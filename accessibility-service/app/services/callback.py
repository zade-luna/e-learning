import asyncio
import logging
import httpx

from app.config import settings
from app.models.schemas import CallbackPayload

logger = logging.getLogger(__name__)


async def fire_callback(payload: CallbackPayload) -> bool:
    """
    POST job completion payload to Next.js callback URL.
    Retries with exponential backoff.
    Returns True if at least one attempt succeeded, False if all failed.
    Failures are logged but never raise — a missed callback is recovered
    by the Next.js sync endpoint on its next startup.
    """
    data = payload.model_dump(mode="json")

    for attempt in range(1, settings.callback_retry_attempts + 1):
        try:
            async with httpx.AsyncClient(
                timeout=settings.callback_timeout_seconds
            ) as client:
                response = await client.post(payload.callback_url, json=data)
                response.raise_for_status()
                logger.info(
                    f"Callback delivered for job {payload.job_id} "
                    f"(attempt {attempt})"
                )
                return True

        except httpx.HTTPError as e:
            logger.warning(
                f"Callback attempt {attempt}/{settings.callback_retry_attempts} "
                f"failed for job {payload.job_id}: {e}"
            )
            if attempt < settings.callback_retry_attempts:
                await asyncio.sleep(2 ** attempt)  # 2s, 4s, 8s …

    logger.error(
        f"All callback attempts failed for job {payload.job_id}. "
        "Next.js will reconcile on next sync."
    )
    return False
