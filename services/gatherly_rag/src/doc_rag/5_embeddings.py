"""Idempotent text embedding utilities for prepared document chunks."""

import hashlib
import json
import re
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_NAME = "BAAI/bge-m3"
DEFAULT_EMBEDDING_ROOT = PROJECT_ROOT / "data" / "rag" / "embeddings"
DEFAULT_BATCH_SIZE = 1
DEFAULT_MAX_SEQUENCE_LENGTH = 512
EMBEDDING_SCHEMA_VERSION = 1


def load_embedding_model(
    model_name: str = DEFAULT_MODEL_NAME,
    *,
    device: str | None = None,
    local_files_only: bool = False,
    max_sequence_length: int = DEFAULT_MAX_SEQUENCE_LENGTH,
    model_kwargs: dict[str, Any] | None = None,
):
    """Load a Sentence Transformers model only when embeddings are required."""
    from sentence_transformers import SentenceTransformer

    if max_sequence_length <= 0:
        raise ValueError("max_sequence_length must be greater than zero.")

    model = SentenceTransformer(
        model_name,
        device=device,
        local_files_only=local_files_only,
        model_kwargs=model_kwargs,
    )
    model.max_seq_length = max_sequence_length
    return model


def prepare_texts(
    texts: list[str],
    model_name: str,
    text_type: str,
) -> list[str]:
    """Apply model-specific passage or query prefixes."""
    if text_type not in {"passage", "query"}:
        raise ValueError("text_type must be 'passage' or 'query'.")

    cleaned = [str(text).strip() for text in texts]
    if any(not text for text in cleaned):
        raise ValueError("Embedding input contains empty text.")

    if "e5" in model_name.casefold():
        prefix = "passage: " if text_type == "passage" else "query: "
        return [prefix + text for text in cleaned]

    return cleaned


def embed_texts(
    texts: list[str],
    model,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    show_progress_bar: bool = True,
) -> np.ndarray:
    """Create normalized float32 embeddings and validate their shape."""
    if batch_size <= 0:
        raise ValueError("batch_size must be greater than zero.")
    if not texts:
        raise ValueError("At least one text is required for embedding.")

    embeddings = np.asarray(
        model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=show_progress_bar,
            normalize_embeddings=True,
        ),
        dtype=np.float32,
    )
    _validate_embeddings(embeddings, expected_rows=len(texts))
    return embeddings


def get_or_create_chunk_embeddings(
    chunks: pd.DataFrame,
    *,
    model_name: str = DEFAULT_MODEL_NAME,
    embedding_root: str | Path = DEFAULT_EMBEDDING_ROOT,
    model=None,
    device: str | None = None,
    local_files_only: bool = True,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_sequence_length: int = DEFAULT_MAX_SEQUENCE_LENGTH,
    model_kwargs: dict[str, Any] | None = None,
    force: bool = False,
    show_progress_bar: bool = True,
) -> dict[str, Any]:
    """Load valid cached chunk embeddings or create them idempotently."""
    _validate_chunks(chunks)
    chunks = chunks.reset_index(drop=True).copy()
    artifact_dir = Path(embedding_root).resolve() / _safe_model_name(model_name)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    embeddings_file = artifact_dir / "embeddings.npy"
    chunks_file = artifact_dir / "chunks.json"
    manifest_file = artifact_dir / "manifest.json"

    chunk_fingerprint = _chunk_fingerprint(chunks)
    expected_manifest = {
        "schema_version": EMBEDDING_SCHEMA_VERSION,
        "model_name": model_name,
        "normalized": True,
        "text_type": "passage",
        "max_sequence_length": max_sequence_length,
        "chunk_count": len(chunks),
        "chunk_fingerprint": chunk_fingerprint,
    }

    if not force:
        cached = _load_valid_cache(
            manifest_file,
            embeddings_file,
            chunks_file,
            expected_manifest,
            chunks,
        )
        if cached is not None:
            embeddings, manifest = cached
            return _build_result(
                chunks, embeddings, manifest, artifact_dir, cache_hit=True
            )

    if model is None:
        model = load_embedding_model(
            model_name,
            device=device,
            local_files_only=local_files_only,
            max_sequence_length=max_sequence_length,
            model_kwargs=model_kwargs,
        )

    prepared = prepare_texts(
        chunks["text"].tolist(), model_name=model_name, text_type="passage"
    )
    started = perf_counter()
    embeddings = embed_texts(
        prepared,
        model,
        batch_size=batch_size,
        show_progress_bar=show_progress_bar,
    )
    elapsed_seconds = perf_counter() - started

    manifest = {
        **expected_manifest,
        "embedding_dimension": int(embeddings.shape[1]),
        "embedding_dtype": str(embeddings.dtype),
        "batch_size": batch_size,
        "elapsed_seconds": round(elapsed_seconds, 4),
    }
    _write_npy_atomic(embeddings_file, embeddings)
    _write_json_atomic(
        chunks_file,
        {"chunk_ids": chunks["chunk_id"].tolist()},
    )
    _write_json_atomic(manifest_file, manifest)
    return _build_result(
        chunks, embeddings, manifest, artifact_dir, cache_hit=False
    )


