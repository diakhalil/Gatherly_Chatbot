"""Comparable retrieval strategies for multilingual PDF text chunks."""

from __future__ import annotations

from collections.abc import Iterable
import json
from pathlib import Path
import re
from typing import Protocol

import numpy as np
import pandas as pd
from qdrant_client import QdrantClient, models
from sklearn.feature_extraction.text import TfidfVectorizer


DEFAULT_MODEL_NAME = "BAAI/bge-m3"
DEFAULT_RERANKER_MODEL = (
    "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
)
DEFAULT_RETRIEVAL_METHOD = "hybrid_rrf"
DEFAULT_COLLECTION_NAME = "gatherly_document_text_bge_m3_v1"
DEFAULT_IMAGE_COLLECTION_NAME = (
    "gatherly_document_images_e5_v1"
)
DEFAULT_IMAGE_RETRIEVAL_METHOD = "retrieve_rerank_fallback"
DEFAULT_IMAGE_CANDIDATE_K = 15
DEFAULT_IMAGE_CONFIDENCE_THRESHOLD = 0.82
DEFAULT_THEME_RERANK_LAMBDA = 0.15  

DEFAULT_IMAGE_CONTEXT_MODEL = "intfloat/multilingual-e5-base"
DEFAULT_QUERY_PREFIX = "query: "
DEFAULT_TOP_K = 5
DEFAULT_CANDIDATE_K = 30
RESULT_COLUMNS = ("rank", "score", "chunk_id", "file_name", "page_number", "text") 
IMAGE_RETRIEVAL_METHODS = (
    "context_dense",
    "retrieve_rerank",
    "retrieve_rerank_section",
    "retrieve_rerank_fallback",
)


class QueryEmbeddingModel(Protocol):
    def encode(self, sentences, **kwargs): ...


class RerankerModel(Protocol):
    def predict(self, sentences, **kwargs): ...


def embed_query(query, model, *, model_name=DEFAULT_MODEL_NAME):
    """Embed one query with required model-specific formatting."""
    query = _validate_query(query)
    prepared = f"{DEFAULT_QUERY_PREFIX}{query}" if "e5" in model_name.casefold() else query
    vector = np.asarray(model.encode(
        [prepared], normalize_embeddings=True, convert_to_numpy=True
    ), dtype=np.float32)
    if vector.ndim != 2 or vector.shape[0] != 1 or not np.isfinite(vector).all():
        raise ValueError("The embedding model returned an invalid query vector.")
    return vector[0]


def cosine_search(query_embedding, corpus_embeddings, *, top_k=5):
    """Return row positions and exact cosine scores in descending order."""
    query_embedding = np.asarray(query_embedding, dtype=np.float32).reshape(-1)
    corpus_embeddings = np.asarray(corpus_embeddings, dtype=np.float32)
    _validate_top_k(top_k)
    if corpus_embeddings.ndim != 2 or corpus_embeddings.shape[0] == 0:
        raise ValueError("corpus_embeddings must be a non-empty 2D matrix.")
    if query_embedding.shape[0] != corpus_embeddings.shape[1]:
        raise ValueError("Query and corpus embedding dimensions do not match.")
    if not np.isfinite(query_embedding).all() or not np.isfinite(corpus_embeddings).all():
        raise ValueError("Embeddings contain NaN or infinite values.")
    query_norm = np.linalg.norm(query_embedding)
    corpus_norms = np.linalg.norm(corpus_embeddings, axis=1)
    if query_norm == 0 or np.any(corpus_norms == 0):
        raise ValueError("Zero-length embedding vectors are not supported.")
    scores = (corpus_embeddings @ query_embedding) / (corpus_norms * query_norm)
    count = min(top_k, len(scores))
    positions = np.argsort(-scores, kind="stable")[:count]
    return positions, scores[positions]


def retrieve_dense(query, model, corpus_embeddings, chunks_df, *, top_k=5,
                   model_name=DEFAULT_MODEL_NAME):
    """Retrieve from the saved NumPy matrix using exact cosine similarity."""
    chunks = _validate_chunks(chunks_df, corpus_embeddings)
    vector = embed_query(query, model, model_name=model_name)
    positions, scores = cosine_search(vector, corpus_embeddings, top_k=top_k)
    return _rank_local_rows(chunks, positions, scores, method="dense")



def retrieve_dense_qdrant(query, client, model, *,
                           collection_name=DEFAULT_COLLECTION_NAME, top_k=5,
                           model_name=DEFAULT_MODEL_NAME, file_names=None,
                           source_paths=None):
    """Retrieve E5 vectors from the production Qdrant collection."""
    _validate_top_k(top_k)
    vector = embed_query(query, model, model_name=model_name)
    response = client.query_points(
        collection_name=collection_name,
        query=vector.tolist(),
        query_filter=build_qdrant_filter(
            file_names=file_names, source_paths=source_paths
        ),
        limit=top_k, with_payload=True, with_vectors=False,
    )
    return _qdrant_points_to_frame(response.points, method="dense_qdrant")


def retrieve_dense_qdrant_reranked(
    query,
    client,
    model,
    reranker,
    *,
    collection_name=DEFAULT_COLLECTION_NAME,
    top_k=DEFAULT_TOP_K,
    candidate_k=DEFAULT_CANDIDATE_K,
    model_name=DEFAULT_MODEL_NAME,
    file_names=None,
    source_paths=None,
    text_column="text",
):
    """dense Qdrant candidates + cross-encoder rerank."""
    _validate_top_k(top_k)
    _validate_top_k(candidate_k)
    if candidate_k < top_k:
        raise ValueError("candidate_k must be greater than or equal to top_k.")

    candidates = retrieve_dense_qdrant(
        query,
        client,
        model,
        collection_name=collection_name,
        top_k=candidate_k,
        model_name=model_name,
        file_names=file_names,
        source_paths=source_paths,
    )
    return rerank_candidates(
        query,
        candidates,
        reranker,
        top_k=top_k,
        text_column=text_column,
    )


