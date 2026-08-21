from pathlib import Path
import re

import pymupdf
import subprocess
import tempfile


def extract_text_blocks(page):
    """
    Extract text blocks from one PDF page while preserving
    their basic position and reading order.
    """
    raw_blocks = page.get_text(
        "blocks",
        sort=True,
    )

    text_blocks = []

    for block in raw_blocks:
        (
            x0,
            y0,
            x1,
            y1,
            text,
            block_number,
            block_type,
        ) = block[:7]

        # Block type 0 represents text.
        if block_type != 0:
            continue

        text = text.strip()

        if not text:
            continue

        text_blocks.append({
            "block_number": int(block_number),
            "bbox": [
                float(x0),
                float(y0),
                float(x1),
                float(y1),
            ],
            "text": text,
        })

    return text_blocks

def extract_text_lines(page):
    """
    Extract individual text lines with bounding boxes.

    Line-level extraction gives finer control than blocks
    and helps remove repeated headers/navigation before
    they become merged with real document text.
    """
    page_dict = page.get_text(
        "dict",
        sort=True,
    )

    text_lines = []

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue

        for line in block.get("lines", []):
            spans = line.get("spans", [])

            text = "".join(
                span.get("text", "")
                for span in spans
            ).strip()

            if not text:
                continue

            bbox = line.get("bbox")

            text_lines.append({
                "bbox": [
                    float(value)
                    for value in bbox
                ],
                "text": text,
            })

    return text_lines

def build_text_from_lines(
    text_lines,
    boilerplate_lines=None,
):
    """
    Build readable text from individual positioned lines.

    Repeated boilerplate lines can be removed before the text
    is reconstructed, preventing navigation/header text from
    being merged into real article sentences.
    """
    if not text_lines:
        return ""

    boilerplate_lines = boilerplate_lines or set()

    kept_lines = []

    for line in text_lines:
        text = clean_extracted_text(
            line["text"]
        )

        if not text:
            continue

        if text in boilerplate_lines:
            continue

        kept_lines.append(text)

    return clean_extracted_text(
        "\n".join(kept_lines)
    )


def extract_pdf( path,
    ocr_language="ara+eng",
    compare_ocr=False,):
    """
    Extract text and text blocks from every PDF page.

    Native text extraction is used first.
    OCR can be used for comparison or as a fallback when
    native text appears unusable.
    """
    path = Path(path).resolve()

    if not path.exists():
        raise FileNotFoundError(
            f"PDF was not found: {path}"
        )

    if not path.is_file():
        raise ValueError(
            f"PDF path is not a file: {path}"
        )

    if path.suffix.lower() != ".pdf":
        raise ValueError(
            f"Expected a PDF file, received: "
            f"{path.suffix or '[no extension]'}"
        )

    pages = []

    with pymupdf.open(path) as pdf:
        if pdf.needs_pass:
            raise ValueError(
                "The PDF is password-protected"
            )

        metadata = dict(
            pdf.metadata or {}
        )

        for page_index in range(pdf.page_count):
            page = pdf.load_page(page_index)

            text = page.get_text(
                "text",
                sort=True,
            ).strip()

            native_text_usable = native_text_looks_usable(text)

            ocr_text = None

            if compare_ocr or not native_text_usable:
                ocr_text = extract_page_ocr(
                    page,
                    language=ocr_language,
                )


            text_blocks = extract_text_blocks(page)

            text_lines = extract_text_lines(page)
            

            (
                layout_text,
                layout_region_types,
                has_two_column_region,
            ) = build_layout_aware_text(
                text_blocks,
                page_width=float(page.rect.width),
                page_height=float(page.rect.height),
            )


            if not native_text_usable:
                final_text = ocr_text or ""
                extraction_method = "ocr"

            elif has_two_column_region:
                final_text = layout_text
                extraction_method = "native_layout_aware"

            else:
                final_text = text
                extraction_method = "native"

            final_text = clean_extracted_text(final_text)

            pages.append({
                "page_number": page_index + 1,
                "width": float(page.rect.width),
                "height": float(page.rect.height),
                "text": text,
                "text_blocks": text_blocks,
                "text_lines": text_lines,
                "text_length": len(text),
                "native_text_usable": native_text_usable,
                "ocr_text": ocr_text,
                "ocr_text_length": (
                    len(ocr_text)
                    if ocr_text is not None
                    else None
                ),

                "final_text": final_text,
                "final_text_length": len(final_text),
                "extraction_method": extraction_method,
                "has_two_column_region": has_two_column_region,
                "layout_region_types": layout_region_types,
                "layout_text": layout_text,
                "layout_text_length": len(layout_text),  
            })

        boilerplate_lines = find_repeated_boilerplate(
            pages
        )

        for page in pages:

            if page["extraction_method"] == "ocr":
                # Keep OCR output as the source.
                page["final_text"] = remove_boilerplate_lines(
                    page["final_text"],
                    boilerplate_lines,
                )

            elif page["extraction_method"] == "native_layout_aware":
                # Preserve the automatic layout-aware reading order.
                page["final_text"] = remove_boilerplate_lines(
                    page["layout_text"],
                    boilerplate_lines,
                )

            else:
                # Normal native pages can safely be rebuilt from
                # clean individual lines.
                page["final_text"] = build_text_from_lines(
                    page["text_lines"],
                    boilerplate_lines,
                )

            page["final_text"] = clean_extracted_text(
                page["final_text"]
            )

            page["final_text_length"] = len(
                page["final_text"]
            )

        return {
            "file_name": path.name,
            "source_path": str(path),
            "file_type": "pdf",
            "file_size_bytes": path.stat().st_size,
            "page_count": pdf.page_count,
            "metadata": metadata,
            "boilerplate_lines": sorted(boilerplate_lines),
            "pages": pages,
        }

