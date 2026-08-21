"""Chunk cleaned PDF text while preserving retrieval provenance."""

import re
import hashlib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


CHUNKING_STRATEGIES = {
    "fixed_size": "fixed_size_chunk",
    "recursive": "recursive_chunk",
    "sentence": "sentence_chunk",
    "structure_aware": "structure_aware_chunk",
    "semantic": "semantic_chunk",
}


def _validate_size_options(chunk_size: int, overlap: int) -> None:
    """Validate character-based chunking options."""
    if not isinstance(chunk_size, int) or isinstance(chunk_size, bool):
        raise TypeError("chunk_size must be an integer.")
    if not isinstance(overlap, int) or isinstance(overlap, bool):
        raise TypeError("overlap must be an integer.")
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than 0.")
    if overlap < 0:
        raise ValueError("overlap cannot be negative.")
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size.")

def fixed_size_chunk(
    text: str,
    chunk_size: int = 800,
    overlap: int = 100,
) -> list[str]:
    """
    Split text into fixed-size character chunks with overlap.

    Parameters
   
    text:
        Text to split.
    chunk_size:
        Maximum number of characters in each chunk.
    overlap:
        Number of characters shared between consecutive chunks.

    Returns
    
    list[str]
        Generated non-empty chunks.
    """
    if not isinstance(text, str) or not text.strip():
        return []

    _validate_size_options(chunk_size, overlap)

    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = min(start + chunk_size, text_length)

        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        # The remaining text has already been included.
        if end == text_length:
            break

        start += chunk_size - overlap

    return chunks

def recursive_chunk(
    text: str,
    chunk_size: int = 800,
    overlap: int = 100,
) -> list[str]:
    """
    Split text recursively while preferring meaningful boundaries.

    Splitting priority:
    paragraphs -> lines -> sentences -> list entries -> words -> characters
    """

    if not isinstance(text, str) or not text.strip():
        return []

    _validate_size_options(chunk_size, overlap)

    separators = [
        "\n\n",
        "\n",
        ". ",
        "; ",
        ", ",
        " ",
        "",
    ]

    def split_recursively(
        current_text: str,
        separator_index: int,
    ) -> list[str]:
        if len(current_text) <= chunk_size:
            return [current_text]

        separator = separators[separator_index]

        # Final fallback: split by characters only when no boundary works.
        if separator == "":
            return [
                current_text[start:start + chunk_size]
                for start in range(0, len(current_text), chunk_size)
                if current_text[start:start + chunk_size]
            ]

        parts = current_text.split(separator)

        # This separator does not exist in the text.
        if len(parts) == 1:
            return split_recursively(
                current_text,
                separator_index + 1,
            )

        split_parts = []

        for index, part in enumerate(parts):
            # Restore the separator so the original text formatting is kept.
            if index < len(parts) - 1:
                part = part + separator

            if not part:
                continue

            if len(part) <= chunk_size:
                split_parts.append(part)
            else:
                split_parts.extend(
                    split_recursively(
                        part,
                        separator_index + 1,
                    )
                )

        return split_parts

    parts = split_recursively(text.strip(), 0)

    chunks = []
    current_parts = []
    current_length = 0

    for part in parts:
        part_length = len(part)

        if current_parts and current_length + part_length > chunk_size:
            chunk = "".join(current_parts).strip()

            if chunk:
                chunks.append(chunk)

            # Keep complete previous parts for overlap where possible.
            while current_parts and (
                current_length > overlap
                or current_length + part_length > chunk_size
            ):
                removed_part = current_parts.pop(0)
                current_length -= len(removed_part)

        current_parts.append(part)
        current_length += part_length

    if current_parts:
        final_chunk = "".join(current_parts).strip()

        if final_chunk:
            chunks.append(final_chunk)

    return chunks