def retrieve_images_dense(
    query,
    model,
    context_embeddings,
    image_records,
    *,
    top_k=DEFAULT_TOP_K,
    model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
):
    """Dense image retrieval over full image-context embeddings."""

    _validate_query(query)
    _validate_top_k(top_k)
    context_embeddings = np.asarray(context_embeddings, dtype=np.float32)
    if len(image_records) != context_embeddings.shape[0]:
        raise ValueError(
            "Image records and context embeddings are misaligned."
        )

    vector = embed_query(query, model, model_name=model_name)
    positions, scores = cosine_search(
        vector, context_embeddings, top_k=top_k
    )
    return _rank_image_rows(
        image_records,
        positions,
        scores,
        method="context_dense",
    )

def retrieve_images_retrieve_rerank(
    query,
    model,
    stage1_embeddings,
    image_records,
    *,
    rerank_embeddings=None,
    stage2_embeddings=None,
    top_k=DEFAULT_TOP_K,
    candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
    model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
    stage2_sources=None,
    section_gate=True,
    confidence_threshold=DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
):
    """Retrieve-and-rerank with optional hard section gate (option C).

    1) stage-1 heading candidates
    2) full-context rerank to pick an anchor
    3) keep only same file_name + section_title as the anchor
    4) rank that section by full-context score
    """

    _validate_query(query)
    _validate_top_k(top_k)
    _validate_top_k(candidate_k)
    if candidate_k < top_k:
        raise ValueError("candidate_k must be >= top_k.")

    if rerank_embeddings is None:
        rerank_embeddings = stage2_embeddings
    if rerank_embeddings is None:
        raise ValueError(
            "retrieve_rerank requires rerank_embeddings "
            "(full context) or stage2_embeddings."
        )

    stage1_embeddings = np.asarray(stage1_embeddings, dtype=np.float32)
    rerank_embeddings = np.asarray(rerank_embeddings, dtype=np.float32)
    if not (
        len(image_records)
        == stage1_embeddings.shape[0]
        == rerank_embeddings.shape[0]
    ):
        raise ValueError(
            "Image records and embeddings are misaligned."
        )

    vector = embed_query(query, model, model_name=model_name)
    query_norm = float(np.linalg.norm(vector))
    if query_norm == 0:
        raise ValueError("Query embedding has zero norm.")

    def full_scores_for(indices):
        scores = []
        for idx in indices:
            emb = rerank_embeddings[int(idx)]
            denom = float(np.linalg.norm(emb)) * query_norm
            scores.append(float(np.dot(emb, vector) / denom))
        return np.asarray(scores, dtype=np.float32)

    candidate_count = min(candidate_k, len(image_records))
    candidate_positions, _ = cosine_search(
        vector, stage1_embeddings, top_k=candidate_count
    )
    candidate_positions = np.asarray(candidate_positions, dtype=np.int64)

    # Option B ranking inside candidates (to choose the section anchor).
    candidate_scores = full_scores_for(candidate_positions)
    anchor_local = int(np.argsort(-candidate_scores, kind="stable")[0])
    anchor_idx = int(candidate_positions[anchor_local])
    anchor = image_records[anchor_idx]

    section_title = str(anchor.get("section_title") or "").strip()
    file_name = str(anchor.get("file_name") or "").strip()

    if (
        section_gate
        and section_title
        and file_name
    ):
        section_indices = [
            i
            for i, record in enumerate(image_records)
            if str(record.get("file_name") or "").strip() == file_name
            and str(record.get("section_title") or "").strip() == section_title
        ]
        if not section_indices:
            section_indices = [anchor_idx]

        section_scores = full_scores_for(section_indices)
        order = np.argsort(-section_scores, kind="stable")[:top_k]
        selected_positions = np.asarray(section_indices, dtype=np.int64)[order]
        selected_scores = section_scores[order]
        method_name = "retrieve_rerank_section"
    else:
        # Fallback = option B (no usable section)
        order = np.argsort(-candidate_scores, kind="stable")[:top_k]
        selected_positions = candidate_positions[order]
        selected_scores = candidate_scores[order]
        method_name = "retrieve_rerank"

    return _rank_image_rows(
        image_records,
        selected_positions,
        selected_scores,
        method=method_name,
    )

# def retrieve_images_retrieve_rerank_fallback(
#     query,
#     model,
#     stage1_embeddings,
#     context_embeddings,
#     image_records,
#     *,
#     top_k=DEFAULT_TOP_K,
#     candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
#     model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
#     confidence_threshold=DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
# ):
#     """retrieve_rerank; if top-1 score < threshold, use context_dense."""
#     reranked = retrieve_images_retrieve_rerank(
#         query,
#         model,
#         stage1_embeddings,
#         image_records,
#         rerank_embeddings=context_embeddings,
#         top_k=top_k,
#         candidate_k=candidate_k,
#         model_name=model_name,
#         section_gate=False,
#     )
#     if len(reranked) == 0:
#         return retrieve_images_dense(
#             query,
#             model,
#             context_embeddings,
#             image_records,
#             top_k=top_k,
#             model_name=model_name,
#         )

#     top_score = float(reranked.iloc[0]["score"])
#     if top_score >= float(confidence_threshold):
#         out = reranked.copy()
#         out["method"] = "retrieve_rerank_fallback"
#         out["fallback_used"] = False
#         out["confidence"] = top_score
#         return out

#     dense = retrieve_images_dense(
#         query,
#         model,
#         context_embeddings,
#         image_records,
#         top_k=top_k,
#         model_name=model_name,
#     )
#     dense = dense.copy()
#     dense["method"] = "retrieve_rerank_fallback"
#     dense["fallback_used"] = True
#     dense["confidence"] = top_score
#     return dense

