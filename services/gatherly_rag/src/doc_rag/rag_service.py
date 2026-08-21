from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from sentence_transformers import CrossEncoder, SentenceTransformer
import ollama
import re
import logging
logger = logging.getLogger("gatherly.rag")
import os
import time
from qdrant_client import QdrantClient
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")


OPS_TOPIC_FILES: dict[str, list[str]] = {
    "organizer": ["Organiser_un_evenement_deAaZ.pdf"],
    "checklist": ["Checklists.pdf"],
    "sustainable": ["Guideline_Sustainable_Event.pdf"],
    "arabic_traditions": ["تقاليد الزفاف في الثقافات العربية.pdf"],
}

embeddings_module = importlib.import_module("doc_rag.5_embeddings")
retrieval = importlib.import_module("doc_rag.7_retrieval")
generation = importlib.import_module("doc_rag.11_generation")
image_embeddings = importlib.import_module("doc_rag.10_image_embeddings")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = PROJECT_ROOT / "data" / "rag" / "processed_documents"
EMBEDDING_DIR = (
    embeddings_module.DEFAULT_EMBEDDING_ROOT
    / embeddings_module._safe_model_name(embeddings_module.DEFAULT_MODEL_NAME)
)
TEXT_COLLECTION = retrieval.DEFAULT_COLLECTION_NAME

# Prefer eval caches (have stage1). Falls back to prod + builds stages if needed.
IMAGE_CONTEXT_ROOT = (
    PROJECT_ROOT
    / "data"
    / "rag"
    / "experiments"
    / "image_embedding_evaluation"
    / "embeddings"
)
IMAGE_STAGE_ROOT = (
    PROJECT_ROOT
    / "data"
    / "rag"
    / "experiments"
    / "image_embedding_evaluation"
    / "stage_embeddings"
)
# If experiment folders missing, uncomment:
# IMAGE_CONTEXT_ROOT = image_embeddings.DEFAULT_OUTPUT_ROOT
# IMAGE_STAGE_ROOT = image_embeddings.DEFAULT_STAGE_OUTPUT_ROOT

IMAGE_CONFIDENCE = 0.82  # locked production threshold
ROUTER_MODEL = "qwen2.5:7b"


