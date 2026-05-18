import logging
from datetime import datetime
from typing import Optional
import redis.asyncio as aioredis

from app.config import settings
from app.models.schemas import JobState, JobStatus

logger = logging.getLogger(__name__)


class JobStore:
    """
    Thin wrapper around Redis for job state persistence.
    Uses a sorted set for the completed index so sync queries are O(log N).
    """

    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        self.ttl = settings.job_ttl_seconds

    def _key(self, job_id: str) -> str:
        return f"job:{job_id}"

    # Sorted set key — score = completion timestamp (unix)
    COMPLETED_INDEX = "jobs:completed_index"

    async def save(self, job: JobState) -> None:
        await self.redis.setex(
            self._key(job.job_id),
            self.ttl,
            job.model_dump_json()
        )

    async def get(self, job_id: str) -> Optional[JobState]:
        data = await self.redis.get(self._key(job_id))
        if not data:
            return None
        return JobState.model_validate_json(data)

    async def update_status(
        self,
        job_id: str,
        status: JobStatus,
        progress: Optional[str] = None,
        output_filename: Optional[str] = None,
        error: Optional[str] = None,
        completed_at: Optional[datetime] = None,
    ) -> Optional[JobState]:
        job = await self.get(job_id)
        if not job:
            logger.warning(f"Tried to update non-existent job: {job_id}")
            return None

        job.status = status
        if progress is not None:
            job.progress = progress
        if output_filename is not None:
            job.output_filename = output_filename
        if error is not None:
            job.error = error
        if completed_at is not None:
            job.completed_at = completed_at

        await self.save(job)

        # Add terminal states to the sorted set for sync queries
        if status in (JobStatus.COMPLETED, JobStatus.FAILED) and completed_at:
            await self.redis.zadd(
                self.COMPLETED_INDEX,
                {job_id: completed_at.timestamp()}
            )

        return job

    async def get_completed_since(self, since: datetime) -> list[JobState]:
        """
        Returns all completed/failed jobs since a given timestamp.
        Used by the /jobs/sync endpoint so Next.js can reconcile on startup.
        """
        job_ids = await self.redis.zrangebyscore(
            self.COMPLETED_INDEX,
            min=since.timestamp(),
            max="+inf"
        )

        jobs = []
        for job_id in job_ids:
            # Redis may return bytes or str depending on decode_responses setting
            if isinstance(job_id, bytes):
                job_id = job_id.decode()
            job = await self.get(job_id)
            if job:
                jobs.append(job)

        return jobs