def retrieve_images_retrieve_rerank_fallback(
    query,
    model,
    stage1_embeddings,
    context_embeddings,
    image_records,
    *,
    top_k=DEFAULT_TOP_K,
    candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
    model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
    confidence_threshold=DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
):
    """Section-gated retrieve-and-rerank; if top-1 score < threshold, use context_dense.

    1) stage-1 candidates → full-context anchor
    2) keep only same file_name + section_title as the anchor
    3) rank inside that section
    4) if top-1 confidence < threshold → fall back to full-corpus context_dense
    """
    reranked = retrieve_images_retrieve_rerank(
        query,
        model,
        stage1_embeddings,
        image_records,
        rerank_embeddings=context_embeddings,
        top_k=top_k,
        candidate_k=candidate_k,
        model_name=model_name,
        section_gate=True,  # was False — this is the whole fix
    )
    if len(reranked) == 0:
        return retrieve_images_dense(
            query,
            model,
            context_embeddings,
            image_records,
            top_k=top_k,
            model_name=model_name,
        )

    top_score = float(reranked.iloc[0]["score"])
    if top_score >= float(confidence_threshold):
        out = reranked.copy()
        out["method"] = "retrieve_rerank_fallback"
        out["fallback_used"] = False
        out["confidence"] = top_score
        return out

    dense = retrieve_images_dense(
        query,
        model,
        context_embeddings,
        image_records,
        top_k=top_k,
        model_name=model_name,
    )
    dense = dense.copy()
    dense["method"] = "retrieve_rerank_fallback"
    dense["fallback_used"] = True
    dense["confidence"] = top_score
    return dense
import uuid


_IMAGE_POINT_NAMESPACE = uuid.UUID("68496ca0-906e-4fab-9682-7467875c68be")


def _image_point_id(image_id: str) -> str:
    return str(uuid.uuid5(_IMAGE_POINT_NAMESPACE, str(image_id)))


def retrieve_images_retrieve_rerank_qdrant(
    query,
    client,
    model,
    image_records,
    *,
    stage1_collection="gatherly_document_images_stage1_e5_v1",
    context_collection=DEFAULT_IMAGE_COLLECTION_NAME,
    top_k=DEFAULT_TOP_K,
    candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
    model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
    section_gate=True,
):
    """Same structure as retrieve_images_retrieve_rerank; vectors from Qdrant."""

    _validate_query(query)
    _validate_top_k(top_k)
    _validate_top_k(candidate_k)
    if candidate_k < top_k:
        raise ValueError("candidate_k must be >= top_k.")

    id_to_index = {
        str(record["image_id"]): i for i, record in enumerate(image_records)
    }

    vector = embed_query(query, model, model_name=model_name)
    query_norm = float(np.linalg.norm(vector))
    if query_norm == 0:
        raise ValueError("Query embedding has zero norm.")

    def full_scores_for(indices):
        """Same role as cosine vs context_embeddings[indices]."""
        point_ids = [
            _image_point_id(image_records[int(i)]["image_id"]) for i in indices
        ]
        points = client.retrieve(
            collection_name=context_collection,
            ids=point_ids,
            with_payload=False,
            with_vectors=True,
        )
        by_pid = {str(p.id): p for p in points}
        scores = []
        for pid in point_ids:
            point = by_pid.get(pid)
            if point is None or point.vector is None:
                scores.append(-1.0)
                continue
            emb = np.asarray(point.vector, dtype=np.float32)
            denom = float(np.linalg.norm(emb)) * query_norm
            scores.append(float(np.dot(emb, vector) / denom) if denom else -1.0)
        return np.asarray(scores, dtype=np.float32)

    # 1) stage-1 candidates  (was: cosine_search on stage1_embeddings)
    candidate_count = min(candidate_k, len(image_records))
    stage1_resp = client.query_points(
        collection_name=stage1_collection,
        query=vector.tolist(),
        limit=candidate_count,
        with_payload=True,
        with_vectors=False,
    )
    candidate_positions = []
    for point in stage1_resp.points:
        image_id = str((point.payload or {}).get("image_id") or "")
        if image_id in id_to_index:
            candidate_positions.append(id_to_index[image_id])
    candidate_positions = np.asarray(candidate_positions, dtype=np.int64)
    if candidate_positions.size == 0:
        return _empty_image_results()

    # 2) full-context scores on candidates → anchor  (was: full_scores_for)
    candidate_scores = full_scores_for(candidate_positions)
    anchor_local = int(np.argsort(-candidate_scores, kind="stable")[0])
    anchor_idx = int(candidate_positions[anchor_local])
    anchor = image_records[anchor_idx]

    section_title = str(anchor.get("section_title") or "").strip()
    file_name = str(anchor.get("file_name") or "").strip()

    # 3) section gate  (identical membership logic)
    if section_gate and section_title and file_name:
        section_indices = [
            i
            for i, record in enumerate(image_records)
            if str(record.get("file_name") or "").strip() == file_name
            and str(record.get("section_title") or "").strip() == section_title
        ]
        if not section_indices:
            section_indices = [anchor_idx]

        section_scores = full_scores_for(section_indices)
        order = np.argsort(-section_scores, kind="stable")[:top_k]
        selected_positions = np.asarray(section_indices, dtype=np.int64)[order]
        selected_scores = section_scores[order]
        method_name = "retrieve_rerank_section"
    else:
        order = np.argsort(-candidate_scores, kind="stable")[:top_k]
        selected_positions = candidate_positions[order]
        selected_scores = candidate_scores[order]
        method_name = "retrieve_rerank"

    return _rank_image_rows(
        image_records,
        selected_positions,
        selected_scores,
        method=method_name,
    )