def sentence_chunk(
    text: str,
    sentences_per_chunk: int = 4,
    sentence_overlap: int = 1,
) -> list[str]:
    """
    Split text into chunks containing a fixed number of sentence-like units.

    For semi-structured food documents, units are separated using:
    - sentence-ending punctuation
    - line breaks
    """

    if not isinstance(text, str) or not text.strip():
        return []

    if sentences_per_chunk <= 0:
        raise ValueError("sentences_per_chunk must be greater than 0.")

    if sentence_overlap < 0:
        raise ValueError("sentence_overlap cannot be negative.")

    if sentence_overlap >= sentences_per_chunk:
        raise ValueError(
            "sentence_overlap must be smaller than sentences_per_chunk."
        )

    
    units = re.split(
        r"(?<=[.!?])\s+|\n+",
        text.strip(),
    )

   
    units = [
        unit.strip()
        for unit in units
        if unit.strip()
    ]

    chunks = []

    step = sentences_per_chunk - sentence_overlap

    for start in range(0, len(units), step):
        end = start + sentences_per_chunk
        selected_units = units[start:end]

        if not selected_units:
            break

        chunk = "\n".join(selected_units)
        chunks.append(chunk)

        if end >= len(units):
            break

    return chunks


def _looks_like_heading(line: str) -> bool:
    """Conservatively detect headings in extracted PDF text."""
    line = line.strip()

    if not line or len(line) > 140:
        return False

    if re.match(r"^(?:\d+(?:\.\d+)*|[A-Z])(?:[.)])?\s+\S", line):
        return True

    words = line.split()
    if not 1 <= len(words) <= 14:
        return False

    letters = [character for character in line if character.isalpha()]
    is_uppercase = bool(letters) and all(
        character.isupper() for character in letters
    )
    is_title_case = sum(word[:1].isupper() for word in words) / len(words) >= 0.8
    ends_like_sentence = line.endswith((".", "?", "!", ",", ";"))

    return is_uppercase or (is_title_case and not ends_like_sentence)

def structure_aware_chunk(
    text: str,
    chunk_size: int = 800,
    overlap: int = 100,
) -> list[str]:
    """
    Split a structured document by logical fields.

    Small consecutive fields are grouped into chunks up to chunk_size.
    Oversized fields are split using recursive chunking.
    """

    if not isinstance(text, str) or not text.strip():
        return []

    _validate_size_options(chunk_size, overlap)

    lines = text.splitlines()

    sections = []
    current_section = []

    # first: detect logical fields/sections
    for raw_line in lines:
        line = raw_line.strip()

        if not line:
            continue

        is_header = _looks_like_heading(line)

        if is_header and current_section:
            sections.append("\n".join(current_section).strip())
            current_section = [line]
        else:
            current_section.append(line)

    if current_section:
        sections.append("\n".join(current_section).strip())

    chunks = []
    current_chunk = ""

    # second: group small sections together
    for section in sections:
        if not section:
            continue

        # oversized section: flush current chunk, then split section
        if len(section) > chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""

            chunks.extend(
                recursive_chunk(
                    section,
                    chunk_size=chunk_size,
                    overlap=overlap,
                )
            )
            continue

        candidate = (
            f"{current_chunk}\n\n{section}"
            if current_chunk
            else section
        )

        if len(candidate) <= chunk_size:
            current_chunk = candidate
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())

            current_chunk = section

    if current_chunk:
        chunks.append(current_chunk.strip())

    return [
        chunk
        for chunk in chunks
        if chunk.strip()
    ]

def semantic_chunk(
    text: str,
    model: Any,
    similarity_threshold: float = 0.65,
    max_chunk_size: int = 800,
    unit_prefix: str = "",
) -> list[str]:
    """
    Split text when the semantic similarity between neighbouring
    sentence-like units falls below a threshold.
    """

    if not isinstance(text, str) or not text.strip():
        return []

    if not 0 <= similarity_threshold <= 1:
        raise ValueError("similarity_threshold must be between 0 and 1.")
    if max_chunk_size <= 0:
        raise ValueError("max_chunk_size must be greater than 0.")

    units = re.split(
        r"(?<=[.!?])\s+|\n+",
        text.strip(),
    )

    units = [unit.strip() for unit in units if unit.strip()]

    if not units:
        return []

    if model is None or not hasattr(model, "encode"):
        raise TypeError("model must provide an encode() method.")

    embedding_units = [f"{unit_prefix}{unit}" for unit in units]
    embeddings = np.asarray(
        model.encode(embedding_units, normalize_embeddings=True),
        dtype=np.float32,
    )

    if embeddings.ndim != 2 or embeddings.shape[0] != len(units):
        raise ValueError("The model must return one embedding per text unit.")

    chunks = []
    current_chunk = [units[0]]

    for index in range(1, len(units)):
        similarity = float(
            embeddings[index - 1] @ embeddings[index]
        )

        possible_chunk = " ".join(current_chunk + [units[index]])

        semantic_break = similarity < similarity_threshold
        size_break = len(possible_chunk) > max_chunk_size

        if semantic_break or size_break:
            chunks.append(" ".join(current_chunk))
            current_chunk = [units[index]]
        else:
            current_chunk.append(units[index])

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks


