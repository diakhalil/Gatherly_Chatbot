"""Idempotent PDF preparation pipeline for document RAG."""

import hashlib
import importlib
import json
import re
import sys
import argparse
import gc
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


loader_module = importlib.import_module("doc_rag.1_loader")
extraction_module = importlib.import_module("doc_rag.2_extraction")
chunking_module = importlib.import_module("doc_rag.4_chunking")
images_module = importlib.import_module("doc_rag.3_images")
embeddings_module = importlib.import_module("doc_rag.5_embeddings")
indexing_module = importlib.import_module("doc_rag.6_indexing")
image_context_module = importlib.import_module(
    "doc_rag.8_image_context"
)
image_ocr_module = importlib.import_module(
    "doc_rag.9_image_ocr"
)
image_embeddings_module = importlib.import_module(
    "doc_rag.10_image_embeddings"
)


load_document = loader_module.load_document
extract_pdf = extraction_module.extract_pdf
chunk_extracted_documents = chunking_module.chunk_extracted_documents
extract_document_images = images_module.extract_document_images
get_or_create_chunk_embeddings = (
    embeddings_module.get_or_create_chunk_embeddings
)
load_embedding_model = embeddings_module.load_embedding_model
index_text_chunks = indexing_module.index_text_chunks
build_document_image_contexts = (
    image_context_module.build_document_image_contexts
)
process_all_image_contexts = (
    image_ocr_module.process_all_image_contexts
)
load_image_records = (
    image_embeddings_module.load_image_records
)

get_or_create_image_embeddings = (
    image_embeddings_module.get_or_create_image_embeddings
)

get_or_create_image_stage_embeddings = (
    image_embeddings_module.get_or_create_image_stage_embeddings
)

index_image_contexts = (
    indexing_module.index_image_contexts
)

index_image_stage1 = indexing_module.index_image_stage1

DEFAULT_ARTIFACT_ROOT = PROJECT_ROOT / "data" / "rag" / "processed_documents"
DEFAULT_CHUNKING_STRATEGY = "semantic"
DEFAULT_CHUNKING_OPTIONS = {
    "similarity_threshold": 0.65,
    "max_chunk_size": 800,
    "unit_prefix": "passage: ",
}
PIPELINE_SCHEMA_VERSION = 1
IMAGE_SCHEMA_VERSION = 2
DEFAULT_EMBEDDING_MODEL = embeddings_module.DEFAULT_MODEL_NAME #bge for index
DEFAULT_CHUNKING_EMBEDDING_MODEL = "intfloat/multilingual-e5-base"


def discover_pdf_files(
    paths: str | Path | Iterable[str | Path],
    recursive: bool = False,
) -> list[Path]:
    """Resolve unique PDF files from file and directory inputs."""
    if isinstance(paths, (str, Path)):
        paths = [paths]

    discovered = []
    for raw_path in paths:
        path = Path(raw_path).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Document input was not found: {path}")
        if path.is_file():
            if path.suffix.lower() != ".pdf":
                raise ValueError(f"Expected a PDF file, received: {path}")
            discovered.append(path)
        else:
            pattern = "**/*.pdf" if recursive else "*.pdf"
            discovered.extend(sorted(path.glob(pattern)))

    unique_files = []
    seen = set()
    for path in discovered:
        resolved = path.resolve()
        key = str(resolved).casefold()
        if key not in seen:
            seen.add(key)
            unique_files.append(resolved)

    if not unique_files:
        raise ValueError("No PDF documents were found in the supplied inputs.")
    return unique_files


