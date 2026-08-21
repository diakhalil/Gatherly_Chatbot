from __future__ import annotations

import logging
import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOG_DIR = REPO_ROOT / "logs"
DEFAULT_LOG_FILE = DEFAULT_LOG_DIR / "gatherly.log"


_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(filename)s:%(lineno)d | %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"


def setup_logging(
    name: str,
    *,
    log_file: Path | None = None,
    level: int = logging.INFO,
    also_console: bool = False,
) -> logging.Logger:
    """Configure once per process; safe to call from api startup or CLI main."""
    log_file = log_file or Path(
        os.getenv("GATHERLY_LOG_FILE", str(DEFAULT_LOG_FILE))
    )
    log_file.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(level)
    formatter = logging.Formatter(_FORMAT, datefmt=_DATEFMT)

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    if also_console:
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        logger.addHandler(stream)

    logger.propagate = False
    return logger