def chunk_extracted_documents(
    documents: list[dict],
    strategy: str | Callable[..., list[str]] = "recursive",
    **strategy_kwargs: Any,
) -> pd.DataFrame:
    """
    Chunk documents returned by ``doc_rag.2_extraction.extract_pdf``.

    Pages are chunked independently so every chunk retains exact page
    provenance. The cleaned ``final_text`` field is used by default.
    """
    if not isinstance(documents, list):
        raise TypeError("documents must be a list of extracted documents.")

    chunk_function, strategy_name = _resolve_strategy(strategy)
    records = []

    for document_index, document in enumerate(documents):
        _validate_extracted_document(document)

        file_name = str(document["file_name"])
        source_path = str(document["source_path"])
        source_key = str(Path(source_path).resolve()).casefold()
        source_hash = hashlib.sha256(
            source_key.encode("utf-8")
        ).hexdigest()[:12]
        document_id = f"{Path(file_name).stem}-{source_hash}"

        for page in document["pages"]:
            page_number = int(page["page_number"])
            page_text = page.get("final_text", "")

            if not isinstance(page_text, str) or not page_text.strip():
                continue

            chunks = chunk_function(page_text, **strategy_kwargs)

            for page_chunk_index, chunk_text in enumerate(chunks):
                chunk_text = chunk_text.strip()
                if not chunk_text:
                    continue

                records.append({
                    "chunk_id": (
                        f"{document_id}-p{page_number:04d}"
                        f"-c{page_chunk_index:03d}"
                    ),
                    "strategy": strategy_name,
                    "document_index": document_index,
                    "file_name": file_name,
                    "source_path": source_path,
                    "page_number": page_number,
                    "page_start": page_number,
                    "page_end": page_number,
                    "page_chunk_index": page_chunk_index,
                    "text": chunk_text,
                    "character_count": len(chunk_text),
                    "word_count": len(chunk_text.split()),
                    "extraction_method": page.get("extraction_method"),
                })

    columns = [
        "chunk_id", "strategy", "document_index", "file_name",
        "source_path", "page_number", "page_start", "page_end",
        "page_chunk_index", "text", "character_count", "word_count",
        "extraction_method",
    ]
    return pd.DataFrame(records, columns=columns)


def _resolve_strategy(
    strategy: str | Callable[..., list[str]],
) -> tuple[Callable[..., list[str]], str]:
    if callable(strategy):
        return strategy, getattr(strategy, "__name__", "custom")

    strategies = {
        "fixed_size": fixed_size_chunk,
        "recursive": recursive_chunk,
        "sentence": sentence_chunk,
        "structure_aware": structure_aware_chunk,
        "semantic": semantic_chunk,
    }

    if strategy not in strategies:
        choices = ", ".join(strategies)
        raise ValueError(f"Unknown strategy {strategy!r}. Choose from: {choices}.")

    return strategies[strategy], strategy


def _validate_extracted_document(document: dict) -> None:
    if not isinstance(document, dict):
        raise TypeError("Each extracted document must be a dictionary.")

    required = {"file_name", "source_path", "pages"}
    missing = required - document.keys()
    if missing:
        raise ValueError(
            "Extracted document is missing fields: "
            + ", ".join(sorted(missing))
        )
    if not isinstance(document["pages"], list):
        raise TypeError("document['pages'] must be a list.")

    for page in document["pages"]:
        if not isinstance(page, dict) or "page_number" not in page:
            raise ValueError("Each page must contain page_number metadata.")