def embed_queries(
    queries: list[str],
    *,
    model,
    model_name: str = DEFAULT_MODEL_NAME,
    batch_size: int = DEFAULT_BATCH_SIZE,
    show_progress_bar: bool = False,
) -> np.ndarray:
    """Embed retrieval queries with the correct model-specific preparation."""
    prepared = prepare_texts(
        queries, model_name=model_name, text_type="query"
    )
    return embed_texts(
        prepared,
        model,
        batch_size=batch_size,
        show_progress_bar=show_progress_bar,
    )


def cosine_search(
    query_embeddings: np.ndarray,
    chunk_embeddings: np.ndarray,
    *,
    top_k: int = 5,
) -> tuple[np.ndarray, np.ndarray]:
    """Return cosine scores and row positions for normalized embeddings."""
    query_embeddings = np.asarray(query_embeddings, dtype=np.float32)
    chunk_embeddings = np.asarray(chunk_embeddings, dtype=np.float32)
    _validate_embeddings(query_embeddings)
    _validate_embeddings(chunk_embeddings)

    if query_embeddings.shape[1] != chunk_embeddings.shape[1]:
        raise ValueError("Query and chunk embedding dimensions do not match.")
    if top_k <= 0:
        raise ValueError("top_k must be greater than zero.")

    top_k = min(top_k, chunk_embeddings.shape[0])
    similarities = query_embeddings @ chunk_embeddings.T
    positions = np.argsort(-similarities, axis=1)[:, :top_k]
    scores = np.take_along_axis(similarities, positions, axis=1)
    return scores, positions


def _load_valid_cache(
    manifest_file, embeddings_file, chunks_file, expected, chunks,
):
    manifest = _read_json(manifest_file)
    saved_chunks = _read_json(chunks_file)
    if not manifest or not saved_chunks or not embeddings_file.is_file():
        return None
    if not all(manifest.get(key) == value for key, value in expected.items()):
        return None
    if saved_chunks.get("chunk_ids") != chunks["chunk_id"].tolist():
        return None

    try:
        embeddings = np.load(embeddings_file, allow_pickle=False)
        _validate_embeddings(embeddings, expected_rows=len(chunks))
    except (OSError, ValueError):
        return None
    if manifest.get("embedding_dimension") != embeddings.shape[1]:
        return None
    return embeddings, manifest


def _validate_chunks(chunks: pd.DataFrame) -> None:
    if not isinstance(chunks, pd.DataFrame):
        raise TypeError("chunks must be a pandas DataFrame.")
    required = {"chunk_id", "text"}
    missing = required - set(chunks.columns)
    if missing:
        raise ValueError("Chunks are missing columns: " + ", ".join(sorted(missing)))
    if chunks.empty:
        raise ValueError("The chunk DataFrame is empty.")
    if chunks["chunk_id"].duplicated().any():
        raise ValueError("Chunk IDs must be unique.")
    if chunks["text"].astype(str).str.strip().eq("").any():
        raise ValueError("Chunks contain empty text.")


def _validate_embeddings(
    embeddings: np.ndarray,
    expected_rows: int | None = None,
) -> None:
    if embeddings.ndim != 2:
        raise ValueError(f"Embeddings must be 2D; received {embeddings.shape}.")
    if expected_rows is not None and embeddings.shape[0] != expected_rows:
        raise ValueError("Embedding rows do not match the expected text count.")
    if embeddings.shape[0] == 0 or embeddings.shape[1] == 0:
        raise ValueError("Embeddings cannot have an empty dimension.")
    if not np.isfinite(embeddings).all():
        raise ValueError("Embeddings contain NaN or infinite values.")


def _chunk_fingerprint(chunks: pd.DataFrame) -> str:
    digest = hashlib.sha256()
    for row in chunks[["chunk_id", "text"]].itertuples(index=False):
        digest.update(str(row.chunk_id).encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(row.text).encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def _safe_model_name(model_name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "__", model_name).strip("._")
    return safe or "embedding_model"


def _build_result(chunks, embeddings, manifest, artifact_dir, cache_hit):
    return {
        "chunks": chunks,
        "embeddings": embeddings,
        "manifest": manifest,
        "artifact_directory": artifact_dir,
        "embeddings_file": artifact_dir / "embeddings.npy",
        "chunks_file": artifact_dir / "chunks.json",
        "manifest_file": artifact_dir / "manifest.json",
        "cache_hit": cache_hit,
    }


def _read_json(path: Path):
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return None


def _write_json_atomic(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    temporary.replace(path)


def _write_npy_atomic(path: Path, embeddings: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as file:
        np.save(file, embeddings, allow_pickle=False)
    temporary.replace(path)