def prepare_documents_for_rag(
    paths: str | Path | Iterable[str | Path],
    *,
    recursive: bool = False,
    artifact_root: str | Path = DEFAULT_ARTIFACT_ROOT,
    chunking_strategy: str = DEFAULT_CHUNKING_STRATEGY,
    chunking_options: dict[str, Any] | None = None,
    chunking_model: Any | None = None,
    extraction_options: dict[str, Any] | None = None,
    extract_images: bool = True,
    include_image_bytes: bool = False,
    force: bool = False,
    embedding_device: str | None = None,
    embedding_local_files_only: bool = False,
) -> dict[str, Any]:
    """Prepare PDFs, reusing valid text, chunk, and image artifacts."""
    pdf_files = discover_pdf_files(paths, recursive=recursive)
    artifact_root = Path(artifact_root).resolve()
    artifact_root.mkdir(parents=True, exist_ok=True)
    extraction_options = dict(extraction_options or {})
    chunking_options = (
        dict(DEFAULT_CHUNKING_OPTIONS)
        if chunking_options is None
        else dict(chunking_options)
    )
    # Never persist the embedding model object in chunk cache metadata.
    runtime_chunking_options = {
        key: value
        for key, value in chunking_options.items()
        if key != "model"
    }

    owns_chunking_model = False
    active_chunking_model = chunking_model or chunking_options.get("model")
    if chunking_strategy == "semantic" and active_chunking_model is None:
        active_chunking_model = load_embedding_model(
            DEFAULT_CHUNKING_EMBEDDING_MODEL,
            device=embedding_device,
            local_files_only=embedding_local_files_only,
        )
        owns_chunking_model = True

    document_infos = []
    extracted_documents = []
    extracted_images = []
    chunk_frames = []
    artifact_status = []

    try:
        for path in pdf_files:
            source_sha256 = _sha256_file(path)
            document_dir = _document_artifact_dir(path, artifact_root)
            document_dir.mkdir(parents=True, exist_ok=True)
            document_infos.append(load_document(path))

            document, text_cached = _load_or_extract_text(
                path,
                document_dir,
                source_sha256,
                extraction_options,
                force,
            )
            extracted_documents.append(document)

            create_options = dict(runtime_chunking_options)
            if chunking_strategy == "semantic":
                create_options["model"] = active_chunking_model

            chunks, chunks_cached = _load_or_create_chunks(
                document,
                document_dir,
                source_sha256,
                chunking_strategy,
                create_options,
                force,
            )
            chunk_frames.append(chunks)

            images_cached = None
            if extract_images:
                image_result, images_cached = _load_or_extract_images(
                    path,
                    document_dir,
                    source_sha256,
                    include_image_bytes,
                    force,
                )
                extracted_images.append(image_result)

            artifact_status.append({
                "file_name": path.name,
                "source_path": str(path),
                "artifact_directory": str(document_dir),
                "text_cache_hit": text_cached,
                "chunks_cache_hit": chunks_cached,
                "images_cache_hit": images_cached,
            })
    finally:
        if owns_chunking_model:
            _release_embedding_memory()

    all_chunks = pd.concat(chunk_frames, ignore_index=True)
    _validate_pipeline_output(extracted_documents, all_chunks)

    return {
        "source_files": pdf_files,
        "document_infos": document_infos,
        "extracted_documents": extracted_documents,
        "extracted_images": extracted_images,
        "chunks": all_chunks,
        "chunking_strategy": chunking_strategy,
        "chunking_options": runtime_chunking_options,
        "artifact_root": artifact_root,
        "artifact_status": pd.DataFrame(artifact_status),
    }


def prepare_document_for_rag(path: str | Path, **kwargs: Any) -> dict[str, Any]:
    """Prepare one PDF with the same pipeline used for document batches."""
    return prepare_documents_for_rag(Path(path).resolve(), **kwargs)


def _load_or_extract_text(
    path, document_dir, source_sha256, extraction_options, force,
):
    cache_file = document_dir / "extracted_text.json"
    expected = {
        "schema_version": PIPELINE_SCHEMA_VERSION,
        "source_sha256": source_sha256,
        "extraction_options": extraction_options,
    }
    cached = None if force else _read_json(cache_file)
    if cached and _metadata_matches(cached, expected) and "document" in cached:
        return cached["document"], True

    document = extract_pdf(path, **extraction_options)
    _write_json_atomic(cache_file, {**expected, "document": document})
    return document, False


def _load_or_create_chunks(
    document, document_dir, source_sha256, strategy, options, force,
):
    cache_file = document_dir / "chunks.json"
    cache_options = {
        key: value for key, value in options.items() if key != "model"
    }
    expected = {
        "schema_version": PIPELINE_SCHEMA_VERSION,
        "source_sha256": source_sha256,
        "chunking_strategy": strategy,
        "chunking_options": cache_options,
    }
    cached = None if force else _read_json(cache_file)
    if cached and _metadata_matches(cached, expected) and "chunks" in cached:
        return pd.DataFrame(cached["chunks"]), True

    chunks = chunk_extracted_documents([document], strategy=strategy, **options)
    _write_json_atomic(cache_file, {
        **expected,
        "chunks": chunks.to_dict(orient="records"),
    })
    return chunks, False