def retrieve_images_retrieve_rerank_fallback_qdrant(
    query,
    client,
    model,
    image_records,
    *,
    stage1_collection="gatherly_document_images_stage1_e5_v1",
    context_collection=DEFAULT_IMAGE_COLLECTION_NAME,
    top_k=DEFAULT_TOP_K,
    candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
    model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
    confidence_threshold=DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
):
    """Same structure as retrieve_images_retrieve_rerank_fallback; Qdrant backends."""

    reranked = retrieve_images_retrieve_rerank_qdrant(
        query,
        client,
        model,
        image_records,
        stage1_collection=stage1_collection,
        context_collection=context_collection,
        top_k=top_k,
        candidate_k=candidate_k,
        model_name=model_name,
        section_gate=True,
    )
    if len(reranked) == 0:
        return retrieve_images_qdrant(
            query,
            client,
            model,
            collection_name=context_collection,
            top_k=top_k,
            model_name=model_name,
        )

    top_score = float(reranked.iloc[0]["score"])
    if top_score >= float(confidence_threshold):
        out = reranked.copy()
        out["method"] = "retrieve_rerank_fallback"
        out["fallback_used"] = False
        out["confidence"] = top_score
        return out

    dense = retrieve_images_qdrant(
        query,
        client,
        model,
        collection_name=context_collection,
        top_k=top_k,
        model_name=model_name,
    )
    dense = dense.copy()
    dense["method"] = "retrieve_rerank_fallback"
    dense["fallback_used"] = True
    dense["confidence"] = top_score
    return dense


def retrieve_images(
    query,
    *,
    method=DEFAULT_IMAGE_RETRIEVAL_METHOD,
    model=None,
    model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
    top_k=DEFAULT_TOP_K,
    candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
    context_embeddings=None,
    stage1_embeddings=None,
    stage2_embeddings=None,
    image_records=None,
    stage2_sources=None,
    client=None,
    collection_name=DEFAULT_IMAGE_COLLECTION_NAME,
    file_names=None,
    source_paths=None,
    confidence_threshold=DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
):
    """Dispatch image retrieval to a named method."""

    method = str(method).strip().casefold()
    allowed = set(IMAGE_RETRIEVAL_METHODS) | {"image_context_qdrant"}
    if method not in allowed:
        raise ValueError(
            "Unsupported image retrieval method: "
            f"{method}. Choose from {sorted(allowed)}."
        )

    if method == "image_context_qdrant":
        if client is None or model is None:
            raise ValueError(
                "Qdrant image retrieval requires client and model."
            )
        return retrieve_images_qdrant(
            query,
            client,
            model,
            collection_name=collection_name,
            top_k=top_k,
            model_name=model_name,
            file_names=file_names,
            source_paths=source_paths,
        )

    if image_records is None or model is None:
        raise ValueError(
            "Local image retrieval requires model and image_records."
        )

    if method == "context_dense":
        if context_embeddings is None:
            raise ValueError(
                "context_dense requires context_embeddings."
            )
        return retrieve_images_dense(
            query,
            model,
            context_embeddings,
            image_records,
            top_k=top_k,
            model_name=model_name,
        )

    if stage1_embeddings is None:
        raise ValueError("retrieve_rerank requires stage1_embeddings.")

    # Prefer full-context embeddings for option B rerank.
    rerank_embeddings = context_embeddings
    if rerank_embeddings is None:
        rerank_embeddings = stage2_embeddings
    if rerank_embeddings is None:
        raise ValueError(
            "retrieve_rerank requires context_embeddings "
            "(option B) or stage2_embeddings."
        )
    if method == "retrieve_rerank":
        return retrieve_images_retrieve_rerank(
            query,
            model,
            stage1_embeddings,
            image_records,
            rerank_embeddings=rerank_embeddings,
            top_k=top_k,
            candidate_k=candidate_k,
            model_name=model_name,
            section_gate=False,
        )

    if method == "retrieve_rerank_section":
        return retrieve_images_retrieve_rerank(
            query,
            model,
            stage1_embeddings,
            image_records,
            rerank_embeddings=rerank_embeddings,
            top_k=top_k,
            candidate_k=candidate_k,
            model_name=model_name,
            section_gate=True,
        )

    if method == "retrieve_rerank_fallback":
        if context_embeddings is None:
            raise ValueError(
                "retrieve_rerank_fallback requires context_embeddings."
            )
        return retrieve_images_retrieve_rerank_fallback(
            query,
            model,
            stage1_embeddings,
            context_embeddings,
            image_records,
            top_k=top_k,
            candidate_k=candidate_k,
            model_name=model_name,
            confidence_threshold=confidence_threshold,
        )
    raise ValueError(f"Unhandled image method: {method}")


def _rank_image_rows(image_records, positions, scores, *, method):
    rows = []
    for rank, (position, score) in enumerate(
        zip(positions, scores), start=1
    ):
        record = dict(image_records[int(position)])
        rows.append({
            **record,
            "rank": rank,
            "score": float(score),
            "method": method,
        })
    if not rows:
        return _empty_image_results()
    return pd.DataFrame(rows)


def retrieve_images_qdrant(
    query,
    client,
    model,
    *,
    collection_name=DEFAULT_IMAGE_COLLECTION_NAME,
    top_k=5,
    model_name=DEFAULT_MODEL_NAME,
    file_names=None,
    source_paths=None,
):
    """Retrieve images through their embedded textual contexts."""

    _validate_top_k(top_k)

    vector = embed_query(
        query,
        model,
        model_name=model_name,
    )

    response = client.query_points(
        collection_name=collection_name,
        query=vector.tolist(),
        query_filter=build_qdrant_filter(
            file_names=file_names,
            source_paths=source_paths,
        ),
        limit=top_k,
        with_payload=True,
        with_vectors=False,
    )

    rows = []

    for point in response.points:
        payload = dict(point.payload or {})

        image_id = payload.get("image_id")

        if not image_id:
            continue

        rows.append({
            **payload,
            "score": float(point.score),
            "point_id": str(point.id),
            "method": "image_context_qdrant",
        })

    if not rows:
        return _empty_image_results()

    results = pd.DataFrame(rows)

    # Protect against duplicate image points.
    results = (
        results.sort_values(
            "score",
            ascending=False,
            kind="stable",
        )
        .drop_duplicates(
            subset=["image_id"],
            keep="first",
        )
        .head(top_k)
        .reset_index(drop=True)
    )

    results.insert(
        0,
        "rank",
        np.arange(1, len(results) + 1),
    )

    return results


