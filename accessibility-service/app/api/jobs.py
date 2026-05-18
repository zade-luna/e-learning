import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import FileResponse
import redis.asyncio as aioredis
from arq import create_pool
from arq.connections import RedisSettings

from app.config import settings
from app.models.schemas import (
    JobSubmitRequest, JobSubmitResponse, JobStatusResponse,
    JobState, JobStatus, SyncResponse,
)
from app.storage.job_store import JobStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])


async def get_redis() -> aioredis.Redis:
    client = aioredis.from_url(
        settings.redis_url, encoding="utf-8", decode_responses=True
    )
    try:
        yield client
    finally:
        await client.aclose()


# ──────────────────────────────────────────────
# Submit job
# ──────────────────────────────────────────────

@router.post("", response_model=JobSubmitResponse, status_code=202)
async def submit_job(
    request: JobSubmitRequest,
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """
    Accept a new STT or TTS job.
    Returns job_id immediately — processing happens in the background worker.
    """
    job_id = str(uuid.uuid4())
    store = JobStore(redis_client)

    job = JobState(
        job_id=job_id,
        job_type=request.job_type,
        file_url=request.file_url,
        callback_url=request.callback_url,
        status=JobStatus.QUEUED,
        created_at=datetime.now(timezone.utc),
        metadata=request.metadata,
    )
    await store.save(job)

    # Enqueue to ARQ (opens a separate short-lived pool — avoids sharing state)
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await arq_pool.enqueue_job(
        "process_job",
        job_id=job_id,
        job_type=request.job_type,
        file_url=request.file_url,
        callback_url=request.callback_url,
        metadata=request.metadata,
    )
    await arq_pool.aclose()

    logger.info(f"Job {job_id} queued ({request.job_type})")
    return JobSubmitResponse(
        job_id=job_id,
        status=JobStatus.QUEUED,
        message="Job queued successfully",
    )


# ──────────────────────────────────────────────
# Sync endpoint (called by Next.js on startup)
# ──────────────────────────────────────────────

@router.get("/sync", response_model=SyncResponse)
async def sync_jobs(
    since: datetime = Query(..., description="ISO 8601 timestamp — return all terminal jobs after this point"),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """
    Returns every job that reached COMPLETED or FAILED after `since`.
    Next.js calls this on startup to reconcile anything missed while it was down.

    Example: GET /jobs/sync?since=2024-01-15T10:00:00Z
    """
    store = JobStore(redis_client)
    all_jobs = await store.get_completed_since(since)

    return SyncResponse(
        completed_jobs=[
            JobStatusResponse(**j.model_dump())
            for j in all_jobs if j.status == JobStatus.COMPLETED
        ],
        failed_jobs=[
            JobStatusResponse(**j.model_dump())
            for j in all_jobs if j.status == JobStatus.FAILED
        ],
        synced_at=datetime.now(timezone.utc),
    )


# ──────────────────────────────────────────────
# Job status
# ──────────────────────────────────────────────

@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    redis_client: aioredis.Redis = Depends(get_redis),
):
    store = JobStore(redis_client)
    job = await store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return JobStatusResponse(**job.model_dump())


# ──────────────────────────────────────────────
# Download output
# ──────────────────────────────────────────────

@router.get("/{job_id}/download")
async def download_output(
    job_id: str,
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """
    Stream the output file (VTT or MP3) back to Next.js.
    Only available when job status is COMPLETED.
    """
    store = JobStore(redis_client)
    job = await store.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not completed (current status: {job.status}). "
                   "Poll GET /jobs/{job_id} until status is 'completed'.",
        )

    output_path = settings.outputs_dir / job.output_filename
    if not output_path.exists():
        raise HTTPException(
            status_code=410,
            detail="Output file no longer exists. It may have been cleaned up after a previous download.",
        )

    media_type = (
        "text/vtt" if job.output_filename.endswith(".vtt") else "audio/mpeg"
    )
    return FileResponse(
        path=str(output_path),
        media_type=media_type,
        filename=job.output_filename,
    )


# ──────────────────────────────────────────────
# Confirm receipt + cleanup
# ──────────────────────────────────────────────

@router.delete("/{job_id}/confirm")
async def confirm_receipt(
    job_id: str,
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """
    Next.js calls this AFTER successfully saving the output file.
    Tells the microservice it is safe to delete the output from its disk.
    This is the clean handoff — microservice keeps nothing after confirmation.
    """
    store = JobStore(redis_client)
    job = await store.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Cannot confirm a job that is not completed.",
        )

    if job.output_filename:
        output_path = settings.outputs_dir / job.output_filename
        if output_path.exists():
            output_path.unlink()
            logger.info(f"[{job_id}] Output file deleted after confirmed receipt")

    return {"message": f"Output for job {job_id} deleted. Thank you."}