def _load_or_extract_images(
    path, document_dir, source_sha256, include_bytes, force,
):
    images_dir = document_dir / "images"
    manifest_file = images_dir / "manifest.json"
    expected = {
        "schema_version": IMAGE_SCHEMA_VERSION,
        "source_sha256": source_sha256,
    }
    manifest = None if force else _read_json(manifest_file)

    if manifest and _metadata_matches(manifest, expected):
        image_files_valid = all(
            (images_dir / image["stored_file_name"]).is_file()
            and (images_dir / image["stored_file_name"]).stat().st_size > 0
            for image in manifest.get("images", [])
        )
        if image_files_valid:
            return _materialize_image_result(
                manifest, images_dir, include_bytes
            ), True

    images_dir.mkdir(parents=True, exist_ok=True)
    extracted = extract_document_images(path, include_bytes=True)
    manifest_images = []

    for index, image in enumerate(extracted["images"], start=1):
        extension = re.sub(r"[^a-zA-Z0-9]", "", image["extension"]) or "bin"
        stored_name = (
            f"image_{index:04d}_{image['digest'][:16]}.{extension.lower()}"
        )
        _write_bytes_atomic(images_dir / stored_name, image["image_bytes"])
        metadata = {
            key: value
            for key, value in image.items()
            if key != "image_bytes"
        }
        metadata["stored_file_name"] = stored_name
        manifest_images.append(metadata)

    manifest = {
        **expected,
        "file_name": extracted["file_name"],
        "source_path": extracted["source_path"],
        "unique_image_count": len(manifest_images),
        "images": manifest_images,
        "unextractable_placements": extracted["unextractable_placements"],
        "unextractable_placement_count": extracted[
            "unextractable_placement_count"
        ],
    }
    _write_json_atomic(manifest_file, manifest)
    stored_names = {image["stored_file_name"] for image in manifest_images}
    for old_image_file in images_dir.glob("image_*"):
        if old_image_file.name not in stored_names and old_image_file.is_file():
            old_image_file.unlink()
    return _materialize_image_result(manifest, images_dir, include_bytes), False


def _materialize_image_result(manifest, images_dir, include_bytes):
    result = dict(manifest)
    result["manifest_path"] = str(images_dir / "manifest.json")
    result["images"] = []
    for stored in manifest.get("images", []):
        image = dict(stored)
        image_path = images_dir / image["stored_file_name"]
        image["image_path"] = str(image_path)
        if include_bytes:
            image["image_bytes"] = image_path.read_bytes()
        result["images"].append(image)
    return result


def _document_artifact_dir(path: Path, artifact_root: Path) -> Path:
    safe_name = re.sub(r"[^\w.-]+", "_", path.stem, flags=re.UNICODE).strip("._")
    safe_name = safe_name or "document"
    path_hash = hashlib.sha256(
        str(path.resolve()).casefold().encode("utf-8")
    ).hexdigest()[:8]
    return artifact_root / f"{safe_name}__{path_hash}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _metadata_matches(payload, expected) -> bool:
    return all(payload.get(key) == value for key, value in expected.items())


def _read_json(path: Path):
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError):
        return None


