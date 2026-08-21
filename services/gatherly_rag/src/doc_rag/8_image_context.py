"""Associate extracted theme-PDF images with nearby positioned text.

Run directly from the project root:
    py src/doc_rag/8_image_context.py

This stage does not perform OCR or create embeddings. It creates one
``image_context.json`` beside each processed theme document's artifacts.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path, PureWindowsPath

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from ftfy import fix_text
from doc_rag.vlm import OpenRouterQwenVLM


DEFAULT_DOCUMENTS_DIR = PROJECT_ROOT / "docs" / "generated_pdfs"
DEFAULT_ARTIFACT_ROOT = PROJECT_ROOT / "data" / "rag" / "processed_documents"
CONTEXT_SCHEMA_VERSION = 3
DEFAULT_NEARBY_BLOCKS = 5
DEFAULT_MAX_CONTEXT_CHARACTERS = 280

def resolve_extracted_image_path(
    record: dict,
    document_dir: str | Path,
) -> Path:
    """Resolve an extracted image without rewriting cached JSON.

    ``image_path`` is often a Windows absolute path. In Docker that string
    does not exist; the file still lives next to ``image_context.json``.
    """
    document_dir = Path(document_dir)
    stored = str(record.get("stored_file_name") or "").strip()
    raw = str(record.get("image_path") or "").strip()

    if not stored and raw:
        stored = PureWindowsPath(raw).name
        if not stored:
            stored = Path(raw.replace("\\", "/")).name

    candidates: list[Path] = []
    if stored:
        candidates.append(document_dir / "images" / stored)
        candidates.append(document_dir / stored)
    if raw:
        candidates.append(Path(raw))

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue

    if stored:
        return (document_dir / "images" / stored).resolve()
    if raw:
        return Path(raw)
    raise FileNotFoundError(
        f"No image path for record {record.get('image_id')}"
    )

def load_image_context_records(
    artifact_root: str | Path = DEFAULT_ARTIFACT_ROOT,
) -> list[dict]:
    """Load image_context.json records (no OCR required)."""
    artifact_root = Path(artifact_root).resolve()
    if not artifact_root.is_dir():
        raise FileNotFoundError(
            f"Processed-document directory not found: {artifact_root}"
        )

    context_files = sorted(artifact_root.glob("*/image_context.json"))
    if not context_files:
        raise ValueError(
            "No image_context.json files were found. "
            "Run 8_image_context.py or the pipeline image stage first."
        )

    records: list[dict] = []
    for context_file in context_files:
        payload = _read_required_json(context_file)
        for image in payload.get("images", []):
            record = dict(image)
            record["context_file"] = str(context_file.resolve())
            record["processed_document_directory"] = str(
                context_file.parent.resolve()
            )
            record["image_path"] = str(
                resolve_extracted_image_path(
                    record,
                    context_file.parent,
                )
            )
            records.append(record)

    if not records:
        raise ValueError("image_context.json files contain no image records.")

    image_ids = [record["image_id"] for record in records]
    if len(image_ids) != len(set(image_ids)):
        raise ValueError("Duplicate image IDs were found.")

    records.sort(
        key=lambda record: (
            str(record.get("file_name", "")).casefold(),
            min(record.get("page_numbers") or [0]),
            str(record["image_id"]),
        )
    )
    return records


def build_pdf_image_contexts(
    documents_dir: str | Path,
    *,
    artifact_root: str | Path = DEFAULT_ARTIFACT_ROOT,
    nearby_blocks: int = DEFAULT_NEARBY_BLOCKS,
    max_context_characters: int = DEFAULT_MAX_CONTEXT_CHARACTERS,
    vlm=None,
    force: bool = False,
) -> dict:
    """Build or reuse image-context records for every PDF in a directory."""

    documents_dir = Path(documents_dir).resolve()
    artifact_root = Path(artifact_root).resolve()

    if not documents_dir.is_dir():
        raise FileNotFoundError(
            f"PDF directory was not found: {documents_dir}"
        )

    if nearby_blocks <= 0 or max_context_characters <= 0:
        raise ValueError(
            "Context limits must be positive integers."
        )

    pdf_paths = sorted(documents_dir.glob("*.pdf"))

    if not pdf_paths:
        raise ValueError(
            f"No PDF files were found in {documents_dir}."
        )

    artifact_dirs = _artifact_directories_by_source(
        artifact_root
    )

    documents = []

    for pdf_path in pdf_paths:
        print(f"\nProcessing document: {pdf_path.name}", flush=True)

        key = str(
            pdf_path.resolve()
        ).casefold()

        document_dir = artifact_dirs.get(key)

        if document_dir is None:
            raise FileNotFoundError(
                f"Processed artifacts are missing for "
                f"{pdf_path.name}. Run the document pipeline first."
            )

        document_summary = build_document_image_contexts(
            document_dir,
            nearby_blocks=nearby_blocks,
            max_context_characters=max_context_characters,
            vlm=vlm,
            force=force,
        )

        documents.append(
            document_summary
        )

        print(
            f"Finished document: {pdf_path.name} "
            f"({document_summary['image_count']} images)",
            flush=True,
        )

    return {
        "documents_directory": str(documents_dir),
        "document_count": len(documents),
        "image_count": sum(
            item["image_count"]
            for item in documents
        ),
        "cache_hits": sum(
            bool(item["cache_hit"])
            for item in documents
        ),
        "documents": documents,
    }


def build_document_image_contexts(
    document_dir: str | Path,
    *,
    nearby_blocks: int = DEFAULT_NEARBY_BLOCKS,
    max_context_characters: int = DEFAULT_MAX_CONTEXT_CHARACTERS,
    vlm=None,
    force: bool = False,
) -> dict:
    """Create spatial text associations for one processed PDF."""
    document_dir = Path(document_dir).resolve()
    manifest_path = document_dir / "images" / "manifest.json"
    text_path = document_dir / "extracted_text.json"
    chunks_path = document_dir / "chunks.json"
    output_path = document_dir / "image_context.json"
    manifest = _read_required_json(manifest_path)
    extracted = _read_required_json(text_path)
    chunk_payload = _read_required_json(chunks_path)

    expected = {
        "schema_version": CONTEXT_SCHEMA_VERSION,
        "source_sha256": manifest["source_sha256"],
        "nearby_blocks": nearby_blocks,
        "max_context_characters": max_context_characters,
    }

    if vlm is not None:
        expected["vlm_enabled"] = True
        expected["vlm_model"] = getattr(vlm, "model", vlm.__class__.__name__)
        expected["vlm_prompt_version"] = getattr(vlm, "prompt_version", None)
        expected["vlm_num_ctx"] = getattr(vlm, "num_ctx", None)
    else:
        expected["vlm_enabled"] = False
        expected["vlm_model"] = None
        expected["vlm_prompt_version"] = None
        expected["vlm_num_ctx"] = None

    cached = None if force else _read_json(output_path)
    reused_descriptions: dict[str, str] = {}

    # Preserve VLM even when nearby/max_context settings change.
    if cached and not force:
        reused_descriptions = {
            str(image.get("image_id")): str(
                image.get("visual_description", "")
            ).strip()
            for image in cached.get("images", [])
            if str(image.get("visual_description", "")).strip()
        }

    if cached and all(cached.get(key) == value for key, value in expected.items()):
        images = cached.get("images", [])
        if len(images) == manifest.get("unique_image_count", 0):
            if vlm is None:
                return _document_summary(cached, output_path, cache_hit=True)

            missing_descriptions = (
                manifest.get("unique_image_count", 0)
                - len(reused_descriptions)
            )
            if missing_descriptions <= 0:
                return _document_summary(
                    cached, output_path, cache_hit=True
                )

            print(
                f"Resuming VLM for {manifest.get('file_name')}: "
                f"reusing {len(reused_descriptions)} descriptions, "
                f"generating {missing_descriptions} missing.",
                flush=True,
            )

    document = extracted["document"]
    pages = {int(page["page_number"]): page for page in document["pages"]}
    boilerplate = {_clean_text(text).casefold() for text in document.get("boilerplate_lines", [])}
    section_headings = _extract_heading_candidates(document["pages"], boilerplate)
    chunks_by_page = _chunks_by_page(chunk_payload.get("chunks", []))
    records = []
    images_dir = manifest_path.parent

    for image_index, image in enumerate(manifest.get("images", []), start=1):
        print(
            f"  Image {image_index}/{manifest.get('unique_image_count', 0)}: "
            f"{image['stored_file_name']}",
            flush=True,
        )
        heading_context = _headings_for_image(image, section_headings, pages)
        image_path = (images_dir / image["stored_file_name"]).resolve()
        visual_description = reused_descriptions.get(
            str(image["image_id"]), ""
        )
        if vlm is not None and not visual_description:
            visual_description = _describe_image_with_vlm(
                image_path,
                vlm,
            )
            if visual_description:
                print("VLM description complete", flush=True)
            else:
                print("No VLM description generated", flush=True)
        elif visual_description:
            print("Reused existing VLM description", flush=True)
        else:
            print("No VLM description generated", flush=True)

        page_associations = []
        selected_texts = []
        linked_chunk_ids = []
        for placement in image.get("placements", []):
            page_number = int(placement["page_number"])
            page = pages.get(page_number)
            if page is None:
                continue
            association = _associate_placement(
                placement, page, nearby_blocks=nearby_blocks,
                boilerplate=boilerplate,
            )
            page_associations.append(association)
            selected_texts.extend(association["selected_texts"])
            linked_chunk_ids.extend(
                chunk["chunk_id"] for chunk in chunks_by_page.get(page_number, [])
            )

        spatial_local_heading = _local_heading_from_associations(page_associations)
        heading_titles = list(heading_context["heading_path"]) if heading_context else []
        if spatial_local_heading and spatial_local_heading not in heading_titles:
            heading_titles.append(spatial_local_heading)
        heading_length = sum(len(title) for title in heading_titles)
        heading_separators = 2 * max(0, len(heading_titles) - 1)
        local_budget = max(160, max_context_characters - heading_length - heading_separators - 2)
        local_context = _build_brief_context(
            [text for text in selected_texts if text not in heading_titles],
            local_budget,
        )
        nearby_text = _join_unique_text(
            [*heading_titles, local_context],
            max_context_characters,
        )
        records.append({
            "image_id": image["image_id"],
            # "image_path": str((images_dir / image["stored_file_name"]).resolve()),
            "image_path": str(image_path),
            "stored_file_name": image["stored_file_name"],
            "file_name": manifest["file_name"],
            "source_path": manifest["source_path"],
            "page_numbers": [int(page) for page in image.get("pages", [])],
            "is_split_across_pages": bool(image.get("is_split_across_pages")),
            "width": int(image["width"]),
            "height": int(image["height"]),
            "section_number": heading_context.get("section_number") if heading_context else None,
            "section_title": heading_context.get("section_title", "") if heading_context else "",
            "local_heading": spatial_local_heading,
            "heading_path": heading_titles,
            "local_context": local_context,
            "nearby_text": nearby_text,
            "ocr_text": "",
            "visual_description": visual_description,
            "linked_chunk_ids": list(dict.fromkeys(linked_chunk_ids)),
            "page_associations": page_associations,
            
        })

    payload = {
        **expected,
        "file_name": manifest["file_name"],
        "source_path": manifest["source_path"],
        "image_count": len(records),
        "images": records,
    }
    _write_json_atomic(output_path, payload)
    return _document_summary(payload, output_path, cache_hit=False)


def _associate_placement(placement, page, *, nearby_blocks, boilerplate):
    image_bbox = [float(value) for value in placement["bbox"]]
    page_width = float(page["width"])
    page_height = float(page["height"])
    visible_bbox = _clip_bbox(image_bbox, page_width, page_height)
    candidates = []
    for block in page.get("text_blocks", []):
        text = _clean_text(block.get("text", ""))
        if not text or _is_boilerplate_text(text, boilerplate):
            continue
        bbox = [float(value) for value in block["bbox"]]
        score, relation = _spatial_score(visible_bbox, bbox, page_width, page_height)
        candidates.append({
            "block_number": int(block.get("block_number", -1)),
            "bbox": bbox,
            "relation": relation,
            "distance_score": round(score, 6),
            "text": text,
        })

    candidates.sort(key=lambda item: item["distance_score"])
    selected = candidates[:nearby_blocks]
    return {
        "page_number": int(placement["page_number"]),
        "image_bbox": image_bbox,
        "visible_bbox": visible_bbox,
        "visible_fraction": float(placement.get("visible_fraction", 1.0)),
        "selected_blocks": selected,
        "selected_texts": [item["text"] for item in selected],
    }

def _describe_image_with_vlm(image_path, vlm):
    """Generate a concise factual description of an image for retrieval."""

    try:
        description = vlm.describe_image(
            image_path=image_path,
        )
        return str(description).strip()

    except Exception as error:
        message = str(error)
        # Fail fast on auth/model issues so we do not write empty descriptions.
        if any(
            marker in message.casefold()
            for marker in (
                "model_not_supported",
                "not supported by any provider",
                "not a valid model id",
                "no endpoints found",
                "capacity_exhausted",
                "requires more credits",
                "402",
                "401",
                "403",
                "unauthorized",
                "invalid_api_key",
                "api key",
                "permission_denied",
                "error code: 400",
                "error code: 402",
                "error code: 404",
            )
        ):
            raise RuntimeError(
                f"VLM backend failed for {Path(image_path).name}: {error}"
            ) from error

        print(
            f"Warning: VLM description failed for "
            f"{Path(image_path).name}: {error}"
        )
        return ""


def _extract_heading_candidates(pages, boilerplate):
    """Infer headings from generic text shape and position signals."""
    headings = []
    for page in pages:
        page_number = int(page["page_number"])
        for block in page.get("text_blocks", []):
            text = _clean_text(block.get("text", ""))
            single_line = " ".join(text.split())
            if _is_boilerplate_text(text, boilerplate):
                continue
            heading_level = _infer_heading_level(single_line)
            if heading_level is None:
                continue
            bbox = [float(value) for value in block["bbox"]]
            headings.append({
                "section_number": _leading_section_number(single_line),
                "title": single_line,
                "level": heading_level,
                "page_number": page_number,
                "y": bbox[1],
            })
    headings.sort(key=lambda item: (item["page_number"], item["y"]))
    return headings


def _headings_for_image(image, headings, pages):
    """Return the latest major and local headings preceding an image."""
    placements = sorted(
        image.get("placements", []),
        key=lambda item: (int(item["page_number"]), float(item["bbox"][1])),
    )
    if not placements:
        return None
    first = placements[0]
    page_number = int(first["page_number"])
    page = pages.get(page_number, {})
    image_y = max(0.0, min(float(page.get("height", 0.0)), float(first["bbox"][1])))
    preceding = [
        heading for heading in headings
        if (heading["page_number"], heading["y"]) <= (page_number, image_y)
    ]
    if not preceding:
        return None
    major_candidates = [heading for heading in preceding if heading["level"] == 1]
    major = major_candidates[-1] if major_candidates else preceding[-1]
    heading_path = [major["title"]]
    return {
        "section_number": major.get("section_number"),
        "section_title": major["title"],
        "heading_path": heading_path,
    }


def _local_heading_from_associations(associations):
    candidates = []
    for association in associations:
        for block in association.get("selected_blocks", []):
            if _infer_heading_level(block["text"]) == 2:
                candidates.append((float(block["distance_score"]), block["text"]))
    return min(candidates, default=(None, ""), key=lambda item: item[0])[1]


def _infer_heading_level(text):
    """Infer a coarse heading level without assuming a document template."""
    text = " ".join(str(text).split())
    if not text or len(text) > 180 or len(text.split()) > 22:
        return None
    if re.search(r"[.!?]$", text) and len(text.split()) > 8:
        return None
    if re.match(r"^\s*(?:\d+(?:\.\d+)*[.)]?|[IVXLCDM]+[.)]|[A-Z][.)])\s+\S", text):
        return 1
    letters = [character for character in text if character.isalpha()]
    if letters and sum(character.isupper() for character in letters) / len(letters) >= 0.8:
        return 1
    words = re.findall(r"[^\W\d_]+", text, flags=re.UNICODE)
    if 4 <= len(words) <= 14 and not re.search(r"[:|]", text):
        significant = [word for word in words if len(word) > 2]
        title_like = sum(word[:1].isupper() for word in significant)
        if significant and title_like / len(significant) >= 0.6:
            return 2
    return None


def _leading_section_number(text):
    match = re.match(r"^\s*(\d+(?:\.\d+)*)[.)]?\s+", str(text))
    return match.group(1) if match else None


def _spatial_score(image, text, page_width, page_height):
    ix0, iy0, ix1, iy1 = image
    tx0, ty0, tx1, ty1 = text
    vertical_overlap = max(0.0, min(iy1, ty1) - max(iy0, ty0))
    horizontal_overlap = max(0.0, min(ix1, tx1) - max(ix0, tx0))
    image_h = max(1.0, iy1 - iy0)
    text_h = max(1.0, ty1 - ty0)
    image_w = max(1.0, ix1 - ix0)
    text_w = max(1.0, tx1 - tx0)
    vertical_ratio = vertical_overlap / min(image_h, text_h)
    horizontal_ratio = horizontal_overlap / min(image_w, text_w)

    if vertical_ratio > 0.25:
        gap = max(0.0, max(ix0, tx0) - min(ix1, tx1))
        relation = "beside"
        penalty = 0.0
    elif horizontal_ratio > 0.25:
        gap = max(0.0, max(iy0, ty0) - min(iy1, ty1))
        relation = "below" if ty0 >= iy1 else "above"
        penalty = 0.08 if relation == "below" else 0.12
    else:
        image_center = ((ix0 + ix1) / 2, (iy0 + iy1) / 2)
        text_center = ((tx0 + tx1) / 2, (ty0 + ty1) / 2)
        dx = (image_center[0] - text_center[0]) / max(1.0, page_width)
        dy = (image_center[1] - text_center[1]) / max(1.0, page_height)
        return math.hypot(dx, dy) + 0.25, "diagonal"

    normalized_gap = gap / (page_width if relation == "beside" else page_height)
    overlap_bonus = 0.12 * (vertical_ratio if relation == "beside" else horizontal_ratio)
    return max(0.0, normalized_gap + penalty - overlap_bonus), relation


def _clip_bbox(bbox, width, height):
    x0, y0, x1, y1 = bbox
    clipped = [max(0.0, x0), max(0.0, y0), min(width, x1), min(height, y1)]
    if clipped[2] <= clipped[0] or clipped[3] <= clipped[1]:
        return [max(0.0, min(width, x0)), max(0.0, min(height, y0)),
                max(0.0, min(width, x1)), max(0.0, min(height, y1))]
    return clipped


def _chunks_by_page(chunks):
    result = {}
    for chunk in chunks:
        start = int(chunk.get("page_start", chunk["page_number"]))
        end = int(chunk.get("page_end", chunk["page_number"]))
        for page_number in range(start, end + 1):
            result.setdefault(page_number, []).append(chunk)
    return result


def _artifact_directories_by_source(artifact_root):
    result = {}
    if not artifact_root.is_dir():
        return result
    for manifest_path in artifact_root.glob("*/images/manifest.json"):
        manifest = _read_json(manifest_path)
        if manifest and manifest.get("source_path"):
            key = str(Path(manifest["source_path"]).resolve()).casefold()
            result[key] = manifest_path.parents[1]
    return result


def _join_unique_text(texts, max_characters):
    parts = []
    length = 0
    for text in texts:
        text = _clean_text(text)
        if not text or text in parts:
            continue
        separator = 2 if parts else 0
        required = len(text) + separator
        if length + required > max_characters:
            break
        parts.append(text)
        length += required
    return "\n\n".join(parts)


def _build_brief_context(texts, max_characters):
    """Compact context; never end mid-sentence or mid-word."""
    unique = []
    for text in texts:
        cleaned = _clean_text(text)
        if cleaned and cleaned not in unique:
            unique.append(cleaned)
    if not unique or max_characters <= 0:
        return ""

    combined = " ".join(" ".join(text.split()) for text in unique)
    combined = re.sub(r"\s+", " ", combined).strip()
    if not combined:
        return ""

    if len(combined) <= max_characters:
        return combined

    window = combined[:max_characters]

    # Prefer last full sentence inside the budget
    sentence_ends = [
        match.end()
        for match in re.finditer(r"[.!?](?:[\"')\]]+)?(?=\s|$)", window)
    ]
    if sentence_ends and sentence_ends[-1] >= max(40, max_characters // 3):
        return combined[: sentence_ends[-1]].strip()

    
    if " " in window:
        trimmed = window.rsplit(" ", 1)[0].strip()
        if trimmed:
            return trimmed

    
    return _join_unique_text(unique, max_characters)

def _clean_text(text):
    text = fix_text(str(text or ""))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"(?<=\w)-\s+(?=\w)", "-", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _is_boilerplate_text(text, boilerplate):
    lines = [_clean_text(line).casefold() for line in str(text).splitlines()]
    lines = [line for line in lines if line]
    return bool(lines) and all(line in boilerplate for line in lines)


def _document_summary(payload, output_path, *, cache_hit):
    return {
        "file_name": payload["file_name"],
        "source_path": payload["source_path"],
        "image_count": int(payload["image_count"]),
        "split_image_count": sum(
            bool(image["is_split_across_pages"]) for image in payload["images"]
        ),
        "empty_context_count": sum(
            not image["nearby_text"].strip() for image in payload["images"]
        ),
        "output_path": str(output_path),
        "cache_hit": cache_hit,
    }


def _read_required_json(path):
    payload = _read_json(path)
    if payload is None:
        raise FileNotFoundError(f"Required artifact is missing or invalid: {path}")
    return payload


def _read_json(path):
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return None


def _write_json_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(
        description="Associate images from all  PDFs with nearby text."
    )
    parser.add_argument("documents_dir", nargs="?", type=Path, default=DEFAULT_DOCUMENTS_DIR)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--nearby-blocks", type=int, default=DEFAULT_NEARBY_BLOCKS)
    parser.add_argument("--max-context-characters", type=int,
                        default=DEFAULT_MAX_CONTEXT_CHARACTERS)
    args = parser.parse_args()
    vlm = OpenRouterQwenVLM()
    result = build_pdf_image_contexts(
        args.documents_dir,
        nearby_blocks=args.nearby_blocks,
        max_context_characters=args.max_context_characters,
        vlm=vlm,
        force=args.force,
    )
    print("\nImage-context association complete")
    print("Documents:", result["document_count"])
    print("Images:", result["image_count"])
    print("Cache hits:", result["cache_hits"])
    for document in result["documents"]:
        print(
            f"- {document['file_name']}: {document['image_count']} images, "
            f"{document['split_image_count']} split, "
            f"{document['empty_context_count']} empty contexts"
        )


if __name__ == "__main__":
    main()