def extract_page_ocr(
    page,
    language="ara+eng",
    dpi=300,
    psm=6,
):
    """
    OCR one PDF page using Tesseract.

    The page is rendered at high resolution and passed
    directly to Tesseract so the page segmentation mode
    can be controlled explicitly.
    """
    pix = page.get_pixmap(
        dpi=dpi,
        alpha=False,
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = (
            Path(temp_dir)
            / "ocr_page.png"
        )

        pix.save(image_path)

        result = subprocess.run(
            [
                "tesseract",
                str(image_path),
                "stdout",
                "-l",
                language,
                "--psm",
                str(psm),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode != 0:
            raise RuntimeError(
                "Tesseract OCR failed: "
                + result.stderr.strip()
            )

        return result.stdout.strip()
    

def native_text_looks_usable(text):
    """
    Check whether native PDF text extraction appears usable.
    """
    text = str(text).strip()

    if len(text) < 10:
        return False

    private_use_count = sum(
        0xE000 <= ord(char) <= 0xF8FF
        for char in text
    )

    private_use_ratio = private_use_count / len(text)

    return private_use_ratio < 0.05

def detect_layout_regions(
    text_blocks,
    page_width,
    page_height,
    full_width_ratio=0.70,
    vertical_gap_ratio=0.03,
):
    """
    Split a page automatically into vertical layout regions.

    A page may contain:
    - full-width content,
    - single-column content,
    - multi-column content.

    No document-specific rules are used.
    """
    if not text_blocks:
        return []

    midpoint = page_width / 2
    vertical_gap = page_height * vertical_gap_ratio

    blocks = sorted(
        text_blocks,
        key=lambda block: (
            block["bbox"][1],
            block["bbox"][0],
        ),
    )

    regions = []
    current_blocks = []
    current_bottom = None

    def flush_current_region():
        nonlocal current_blocks

        if current_blocks:
            regions.append({
                "type": "flow",
                "blocks": current_blocks,
            })

            current_blocks = []

    for block in blocks:
        x0, y0, x1, y1 = block["bbox"]

        block_width = x1 - x0

        is_full_width = (
            block_width >= page_width * full_width_ratio
        )

        # A genuinely wide block acts as a layout boundary
        if is_full_width:
            flush_current_region()

            regions.append({
                "type": "full_width",
                "blocks": [block],
            })

            current_bottom = y1
            continue

        # Start a new region when there is a meaningful
        # vertical gap from the previous block group
        if (
            current_blocks
            and current_bottom is not None
            and y0 - current_bottom > vertical_gap
        ):
            flush_current_region()

        current_blocks.append(block)

        if current_bottom is None:
            current_bottom = y1
        else:
            current_bottom = max(
                current_bottom,
                y1,
            )

    flush_current_region()

    return regions

def region_looks_two_column(
    blocks,
    page_width,
    min_blocks_per_column=2,
):
    """
    Detect whether one layout region contains two columns.
    """
    midpoint = page_width / 2

    left_blocks = []
    right_blocks = []
    crossing_blocks = []

    for block in blocks:
        x0, y0, x1, y1 = block["bbox"]

        block_width = x1 - x0

        # Ignore tiny fragments.
        if block_width < page_width * 0.08:
            continue

        if x0 < midpoint < x1:
            crossing_blocks.append(block)
            continue

        block_center = (
            x0 + x1
        ) / 2

        if block_center < midpoint:
            left_blocks.append(block)
        else:
            right_blocks.append(block)

    if (
        len(left_blocks) < min_blocks_per_column
        or len(right_blocks) < min_blocks_per_column
    ):
        return False

    # If most content crosses the centre,
    # this probably is not a genuine two-column region
    total = (
        len(left_blocks)
        + len(right_blocks)
        + len(crossing_blocks)
    )

    if total == 0:
        return False

    crossing_ratio = (
        len(crossing_blocks)
        / total
    )

    return crossing_ratio <= 0.25

def build_layout_aware_text(
    text_blocks,
    page_width,
    page_height,
):
    """
    Build reading-order text using automatically detected
    layout regions.

    Each region is independently treated as full-width,
    single-column, or two-column.
    """
    regions = detect_layout_regions(
        text_blocks,
        page_width=page_width,
        page_height=page_height,
    )

    ordered_text = []
    region_types = []

    midpoint = page_width / 2

    for region in regions:
        blocks = region["blocks"]

        if region["type"] == "full_width":
            region_types.append(
                "full_width"
            )

            ordered_blocks = sorted(
                blocks,
                key=lambda block: (
                    block["bbox"][1],
                    block["bbox"][0],
                ),
            )

        elif region_looks_two_column(
            blocks,
            page_width=page_width,
        ):
            region_types.append(
                "two_column"
            )

            left_blocks = []
            right_blocks = []

            for block in blocks:
                x0, y0, x1, y1 = block["bbox"]

                block_center = (
                    x0 + x1
                ) / 2

                if block_center < midpoint:
                    left_blocks.append(block)
                else:
                    right_blocks.append(block)

            left_blocks.sort(
                key=lambda block: (
                    block["bbox"][1],
                    block["bbox"][0],
                )
            )

            right_blocks.sort(
                key=lambda block: (
                    block["bbox"][1],
                    block["bbox"][0],
                )
            )

            ordered_blocks = (
                left_blocks
                + right_blocks
            )

        else:
            region_types.append(
                "single_column"
            )

            ordered_blocks = sorted(
                blocks,
                key=lambda block: (
                    block["bbox"][1],
                    block["bbox"][0],
                ),
            )

        ordered_text.extend(
            block["text"]
            for block in ordered_blocks
            if block["text"].strip()
        )

    layout_text = "\n\n".join(
        ordered_text
    )

    has_two_column_region = (
        "two_column"
        in region_types
    )

    return (
        layout_text,
        region_types,
        has_two_column_region,
    )


def clean_extracted_text(text):
    """
    Apply conservative cleanup to extracted document text.

    Removes common PDF extraction artifacts without trying
    to rewrite or correct the actual document content.
    """
    if not text:
        return ""

    text = str(text)

    # Remove Unicode replacement characters
    text = text.replace("\ufffd", "")

    # Remove common dotted TOC leader artifacts left after
    # replacement characters are removed
    text = re.sub(
        r"(?:\.\s*){4,}",
        " ",
        text,
    )

    # Normalize spaces and tabs inside each line while
    # preserving line and paragraph boundaries
    lines = []

    for line in text.splitlines():
        line = re.sub(
            r"[ \t]+",
            " ",
            line,
        ).strip()

        lines.append(line)

    text = "\n".join(lines)

    # Do not allow excessive blank lines
    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text,
    )

    return text.strip()

def find_repeated_boilerplate(
    pages,
    min_page_ratio=0.30,
    top_ratio=0.18,
    bottom_ratio=0.82,
):
    """
    Detect repeated header/footer text across document pages.

    Text is analysed line by line rather than block by block,
    because PDF extraction may group the same header differently
    across pages.
    """
    line_pages = {}

    total_pages = len(pages)

    if total_pages == 0:
        return set()

    for page in pages:
        page_height = page["height"]
        page_number = page["page_number"]

        for line in page["text_lines"]:
            x0, y0, x1, y1 = line["bbox"]

            is_top = y0 <= page_height * top_ratio
            is_bottom = y1 >= page_height * bottom_ratio

            if not (is_top or is_bottom):
                continue

            text = clean_extracted_text(
                line["text"]
            )

            if not text:
                continue
            private_use_count = sum(
                0xE000 <= ord(char) <= 0xF8FF
                for char in text
            )

            if private_use_count > 0:
                continue

            if len(text) > 120:
                continue

            if len(text) < 4:
                continue

            line_pages.setdefault(
                text,
                set(),
            ).add(page_number)

    minimum_pages = max(
        2,
        round(total_pages * min_page_ratio),
    )

    boilerplate_lines = {
        line
        for line, page_numbers
        in line_pages.items()
        if len(page_numbers) >= minimum_pages
    }

    return boilerplate_lines


def remove_boilerplate_lines(
    text,
    boilerplate_lines,
):
    """
    Remove repeated document-level boilerplate from final text.

    Handles both standalone repeated lines and repeated fragments
    that became merged into surrounding text during extraction.
    """
    if not text:
        return ""

    cleaned_lines = []

    # Longer fragments first so that a large navigation
    # string is removed before one of its smaller pieces.
    ordered_boilerplate = sorted(
        boilerplate_lines,
        key=len,
        reverse=True,
    )

    for raw_line in text.splitlines():

        line = clean_extracted_text(
            raw_line
        )

        if not line:
            cleaned_lines.append("")
            continue

        # Remove the whole line if it exactly matches
        # known boilerplate.
        if line in boilerplate_lines:
            continue

        # Sometimes PDF extraction merges navigation/header
        # text into a legitimate line. Remove only the known
        # repeated fragment in that case.
        for boilerplate in ordered_boilerplate:

            if boilerplate not in line:
                continue

            line = line.replace(
                boilerplate,
                " ",
            )

            line = clean_extracted_text(
                line
            )

        if line:
            cleaned_lines.append(line)

    text = "\n".join(
        cleaned_lines
    )

    return clean_extracted_text(
        text
    )