def _write_json_atomic(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    temporary.replace(path)


def _write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def _validate_pipeline_output(extracted_documents, chunks) -> None:
    if chunks.empty:
        raise ValueError("The selected documents produced no text chunks.")
    if chunks["chunk_id"].duplicated().any():
        raise ValueError("Duplicate chunk IDs were generated.")
    if chunks["text"].str.strip().eq("").any():
        raise ValueError("At least one generated chunk has empty text.")
    if chunks["page_number"].lt(1).any():
        raise ValueError("At least one chunk has an invalid page number.")

    expected_sources = {
        str(Path(document["source_path"]).resolve()).casefold()
        for document in extracted_documents
        if any(page.get("final_text", "").strip() for page in document["pages"])
    }
    chunk_sources = {
        str(Path(value).resolve()).casefold()
        for value in chunks["source_path"].unique()
    }
    if expected_sources - chunk_sources:
        raise ValueError("At least one extracted document is missing chunks.")


def run_pipeline(
    paths: str | Path | Iterable[str | Path],
    *,
    create_embeddings: bool = True,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    embedding_device: str | None = None,
    embedding_batch_size: int = embeddings_module.DEFAULT_BATCH_SIZE,
    embedding_local_files_only: bool = False,
    force_embeddings: bool = False,
    create_index: bool = True,
    qdrant_url: str = indexing_module.DEFAULT_QDRANT_URL,
    qdrant_collection: str = indexing_module.DEFAULT_COLLECTION_NAME,
    create_image_embeddings: bool = True,
    create_image_index: bool = True,
    build_image_contexts: bool = True,
    image_collection: str = indexing_module.IMAGE_COLLECTION_NAME,
    image_embedding_batch_size: int = (
        image_embeddings_module.DEFAULT_CONTEXT_BATCH_SIZE
    ),
    **kwargs: Any,
) -> dict[str, Any]:
    """Run the complete text and image document-RAG pipeline."""

    prepare_kwargs = dict(kwargs)
    prepare_kwargs.setdefault("embedding_device", embedding_device)
    prepare_kwargs.setdefault(
        "embedding_local_files_only",
        embedding_local_files_only,
    )
    result = prepare_documents_for_rag(
        paths,
        **prepare_kwargs,
    )

    result["text_embeddings"] = None
    result["qdrant_index"] = None
    result["image_contexts"] = []
    result["image_ocr"] = None
    result["image_embeddings"] = None
    result["image_qdrant_index"] = None

    result["image_stage_embeddings"] = None
    result["image_stage1_qdrant_index"] = None

    extract_images_enabled = kwargs.get(
        "extract_images",
        True,
    )

    force_artifacts = bool(
        kwargs.get("force", False)
    )

    # Text embedding and indexing
    if create_embeddings:
        try:
            result["text_embeddings"] = (
                get_or_create_chunk_embeddings(
                    result["chunks"],
                    model_name=embedding_model,
                    device=embedding_device,
                    local_files_only=embedding_local_files_only,
                    batch_size=embedding_batch_size,
                    force=force_embeddings,
                )
            )
        finally:
            _release_embedding_memory()

        if create_index:
            result["qdrant_index"] = index_text_chunks(
                result["chunks"],
                result["text_embeddings"]["embeddings"],
                url=qdrant_url,
                collection_name=qdrant_collection,
            )

    # Image context, OCR, embedding, and indexing
    if extract_images_enabled and create_image_embeddings:
        if build_image_contexts:
            for artifact_directory in result[
                "artifact_status"
            ]["artifact_directory"]:
                context_result = (
                    build_document_image_contexts(
                        artifact_directory,
                        force=force_artifacts,
                    )
                )

                result["image_contexts"].append(
                    context_result
                )

        result["image_ocr"] = (
            process_all_image_contexts(
                result["artifact_root"],
                force=force_artifacts,
            )
        )

        image_records = load_image_records(
            result["artifact_root"]
        )

        try:
            result["image_embeddings"] = (
                get_or_create_image_embeddings(
                    image_records,
                    device=embedding_device,
                    context_batch_size=(
                        image_embedding_batch_size
                    ),
                    local_files_only=(
                        embedding_local_files_only
                    ),
                    include_ocr=True,
                    force=force_embeddings,
                )
            )
        finally:
            _release_embedding_memory()

        try:
            result["image_stage_embeddings"] = (
                get_or_create_image_stage_embeddings(
                    image_records,
                    device=embedding_device,
                    context_batch_size=image_embedding_batch_size,
                    local_files_only=embedding_local_files_only,
                    force=force_embeddings,
                )
            )
        finally:
            _release_embedding_memory()

        if create_index and create_image_index:
            result["image_qdrant_index"] = (
                index_image_contexts(
                    result["image_embeddings"][
                        "metadata"
                    ]["images"],
                    result["image_embeddings"][
                        "context_embeddings"
                    ],
                    url=qdrant_url,
                    collection_name=image_collection,
                )
            )

            result["image_stage1_qdrant_index"] = (
                index_image_stage1(
                    result["image_stage_embeddings"]["metadata"]["images"],
                    result["image_stage_embeddings"]["stage1_embeddings"],
                    url=qdrant_url,
                )
            )

        

    return result

def _release_embedding_memory() -> None:
    """Release unused Python and CUDA memory after the embedding stage."""
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except (ImportError, RuntimeError):
        pass


def main() -> None:
    """Run the preparation pipeline from a terminal."""
    parser = argparse.ArgumentParser(
        description=(
            "Extract PDF text and images, create chunks, and embed the text."
        )
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        default=[PROJECT_ROOT / "docs"],
        help="PDF files or directories. Defaults to the project's docs folder.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Rebuild artifacts instead of using valid cached files.",
    )
    parser.add_argument(
        "--no-images",
        action="store_true",
        help="Skip image extraction for this run.",
    )
    parser.add_argument(
        "--no-embeddings",
        action="store_true",
        help="Stop after extraction and chunking; do not embed text.",
    )
    parser.add_argument(
        "--device",
        default=None,
        help="Embedding device, for example cuda or cpu (default: automatic).",
    )
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="Create embeddings but do not upload them to Qdrant.",
    )
    parser.add_argument(
        "--qdrant-url",
        default=indexing_module.DEFAULT_QDRANT_URL,
        help="Qdrant URL (default: http://localhost:6333).",
    )
    parser.add_argument(
        "--collection",
        default=indexing_module.DEFAULT_COLLECTION_NAME,
        help="Qdrant text collection name.",
    )
    
    parser.add_argument(
        "--image-collection",
        default=indexing_module.IMAGE_COLLECTION_NAME,
        help="Qdrant image-context collection name.",
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=embeddings_module.DEFAULT_BATCH_SIZE,
        help="Text embedding batch size (default: 8).",
    )

    parser.add_argument(
        "--image-only",
        action="store_true",
        help=(
            "Reuse existing image_context.json files and rebuild only "
            "OCR, image embeddings, and the image Qdrant index."
        ),
    )

    args = parser.parse_args()

    result = run_pipeline(
        args.paths,
        recursive=True,
        force=(
            False if args.image_only
            else args.force
        ),
        extract_images=not args.no_images,
        create_embeddings=(
            False if args.image_only
            else not args.no_embeddings
        ),
        build_image_contexts=not args.image_only,

        embedding_device=args.device,
        embedding_batch_size=args.batch_size,
        force_embeddings=(
            True if args.image_only
            else args.force
        ),
        create_index=not args.no_index,
        qdrant_url=args.qdrant_url,
        qdrant_collection=args.collection,
        image_collection=args.image_collection,
    )

    image_count = sum(
        document["unique_image_count"]
        for document in result["extracted_images"]
    )
    print("\nPipeline complete")
    print("Documents:", len(result["extracted_documents"]))
    print("Chunking strategy:", result.get("chunking_strategy"))
    print("Text chunks:", len(result["chunks"]))
    print("Extracted images:", image_count)
    print("Artifacts:", result["artifact_root"])
    if result["text_embeddings"] is not None:
        embedding_result = result["text_embeddings"]
        print("Text embedding model:", embedding_result["manifest"]["model_name"])
        print("Embedding shape:", embedding_result["embeddings"].shape)
        print("Embeddings cache hit:", embedding_result["cache_hit"])
        print("Embeddings:", embedding_result["embeddings_file"])
    if result["qdrant_index"] is not None:
        index_result = result["qdrant_index"]
        print("Qdrant URL:", index_result["url"])
        print("Qdrant collection:", index_result["collection_name"])
        print("Indexed text chunks:", index_result["indexed_count"])
        print("Total collection points:", index_result["total_count"])


    if result["image_ocr"] is not None:
        print(
            "Images with OCR text:",
            result["image_ocr"]["images_with_text"],
        )

    if result["image_embeddings"] is not None:
        image_embedding_result = result[
            "image_embeddings"
        ]

        print(
            "Image context model:",
            image_embedding_result[
                "manifest"
            ]["context_model_name"],
        )
        print(
            "Image embedding shape:",
            image_embedding_result[
                "context_embeddings"
            ].shape,
        )
        print(
            "Image embeddings cache hit:",
            image_embedding_result["cache_hit"],
        )
        print(
            "Image embeddings:",
            image_embedding_result[
                "context_embeddings_file"
            ],
        )

    if result["image_qdrant_index"] is not None:
        image_index_result = result[
            "image_qdrant_index"
        ]

        print(
            "Qdrant image collection:",
            image_index_result["collection_name"],
        )
        print(
            "Indexed images:",
            image_index_result["indexed_count"],
        )
        print(
            "Total image points:",
            image_index_result["total_count"],
        )

    print("\nCache status")
    print(result["artifact_status"].to_string(index=False))


if __name__ == "__main__":
    main()
