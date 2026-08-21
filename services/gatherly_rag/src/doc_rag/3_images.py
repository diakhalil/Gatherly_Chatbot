from pathlib import Path
from io import BytesIO

import pymupdf
from PIL import Image


def extract_document_images(path, include_bytes=True):
    """
    Extract every unique embedded raster image from a PDF.

    Repeated placements are deduplicated by image digest while retaining all
    page numbers and bounding boxes. This means one complete embedded image
    reused across a page boundary is returned once with both page placements.
    """
    path = Path(path).resolve()

    if not path.is_file():
        raise FileNotFoundError(f"PDF was not found: {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"Expected a PDF file, received: {path}")

    images_by_digest = {}
    unextractable_placements = []

    with pymupdf.open(path) as pdf:
        for page_index, page in enumerate(pdf, start=1):
            page_rect = page.rect

            for image_index, image in enumerate(
                page.get_image_info(xrefs=True),
                start=1,
            ):
                xref = int(image.get("xref", 0))
                digest_value = image.get("digest")
                digest = (
                    digest_value.hex()
                    if isinstance(digest_value, bytes)
                    else str(digest_value or f"xref-{xref}")
                )
                bbox = pymupdf.Rect(image["bbox"])
                placement = {
                    "page_number": page_index,
                    "image_index": image_index,
                    "bbox": [float(value) for value in bbox],
                    "visible_fraction": _visible_fraction(bbox, page_rect),
                    "touches_top": bbox.y0 <= page_rect.y0 + 1,
                    "touches_bottom": bbox.y1 >= page_rect.y1 - 1,
                    "fully_inside_page": page_rect.contains(bbox),
                }

                if xref <= 0:
                    unextractable_placements.append({
                        "digest": digest,
                        "xref": xref,
                        **placement,
                    })
                    continue

                if digest not in images_by_digest:
                    extracted = pdf.extract_image(xref)
                    if not extracted:
                        unextractable_placements.append({
                            "digest": digest,
                            "xref": xref,
                            **placement,
                        })
                        continue

                    record = {
                        "image_id": f"{path.stem}-{digest[:16]}",
                        "file_name": path.name,
                        "source_path": str(path),
                        "digest": digest,
                        "xref": xref,
                        "extension": extracted["ext"],
                        "width": int(extracted["width"]),
                        "height": int(extracted["height"]),
                        "colorspace": extracted["colorspace"],
                        "placements": [],
                    }
                    record["image_bytes"] = extracted["image"]
                    images_by_digest[digest] = record

                images_by_digest[digest]["placements"].append(placement)

    images = _deduplicate_visual_images(list(images_by_digest.values()))
    for image in images:
        image["pages"] = sorted({
            placement["page_number"]
            for placement in image["placements"]
        })
        image["is_split_across_pages"] = _is_split_across_pages(
            image["placements"]
        )
        if not include_bytes:
            image.pop("image_bytes", None)

    return {
        "file_name": path.name,
        "source_path": str(path),
        "images": images,
        "unique_image_count": len(images),
        "unextractable_placements": unextractable_placements,
        "unextractable_placement_count": len(unextractable_placements),
    }


def _deduplicate_visual_images(images, max_hash_distance=6):
    """Merge strict near-duplicates and keep the highest-resolution copy."""
    unique = []

    for image in images:
        image["visual_hash"] = _difference_hash(image["image_bytes"])
        image["source_xrefs"] = [image["xref"]]
        image["source_digests"] = [image["digest"]]
        match_index = next(
            (
                index
                for index, existing in enumerate(unique)
                if _images_visually_match(
                    existing,
                    image,
                    max_hash_distance=max_hash_distance,
                )
            ),
            None,
        )

        if match_index is None:
            unique.append(image)
            continue

        existing = unique[match_index]
        combined_placements = existing["placements"] + image["placements"]
        combined_xrefs = sorted(set(existing["source_xrefs"] + [image["xref"]]))
        combined_digests = sorted(
            set(existing["source_digests"] + [image["digest"]])
        )

        if image["width"] * image["height"] > existing["width"] * existing["height"]:
            image["placements"] = combined_placements
            image["source_xrefs"] = combined_xrefs
            image["source_digests"] = combined_digests
            unique[match_index] = image
        else:
            existing["placements"] = combined_placements
            existing["source_xrefs"] = combined_xrefs
            existing["source_digests"] = combined_digests

    return unique


def _difference_hash(image_bytes, hash_size=16):
    with Image.open(BytesIO(image_bytes)) as image:
        grayscale = image.convert("L").resize(
            (hash_size + 1, hash_size),
            Image.Resampling.LANCZOS,
        )
        pixels = list(grayscale.getdata())

    bits = []
    row_width = hash_size + 1
    for row in range(hash_size):
        offset = row * row_width
        bits.extend(
            pixels[offset + column + 1] > pixels[offset + column]
            for column in range(hash_size)
        )
    value = sum(int(bit) << index for index, bit in enumerate(bits))
    return f"{value:0{hash_size * hash_size // 4}x}"


def _images_visually_match(first, second, max_hash_distance):
    first_ratio = first["width"] / max(first["height"], 1)
    second_ratio = second["width"] / max(second["height"], 1)
    if abs(first_ratio - second_ratio) > 0.01:
        return False

    first_hash = int(first["visual_hash"], 16)
    second_hash = int(second["visual_hash"], 16)
    return (first_hash ^ second_hash).bit_count() <= max_hash_distance


def _visible_fraction(bbox, page_rect):
    visible = bbox & page_rect
    area = max(bbox.width * bbox.height, 0)
    visible_area = max(visible.width * visible.height, 0)
    return round(visible_area / area, 6) if area else 0.0


def _is_split_across_pages(placements):
    if len({item["page_number"] for item in placements}) < 2:
        return False

    bottom_pages = {
        item["page_number"]
        for item in placements
        if item["touches_bottom"]
    }
    top_pages = {
        item["page_number"]
        for item in placements
        if item["touches_top"]
    }
    return any(page + 1 in top_pages for page in bottom_pages)


def validate_page_number(pdf, page_number):
    """
    Validate a human-facing page number starting at 1.
    """
    if not isinstance(page_number, int):
        raise TypeError(
            "page_number must be an integer"
        )

    if page_number < 1 or page_number > pdf.page_count:
        raise ValueError(
            f"Invalid page number: {page_number}. "
            f"The PDF contains {pdf.page_count} pages."
        )


def render_pdf_page(
    path,
    page_number,
    zoom=1.5,
):
    """
    Render one PDF page as PNG bytes for visual inspection.
    """
    path = Path(path).resolve()

    if zoom <= 0:
        raise ValueError(
            "zoom must be greater than zero"
        )

    with pymupdf.open(path) as pdf:
        validate_page_number(
            pdf,
            page_number,
        )

        page = pdf.load_page(
            page_number - 1
        )

        matrix = pymupdf.Matrix(
            zoom,
            zoom,
        )

        pixmap = page.get_pixmap(
            matrix=matrix,
            alpha=False,
        )

        return {
            "page_number": page_number,
            "width": pixmap.width,
            "height": pixmap.height,
            "png_bytes": pixmap.tobytes("png"),
        }


def inspect_page_images(
    path,
    page_number,
):
    """
    Return metadata for raster images displayed on one PDF page.

    This does not save or embed the images.
    """
    path = Path(path).resolve()

    with pymupdf.open(path) as pdf:
        validate_page_number(
            pdf,
            page_number,
        )

        page = pdf.load_page(
            page_number - 1
        )

        raw_images = page.get_image_info(
            xrefs=True,
        )

        images = []

        for image_index, image in enumerate(
            raw_images,
            start=1,
        ):
            bbox = image.get("bbox")

            images.append({
                "image_index": image_index,
                "xref": int(
                    image.get("xref", 0)
                ),
                "bbox": (
                    [float(value) for value in bbox]
                    if bbox is not None
                    else None
                ),
                "width": int(
                    image.get("width", 0)
                ),
                "height": int(
                    image.get("height", 0)
                ),
                "colorspace": image.get(
                    "cs-name"
                ),
                "bits_per_component": image.get(
                    "bpc"
                ),
                "has_mask": bool(
                    image.get("has-mask", False)
                ),
            })

        return images


def extract_embedded_image(
    path,
    xref,
):
    """
    Extract one embedded raster image using its PDF xref.

    An xref of zero represents an image that cannot be extracted
    independently with this method.
    """
    path = Path(path).resolve()

    if not isinstance(xref, int):
        raise TypeError(
            "xref must be an integer"
        )

    if xref <= 0:
        raise ValueError(
            "xref must be greater than zero"
        )

    with pymupdf.open(path) as pdf:
        extracted = pdf.extract_image(
            xref
        )

        if not extracted:
            raise ValueError(
                f"Could not extract image xref {xref}"
            )

        return {
            "xref": xref,
            "extension": extracted["ext"],
            "width": extracted["width"],
            "height": extracted["height"],
            "colorspace": extracted["colorspace"],
            "image_bytes": extracted["image"],
        }
    
