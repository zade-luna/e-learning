import uuid
import logging
from pathlib import Path
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def download_file(url: str, suffix: str) -> Path:
    """
    Download a file from a URL into the temp directory.
    Streams the download to avoid loading large files into memory.
    Returns the local path.
    """
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.temp_dir / f"{uuid.uuid4()}{suffix}"

    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with open(dest, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    f.write(chunk)

    logger.info(f"Downloaded {url} → {dest} ({dest.stat().st_size / 1024:.1f} KB)")
    return dest


def get_output_path(job_id: str, extension: str) -> Path:
    """Return the standard output path for a job's result file."""
    settings.outputs_dir.mkdir(parents=True, exist_ok=True)
    return settings.outputs_dir / f"{job_id}{extension}"


def cleanup_file(path: Optional[Path]) -> None:
    """Best-effort deletion of a temp file. Never raises."""
    if path is None:
        return
    try:
        if path.exists():
            path.unlink()
            logger.debug(f"Cleaned up temp file: {path}")
    except Exception as e:
        logger.warning(f"Failed to clean up {path}: {e}")