class RagService:
    def __init__(self) -> None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model_kwargs = {"torch_dtype": torch.float16} if device == "cuda" else None

       
        embedding_matrix = np.load(EMBEDDING_DIR / "embeddings.npy", allow_pickle=False)
        saved_ids = json.loads(
            (EMBEDDING_DIR / "chunks.json").read_text(encoding="utf-8")
        )["chunk_ids"]

        rows = []
        for path in PROCESSED_DIR.glob("*/chunks.json"):
            rows.extend(json.loads(path.read_text(encoding="utf-8")).get("chunks", []))
        all_chunks = pd.DataFrame(rows).set_index("chunk_id", drop=False)
        chunks_df = all_chunks.loc[saved_ids].reset_index(drop=True)

        self.device = device
        self.model_name = embeddings_module.DEFAULT_MODEL_NAME
        self.chunks_df = chunks_df
        self.embedding_matrix = embedding_matrix
        self.embedding_model = embeddings_module.load_embedding_model(
            self.model_name,
            device=device,
            local_files_only=True,
            model_kwargs=model_kwargs,
        )
        self.tfidf_index = retrieval.build_tfidf_index(chunks_df)
        self.reranker = CrossEncoder(
            retrieval.DEFAULT_RERANKER_MODEL,
            device=device,
            local_files_only=True,
            model_kwargs=model_kwargs,
        )
        self.top_k = retrieval.DEFAULT_TOP_K
        self.candidate_k = retrieval.DEFAULT_CANDIDATE_K

        self.theme_registry = retrieval.build_theme_document_registry(chunks_df)
        self.theme_rerank_boost = retrieval.DEFAULT_THEME_RERANK_LAMBDA
        logger.info("Theme registry: %s docs (boost=%s)", len(self.theme_registry), self.theme_rerank_boost)

       
        self.image_records = image_embeddings.load_image_records(PROCESSED_DIR)
        self.image_by_id = {
            str(r["image_id"]): r for r in self.image_records
        }
        self.image_stage1_collection = "gatherly_document_images_stage1_e5_v1"
        self.image_context_collection = retrieval.DEFAULT_IMAGE_COLLECTION_NAME

        image_pack = image_embeddings.get_or_create_image_embeddings(
            self.image_records,
            output_root=IMAGE_CONTEXT_ROOT,
            context_model_name=retrieval.DEFAULT_IMAGE_CONTEXT_MODEL,
            device=device,
            local_files_only=True,
            include_ocr=False,
        )
        stage_pack = image_embeddings.get_or_create_image_stage_embeddings(
            self.image_records,
            output_root=IMAGE_STAGE_ROOT,
            context_model_name=retrieval.DEFAULT_IMAGE_CONTEXT_MODEL,
            device=device,
            local_files_only=True,
        )

        self.image_context_embeddings = image_pack["context_embeddings"]
        self.image_stage1_embeddings = stage_pack["stage1_embeddings"]
        self.image_model_name = retrieval.DEFAULT_IMAGE_CONTEXT_MODEL
        self.image_model = SentenceTransformer(
            self.image_model_name,
            device=device,
            local_files_only=True,
            model_kwargs=model_kwargs,
        )
        self.image_top_k = 3
        self.image_candidate_k = retrieval.DEFAULT_IMAGE_CANDIDATE_K
        self.image_confidence = IMAGE_CONFIDENCE

        logger.info("RAG ready: %s text chunks, %s images (context_cache=%s, stage_cache=%s)", len(chunks_df), len(self.image_records), image_pack["cache_hit"], stage_pack["cache_hit"])
        self.qdrant_url = QDRANT_URL
        self.text_collection = TEXT_COLLECTION
        self.qdrant = QdrantClient(url=self.qdrant_url, timeout=60)
        text_count = self.qdrant.count(
            collection_name=self.text_collection,
            exact=True,
        ).count
        logger.info(
            "Qdrant text index: url=%s collection=%s points=%s",
            self.qdrant_url,
            self.text_collection,
            text_count,
        )

    def retrieve(self, query: str) -> list[dict[str, Any]]:
        started = time.perf_counter()
        frame = retrieval.retrieve_hybrid_reranked_qdrant(
            query,
            self.qdrant,
            self.embedding_model,
            # self.embedding_matrix,
            self.chunks_df,
            self.tfidf_index,
            self.reranker,
            collection_name=self.text_collection,
            top_k=self.top_k,
            candidate_k=self.candidate_k,
            model_name=self.model_name,
        )
        frame = retrieval.apply_optional_theme_rerank(
            query,
            frame,
            self.theme_registry,
            top_k=self.top_k,
            boost=self.theme_rerank_boost,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        top = []
        if len(frame):
            for _, row in frame.head(self.top_k).iterrows():
                top.append(
                    f"{row.get('rank')}:{row.get('chunk_id')}"
                    f"@{row.get('file_name')}:p{row.get('page_number')}"
                )
        logger.info(
            "Text retrieve (hybrid_reranked_qdrant): query=%r hits=%s "
            "theme_applied=%s elapsed_ms=%.1f top=%s",
            query[:80],
            len(frame),
            bool(len(frame) and frame["theme_rerank_applied"].iloc[0])
            if "theme_rerank_applied" in frame.columns
            else False,
            elapsed_ms,
            top,
        )
        return frame.to_dict(orient="records")

    # def retrieve_images(self, query: str) -> list[dict[str, Any]]:
    #     frame = retrieval.retrieve_images_retrieve_rerank_fallback(
    #         query,
    #         self.image_model,
    #         self.image_stage1_embeddings,
    #         self.image_context_embeddings,
    #         self.image_records,
    #         top_k=self.image_top_k,
    #         candidate_k=self.image_candidate_k,
    #         model_name=self.image_model_name,
    #         confidence_threshold=self.image_confidence,
    #     )
    #     return frame.to_dict(orient="records")


    def retrieve_images(self, query: str) -> list[dict[str, Any]]:
        # same but with qdrant
        started = time.perf_counter()
        frame = retrieval.retrieve_images_retrieve_rerank_fallback_qdrant(
            query,
            self.qdrant,
            self.image_model,
            self.image_records,
            stage1_collection=self.image_stage1_collection,
            context_collection=self.image_context_collection,
            top_k=self.image_top_k,
            candidate_k=self.image_candidate_k,
            model_name=self.image_model_name,
            confidence_threshold=self.image_confidence,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        top = []
        if len(frame):
            for _, row in frame.head(self.image_top_k).iterrows():
                top.append(
                    f"{row.get('rank')}:{row.get('image_id')}"
                    f"@{row.get('file_name')}|{row.get('section_title')}"
                )
        logger.info(
            "Image retrieve (qdrant): query=%r hits=%s fallback=%s "
            "confidence=%s elapsed_ms=%.1f top=%s",
            query[:80],
            len(frame),
            bool(frame["fallback_used"].iloc[0]) if len(frame) and "fallback_used" in frame.columns else None,
            float(frame["confidence"].iloc[0]) if len(frame) and "confidence" in frame.columns else None,
            elapsed_ms,
            top,
        )
        return frame.to_dict(orient="records")

    def text_from_linked_chunks(self, image_contexts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Pull real text chunks linked to retrieved images (same pages)."""
        seen: set[str] = set()
        ordered_ids: list[str] = []
        for img in image_contexts:
            for cid in img.get("linked_chunk_ids") or []:
                cid = str(cid)
                if cid not in seen:
                    seen.add(cid)
                    ordered_ids.append(cid)

        if not ordered_ids:
            return []

        by_id = self.chunks_df.set_index("chunk_id", drop=False)
        rows = []
        for cid in ordered_ids:
            if cid not in by_id.index:
                continue
            row = by_id.loc[cid]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            rows.append(row.to_dict())
        return rows


    def build_display_cards(
        self,
        text_contexts: list[dict[str, Any]],
        image_contexts: list[dict[str, Any]],
        public_base_url: str,
    ) -> list[dict[str, Any]]:
        """Pair each image with its linked doc text for UI consumers."""
        base = public_base_url.rstrip("/")
        cards: list[dict[str, Any]] = []
        by_id = self.chunks_df.set_index("chunk_id", drop=False)

        def chunk_text(cid: str) -> str:
            if cid not in by_id.index:
                return ""
            row = by_id.loc[cid]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            return str(row.get("text") or "").strip()

        if image_contexts:
            for img in image_contexts[:5]:
                image_id = str(img.get("image_id") or "").strip()
                linked_texts: list[str] = []
                seen: set[str] = set()
                for cid in img.get("linked_chunk_ids") or []:
                    cid = str(cid)
                    if cid in seen:
                        continue
                    seen.add(cid)
                    t = chunk_text(cid)
                    if t:
                        linked_texts.append(t)

                fallback = str(
                    img.get("nearby_text")
                    or img.get("local_context")
                    or img.get("context_text")
                    or ""
                ).strip()
                doc_text = "\n\n".join(linked_texts) if linked_texts else fallback

                pages = img.get("page_numbers") or img.get("page_number") or ""
                cards.append(
                    {
                        "image_id": image_id,
                        "image_url": f"{base}/media/{image_id}" if image_id else None,
                        "file_name": img.get("file_name"),
                        "page": pages,
                        "section_title": str(img.get("section_title") or "").strip(),
                        "heading": str(
                            img.get("local_heading")
                            or img.get("section_title")
                            or ""
                        ).strip(),
                        "doc_text": doc_text,
                        "visual_description": str(
                            img.get("visual_description") or ""
                        ).strip(),
                        "context": str(
                            img.get("local_context")
                            or img.get("nearby_text")
                            or ""
                        ).strip(),
                    }
                )
            return cards

        for s in text_contexts[:5]:
            text = str(s.get("text") or "").strip()
            cards.append(
                {
                    "image_id": None,
                    "image_url": None,
                    "file_name": s.get("file_name"),
                    "page": s.get("page_number"),
                    "section_title": str(s.get("section_title") or "").strip(),
                    "heading": str(s.get("section_title") or "").strip(),
                    "doc_text": text,
                    "visual_description": "",
                    "context": text,
                }
            )
        return cards

    
    def classify_intent(self, query: str) -> str:
        """Return 'visual' or 'text'. Local Ollama router; keyword fallback if Ollama fails."""
        prompt = (
            "Classify the user question for a wedding/event RAG system.\n"
            "Reply with exactly one word: visual or text.\n"
            "- visual = asking how something looks, designs, photos, invitations appearance, "
            "decor style to see, show me, bouquet look, table setting look\n"
            "- text = facts, how-to, planning advice, sustainability, logistics, definitions "
            "with no need for pictures\n\n"
            f"Question: {query}\n"
            "Label:"
        )
        # try:
        #     resp = ollama.chat(
        #         model=ROUTER_MODEL,
        #         messages=[{"role": "user", "content": prompt}],
        #         options={"temperature": 0},
        #     )
        #     raw = (resp.get("message") or {}).get("content") or ""

        try:
            client = generation.get_llm_client()
            resp = client.chat.completions.create(
                model=generation.DEFAULT_LLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=10,
            )
            raw = (resp.choices[0].message.content or "").strip()
            label = raw.strip().casefold()
            if "visual" in label.split() or label.startswith("visual"):
                return "visual"
            if "text" in label.split() or label.startswith("text"):
                return "text"
            # if model rambling, take first token
            first = re.sub(r"[^a-z]", "", label.split()[0]) if label.split() else ""
            if first in {"visual", "text"}:
                return first
        except Exception as exc:
            logger.warning("Router Ollama failed (%s); using keyword fallback", exc)

        q = query.casefold()
        visual_hints = (
            "look like", "looks like", "show me", "show ", "photo", "image",
            "design", "invitation", "bouquet", "decor", "aesthetic", "visual",
            "picture", "style of", "how should .* look",
        )
        if any(h in q for h in visual_hints):
            return "visual"
        return "text"


    def ask(
        self,
        query: str,
        *,
        max_tokens: int = 2048,
        public_base_url: str = "http://host.docker.internal:8001",
    ) -> dict[str, Any]:
        mode = self.classify_intent(query)
        logger.info("Intent: %s | query=%r", mode, query[:80])

        if mode == "visual":
            image_contexts = self.retrieve_images(query)
            text_contexts = self.text_from_linked_chunks(image_contexts)
        else:
            text_contexts = self.retrieve(query)
            image_contexts = []

        answer = generation.generate_answer(
            query,
            text_contexts,
            image_contexts=image_contexts or None,
            max_tokens=max_tokens,
        )
        base = public_base_url.rstrip("/")
        cards = self.build_display_cards(text_contexts, image_contexts, base)
        	
        logger.info("Cards built: %s", len(cards))
        return {
            "answer": answer,
            "sources": text_contexts,
            "image_sources": image_contexts,
            "cards": cards,
            "mode": mode,
            "public_base_url": base,
        }

    def _ops_allowed_files(self, topics: list[str]) -> set[str]:
        allowed: set[str] = set()
        for topic in topics or []:
            key = (topic or "").strip().lower()
            for name in OPS_TOPIC_FILES.get(key, []):
                allowed.add(name)
        return allowed

    def ask_ops(
        self,
        query: str,
        topics: list[str],
        *,
        max_tokens: int = 2048,
        public_base_url: str = "http://host.docker.internal:8001",
    ) -> dict[str, Any]:
        """RAG over ops/checklist/sustainability/Arabic docs only.

        Retrieves per-topic so each topic gets its own chunk slots.
        """
        question = (query or "").strip()
        if not question:
            raise ValueError("question is required")

        clean_topics = [
            t.strip().lower()
            for t in (topics or [])
            if t.strip().lower() in OPS_TOPIC_FILES
        ]
        if not clean_topics:
            raise ValueError("At least one valid topic is required.")

        HINT_LABELS = {
            "organizer": "Organiser un événement de A à Z",
            "checklist": "Checklists",
            "sustainable": "Guideline Sustainable Event",
            "arabic_traditions": "Arabic wedding traditions",
        }

        all_filtered: list[dict[str, Any]] = []

        for topic in clean_topics:
            allowed_files = set(OPS_TOPIC_FILES[topic])
            results = self.retrieve(question)
            topic_hits = [
                row for row in results
                if str(row.get("file_name") or "") in allowed_files
            ]

            if not topic_hits:
                hint = HINT_LABELS.get(topic, topic)
                enriched = f"{question}\n\nUse only: {hint}"
                retry = self.retrieve(enriched)
                topic_hits = [
                    row for row in retry
                    if str(row.get("file_name") or "") in allowed_files
                ]

            for hit in topic_hits:
                hit["_topic"] = topic

            all_filtered.extend(topic_hits)

        if not all_filtered:
            return {
                "status": "error",
                "message": (
                    "No passages found in the requested ops guides. "
                    "Try a more specific question."
                ),
                "topics": clean_topics,
            }

        answer = generation.generate_ops_answer(
            question,
            all_filtered,
            topics=clean_topics,
            max_tokens=max_tokens,
        )
        base = public_base_url.rstrip("/")
        return {
            "status": "success",
            "answer": answer,
            "sources": all_filtered,
            "topics": clean_topics,
            "mode": "ops_text",
            "public_base_url": base,
        }



    def ask_by_image(
        self,
        image_path: str,
        *,
        question: str = "",
        max_tokens: int = 2048,
        public_base_url: str = "http://host.docker.internal:8001",
    ) -> dict[str, Any]:
        """VLM describe → embed/search images → linked text → answer."""
        from doc_rag.vlm import describe_image_file

        description = describe_image_file(image_path).strip()
        if not description:
            raise ValueError("VLM returned an empty image description.")

        user_q = (question or "").strip()
        query = (
            f"{user_q}\n\nVisual description: {description}"
            if user_q
            else description
        )

        image_contexts = self.retrieve_images(description)
        text_contexts = self.text_from_linked_chunks(image_contexts)
        answer = generation.generate_answer(
            query,
            text_contexts,
            image_contexts=image_contexts or None,
            max_tokens=max_tokens,
        )
        base = public_base_url.rstrip("/")
        cards = self.build_display_cards(text_contexts, image_contexts, base)
        return {
            "answer": answer,
            "sources": text_contexts,
            "image_sources": image_contexts,
            "cards": cards,
            "mode": "visual_image",
            "vlm_description": description,
            "public_base_url": base,
        }