def retrieve_text_and_images_qdrant(
    query,
    client,
    model,
    *,
    reranker=None,
    text_collection=DEFAULT_COLLECTION_NAME,
    image_collection=DEFAULT_IMAGE_COLLECTION_NAME,
    text_top_k=5,
    image_top_k=5,
    text_candidate_k=30,
    model_name=DEFAULT_MODEL_NAME,
    image_model=None,
    image_model_name=DEFAULT_IMAGE_CONTEXT_MODEL,
    image_method="image_context_qdrant",
    image_records=None,
    context_embeddings=None,
    stage1_embeddings=None,
    stage2_embeddings=None,
    stage2_sources=None,
    image_candidate_k=DEFAULT_IMAGE_CANDIDATE_K,
    file_names=None,
    source_paths=None,
    image_confidence_threshold=DEFAULT_IMAGE_CONFIDENCE_THRESHOLD,
):
    """Retrieve text chunks and linked images for one query."""

    _validate_query(query)
    _validate_top_k(text_top_k)
    _validate_top_k(image_top_k)
    _validate_top_k(text_candidate_k)

    if text_candidate_k < text_top_k:
        raise ValueError(
            "text_candidate_k must be greater than "
            "or equal to text_top_k."
        )

    candidate_count = (
        text_candidate_k
        if reranker is not None
        else text_top_k
    )

    text_results = retrieve_dense_qdrant(
        query,
        client,
        model,
        collection_name=text_collection,
        top_k=candidate_count,
        model_name=model_name,
        file_names=file_names,
        source_paths=source_paths,
    )

    if reranker is not None:
        text_results = rerank_candidates(
            query,
            text_results,
            reranker,
            top_k=text_top_k,
            text_column="text",
        )
    else:
        text_results = (
            text_results
            .head(text_top_k)
            .reset_index(drop=True)
        )

    image_model = image_model or model
    image_results = retrieve_images(
        query,
        method=image_method,
        model=image_model,
        model_name=image_model_name,
        top_k=image_top_k,
        candidate_k=image_candidate_k,
        context_embeddings=context_embeddings,
        stage1_embeddings=stage1_embeddings,
        stage2_embeddings=stage2_embeddings,
        image_records=image_records,
        stage2_sources=stage2_sources,
        client=client,
        collection_name=image_collection,
        file_names=file_names,
        source_paths=source_paths,
        confidence_threshold=image_confidence_threshold,
    )

    return {
        "query": query,
        "text_results": text_results,
        "image_results": image_results,
        "image_method": image_method,
    }


def build_qdrant_filter(*, file_names=None, source_paths=None):
    """Build optional filters for metadata indexed by the document pipeline."""
    conditions = []
    if file_names:
        conditions.append(models.FieldCondition(
            key="file_name", match=models.MatchAny(any=list(file_names))
        ))
    if source_paths:
        conditions.append(models.FieldCondition(
            key="source_path", match=models.MatchAny(any=list(source_paths))
        ))
    return models.Filter(must=conditions) if conditions else None


def build_tfidf_index(chunks_df, *, text_column="text"):
    """Build a multilingual word/phrase TF-IDF baseline."""
    chunks = _validate_chunks(chunks_df)
    if text_column not in chunks.columns:
        raise ValueError(f"Missing text column: {text_column}")
    vectorizer = TfidfVectorizer(
        lowercase=True, strip_accents=None,
        token_pattern=r"(?u)\b\w\w+\b", ngram_range=(1, 2), sublinear_tf=True,
    )
    matrix = vectorizer.fit_transform(chunks[text_column].astype(str))
    return {"vectorizer": vectorizer, "matrix": matrix,
            "chunk_ids": chunks["chunk_id"].tolist()}


def retrieve_tfidf(query, tfidf_index, chunks_df, *, top_k=5):
    """Retrieve with the lexical TF-IDF baseline."""
    query = _validate_query(query)
    _validate_top_k(top_k)
    chunks = _validate_chunks(chunks_df)
    _validate_tfidf_alignment(tfidf_index, chunks)
    query_vector = tfidf_index["vectorizer"].transform([query])
    if query_vector.nnz == 0:
        return _empty_results()
    scores = (tfidf_index["matrix"] @ query_vector.T).toarray().ravel()
    positive = np.flatnonzero(scores > 0)
    positions = positive[np.argsort(-scores[positive], kind="stable")][:top_k]
    return _rank_local_rows(chunks, positions, scores[positions], method="tfidf")


def retrieve_hybrid(query, model, corpus_embeddings, chunks_df, tfidf_index, *,
                    top_k=5, candidate_k=30, dense_weight=0.5,
                    lexical_weight=0.5, rrf_constant=60,
                    model_name=DEFAULT_MODEL_NAME):
    """Fuse dense and TF-IDF rankings using weighted reciprocal-rank fusion."""
    _validate_fusion_options(
        top_k, candidate_k, dense_weight, lexical_weight, rrf_constant
    )
    dense = retrieve_dense(
        query, model, corpus_embeddings, chunks_df,
        top_k=candidate_k, model_name=model_name,
    )
    lexical = retrieve_tfidf(query, tfidf_index, chunks_df, top_k=candidate_k)
    return reciprocal_rank_fusion(
        [(dense, dense_weight), (lexical, lexical_weight)],
        top_k=top_k, rrf_constant=rrf_constant, method="hybrid_rrf",
    )


def rerank_candidates(query, candidates_df, reranker, *, top_k=5,
                      text_column="text"):
    """Rerank a shared candidate set with a multilingual cross-encoder."""
    query = _validate_query(query)
    _validate_top_k(top_k)
    if candidates_df.empty:
        return candidates_df.copy()
    if text_column not in candidates_df.columns:
        raise ValueError(f"Candidates are missing '{text_column}'.")
    results = candidates_df.copy()
    results["original_rank"] = results["rank"].astype(int)
    scores = np.asarray(reranker.predict(
        [[query, text] for text in results[text_column].astype(str)]
    ), dtype=np.float32).reshape(-1)
    if len(scores) != len(results) or not np.isfinite(scores).all():
        raise ValueError("The reranker returned invalid scores.")
    results["reranker_score"] = scores
    results = results.sort_values(
        "reranker_score", ascending=False, kind="stable"
    ).head(top_k).reset_index(drop=True)
    results["rank"] = np.arange(1, len(results) + 1)
    results["score"] = results["reranker_score"]
    prior_method = results["method"].astype(str) if "method" in results else "retrieval"
    results["method"] = prior_method + "_reranked"
    return results


