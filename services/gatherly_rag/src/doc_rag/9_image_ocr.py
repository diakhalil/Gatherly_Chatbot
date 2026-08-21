"""Idempotent OCR for extracted document images.

Default usage:
    py src/doc_rag/9_image_ocr.py

This reads every image_context.json under processed_documents and adds
OCR results to a separate image_ocr.json file. It does not modify the
original image-context records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from ftfy import fix_text



PROJECT_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_PROCESSED_ROOT = (
    PROJECT_ROOT / "data" / "rag" / "processed_documents"
)


OCR_SCHEMA_VERSION = 3
DEFAULT_LANGUAGES = "eng"
DEFAULT_PSM = 11
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_MIN_CONFIDENCE = 45.0
DEFAULT_MIN_TEXT_LENGTH = 6
DEFAULT_MIN_MEAN_CONFIDENCE = 60.0
DEFAULT_MIN_MEANINGFUL_WORDS = 3
DEFAULT_MIN_COHERENT_WORDS = 4
DEFAULT_MIN_COHERENT_WORD_RATIO = 0.45
DEFAULT_MIN_ALPHABETIC_RATIO = 0.65
DEFAULT_MAX_SINGLE_CHARACTER_RATIO = 0.30


def load_image_ocr_records(
    processed_root: str | Path = DEFAULT_PROCESSED_ROOT,
) -> list[dict]:
    """Load image_ocr.json records for inspection and embedding."""
    processed_root = Path(processed_root).resolve()
    if not processed_root.is_dir():
        raise FileNotFoundError(
            f"Processed-document directory was not found: {processed_root}"
        )

    ocr_files = sorted(processed_root.glob("*/image_ocr.json"))
    if not ocr_files:
        raise ValueError(
            "No image_ocr.json files were found. "
            "Run 9_image_ocr.py first."
        )

    records: list[dict] = []
    for ocr_file in ocr_files:
        payload = _read_required_json(ocr_file)
        for image in payload.get("images", []):
            record = dict(image)
            record["ocr_file"] = str(ocr_file.resolve())
            record["ocr_languages"] = payload.get("languages")
            record["image_path"] = str(
                Path(record["image_path"]).resolve()
            )
            records.append(record)

    if not records:
        raise ValueError("OCR artifacts contain no image records.")

    image_ids = [record["image_id"] for record in records]
    if len(image_ids) != len(set(image_ids)):
        raise ValueError("Duplicate image IDs were found.")

    missing_images = [
        record["image_path"]
        for record in records
        if not Path(record["image_path"]).is_file()
    ]
    if missing_images:
        raise FileNotFoundError(
            f"{len(missing_images)} extracted image files are missing."
        )

    records.sort(
        key=lambda record: (
            str(record.get("file_name", "")).casefold(),
            min(record.get("page_numbers") or [0]),
            str(record["image_id"]),
        )
    )
    return records


def process_all_image_contexts(
    processed_root: str | Path = DEFAULT_PROCESSED_ROOT,
    *,
    languages: str = DEFAULT_LANGUAGES,
    psm: int = DEFAULT_PSM,
    minimum_confidence: float = DEFAULT_MIN_CONFIDENCE,
    minimum_text_length: int = DEFAULT_MIN_TEXT_LENGTH,
    minimum_mean_confidence: float = DEFAULT_MIN_MEAN_CONFIDENCE,
    minimum_meaningful_words: int = DEFAULT_MIN_MEANINGFUL_WORDS,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    force: bool = False,
) -> dict:
    """Run or reuse OCR for every available image-context record."""

    processed_root = Path(processed_root).resolve()

    if not processed_root.is_dir():
        raise FileNotFoundError(
            f"Processed-document directory was not found: {processed_root}"
        )

    _validate_options(
        psm=psm,
        minimum_confidence=minimum_confidence,
        minimum_text_length=minimum_text_length,
        minimum_mean_confidence=minimum_mean_confidence,
        minimum_meaningful_words=minimum_meaningful_words,
        timeout_seconds=timeout_seconds,
    )

    _check_tesseract()

    context_files = sorted(
        processed_root.glob("*/image_context.json")
    )

    if not context_files:
        raise ValueError(
            "No image_context.json files were found. "
            "Run 8_image_context.py first."
        )

    documents = []

    for context_file in context_files:
        result = process_document_images(
            context_file,
            languages=languages,
            psm=psm,
            minimum_confidence=minimum_confidence,
            minimum_text_length=minimum_text_length,
            minimum_mean_confidence=minimum_mean_confidence,
            minimum_meaningful_words=minimum_meaningful_words,
            timeout_seconds=timeout_seconds,
            force=force,
        )
        documents.append(result)

    return {
        "document_count": len(documents),
        "image_count": sum(
            document["image_count"] for document in documents
        ),
        "images_with_text": sum(
            document["images_with_text"] for document in documents
        ),
        "images_without_text": sum(
            document["images_without_text"] for document in documents
        ),
        "cache_hits": sum(
            document["cache_hits"] for document in documents
        ),
        "ocr_runs": sum(
            document["ocr_runs"] for document in documents
        ),
        "documents": documents,
    }


def process_document_images(
    context_file: str | Path,
    *,
    languages: str = DEFAULT_LANGUAGES,
    psm: int = DEFAULT_PSM,
    minimum_confidence: float = DEFAULT_MIN_CONFIDENCE,
    minimum_text_length: int = DEFAULT_MIN_TEXT_LENGTH,
    minimum_mean_confidence: float = DEFAULT_MIN_MEAN_CONFIDENCE,
    minimum_meaningful_words: int = DEFAULT_MIN_MEANINGFUL_WORDS,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    force: bool = False,
) -> dict:
    """OCR every image associated with one processed document."""

    context_file = Path(context_file).resolve()
    context_payload = _read_required_json(context_file)
    output_file = context_file.with_name("image_ocr.json")

    existing_payload = (
        None if force else _read_json(output_file)
    )

    cached_by_id = {}

    if _cache_configuration_matches(
        existing_payload,
        languages=languages,
        psm=psm,
        minimum_confidence=minimum_confidence,
        minimum_text_length=minimum_text_length,
        minimum_mean_confidence=minimum_mean_confidence,
        minimum_meaningful_words=minimum_meaningful_words,
    ):
        cached_by_id = {
            record["image_id"]: record
            for record in existing_payload.get("images", [])
            if record.get("image_id")
        }

    records = []
    cache_hits = 0
    ocr_runs = 0

    for image in context_payload.get("images", []):
        image_path = Path(image["image_path"]).resolve()

        if not image_path.is_file():
            raise FileNotFoundError(
                f"Extracted image was not found: {image_path}"
            )

        image_sha256 = _sha256_file(image_path)
        cached = cached_by_id.get(image["image_id"])

        if (
            cached
            and cached.get("image_sha256") == image_sha256
        ):
            ocr_record = cached
            cache_hits += 1
        else:
            ocr_record = run_image_ocr(
                image_id=image["image_id"],
                image_path=image_path,
                image_sha256=image_sha256,
                languages=languages,
                psm=psm,
                minimum_confidence=minimum_confidence,
                minimum_text_length=minimum_text_length,
                minimum_mean_confidence=minimum_mean_confidence,
                minimum_meaningful_words=minimum_meaningful_words,
                timeout_seconds=timeout_seconds,
            )
            ocr_runs += 1

        combined_record = dict(image)
        combined_record["document_label"] = document_label(
            image["file_name"]
        )
        combined_record["ocr_text"] = ocr_record["ocr_text"]
        combined_record["ocr_raw_text"] = ocr_record["ocr_raw_text"]
        combined_record["ocr_rejection_reasons"] = ocr_record[
            "ocr_rejection_reasons"
        ]
        combined_record["ocr_quality"] = ocr_record["ocr_quality"]
        combined_record["ocr_word_count"] = ocr_record[
            "ocr_word_count"
        ]
        combined_record["ocr_mean_confidence"] = ocr_record[
            "ocr_mean_confidence"
        ]
        combined_record["ocr_detected"] = ocr_record[
            "ocr_detected"
        ]
        combined_record["image_sha256"] = image_sha256

        records.append(combined_record)

    payload = {
        "schema_version": OCR_SCHEMA_VERSION,
        "source_context_schema_version": context_payload.get(
            "schema_version"
        ),
        "source_sha256": context_payload.get("source_sha256"),
        "file_name": context_payload["file_name"],
        "source_path": context_payload["source_path"],
        "languages": languages,
        "psm": psm,
        "minimum_confidence": minimum_confidence,
        "minimum_text_length": minimum_text_length,
        "minimum_mean_confidence": minimum_mean_confidence,
        "minimum_meaningful_words": minimum_meaningful_words,
        "image_count": len(records),
        "images_with_text": sum(
            record["ocr_detected"] for record in records
        ),
        "images": records,
    }

    _write_json_atomic(output_file, payload)

    images_with_text = payload["images_with_text"]

    return {
        "file_name": payload["file_name"],
        "image_count": len(records),
        "images_with_text": images_with_text,
        "images_without_text": len(records) - images_with_text,
        "cache_hits": cache_hits,
        "ocr_runs": ocr_runs,
        "output_file": str(output_file),
    }


def run_image_ocr(
    *,
    image_id: str,
    image_path: Path,
    image_sha256: str,
    languages: str,
    psm: int,
    minimum_confidence: float,
    minimum_text_length: int,
    minimum_mean_confidence: float,
    minimum_meaningful_words: int,
    timeout_seconds: int,
) -> dict:
    """Run Tesseract TSV output and retain reliable words."""

    command = [
        "tesseract",
        str(image_path),
        "stdout",
        "-l",
        languages,
        "--psm",
        str(psm),
        "tsv",
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"OCR timed out for {image_path}"
        ) from error

    if result.returncode != 0:
        raise RuntimeError(
            f"Tesseract failed for {image_path}: "
            f"{result.stderr.strip()}"
        )

    text, word_count, mean_confidence = parse_tesseract_tsv(
        result.stdout,
        minimum_confidence=minimum_confidence,
    )

    raw_text = clean_ocr_text(text)
    quality = assess_ocr_quality(
        raw_text,
        languages=languages,
        mean_confidence=mean_confidence,
        minimum_text_length=minimum_text_length,
        minimum_mean_confidence=minimum_mean_confidence,
        minimum_meaningful_words=minimum_meaningful_words,
    )
    text = (
        _clean_searchable_ocr(raw_text, languages)
        if quality["accepted"] else ""
    )

    return {
        "image_id": image_id,
        "image_path": str(image_path),
        "image_sha256": image_sha256,
        "ocr_text": text,
        "ocr_raw_text": raw_text,
        "ocr_word_count": word_count,
        "ocr_mean_confidence": mean_confidence,
        "ocr_detected": bool(text),
        "ocr_rejection_reasons": quality["rejection_reasons"],
        "ocr_quality": quality,
    }


def assess_ocr_quality(
    text,
    *,
    languages,
    mean_confidence,
    minimum_text_length,
    minimum_mean_confidence,
    minimum_meaningful_words,
):
    """Reject photographic OCR noise using language-independent text shape."""
    tokens = re.findall(r"[^\W_]+(?:['’\-][^\W_]+)*", text, flags=re.UNICODE)
    meaningful = [token for token in tokens if sum(char.isalpha() for char in token) >= 2]
    coherent = [
        token for token in meaningful
        if _looks_like_coherent_word(token, languages)
    ]
    alpha_characters = sum(char.isalpha() for char in text)
    alphanumeric = sum(char.isalnum() for char in text)
    alphabetic_ratio = alpha_characters / max(1, alphanumeric)
    single_character_ratio = (
        sum(len(token) == 1 for token in tokens) / max(1, len(tokens))
    )
    unsupported_ratio = _unsupported_script_ratio(text, languages)
    coherent_word_ratio = len(coherent) / max(1, len(meaningful))
    reasons = []
    if len(text) < minimum_text_length:
        reasons.append("too_short")
    if mean_confidence is None or mean_confidence < minimum_mean_confidence:
        reasons.append("low_mean_confidence")
    if len(meaningful) < minimum_meaningful_words:
        reasons.append("too_few_meaningful_words")
    if len(coherent) < DEFAULT_MIN_COHERENT_WORDS:
        reasons.append("too_few_coherent_words")
    if coherent_word_ratio < DEFAULT_MIN_COHERENT_WORD_RATIO:
        reasons.append("low_coherent_word_ratio")
    if alphabetic_ratio < DEFAULT_MIN_ALPHABETIC_RATIO:
        reasons.append("low_alphabetic_ratio")
    if single_character_ratio > DEFAULT_MAX_SINGLE_CHARACTER_RATIO:
        reasons.append("too_many_single_character_tokens")
    if unsupported_ratio > 0.10:
        reasons.append("unsupported_script_noise")
    return {
        "accepted": not reasons,
        "meaningful_word_count": len(meaningful),
        "coherent_word_count": len(coherent),
        "coherent_word_ratio": round(coherent_word_ratio, 4),
        "alphabetic_ratio": round(alphabetic_ratio, 4),
        "single_character_ratio": round(single_character_ratio, 4),
        "unsupported_script_ratio": round(unsupported_ratio, 4),
        "rejection_reasons": reasons,
    }


def _looks_like_coherent_word(token, languages):
    letters = "".join(character for character in token if character.isalpha())
    if len(letters) < 4:
        return False
    language_codes = set(str(languages).casefold().split("+"))
    contains_arabic = any(0x0600 <= ord(character) <= 0x06FF for character in letters)
    contains_cyrillic = any(0x0400 <= ord(character) <= 0x052F for character in letters)
    if contains_arabic:
        return "ara" in language_codes
    if contains_cyrillic:
        return bool(language_codes & {"rus", "srp", "ukr", "bul"})
    # Latin OCR fragments from photographs often contain no vowel at all.
    normalized = letters.casefold()
    return any(vowel in normalized for vowel in "aeiouyàâäæçéèêëîïôöœùûüÿ")


def _clean_searchable_ocr(text, languages):
    """Keep only lines containing at least one plausible word."""
    kept_lines = []
    for line in str(text).splitlines():
        tokens = re.findall(r"[^\W_]+(?:['’\-][^\W_]+)*", line, flags=re.UNICODE)
        if any(_looks_like_coherent_word(token, languages) for token in tokens):
            kept_lines.append(line.strip())
    return "\n".join(line for line in kept_lines if line).strip()


def _unsupported_script_ratio(text, languages):
    allowed = {"latin"}
    language_codes = set(str(languages).casefold().split("+"))
    if "ara" in language_codes:
        allowed.add("arabic")
    if any(code in language_codes for code in {"rus", "srp", "ukr", "bul"}):
        allowed.add("cyrillic")
    letters = [character for character in text if character.isalpha()]
    unsupported = 0
    for character in letters:
        code = ord(character)
        script = (
            "arabic" if 0x0600 <= code <= 0x06FF
            else "cyrillic" if 0x0400 <= code <= 0x052F
            else "latin" if code <= 0x024F
            else "other"
        )
        unsupported += script not in allowed
    return unsupported / max(1, len(letters))


def parse_tesseract_tsv(
    tsv_text: str,
    *,
    minimum_confidence: float,
) -> tuple[str, int, float | None]:
    """Convert Tesseract TSV into readable lines."""

    lines = str(tsv_text).splitlines()

    if len(lines) <= 1:
        return "", 0, None

    grouped_words = {}
    confidences = []

    for line in lines[1:]:
        columns = line.split("\t")

        if len(columns) < 12:
            continue

        try:
            page_number = int(columns[1])
            block_number = int(columns[2])
            paragraph_number = int(columns[3])
            line_number = int(columns[4])
            confidence = float(columns[10])
        except ValueError:
            continue

        word = fix_text(columns[11]).strip()

        if (
            not word
            or confidence < minimum_confidence
        ):
            continue

        key = (
            page_number,
            block_number,
            paragraph_number,
            line_number,
        )

        grouped_words.setdefault(key, []).append(word)
        confidences.append(confidence)

    readable_lines = [
        " ".join(words)
        for _, words in sorted(grouped_words.items())
        if words
    ]

    text = "\n".join(readable_lines)

    mean_confidence = (
        round(sum(confidences) / len(confidences), 2)
        if confidences
        else None
    )

    return text, len(confidences), mean_confidence


def clean_ocr_text(text: str) -> str:
    """Remove obvious OCR formatting noise."""

    text = fix_text(str(text or ""))
    text = text.replace("\x0c", " ")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    lines = []

    for line in text.splitlines():
        line = line.strip()

        if not line:
            continue

        alphanumeric_count = sum(
            character.isalnum()
            for character in line
        )

        if alphanumeric_count == 0:
            continue

        lines.append(line)

    return "\n".join(lines).strip()


def document_label(file_name: str) -> str:
    """Derive a readable label without assuming a naming convention."""

    stem = Path(str(file_name)).stem
    label = re.sub(r"[_\-]+", " ", stem)
    label = re.sub(r"\s+", " ", label).strip()

    return label


def _cache_configuration_matches(
    payload,
    *,
    languages,
    psm,
    minimum_confidence,
    minimum_text_length,
    minimum_mean_confidence,
    minimum_meaningful_words,
) -> bool:
    if not isinstance(payload, dict):
        return False

    expected = {
        "schema_version": OCR_SCHEMA_VERSION,
        "languages": languages,
        "psm": psm,
        "minimum_confidence": minimum_confidence,
        "minimum_text_length": minimum_text_length,
        "minimum_mean_confidence": minimum_mean_confidence,
        "minimum_meaningful_words": minimum_meaningful_words,
    }

    return all(
        payload.get(key) == value
        for key, value in expected.items()
    )


def _validate_options(
    *,
    psm,
    minimum_confidence,
    minimum_text_length,
    minimum_mean_confidence,
    minimum_meaningful_words,
    timeout_seconds,
):
    if not isinstance(psm, int) or not 0 <= psm <= 13:
        raise ValueError("psm must be an integer from 0 to 13.")

    if not 0 <= minimum_confidence <= 100:
        raise ValueError(
            "minimum_confidence must be from 0 to 100."
        )

    if minimum_text_length < 1:
        raise ValueError(
            "minimum_text_length must be positive."
        )
    if not 0 <= minimum_mean_confidence <= 100:
        raise ValueError("minimum_mean_confidence must be from 0 to 100.")
    if minimum_meaningful_words < 1:
        raise ValueError("minimum_meaningful_words must be positive.")

    if timeout_seconds <= 0:
        raise ValueError(
            "timeout_seconds must be positive."
        )


def _check_tesseract():
    executable = shutil.which("tesseract")

    if executable is None:
        raise RuntimeError(
            "Tesseract was not found on PATH. "
            "Install Tesseract or add its installation directory "
            "to the system PATH."
        )

    result = subprocess.run(
        ["tesseract", "--list-langs"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode != 0:
        raise RuntimeError(
            "Tesseract is installed but its languages "
            "could not be inspected."
        )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as file:
        for block in iter(
            lambda: file.read(1024 * 1024),
            b"",
        ):
            digest.update(block)

    return digest.hexdigest()


def _read_required_json(path: Path):
    payload = _read_json(path)

    if payload is None:
        raise FileNotFoundError(
            f"Required JSON artifact is missing or invalid: {path}"
        )

    return payload


def _read_json(path: Path):
    if not path.is_file():
        return None

    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return None


def _write_json_atomic(path: Path, payload):
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


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Run cached Tesseract OCR on extracted document images."
        )
    )

    parser.add_argument(
        "processed_root",
        nargs="?",
        type=Path,
        default=DEFAULT_PROCESSED_ROOT,
    )

    parser.add_argument(
        "--languages",
        default=DEFAULT_LANGUAGES,
        help=(
            "Installed Tesseract languages, such as "
            "eng, ara+eng, or fra+eng."
        ),
    )

    parser.add_argument(
        "--psm",
        type=int,
        default=DEFAULT_PSM,
    )

    parser.add_argument(
        "--minimum-confidence",
        type=float,
        default=DEFAULT_MIN_CONFIDENCE,
    )

    parser.add_argument(
        "--minimum-text-length",
        type=int,
        default=DEFAULT_MIN_TEXT_LENGTH,
    )
    parser.add_argument(
        "--minimum-mean-confidence",
        type=float,
        default=DEFAULT_MIN_MEAN_CONFIDENCE,
    )
    parser.add_argument(
        "--minimum-meaningful-words",
        type=int,
        default=DEFAULT_MIN_MEANINGFUL_WORDS,
    )

    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Rerun OCR instead of reusing valid cached results.",
    )

    args = parser.parse_args()

    result = process_all_image_contexts(
        args.processed_root,
        languages=args.languages,
        psm=args.psm,
        minimum_confidence=args.minimum_confidence,
        minimum_text_length=args.minimum_text_length,
        minimum_mean_confidence=args.minimum_mean_confidence,
        minimum_meaningful_words=args.minimum_meaningful_words,
        timeout_seconds=args.timeout_seconds,
        force=args.force,
    )

    print("\nImage OCR complete")
    print("Documents:", result["document_count"])
    print("Images:", result["image_count"])
    print("Images with OCR text:", result["images_with_text"])
    print("Images without OCR text:", result["images_without_text"])
    print("Cache hits:", result["cache_hits"])
    print("New OCR runs:", result["ocr_runs"])

    for document in result["documents"]:
        print(
            f"- {document['file_name']}: "
            f"{document['images_with_text']}/"
            f"{document['image_count']} with text"
        )


if __name__ == "__main__":
    main()
    
