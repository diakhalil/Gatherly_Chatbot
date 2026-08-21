"""Create rerun-safe textual context embeddings for document images.

The image pixels are not embedded. Each vector represents:

- document name
- section title and local heading
- short nearby text
- VLM-generated visual description, when available
- accepted OCR text, when available

The image path and metadata remain linked to the vector so retrieval can
return the original extracted image.

Run:
    py src/doc_rag/10_image_embeddings.py --device cuda
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import re
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
import torch
from sentence_transformers import SentenceTransformer


PROJECT_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_PROCESSED_ROOT = (
    PROJECT_ROOT / "data" / "rag" / "processed_documents"
)

DEFAULT_OUTPUT_ROOT = (
    PROJECT_ROOT / "data" / "rag" / "image_embeddings"
)

DEFAULT_CONTEXT_MODEL = "intfloat/multilingual-e5-base"
DEFAULT_CONTEXT_BATCH_SIZE = 16
DEFAULT_MAX_SEQUENCE_LENGTH = 512
DEFAULT_STAGE_OUTPUT_ROOT = DEFAULT_OUTPUT_ROOT / "stages"

EMBEDDING_SCHEMA_VERSION = 3
STAGE_EMBEDDING_SCHEMA_VERSION = 1


def load_image_records(
    processed_root: str | Path = DEFAULT_PROCESSED_ROOT,
) -> list[dict[str, Any]]:
    """Load image records from image_context.json (no OCR required)."""

    import importlib

    image_context_module = importlib.import_module(
        "doc_rag.8_image_context"
    )
    records = image_context_module.load_image_context_records(
        processed_root
    )

    missing_images = [
        record["image_path"]
        for record in records
        if not Path(record["image_path"]).is_file()
    ]

    if missing_images:
        raise FileNotFoundError(
            f"{len(missing_images)} extracted image files are missing."
        )

    return records


def build_image_context_text(
    record: dict[str, Any],
    *,
    include_ocr: bool = False,
) -> str:
    """Create the searchable text linked to one extracted image."""

    components: list[str] = []

    document_label = str(
        record.get("document_label")
        or _document_label(record.get("file_name", ""))
    ).strip()

    if document_label:
        components.append(f"Document: {document_label}")

    section_title = _clean_text(
        record.get("section_title", "")
    )

    local_heading = _clean_text(
        record.get("local_heading", "")
    )

    heading_path = record.get("heading_path", [])

    if isinstance(heading_path, str):
        heading_path = [heading_path]

    cleaned_headings: list[str] = []

    for heading in heading_path or []:
        heading = _clean_text(heading)

        if heading and heading not in cleaned_headings:
            cleaned_headings.append(heading)

    for heading in [section_title, local_heading]:
        if heading and heading not in cleaned_headings:
            cleaned_headings.append(heading)

    if cleaned_headings:
        components.append(
            "Topic: " + " > ".join(cleaned_headings)
        )

    nearby_text = _clean_text(
        record.get("nearby_text", "")
    )

    if nearby_text:
        nearby_parts = [
            part.strip()
            for part in nearby_text.split("\n\n")
            if part.strip()
        ]

        heading_set = set(cleaned_headings)

        nearby_parts = [
            part
            for part in nearby_parts
            if part not in heading_set
        ]

        nearby_text = " ".join(nearby_parts).strip()

        if nearby_text:
            components.append(
                "Description: " + nearby_text
            )
    visual_description = _clean_text(
        record.get("visual_description", "")
    )

    if visual_description:
        components.append(
            "Visual description: " + visual_description
        )

    if include_ocr:
        ocr_text = _clean_text(
            record.get("ocr_text", "")
        )

        if ocr_text:
            components.append(
                "Visible text: " + ocr_text
            )

    context_text = "\n".join(components).strip()

    if not context_text:
        raise ValueError(
            f"Image {record.get('image_id')} has no searchable context."
        )

    return context_text


def build_image_stage_texts(
    record: dict[str, Any],
) -> dict[str, str]:
    """Build retrieve-and-rerank texts with heading → nearby → VLM fallback.

    Stage 1 uses structure/PDF text when possible.
    Stage 2 uses only signals that stage 1 did not already consume.
    """

    document_label = str(
        record.get("document_label")
        or _document_label(record.get("file_name", ""))
    ).strip()

    section_title = _clean_text(record.get("section_title", ""))
    local_heading = _clean_text(record.get("local_heading", ""))
    heading_path = record.get("heading_path", [])

    if isinstance(heading_path, str):
        heading_path = [heading_path]

    cleaned_headings: list[str] = []
    for heading in heading_path or []:
        heading = _clean_text(heading)
        if heading and heading not in cleaned_headings:
            cleaned_headings.append(heading)

    for heading in [section_title, local_heading]:
        if heading and heading not in cleaned_headings:
            cleaned_headings.append(heading)

    heading_text = " > ".join(cleaned_headings)

    nearby_text = _clean_text(record.get("nearby_text", ""))
    if nearby_text:
        nearby_parts = [
            part.strip()
            for part in nearby_text.split("\n\n")
            if part.strip() and part.strip() not in set(cleaned_headings)
        ]
        nearby_text = " ".join(nearby_parts).strip()

    visual_description = _clean_text(
        record.get("visual_description", "")
    )

    doc_prefix = f"Document: {document_label}" if document_label else ""

    if heading_text:
        stage1_parts = [part for part in [doc_prefix, f"Topic: {heading_text}"] if part]
        stage1_text = "\n".join(stage1_parts)
        stage1_source = "heading"
        stage2_parts = []
        if nearby_text:
            stage2_parts.append(f"Description: {nearby_text}")
        if visual_description:
            stage2_parts.append(
                f"Visual description: {visual_description}"
            )
        stage2_text = "\n".join(stage2_parts)
        stage2_source = "nearby_vlm" if stage2_text else "none"
    elif nearby_text:
        stage1_parts = [
            part for part in [doc_prefix, f"Description: {nearby_text}"] if part
        ]
        stage1_text = "\n".join(stage1_parts)
        stage1_source = "nearby"
        stage2_text = (
            f"Visual description: {visual_description}"
            if visual_description
            else ""
        )
        stage2_source = "vlm" if stage2_text else "none"
    elif visual_description:
        stage1_parts = [
            part
            for part in [
                doc_prefix,
                f"Visual description: {visual_description}",
            ]
            if part
        ]
        stage1_text = "\n".join(stage1_parts)
        stage1_source = "vlm"
        stage2_text = ""
        stage2_source = "none"
    else:
        raise ValueError(
            f"Image {record.get('image_id')} has no heading, nearby, or VLM text."
        )

    return {
        "stage1_text": stage1_text,
        "stage2_text": stage2_text,
        "stage1_source": stage1_source,
        "stage2_source": stage2_source,
    }


def get_or_create_image_stage_embeddings(
    records: list[dict[str, Any]],
    *,
    output_root: str | Path = DEFAULT_STAGE_OUTPUT_ROOT,
    context_model_name: str = DEFAULT_CONTEXT_MODEL,
    device: str | None = None,
    context_batch_size: int = DEFAULT_CONTEXT_BATCH_SIZE,
    max_sequence_length: int = DEFAULT_MAX_SEQUENCE_LENGTH,
    local_files_only: bool = True,
    force: bool = False,
) -> dict[str, Any]:
    """Cache stage-1 / stage-2 embeddings for retrieve-and-rerank image search."""

    _validate_records(records)

    if context_batch_size <= 0:
        raise ValueError("context_batch_size must be positive.")
    if max_sequence_length <= 0:
        raise ValueError("max_sequence_length must be positive.")

    output_root = Path(output_root).resolve()
    artifact_directory = output_root / _safe_model_name(context_model_name)
    artifact_directory.mkdir(parents=True, exist_ok=True)

    stage1_file = artifact_directory / "stage1_embeddings.npy"
    stage2_file = artifact_directory / "stage2_embeddings.npy"
    metadata_file = artifact_directory / "images.json"
    manifest_file = artifact_directory / "manifest.json"

    stage_payloads = [build_image_stage_texts(record) for record in records]
    fingerprint_source = "\n".join(
        f"{record['image_id']}\t{payload['stage1_source']}\t"
        f"{payload['stage1_text']}\t{payload['stage2_source']}\t"
        f"{payload['stage2_text']}"
        for record, payload in zip(records, stage_payloads)
    )
    records_fingerprint = hashlib.sha256(
        fingerprint_source.encode("utf-8")
    ).hexdigest()

    expected_manifest = {
        "schema_version": STAGE_EMBEDDING_SCHEMA_VERSION,
        "embedding_type": "image_retrieve_rerank_stages",
        "context_model_name": context_model_name,
        "normalized": True,
        "max_sequence_length": max_sequence_length,
        "image_count": len(records),
        "records_fingerprint": records_fingerprint,
    }

    if not force:
        cached = _load_valid_stage_cache(
            stage1_file=stage1_file,
            stage2_file=stage2_file,
            metadata_file=metadata_file,
            manifest_file=manifest_file,
            expected_manifest=expected_manifest,
            records=records,
        )
        if cached is not None:
            return cached

    resolved_device = device or (
        "cuda" if torch.cuda.is_available() else "cpu"
    )
    model = None
    try:
        model_kwargs = (
            {"torch_dtype": torch.float16}
            if resolved_device == "cuda"
            else None
        )
        model = SentenceTransformer(
            context_model_name,
            device=resolved_device,
            local_files_only=local_files_only,
            model_kwargs=model_kwargs,
        )
        model.max_seq_length = max_sequence_length

        stage1_texts = [payload["stage1_text"] for payload in stage_payloads]
        stage2_texts = [
            payload["stage2_text"] or payload["stage1_text"]
            for payload in stage_payloads
        ]

        prepared_stage1 = [
            f"passage: {text}" if "e5" in context_model_name.casefold() else text
            for text in stage1_texts
        ]
        prepared_stage2 = [
            f"passage: {text}" if "e5" in context_model_name.casefold() else text
            for text in stage2_texts
        ]

        started = perf_counter()
        stage1_embeddings = np.asarray(
            model.encode(
                prepared_stage1,
                batch_size=context_batch_size,
                show_progress_bar=True,
                normalize_embeddings=True,
                convert_to_numpy=True,
            ),
            dtype=np.float32,
        )
        stage2_embeddings = np.asarray(
            model.encode(
                prepared_stage2,
                batch_size=context_batch_size,
                show_progress_bar=True,
                normalize_embeddings=True,
                convert_to_numpy=True,
            ),
            dtype=np.float32,
        )
        elapsed_seconds = perf_counter() - started

        _validate_embeddings(stage1_embeddings, expected_rows=len(records))
        _validate_embeddings(stage2_embeddings, expected_rows=len(records))
    finally:
        if model is not None:
            del model
        _release_memory()

    metadata_records = []
    for position, (record, payload) in enumerate(
        zip(records, stage_payloads)
    ):
        metadata = dict(record)
        metadata["embedding_position"] = position
        metadata.update(payload)
        metadata["context_text"] = build_image_context_text(
            record,
            include_ocr=False,
        )
        metadata_records.append(metadata)

    manifest = {
        **expected_manifest,
        "device": resolved_device,
        "context_dimension": int(stage1_embeddings.shape[1]),
        "context_dtype": str(stage1_embeddings.dtype),
        "context_batch_size": context_batch_size,
        "elapsed_seconds": round(elapsed_seconds, 4),
    }
    metadata_payload = {
        "schema_version": STAGE_EMBEDDING_SCHEMA_VERSION,
        "embedding_type": "image_retrieve_rerank_stages",
        "images": metadata_records,
    }

    _write_npy_atomic(stage1_file, stage1_embeddings)
    _write_npy_atomic(stage2_file, stage2_embeddings)
    _write_json_atomic(metadata_file, metadata_payload)
    _write_json_atomic(manifest_file, manifest)

    return {
        "records": records,
        "stage1_embeddings": stage1_embeddings,
        "stage2_embeddings": stage2_embeddings,
        "metadata": metadata_payload,
        "manifest": manifest,
        "artifact_directory": artifact_directory,
        "stage1_embeddings_file": stage1_file,
        "stage2_embeddings_file": stage2_file,
        "metadata_file": metadata_file,
        "manifest_file": manifest_file,
        "cache_hit": False,
    }


def _load_valid_stage_cache(
    *,
    stage1_file: Path,
    stage2_file: Path,
    metadata_file: Path,
    manifest_file: Path,
    expected_manifest: dict[str, Any],
    records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    manifest = _read_json(manifest_file)
    metadata = _read_json(metadata_file)

    if (
        not manifest
        or not metadata
        or not stage1_file.is_file()
        or not stage2_file.is_file()
    ):
        return None

    for key, value in expected_manifest.items():
        if manifest.get(key) != value:
            return None

    stage1 = np.load(stage1_file)
    stage2 = np.load(stage2_file)
    try:
        _validate_embeddings(stage1, expected_rows=len(records))
        _validate_embeddings(stage2, expected_rows=len(records))
        _validate_records(records)
    except ValueError:
        return None

    cached_ids = [
        image.get("image_id") for image in metadata.get("images", [])
    ]
    expected_ids = [record["image_id"] for record in records]
    if cached_ids != expected_ids:
        return None

    return {
        "records": records,
        "stage1_embeddings": np.asarray(stage1, dtype=np.float32),
        "stage2_embeddings": np.asarray(stage2, dtype=np.float32),
        "metadata": metadata,
        "manifest": manifest,
        "artifact_directory": stage1_file.parent,
        "stage1_embeddings_file": stage1_file,
        "stage2_embeddings_file": stage2_file,
        "metadata_file": metadata_file,
        "manifest_file": manifest_file,
        "cache_hit": True,
    }


def get_or_create_image_embeddings(
    records: list[dict[str, Any]],
    *,
    output_root: str | Path = DEFAULT_OUTPUT_ROOT,
    context_model_name: str = DEFAULT_CONTEXT_MODEL,
    device: str | None = None,
    context_batch_size: int = DEFAULT_CONTEXT_BATCH_SIZE,
    max_sequence_length: int = DEFAULT_MAX_SEQUENCE_LENGTH,
    local_files_only: bool = True,
    include_ocr: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    """Load cached context embeddings or generate them."""

    _validate_records(records)

    if context_batch_size <= 0:
        raise ValueError(
            "context_batch_size must be positive."
        )

    if max_sequence_length <= 0:
        raise ValueError(
            "max_sequence_length must be positive."
        )

    output_root = Path(output_root).resolve()

    artifact_directory = (
        output_root / _safe_model_name(context_model_name)
    )

    artifact_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    embeddings_file = (
        artifact_directory / "context_embeddings.npy"
    )

    metadata_file = artifact_directory / "images.json"
    manifest_file = artifact_directory / "manifest.json"

    records_fingerprint = _records_fingerprint(
        records,
        include_ocr=include_ocr,
    )

    expected_manifest = {
        "schema_version": EMBEDDING_SCHEMA_VERSION,
        "embedding_type": "image_text_context",
        "context_model_name": context_model_name,
        "normalized": True,
        "include_ocr": include_ocr,
        "max_sequence_length": max_sequence_length,
        "image_count": len(records),
        "records_fingerprint": records_fingerprint,
    }

    if not force:
        cached = _load_valid_cache(
            embeddings_file=embeddings_file,
            metadata_file=metadata_file,
            manifest_file=manifest_file,
            expected_manifest=expected_manifest,
            records=records,
        )

        if cached is not None:
            embeddings, metadata, manifest = cached

            return _build_result(
                records=records,
                embeddings=embeddings,
                metadata=metadata,
                manifest=manifest,
                artifact_directory=artifact_directory,
                cache_hit=True,
            )

    resolved_device = (
        device
        or (
            "cuda"
            if torch.cuda.is_available()
            else "cpu"
        )
    )

    model = None

    try:
        model_kwargs = None

        if resolved_device == "cuda":
            model_kwargs = {
                "torch_dtype": torch.float16,
            }

        model = SentenceTransformer(
            context_model_name,
            device=resolved_device,
            local_files_only=local_files_only,
            model_kwargs=model_kwargs,
        )

        model.max_seq_length = max_sequence_length

        context_texts = [
            build_image_context_text(
                record,
                include_ocr=include_ocr,
            )
            for record in records
        ]

        prepared_contexts = [
            (
                f"passage: {text}"
                if "e5" in context_model_name.casefold()
                else text
            )
            for text in context_texts
        ]

        started = perf_counter()

        embeddings = np.asarray(
            model.encode(
                prepared_contexts,
                batch_size=context_batch_size,
                show_progress_bar=True,
                normalize_embeddings=True,
                convert_to_numpy=True,
            ),
            dtype=np.float32,
        )

        elapsed_seconds = perf_counter() - started

        _validate_embeddings(
            embeddings,
            expected_rows=len(records),
        )

    finally:
        if model is not None:
            del model

        _release_memory()

    metadata_records = []

    for position, record in enumerate(records):
        metadata = dict(record)

        metadata["embedding_position"] = position

        metadata["context_text"] = build_image_context_text(
            record,
            include_ocr=include_ocr,
        )

        metadata_records.append(metadata)

    manifest = {
        **expected_manifest,
        "device": resolved_device,
        "context_dimension": int(embeddings.shape[1]),
        "context_dtype": str(embeddings.dtype),
        "context_batch_size": context_batch_size,
        "elapsed_seconds": round(elapsed_seconds, 4),
    }

    metadata_payload = {
        "schema_version": EMBEDDING_SCHEMA_VERSION,
        "embedding_type": "image_text_context",
        "images": metadata_records,
    }

    _write_npy_atomic(
        embeddings_file,
        embeddings,
    )

    _write_json_atomic(
        metadata_file,
        metadata_payload,
    )

    _write_json_atomic(
        manifest_file,
        manifest,
    )

    return _build_result(
        records=records,
        embeddings=embeddings,
        metadata=metadata_payload,
        manifest=manifest,
        artifact_directory=artifact_directory,
        cache_hit=False,
    )


def encode_image_query(
    query: str,
    *,
    model: SentenceTransformer,
    context_model_name: str = DEFAULT_CONTEXT_MODEL,
) -> np.ndarray:
    """Embed an image-retrieval query using the selected text model."""

    query = _clean_text(query)

    if not query:
        raise ValueError("The query cannot be empty.")

    prepared_query = (
        f"query: {query}"
        if "e5" in context_model_name.casefold()
        else query
    )

    embedding = np.asarray(
        model.encode(
            [prepared_query],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        ),
        dtype=np.float32,
    )

    _validate_embeddings(
        embedding,
        expected_rows=1,
    )

    return embedding[0]


def _load_valid_cache(
    *,
    embeddings_file: Path,
    metadata_file: Path,
    manifest_file: Path,
    expected_manifest: dict[str, Any],
    records: list[dict[str, Any]],
):
    manifest = _read_json(manifest_file)
    metadata = _read_json(metadata_file)

    if (
        not manifest
        or not metadata
        or not embeddings_file.is_file()
    ):
        return None

    if not all(
        manifest.get(key) == value
        for key, value in expected_manifest.items()
    ):
        return None

    saved_images = metadata.get("images", [])

    saved_ids = [
        image.get("image_id")
        for image in saved_images
    ]

    expected_ids = [
        record["image_id"]
        for record in records
    ]

    if saved_ids != expected_ids:
        return None

    try:
        embeddings = np.load(
            embeddings_file,
            allow_pickle=False,
        )

        _validate_embeddings(
            embeddings,
            expected_rows=len(records),
        )

    except (OSError, ValueError):
        return None

    if (
        manifest.get("context_dimension")
        != embeddings.shape[1]
    ):
        return None

    return embeddings, metadata, manifest


def _records_fingerprint(
    records: list[dict[str, Any]],
    *,
    include_ocr: bool,
) -> str:
    digest = hashlib.sha256()

    for record in records:
        values = [
            record["image_id"],
            record.get("image_sha256", ""),
            record.get("file_name", ""),
            record.get("document_label", ""),
            record.get("section_title", ""),
            record.get("local_heading", ""),
            json.dumps(
                record.get("heading_path", []),
                ensure_ascii=False,
                sort_keys=True,
            ),
            record.get("nearby_text", ""),
            record.get("visual_description", ""),
            (
                record.get("ocr_text", "")
                if include_ocr
                else ""
            ),
        ]

        for value in values:
            digest.update(
                str(value).encode("utf-8")
            )
            digest.update(b"\0")

    return digest.hexdigest()


def _validate_records(
    records: list[dict[str, Any]],
) -> None:
    if not isinstance(records, list):
        raise TypeError("records must be a list.")

    if not records:
        raise ValueError("records cannot be empty.")

    required_fields = {
        "image_id",
        "image_path",
        "file_name",
        "page_numbers",
        "nearby_text",
    }

    image_ids = []

    for record in records:
        missing = required_fields - set(record)

        if missing:
            raise ValueError(
                "Image record is missing fields: "
                + ", ".join(sorted(missing))
            )

        image_ids.append(record["image_id"])

    if len(image_ids) != len(set(image_ids)):
        raise ValueError("Image IDs must be unique.")


def _validate_embeddings(
    embeddings: np.ndarray,
    *,
    expected_rows: int,
) -> None:
    if embeddings.ndim != 2:
        raise ValueError(
            f"Embeddings must be 2D: {embeddings.shape}"
        )

    if embeddings.shape[0] != expected_rows:
        raise ValueError(
            "Embedding row count does not match image count."
        )

    if embeddings.shape[1] == 0:
        raise ValueError(
            "Embedding dimension cannot be empty."
        )

    if not np.isfinite(embeddings).all():
        raise ValueError(
            "Embeddings contain NaN or infinite values."
        )


def _build_result(
    *,
    records: list[dict[str, Any]],
    embeddings: np.ndarray,
    metadata: dict[str, Any],
    manifest: dict[str, Any],
    artifact_directory: Path,
    cache_hit: bool,
) -> dict[str, Any]:
    return {
        "records": records,
        "context_embeddings": embeddings,
        "metadata": metadata,
        "manifest": manifest,
        "artifact_directory": artifact_directory,
        "context_embeddings_file": (
            artifact_directory / "context_embeddings.npy"
        ),
        "metadata_file": artifact_directory / "images.json",
        "manifest_file": artifact_directory / "manifest.json",
        "cache_hit": cache_hit,
    }


def _document_label(file_name: str) -> str:
    stem = Path(str(file_name)).stem
    label = re.sub(r"[_\-]+", " ", stem)
    return re.sub(r"\s+", " ", label).strip()


def _clean_text(text: Any) -> str:
    text = str(text or "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _safe_model_name(model_name: str) -> str:
    safe = re.sub(
        r"[^a-zA-Z0-9._-]+",
        "__",
        model_name,
    ).strip("._")

    return safe or "model"


def _release_memory() -> None:
    gc.collect()

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

        try:
            torch.cuda.ipc_collect()
        except RuntimeError:
            pass


def _read_required_json(path: Path) -> dict[str, Any]:
    payload = _read_json(path)

    if payload is None:
        raise FileNotFoundError(
            f"Required JSON file is missing or invalid: {path}"
        )

    return payload


def _read_json(path: Path) -> dict[str, Any] | None:
    if not Path(path).is_file():
        return None

    try:
        with Path(path).open(
            encoding="utf-8"
        ) as file:
            return json.load(file)

    except (OSError, json.JSONDecodeError):
        return None


def _write_json_atomic(
    path: Path,
    payload: dict[str, Any],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    temporary = path.with_suffix(
        path.suffix + ".tmp"
    )

    with temporary.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            payload,
            file,
            ensure_ascii=False,
            indent=2,
        )

    temporary.replace(path)


def _write_npy_atomic(
    path: Path,
    embeddings: np.ndarray,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    temporary = path.with_suffix(
        path.suffix + ".tmp"
    )

    with temporary.open("wb") as file:
        np.save(
            file,
            embeddings,
            allow_pickle=False,
        )

    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create cached textual context embeddings "
            "for extracted document images."
        )
    )

    parser.add_argument(
        "--processed-root",
        type=Path,
        default=DEFAULT_PROCESSED_ROOT,
    )

    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
    )

    parser.add_argument(
        "--device",
        default=None,
        help="Embedding device, such as cuda or cpu.",
    )

    parser.add_argument(
        "--context-batch-size",
        type=int,
        default=DEFAULT_CONTEXT_BATCH_SIZE,
    )

    parser.add_argument(
        "--with-ocr",
        action="store_true",
        help="Include accepted OCR text in full-context embeddings.",
    )

    parser.add_argument(
        "--stages",
        action="store_true",
        help="Also build cached retrieve-and-rerank stage embeddings.",
    )

    parser.add_argument(
        "--allow-downloads",
        action="store_true",
        help=(
            "Allow model downloads when the selected "
            "model is not already cached."
        ),
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Regenerate embeddings instead of using "
            "a valid cache."
        ),
    )

    args = parser.parse_args()

    records = load_image_records(
        args.processed_root
    )

    result = get_or_create_image_embeddings(
        records,
        output_root=args.output_root,
        device=args.device,
        context_batch_size=args.context_batch_size,
        local_files_only=not args.allow_downloads,
        include_ocr=args.with_ocr,
        force=args.force,
    )

    print("\nImage context embeddings complete")
    print("Images:", len(records))
    print(
        "Model:",
        result["manifest"]["context_model_name"],
    )
    print(
        "Embedding shape:",
        result["context_embeddings"].shape,
    )
    print(
        "OCR included:",
        result["manifest"]["include_ocr"],
    )
    print("Cache hit:", result["cache_hit"])
    print("Artifacts:", result["artifact_directory"])

    if args.stages:
        stage_result = get_or_create_image_stage_embeddings(
            records,
            device=args.device,
            context_batch_size=args.context_batch_size,
            local_files_only=not args.allow_downloads,
            force=args.force,
        )
        print("\nImage stage embeddings complete")
        print("Cache hit:", stage_result["cache_hit"])
        print("Artifacts:", stage_result["artifact_directory"])


if __name__ == "__main__":
    main()
    