def retrieve_dense_reranked(query, model, corpus_embeddings, chunks_df,
                            reranker, *, top_k=5, candidate_k=30,
                            model_name=DEFAULT_MODEL_NAME):
    """Retrieve dense candidates and rerank them."""
    candidates = retrieve_dense(
        query, model, corpus_embeddings, chunks_df,
        top_k=candidate_k, model_name=model_name,
    )
    return rerank_candidates(query, candidates, reranker, top_k=top_k)


def retrieve_hybrid_reranked(query, model, corpus_embeddings, chunks_df,
                             tfidf_index, reranker, *, top_k=5,
                             candidate_k=30, rerank_k=30,
                             model_name=DEFAULT_MODEL_NAME):
    """Retrieve hybrid candidates and rerank the fused candidate set."""
    candidates = retrieve_hybrid(
        query, model, corpus_embeddings, chunks_df, tfidf_index,
        top_k=rerank_k, candidate_k=max(candidate_k, rerank_k),
        model_name=model_name,
    )
    return rerank_candidates(query, candidates, reranker, top_k=top_k)


def retrieve_hybrid_qdrant(
    query,
    client,
    model,
    chunks_df,
    tfidf_index,
    *,
    collection_name=DEFAULT_COLLECTION_NAME,
    top_k=5,
    candidate_k=30,
    dense_weight=0.5,
    lexical_weight=0.5,
    rrf_constant=60,
    model_name=DEFAULT_MODEL_NAME,
    file_names=None,
    source_paths=None,
):
    """Same hybrid RRF logic as retrieve_hybrid; dense arm uses Qdrant."""
    _validate_fusion_options(
        top_k, candidate_k, dense_weight, lexical_weight, rrf_constant
    )
    dense = retrieve_dense_qdrant(
        query,
        client,
        model,
        collection_name=collection_name,
        top_k=candidate_k,
        model_name=model_name,
        file_names=file_names,
        source_paths=source_paths,
    )
    lexical = retrieve_tfidf(query, tfidf_index, chunks_df, top_k=candidate_k)
    return reciprocal_rank_fusion(
        [(dense, dense_weight), (lexical, lexical_weight)],
        top_k=top_k,
        rrf_constant=rrf_constant,
        method="hybrid_rrf_qdrant",
    )


def retrieve_hybrid_reranked_qdrant(
    query,
    client,
    model,
    chunks_df,
    tfidf_index,
    reranker,
    *,
    collection_name=DEFAULT_COLLECTION_NAME,
    top_k=5,
    candidate_k=30,
    rerank_k=30,
    model_name=DEFAULT_MODEL_NAME,
    file_names=None,
    source_paths=None,
):
    """Same as retrieve_hybrid_reranked; dense candidates from Qdrant."""
    candidates = retrieve_hybrid_qdrant(
        query,
        client,
        model,
        chunks_df,
        tfidf_index,
        collection_name=collection_name,
        top_k=rerank_k,
        candidate_k=max(candidate_k, rerank_k),
        model_name=model_name,
        file_names=file_names,
        source_paths=source_paths,
    )
    return rerank_candidates(query, candidates, reranker, top_k=top_k)

def build_theme_document_registry(chunks_df) -> dict[str, list[str]]:
    """Map theme PDF file_names to alias phrases derived from the stem.

    Only includes ``*_Wedding.pdf`` (and ``*Wedding.pdf``) documents.
    Non-theme guides (checklists, sustainability, FR/AR manuals) are omitted.
    Aliases are sorted longest-first for matching.
    """
    chunks = chunks_df if isinstance(chunks_df, pd.DataFrame) else pd.DataFrame(chunks_df)
    if "file_name" not in chunks.columns:
        raise ValueError("chunks_df must contain a 'file_name' column.")

    registry: dict[str, list[str]] = {}
    for raw_name in chunks["file_name"].dropna().astype(str).unique():
        file_name = raw_name.strip()
        if not file_name:
            continue
        stem = Path(file_name).stem
        stem_cf = stem.casefold()
        if not (stem_cf.endswith("_wedding") or stem_cf.endswith("wedding")):
            continue
        if not stem_cf.endswith("wedding"):
            continue

        # Prefer *_Wedding.pdf theme guides.
        if not re.search(r"(^|_)wedding$", stem_cf):
            continue

        phrase = re.sub(r"[_\\-]+", " ", stem).strip()
        phrase_cf = " ".join(phrase.casefold().split())
        if not phrase_cf:
            continue

        aliases: list[str] = []
        # Full stem phrase: "celestial wedding", "enchanted forest wedding"
        aliases.append(phrase_cf)
        # Drop trailing "wedding": "celestial", "enchanted forest"
        without_wedding = re.sub(r"\bwedding\b", "", phrase_cf).strip()
        without_wedding = " ".join(without_wedding.split())
        if without_wedding and without_wedding not in aliases:
            aliases.append(without_wedding)

        # Unique, longest first
        uniq: list[str] = []
        for alias in aliases:
            if alias and alias not in uniq:
                uniq.append(alias)
        uniq.sort(key=len, reverse=True)
        registry[file_name] = uniq

    return dict(sorted(registry.items(), key=lambda item: item[0].casefold()))


