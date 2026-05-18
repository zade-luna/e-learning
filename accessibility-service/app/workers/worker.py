import logging
from datetime import datetime, timezone

import redis.asyncio as aioredis
from arq.connections import RedisSettings

from app.config import settings
from app.models.schemas import JobStatus, JobType, CallbackPayload
from app.services.callback import fire_callback
from app.storage.job_store import JobStore
from app.workers.stt_pipeline import run_stt_pipeline
from app.workers.tts_pipeline import run_tts_pipeline

logger = logging.getLogger(__name__)


async def process_job(
    ctx,
    job_id: str,
    job_type: str,
    file_url: str,
    callback_url: str,
    metadata: dict | None = None,
):
    """
    Single ARQ task entry point for both STT and TTS jobs.
    ARQ calls this from the worker process.
    """
    metadata = metadata or {}
    redis_client: aioredis.Redis = ctx["redis"]
    store = JobStore(redis_client)

    job = await store.get(job_id)
    if not job:
        logger.error(f"Job {job_id} not found in Redis — was it deleted?")
        return

    output_filename: str | None = None
    error: str | None = None
    completed_at = datetime.now(timezone.utc)

    try:
        job_type_enum = JobType(job_type)

        if job_type_enum == JobType.STT:
            output_path = await run_stt_pipeline(job_id, file_url, store)
        elif job_type_enum == JobType.TTS:
            output_path = await run_tts_pipeline(job_id, file_url, store)
        else:
            raise ValueError(f"Unknown job type: {job_type}")

        output_filename = output_path.name
        completed_at = datetime.now(timezone.utc)

        await store.update_status(
            job_id,
            status=JobStatus.COMPLETED,
            progress="Done",
            output_filename=output_filename,
            completed_at=completed_at,
        )
        logger.info(f"[{job_id}] COMPLETED → {output_filename}")

    except Exception as e:
        error = str(e)
        completed_at = datetime.now(timezone.utc)
        logger.exception(f"[{job_id}] FAILED: {e}")

        await store.update_status(
            job_id,
            status=JobStatus.FAILED,
            error=error,
            completed_at=completed_at,
        )

    # Always fire callback — Next.js needs to know either way
    await fire_callback(
        CallbackPayload(
            job_id=job_id,
            job_type=JobType(job_type),
            status=JobStatus.COMPLETED if not error else JobStatus.FAILED,
            callback_url=callback_url,
            output_filename=output_filename,
            error=error,
            completed_at=completed_at,
            metadata=metadata,
        )
    )


async def startup(ctx):
    ctx["redis"] = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
    )
    logger.info("Worker process started")


async def shutdown(ctx):
    await ctx["redis"].aclose()
    logger.info("Worker process stopped")


class WorkerSettings:
    functions = [process_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 2          # Limit concurrent jobs — prevent OOM on CPU
    job_timeout = 3600    # 1 hour hard limit per job
    keep_result = 0       # Job state lives in our Redis keys, not ARQ's
