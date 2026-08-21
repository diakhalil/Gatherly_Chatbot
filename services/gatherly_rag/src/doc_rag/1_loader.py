from pathlib import Path


SUPPORTED_DOCUMENT_TYPES = {
    ".pdf": "pdf",
}


def detect_document_type(path):
    """
    Validate a document path and identify its format.
    """
    path = Path(path).resolve()

    if not path.exists():
        raise FileNotFoundError(
            f"Document was not found: {path}"
        )

    if not path.is_file():
        raise ValueError(
            f"Document path is not a file: {path}"
        )

    suffix = path.suffix.lower()

    if suffix not in SUPPORTED_DOCUMENT_TYPES:
        supported = ", ".join(
            sorted(SUPPORTED_DOCUMENT_TYPES)
        )

        raise ValueError(
            f"Unsupported document type: "
            f"{suffix or '[no extension]'}. "
            f"Currently supported: {supported}"
        )

    return SUPPORTED_DOCUMENT_TYPES[suffix]


def load_document(path):
    """
    Validate a document and return its basic source information.

    Format-specific content extraction will be added after the
    loader is tested.
    """
    path = Path(path).resolve()
    document_type = detect_document_type(path)

    return {
        "file_name": path.name,
        "source_path": str(path),
        "file_type": document_type,
        "file_size_bytes": path.stat().st_size,
    }