def detect_theme_documents(query: str, registry: dict[str, list[str]]) -> list[str]:
    """Return corpus file_names whose theme aliases appear in the query.

    Empty list means the optional theme re-rank stage should be skipped.
    Longer aliases are tried first. Each file is matched at most once.
    """
    if not registry:
        return []
    q = " ".join(str(query).casefold().split())
    if not q:
        return []

    matched: list[str] = []
    for file_name, aliases in registry.items():
        for alias in aliases:
            alias_norm = " ".join(str(alias).casefold().split())
            if not alias_norm:
                continue
            # Phrase / token-boundary style match
            pattern = r"(?<!\w)" + re.escape(alias_norm).replace(r"\ ", r"\s+") + r"(?!\w)"
            if re.search(pattern, q, flags=re.IGNORECASE):
                matched.append(file_name)
                break
    return matched



def rerank_by_theme_documents(
    results_df: pd.DataFrame,
    matched_file_names: list[str],
    *,
    top_k: int | None = None,
    boost: float = DEFAULT_THEME_RERANK_LAMBDA,
) -> pd.DataFrame:
    """Reorder already-retrieved rows so theme docs come first.

    Does not add/remove chunks. If no theme match, returns input unchanged.
    ``boost`` is unused (kept for call-site compatibility).
    ``top_k`` is unused for membership; optional head only if you pass it.
    """
    if results_df is None or len(results_df) == 0:
        out = results_df.copy() if isinstance(results_df, pd.DataFrame) else pd.DataFrame()
        if len(out):
            out["theme_rerank_applied"] = False
            out["theme_matched_files"] = [[] for _ in range(len(out))]
            out["theme_boosted"] = False
        return out

    out = results_df.copy()
    matched = [str(x) for x in (matched_file_names or []) if str(x).strip()]
    matched_set = set(matched)

    if not matched_set:
        out["theme_rerank_applied"] = False
        out["theme_matched_files"] = [[] for _ in range(len(out))]
        out["theme_boosted"] = False
        return out

    if "file_name" not in out.columns:
        raise ValueError("results_df must contain a 'file_name' column.")
    if "score" not in out.columns:
        raise ValueError("results_df must contain a 'score' column.")

    file_names = out["file_name"].astype(str)
    boosted = file_names.isin(matched_set)
    base_scores = pd.to_numeric(out["score"], errors="coerce").fillna(0.0).astype(float)

    out["theme_rerank_applied"] = True
    out["theme_matched_files"] = [matched for _ in range(len(out))]
    out["theme_boosted"] = boosted.to_numpy()
    # Keep original retrieval score; only order changes.
    out["score"] = base_scores

    # Matched first, then others; within each group keep original score order.
    out = out.assign(_theme_key=boosted.map({True: 0, False: 1}))
    out = out.sort_values(
        by=["_theme_key", "score"],
        ascending=[True, False],
        kind="stable",
    ).drop(columns=["_theme_key"]).reset_index(drop=True)

    if top_k is not None:
        top_k = int(top_k)
        if top_k < 1:
            raise ValueError("top_k must be >= 1 when provided.")
        # Membership already fixed by caller; head only if frame was larger.
        out = out.head(top_k).reset_index(drop=True)

    if "rank" in out.columns:
        out["rank"] = np.arange(1, len(out) + 1)

    prior = out["method"].astype(str) if "method" in out.columns else "retrieval"
    out["method"] = prior + "_theme"
    return out

def apply_optional_theme_rerank(
    query: str,
    results_df: pd.DataFrame,
    registry: dict[str, list[str]],
    *,
    top_k: int | None = None,
    boost: float = DEFAULT_THEME_RERANK_LAMBDA,
) -> pd.DataFrame:
    """Detect theme docs in the query; reorder only if any match, else no-op."""
    matched = detect_theme_documents(query, registry)
    return rerank_by_theme_documents(
        results_df,
        matched,
        top_k=top_k,
        boost=boost,
    )

    
def retrieve_multi_query(queries, model, corpus_embeddings, chunks_df, *,
                         top_k=5, candidate_k=20, rrf_constant=60,
                         model_name=DEFAULT_MODEL_NAME):
    """Fuse dense results for deterministic, user-supplied query variants."""
    if not isinstance(queries, (list, tuple)) or not queries:
        raise ValueError("queries must contain at least one query.")
    cleaned = list(dict.fromkeys(_validate_query(query) for query in queries))
    rankings = [(
        retrieve_dense(
            query, model, corpus_embeddings, chunks_df,
            top_k=candidate_k, model_name=model_name,
        ), 1.0,
    ) for query in cleaned]
    result = reciprocal_rank_fusion(
        rankings, top_k=top_k, rrf_constant=rrf_constant,
        method="multi_query_dense",
    )
    result["query_variants"] = [cleaned] * len(result)
    return result


def get_or_create_gemini_query_variants(
    queries,
    gemini_client,
    *,
    cache_file,
    gemini_model="gemini-3.6-flash",
    variant_count=3,
    force=False,
):
    """Generate multilingual query variants once and cache them as JSON.

    The returned mapping always includes the original query first. Gemini is
    called only for queries that are absent from a valid cache unless force is
    True. This makes multi-query evaluation repeatable and inexpensive.
    """
    if not isinstance(variant_count, int) or variant_count < 1:
        raise ValueError("variant_count must be a positive integer.")
    cleaned = list(dict.fromkeys(_validate_query(query) for query in queries))
    cache_path = Path(cache_file).resolve()
    cache = {} if force else _read_variant_cache(
        cache_path, gemini_model=gemini_model, variant_count=variant_count
    )
    missing = cleaned if force else [query for query in cleaned if query not in cache]

    if missing:
        generated = generate_query_variants_batch_gemini(
            missing,
            gemini_client,
            gemini_model=gemini_model,
            variant_count=variant_count,
        )
        cache.update(generated)
        _write_json_atomic(cache_path, {
            "gemini_model": gemini_model,
            "variant_count": variant_count,
            "variants": cache,
        })

    return {query: _normalize_variants(query, cache[query], variant_count)
            for query in cleaned}


