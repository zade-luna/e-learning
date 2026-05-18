from pydantic import BaseModel
from enum import Enum
from datetime import datetime
from typing import Optional, Any


class JobType(str, Enum):
    STT = "stt"
    TTS = "tts"


class JobStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobSubmitRequest(BaseModel):
    file_url: str
    job_type: JobType
    callback_url: str
    # Next.js can pass extra context (e.g. course_id, material_id) for the callback
    metadata: dict[str, Any] = {}


class JobSubmitResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str


class JobState(BaseModel):
    job_id: str
    job_type: JobType
    file_url: str
    callback_url: str
    status: JobStatus = JobStatus.QUEUED
    progress: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    output_filename: Optional[str] = None
    error: Optional[str] = None
    metadata: dict[str, Any] = {}


class JobStatusResponse(BaseModel):
    job_id: str
    job_type: JobType
    status: JobStatus
    progress: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    output_filename: Optional[str] = None
    error: Optional[str] = None
    metadata: dict[str, Any] = {}


class SyncResponse(BaseModel):
    completed_jobs: list[JobStatusResponse]
    failed_jobs: list[JobStatusResponse]
    synced_at: datetime


class CallbackPayload(BaseModel):
    """What the microservice POSTs to Next.js when a job finishes."""
    job_id: str
    job_type: JobType
    status: JobStatus
    callback_url: str
    output_filename: Optional[str] = None
    error: Optional[str] = None
    completed_at: datetime
    metadata: dict[str, Any] = {}