def generate_query_variants_batch_gemini(
    queries,
    gemini_client,
    *,
    gemini_model="gemini-3.6-flash",
    variant_count=3,
):
    """Ask Gemini for deterministic-style paraphrases in each query's language."""
    cleaned = list(dict.fromkeys(_validate_query(query) for query in queries))
    if not cleaned:
        return {}
    numbered = "\n".join(
        f"{index}. {json.dumps(query, ensure_ascii=False)}"
        for index, query in enumerate(cleaned, start=1)
    )
    prompt = f"""Create exactly {variant_count} concise retrieval paraphrases for each query below.
Preserve the original meaning, facts, names, and language. Do not answer the queries.
Do not translate them. Avoid adding facts that are absent from the original.

Return only valid JSON with this structure:
{{"items":[{{"index":1,"variants":["...","..."]}}]}}

Queries:
{numbered}
"""
    response = gemini_client.models.generate_content(
        model=gemini_model,
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    payload = _parse_json_response(getattr(response, "text", ""))
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError("Gemini response does not contain an 'items' list.")
    by_index = {}
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("index"), int):
            by_index[item["index"]] = item.get("variants", [])
    result = {}
    for index, query in enumerate(cleaned, start=1):
        variants = by_index.get(index)
        if not isinstance(variants, list) or len(variants) < variant_count:
            raise ValueError(f"Gemini returned too few variants for query {index}.")
        result[query] = _normalize_variants(query, variants, variant_count)
    return result


def reciprocal_rank_fusion(rankings: Iterable[tuple[pd.DataFrame, float]], *,
                           top_k=5, rrf_constant=60, method="rrf"):
    """Fuse standardized result frames using weighted RRF."""
    _validate_top_k(top_k)
    if rrf_constant < 0:
        raise ValueError("rrf_constant cannot be negative.")
    fused = {}
    for frame, weight in rankings:
        if weight < 0:
            raise ValueError("RRF weights cannot be negative.")
        for _, row in frame.iterrows():
            chunk_id = str(row["chunk_id"])
            fused.setdefault(chunk_id, {"row": row.to_dict(), "score": 0.0})
            fused[chunk_id]["score"] += weight / (rrf_constant + int(row["rank"]))
    ranked = sorted(fused.values(), key=lambda item: item["score"], reverse=True)[:top_k]
    rows = []
    for rank, item in enumerate(ranked, start=1):
        row = item["row"]
        row.update(rank=rank, score=item["score"], method=method)
        rows.append(row)
    return pd.DataFrame(rows) if rows else _empty_results()


def _rank_local_rows(chunks, positions, scores, *, method):
    results = chunks.iloc[np.asarray(positions, dtype=int)].copy().reset_index(drop=True)
    results.insert(0, "rank", np.arange(1, len(results) + 1))
    results["score"] = np.asarray(scores, dtype=float)
    results["method"] = method
    return results


def _qdrant_points_to_frame(points, *, method):
    rows = []
    for rank, point in enumerate(points, start=1):
        row = dict(point.payload or {})
        row.update(rank=rank, score=float(point.score), method=method,
                   point_id=str(point.id))
        rows.append(row)
    return pd.DataFrame(rows) if rows else _empty_results()


def _validate_chunks(chunks_df, embeddings=None):
    if not isinstance(chunks_df, pd.DataFrame):
        raise TypeError("chunks_df must be a pandas DataFrame.")
    required = {"chunk_id", "file_name", "page_number", "text"}
    missing = required - set(chunks_df.columns)
    if missing:
        raise ValueError("Chunks are missing columns: " + ", ".join(sorted(missing)))
    if chunks_df.empty or chunks_df["chunk_id"].duplicated().any():
        raise ValueError("Chunks must be non-empty and have unique chunk IDs.")
    chunks = chunks_df.reset_index(drop=True).copy()
    if embeddings is not None and len(chunks) != len(embeddings):
        raise ValueError("Chunks and corpus embeddings are not aligned.")
    return chunks


def _validate_tfidf_alignment(index, chunks):
    required = {"vectorizer", "matrix", "chunk_ids"}
    if not isinstance(index, dict) or required - set(index):
        raise ValueError("Invalid TF-IDF index.")
    if index["chunk_ids"] != chunks["chunk_id"].tolist():
        raise ValueError("TF-IDF index is not aligned with chunks_df.")


def _validate_query(query):
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a non-empty string.")
    return query.strip()


def _validate_top_k(top_k):
    if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k <= 0:
        raise ValueError("top_k must be a positive integer.")


def _validate_fusion_options(top_k, candidate_k, dense_weight,
                             lexical_weight, rrf_constant):
    _validate_top_k(top_k)
    _validate_top_k(candidate_k)
    if candidate_k < top_k:
        raise ValueError("candidate_k must be greater than or equal to top_k.")
    if dense_weight < 0 or lexical_weight < 0 or dense_weight + lexical_weight <= 0:
        raise ValueError("Fusion weights must be non-negative and not both zero.")
    if rrf_constant < 0:
        raise ValueError("rrf_constant cannot be negative.")


def _empty_results():
    return pd.DataFrame(columns=[*RESULT_COLUMNS, "method"])

def _empty_image_results():
    return pd.DataFrame(columns=[
        "rank",
        "score",
        "image_id",
        "image_path",
        "file_name",
        "source_path",
        "page_numbers",
        "section_title",
        "local_heading",
        "heading_path",
        "context_text",
        "ocr_text",
        "method",
        "point_id",
    ])


def _normalize_variants(original, variants, variant_count):
    cleaned = [original]
    for variant in variants:
        candidate = str(variant).strip()
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
        if len(cleaned) == variant_count + 1:
            break
    if len(cleaned) < variant_count + 1:
        raise ValueError(f"Not enough unique Gemini variants for: {original}")
    return cleaned


def _parse_json_response(text):
    text = str(text or "").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("Gemini did not return valid JSON.") from error


def _read_variant_cache(path, *, gemini_model, variant_count):
    if not path.is_file():
        return {}
    try:
        with path.open(encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    if (payload.get("gemini_model") != gemini_model
            or payload.get("variant_count") != variant_count):
        return {}
    variants = payload.get("variants", {})
    return variants if isinstance(variants, dict) else {}


def _write_json_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    temporary.replace(path)
