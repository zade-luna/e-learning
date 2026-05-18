# AI Accessibility Microservice — Complete Implementation

## Project Structure

```
microservice/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── jobs.py
│   │   └── health.py
│   ├── workers/
│   │   ├── __init__.py
│   │   ├── worker.py
│   │   ├── stt_pipeline.py
│   │   └── tts_pipeline.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── file_service.py
│   │   ├── text_extractor.py
│   │   └── callback.py
│   └── storage/
│       ├── __init__.py
│       └── job_store.py
├── scripts/
│   └── download_models.py
├── Dockerfile
├── Dockerfile.gpu
├── docker-compose.yml
├── docker-compose.gpu.yml
├── requirements.txt
├── requirements.gpu.txt
└── .env.example
```

---

## File: `requirements.txt`

```txt
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
arq>=0.25.0
redis>=5.0.0
faster-whisper>=1.0.0
piper-tts>=1.2.0
onnxruntime>=1.18.0
PyMuPDF>=1.24.0
python-pptx>=0.6.23
pysbd>=0.3.4
pydub>=0.25.1
httpx>=0.27.0
pydantic-settings>=2.3.0
```

---

## File: `requirements.gpu.txt`

```txt
# Same as requirements.txt but with GPU-enabled onnxruntime
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
arq>=0.25.0
redis>=5.0.0
faster-whisper>=1.0.0
piper-tts>=1.2.0
onnxruntime-gpu>=1.18.0
PyMuPDF>=1.24.0
python-pptx>=0.6.23
pysbd>=0.3.4
pydub>=0.25.1
httpx>=0.27.0
pydantic-settings>=2.3.0
```

---

## File: `.env.example`

```env
# Copy to .env and adjust

# Set to true ONLY if you have an NVIDIA GPU + nvidia-docker installed
USE_GPU=false

# Redis — do not change unless running Redis separately
REDIS_URL=redis://redis:6379

# Whisper model size
# CPU-safe choices: tiny, base, small
# GPU choices: medium, large-v3
# Recommendation: base for CPU, small for GPU
WHISPER_MODEL_SIZE=base

# Piper TTS voice
# Options: en_US-amy-medium, en_US-lessac-medium, en_US-ryan-medium
# Run scripts/download_models.py after changing this
PIPER_VOICE_NAME=en_US-amy-medium

# How long (seconds) to keep output files before they can be cleaned up
# Default: 7 days
JOB_TTL_SECONDS=604800
```

---

## File: `app/__init__.py`

```python
# empty
```

---

## File: `app/config.py`

```python
from pydantic_settings import BaseSettings
from pathlib import Path
from functools import lru_cache


class Settings(BaseSettings):
    # Hardware
    use_gpu: bool = False

    # Redis
    redis_url: str = "redis://redis:6379"

    # Paths (all mounted as Docker volumes)
    models_dir: Path = Path("/app/models")
    outputs_dir: Path = Path("/app/outputs")
    temp_dir: Path = Path("/app/temp")

    # Whisper
    whisper_model_size: str = "base"

    # Piper TTS
    piper_voice_name: str = "en_US-amy-medium"

    # Job lifecycle
    job_ttl_seconds: int = 604800  # 7 days

    # Callback behaviour
    callback_timeout_seconds: int = 10
    callback_retry_attempts: int = 3

    model_config = {"env_file": ".env"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

---

## File: `app/models/__init__.py`

```python
# empty
```

---

## File: `app/models/schemas.py`

```python
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
    output_filename: Optional[str] = None
    error: Optional[str] = None
    completed_at: datetime
    metadata: dict[str, Any] = {}
```

---

## File: `app/storage/__init__.py`

```python
# empty
```

---

## File: `app/storage/job_store.py`

```python
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
```

---

## File: `app/services/__init__.py`

```python
# empty
```

---

## File: `app/services/file_service.py`

```python
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
```

---

## File: `app/services/text_extractor.py`

```python
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import fitz  # PyMuPDF
from pptx import Presentation
from pptx.enum.shapes import PP_PLACEHOLDER

logger = logging.getLogger(__name__)

# If a PDF page has fewer than this many characters it is treated as scanned
SCANNED_PAGE_THRESHOLD = 50
# If more than this fraction of pages are scanned, reject the whole file
SCANNED_RATIO_THRESHOLD = 0.5


@dataclass
class SlideContent:
    slide_number: int
    title: Optional[str]
    body: str


@dataclass
class ExtractionResult:
    slides: list[SlideContent] = field(default_factory=list)
    is_scanned: bool = False
    error: Optional[str] = None

    @property
    def has_content(self) -> bool:
        return any(s.body.strip() or (s.title and s.title.strip()) for s in self.slides)


# ──────────────────────────────────────────────
# PDF
# ──────────────────────────────────────────────

def extract_from_pdf(path: Path) -> ExtractionResult:
    doc = fitz.open(str(path))
    slides: list[SlideContent] = []
    scanned_count = 0

    for page_num, page in enumerate(doc, 1):
        text = page.get_text("text").strip()

        if len(text) < SCANNED_PAGE_THRESHOLD:
            scanned_count += 1
            slides.append(SlideContent(
                slide_number=page_num,
                title=f"Page {page_num}",
                body=""
            ))
            continue

        lines = [l.strip() for l in text.split("\n") if l.strip()]
        title = lines[0] if lines else f"Page {page_num}"
        body = " ".join(lines[1:]) if len(lines) > 1 else text

        slides.append(SlideContent(
            slide_number=page_num,
            title=title,
            body=body
        ))

    doc.close()

    total = len(slides)
    if total > 0 and (scanned_count / total) > SCANNED_RATIO_THRESHOLD:
        return ExtractionResult(
            slides=slides,
            is_scanned=True,
            error=(
                f"This PDF appears to be a scanned document "
                f"({scanned_count}/{total} pages have no text layer). "
                "OCR support is not yet available."
            )
        )

    return ExtractionResult(slides=slides)


# ──────────────────────────────────────────────
# PPTX
# ──────────────────────────────────────────────

_TITLE_PLACEHOLDER_TYPES = {
    PP_PLACEHOLDER.TITLE,
    PP_PLACEHOLDER.CENTER_TITLE,
}


def extract_from_pptx(path: Path) -> ExtractionResult:
    prs = Presentation(str(path))
    slides: list[SlideContent] = []

    for slide_num, slide in enumerate(prs.slides, 1):
        title_text: Optional[str] = None
        body_parts: list[str] = []

        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue

            # Identify title placeholder
            try:
                if (
                    shape.placeholder_format is not None
                    and shape.placeholder_format.type in _TITLE_PLACEHOLDER_TYPES
                ):
                    title_text = shape.text_frame.text.strip() or None
                    continue
            except Exception:
                pass

            # Everything else is body content
            for para in shape.text_frame.paragraphs:
                text = para.text.strip()
                if text:
                    body_parts.append(text)

        # Skip completely empty slides (e.g. divider slides with only an image)
        if not title_text and not body_parts:
            continue

        slides.append(SlideContent(
            slide_number=slide_num,
            title=title_text or f"Slide {slide_num}",
            body=" ".join(body_parts)
        ))

    return ExtractionResult(slides=slides)


# ──────────────────────────────────────────────
# Router
# ──────────────────────────────────────────────

def extract_text(path: Path) -> ExtractionResult:
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return extract_from_pdf(path)
    elif suffix == ".pptx":
        return extract_from_pptx(path)
    elif suffix == ".ppt":
        # python-pptx does NOT support old binary .ppt — only .pptx (Office Open XML)
        return ExtractionResult(
            error=(
                "Old-format .ppt files are not supported. "
                "Please ask the teacher to re-save as .pptx in PowerPoint: "
                "File -> Save As -> PowerPoint Presentation (.pptx)."
            )
        )
    else:
        return ExtractionResult(
            error=f"Unsupported file type: '{suffix}'. Only .pdf and .pptx are supported."
        )
```

---

## File: `app/services/callback.py`

```python
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
```

---

## File: `app/workers/__init__.py`

```python
# empty
```

---

## File: `app/workers/stt_pipeline.py`

```python
import subprocess
import uuid
import logging
from pathlib import Path
from faster_whisper import WhisperModel

from app.config import settings
from app.services.file_service import download_file, get_output_path, cleanup_file
from app.storage.job_store import JobStore
from app.models.schemas import JobStatus

logger = logging.getLogger(__name__)

# Module-level singleton — loaded once per worker process
_whisper_model: WhisperModel | None = None


def get_whisper_model() -> WhisperModel:
    global _whisper_model
    if _whisper_model is None:
        device = "cuda" if settings.use_gpu else "cpu"
        compute_type = "float16" if settings.use_gpu else "int8"

        whisper_cache = settings.models_dir / "whisper"
        whisper_cache.mkdir(parents=True, exist_ok=True)

        logger.info(
            f"Loading Whisper '{settings.whisper_model_size}' "
            f"on {device} ({compute_type})"
        )
        _whisper_model = WhisperModel(
            settings.whisper_model_size,
            device=device,
            compute_type=compute_type,
            download_root=str(whisper_cache),
        )
    return _whisper_model


def extract_audio_ffmpeg(video_path: Path) -> Path:
    """
    Use FFmpeg to extract a 16 kHz mono WAV from the video.
    This is exactly what Whisper expects — passing it directly avoids
    any re-sampling overhead inside faster-whisper.
    """
    audio_path = video_path.parent / f"{uuid.uuid4()}.wav"

    cmd = [
        "ffmpeg", "-i", str(video_path),
        "-vn",                   # Drop video stream
        "-acodec", "pcm_s16le",  # 16-bit PCM
        "-ar", "16000",          # 16 kHz sample rate
        "-ac", "1",              # Mono
        "-y",                    # Overwrite without prompting
        str(audio_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed:\n{result.stderr}")

    return audio_path


def _format_vtt_timestamp(seconds: float) -> str:
    """Seconds → HH:MM:SS.mmm  (VTT format)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def segments_to_vtt(segments: list) -> str:
    lines = ["WEBVTT", ""]
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        start = _format_vtt_timestamp(segment.start)
        end = _format_vtt_timestamp(segment.end)
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


async def run_stt_pipeline(job_id: str, file_url: str, store: JobStore) -> Path:
    """
    Full STT pipeline.
    Downloads the video, extracts audio, transcribes, formats VTT.
    Cleans up temp files before returning.
    Returns path to the output .vtt file.
    """
    video_path: Path | None = None
    audio_path: Path | None = None

    try:
        # 1. Download
        await store.update_status(job_id, JobStatus.DOWNLOADING, progress="Downloading video")
        logger.info(f"[{job_id}] Downloading from {file_url}")
        video_path = await download_file(file_url, ".mp4")

        # 2. Extract audio — then discard the video immediately
        await store.update_status(job_id, JobStatus.PROCESSING, progress="Extracting audio")
        logger.info(f"[{job_id}] Extracting audio with FFmpeg")
        audio_path = extract_audio_ffmpeg(video_path)
        cleanup_file(video_path)
        video_path = None

        # 3. Transcribe
        await store.update_status(job_id, JobStatus.PROCESSING, progress="Transcribing")
        logger.info(f"[{job_id}] Running Whisper")
        model = get_whisper_model()
        segments, info = model.transcribe(
            str(audio_path),
            beam_size=5,
            language=None,          # Auto-detect language
            vad_filter=True,        # Skip silent sections
            vad_parameters={"min_silence_duration_ms": 500},
        )
        # faster-whisper returns a generator — materialise it
        segments = list(segments)
        logger.info(
            f"[{job_id}] Transcribed {len(segments)} segments. "
            f"Language: {info.language} ({info.language_probability:.0%})"
        )

        # 4. Format + save
        await store.update_status(job_id, JobStatus.PROCESSING, progress="Formatting subtitle file")
        vtt_content = segments_to_vtt(segments)
        output_path = get_output_path(job_id, ".vtt")
        output_path.write_text(vtt_content, encoding="utf-8")
        logger.info(f"[{job_id}] VTT written → {output_path}")

        return output_path

    finally:
        cleanup_file(video_path)
        cleanup_file(audio_path)
```

---

## File: `app/workers/tts_pipeline.py`

```python
import io
import wave
import logging
from pathlib import Path

from piper import PiperVoice
from pydub import AudioSegment
import pysbd

from app.config import settings
from app.services.file_service import download_file, get_output_path, cleanup_file
from app.services.text_extractor import extract_text
from app.storage.job_store import JobStore
from app.models.schemas import JobStatus

logger = logging.getLogger(__name__)

# Module-level singleton
_piper_voice: PiperVoice | None = None

# Milliseconds of silence inserted between slides
INTER_SLIDE_SILENCE_MS = 900


def get_piper_voice() -> PiperVoice:
    global _piper_voice
    if _piper_voice is None:
        voice_name = settings.piper_voice_name
        piper_dir = settings.models_dir / "piper"
        model_path = piper_dir / f"{voice_name}.onnx"
        config_path = piper_dir / f"{voice_name}.onnx.json"

        if not model_path.exists() or not config_path.exists():
            raise RuntimeError(
                f"Piper model not found at {model_path}.\n"
                "Run:  python scripts/download_models.py"
            )

        logger.info(f"Loading Piper voice '{voice_name}'")
        _piper_voice = PiperVoice.load(
            str(model_path),
            config_path=str(config_path),
            use_cuda=settings.use_gpu,
        )
    return _piper_voice


def synthesize_to_segment(voice: PiperVoice, text: str) -> AudioSegment:
    """Synthesize one text chunk → AudioSegment (in-memory, no disk I/O)."""
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    wav_io.seek(0)
    return AudioSegment.from_wav(wav_io)


def split_into_sentences(text: str, language: str = "en") -> list[str]:
    """
    Use pysbd for sentence boundary detection.
    Much more reliable than split(".") for academic text.
    """
    segmenter = pysbd.Segmenter(language=language, clean=False)
    return [s.strip() for s in segmenter.segment(text) if s.strip()]


async def run_tts_pipeline(job_id: str, file_url: str, store: JobStore) -> Path:
    """
    Full TTS pipeline.
    Downloads the document, extracts text slide-by-slide, synthesizes
    each sentence, concatenates with inter-slide silence gaps, exports MP3.
    Returns path to the output .mp3 file.
    """
    source_path: Path | None = None

    try:
        # Infer file extension from URL (strip query params first)
        clean_url = file_url.split("?")[0]
        suffix = Path(clean_url).suffix.lower()
        if suffix not in (".pdf", ".pptx", ".ppt"):
            # Fallback — let the extractor return an error
            suffix = ".pdf"

        # 1. Download
        await store.update_status(job_id, JobStatus.DOWNLOADING, progress="Downloading document")
        logger.info(f"[{job_id}] Downloading from {file_url}")
        source_path = await download_file(file_url, suffix)

        # 2. Extract text
        await store.update_status(job_id, JobStatus.PROCESSING, progress="Extracting text")
        result = extract_text(source_path)
        cleanup_file(source_path)
        source_path = None

        if result.error:
            raise ValueError(result.error)

        if not result.has_content:
            raise ValueError("No readable text found in this document.")

        # 3. Synthesize slide by slide
        await store.update_status(job_id, JobStatus.PROCESSING, progress="Synthesizing audio")
        voice = get_piper_voice()
        final_audio = AudioSegment.empty()
        silence_gap = AudioSegment.silent(duration=INTER_SLIDE_SILENCE_MS)
        content_slides = [s for s in result.slides if s.body.strip() or s.title]
        total = len(content_slides)

        for idx, slide in enumerate(content_slides):
            logger.info(
                f"[{job_id}] Synthesizing slide "
                f"{slide.slide_number} ({idx + 1}/{total})"
            )
            slide_audio = AudioSegment.empty()

            # Read the title first — gives the listener a clear signal
            # that a new topic is starting (mirrors how a lecturer speaks)
            if slide.title:
                slide_audio += synthesize_to_segment(voice, slide.title + ".")

            # Body: one sentence at a time to prevent TTS hallucinations
            if slide.body.strip():
                sentences = split_into_sentences(slide.body)
                for sentence in sentences:
                    slide_audio += synthesize_to_segment(voice, sentence)

            final_audio += slide_audio

            # Silence gap after every slide except the last
            if idx < total - 1:
                final_audio += silence_gap

        if len(final_audio) == 0:
            raise ValueError("Synthesis produced no audio output.")

        # 4. Export MP3
        await store.update_status(job_id, JobStatus.PROCESSING, progress="Exporting MP3")
        output_path = get_output_path(job_id, ".mp3")
        final_audio.export(str(output_path), format="mp3", bitrate="128k")
        logger.info(
            f"[{job_id}] MP3 written → {output_path} "
            f"({len(final_audio) / 1000:.1f}s)"
        )

        return output_path

    finally:
        cleanup_file(source_path)
```

---

## File: `app/workers/worker.py`

```python
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
```

---

## File: `app/api/__init__.py`

```python
# empty
```

---

## File: `app/api/health.py`

```python
from datetime import datetime, timezone
from fastapi import APIRouter
import redis.asyncio as aioredis

from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    redis_ok = False
    try:
        client = aioredis.from_url(settings.redis_url)
        await client.ping()
        await client.aclose()
        redis_ok = True
    except Exception:
        pass

    return {
        "status": "ok" if redis_ok else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "redis": "connected" if redis_ok else "disconnected",
        "gpu_enabled": settings.use_gpu,
        "whisper_model": settings.whisper_model_size,
        "piper_voice": settings.piper_voice_name,
    }
```

---

## File: `app/api/jobs.py`

```python
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
```

---

## File: `app/main.py`

```python
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import jobs, health
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure all working directories exist on startup
    for directory in [settings.models_dir, settings.outputs_dir, settings.temp_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    yield
    # Nothing to tear down — Redis connections are per-request


app = FastAPI(
    title="Accessibility Microservice",
    description=(
        "Local AI pipelines for educational accessibility.\n\n"
        "**STT** — MP4 → VTT subtitle file (via Whisper)\n\n"
        "**TTS** — PDF/PPTX → MP3 audiobook (via Piper TTS)"
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(jobs.router)
```

---

## File: `scripts/download_models.py`

```python
#!/usr/bin/env python3
"""
Run ONCE before starting the microservice to download Piper voice model weights.
Whisper weights are downloaded automatically on first transcription request.

Usage (from the microservice/ directory):
    python scripts/download_models.py

Or with a different voice:
    PIPER_VOICE_NAME=en_US-lessac-medium python scripts/download_models.py
"""
import os
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(os.getenv("MODELS_DIR", "./models"))
PIPER_DIR = MODELS_DIR / "piper"

VOICE_NAME = os.getenv("PIPER_VOICE_NAME", "en_US-amy-medium")

# Maps voice name → its path on the HuggingFace repo
VOICE_PATHS = {
    "en_US-amy-medium":    "en/en_US/amy/medium",
    "en_US-lessac-medium": "en/en_US/lessac/medium",
    "en_US-ryan-medium":   "en/en_US/ryan/medium",
}

BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"


def download(url: str, dest: Path) -> None:
    print(f"  Downloading {dest.name} ...", end=" ", flush=True)

    def progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(downloaded / total_size * 100, 100)
            print(f"\r  Downloading {dest.name} ... {pct:.0f}%", end="", flush=True)

    urllib.request.urlretrieve(url, dest, reporthook=progress)
    print(f"\r  ✓ {dest.name} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")


def main():
    if VOICE_NAME not in VOICE_PATHS:
        print(f"ERROR: Unknown voice '{VOICE_NAME}'")
        print(f"Available voices: {', '.join(VOICE_PATHS)}")
        sys.exit(1)

    PIPER_DIR.mkdir(parents=True, exist_ok=True)
    voice_path = VOICE_PATHS[VOICE_NAME]

    print(f"\nDownloading Piper voice: {VOICE_NAME}")
    print(f"Destination: {PIPER_DIR.absolute()}\n")

    for ext in [".onnx", ".onnx.json"]:
        filename = f"{VOICE_NAME}{ext}"
        dest = PIPER_DIR / filename

        if dest.exists():
            print(f"  ✓ {filename} already exists, skipping")
            continue

        url = f"{BASE_URL}/{voice_path}/{filename}"
        download(url, dest)

    print("\nPiper models ready.")
    print(
        "\nNOTE: Whisper model will auto-download on first transcription request.\n"
        f"      It will be saved to {MODELS_DIR / 'whisper'}.\n"
        f"      Model size: {os.getenv('WHISPER_MODEL_SIZE', 'base')}"
    )


if __name__ == "__main__":
    main()
```

---

## File: `Dockerfile`  *(CPU — default)*

```dockerfile
FROM python:3.11-slim

# System dependencies
# ffmpeg    — audio extraction from video
# libgomp1  — OpenMP, required by faster-whisper on CPU
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY scripts/ ./scripts/

# These directories are overridden by Docker volume mounts at runtime.
# Creating them here means the container works even without volumes
# (e.g. during a quick local test run).
RUN mkdir -p /app/models /app/outputs /app/temp

# Default: run the API server.
# The worker service in docker-compose overrides this CMD.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## File: `Dockerfile.gpu`  *(NVIDIA GPU)*

```dockerfile
# Requires: NVIDIA driver + nvidia-container-toolkit on the host
FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    ffmpeg \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

# GPU requirements — onnxruntime-gpu replaces onnxruntime
COPY requirements.gpu.txt .
RUN python3.11 -m pip install --no-cache-dir -r requirements.gpu.txt

COPY app/ ./app/
COPY scripts/ ./scripts/

RUN mkdir -p /app/models /app/outputs /app/temp

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## File: `docker-compose.yml`  *(CPU — default, works on any machine)*

```yaml
services:

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    env_file: .env
    environment:
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./models:/app/models      # AI model weights (persistent)
      - ./outputs:/app/outputs    # Finished VTT / MP3 files
      - ./temp:/app/temp          # In-progress downloads (transient)
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    environment:
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./models:/app/models
      - ./outputs:/app/outputs
      - ./temp:/app/temp
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    command: python -m arq app.workers.worker.WorkerSettings

volumes:
  redis_data:
```

---

## File: `docker-compose.gpu.yml`  *(GPU override — stack on top of base compose)*

```yaml
# Usage:
#   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build

services:

  api:
    build:
      dockerfile: Dockerfile.gpu
    environment:
      - USE_GPU=true

  worker:
    build:
      dockerfile: Dockerfile.gpu
    environment:
      - USE_GPU=true
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

---

## First-Time Setup Checklist

```bash
# 1. Clone / create the microservice directory
cd microservice/

# 2. Copy env file
cp .env.example .env

# 3. Download Piper voice model weights (runs outside Docker — writes to ./models/)
python scripts/download_models.py

# 4. Build and start (CPU)
docker compose up --build

# 4b. GPU machines instead
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build

# Whisper model auto-downloads on the first STT job request.
# You will see the download in the worker container logs.
```

---

## API Contract (for your Next.js backend)

### Submit a job
```http
POST http://localhost:8000/jobs
Content-Type: application/json

{
  "file_url": "http://your-nextjs/uploads/lecture.mp4",
  "job_type": "stt",
  "callback_url": "http://your-nextjs/api/internal/job-complete",
  "metadata": { "course_id": "abc123", "material_id": "xyz456" }
}

→ 202 { "job_id": "...", "status": "queued", "message": "..." }
```

### Poll status (fallback)
```http
GET http://localhost:8000/jobs/{job_id}

→ 200 { "status": "processing", "progress": "Transcribing", ... }
```

### Sync on startup
```http
GET http://localhost:8000/jobs/sync?since=2024-01-15T10:00:00Z

→ 200 { "completed_jobs": [...], "failed_jobs": [...], "synced_at": "..." }
```

### Download output
```http
GET http://localhost:8000/jobs/{job_id}/download

→ 200  (streams .vtt or .mp3 file)
```

### Confirm receipt + trigger cleanup
```http
DELETE http://localhost:8000/jobs/{job_id}/confirm

→ 200 { "message": "Output for job ... deleted." }
```

### Callback payload (what the microservice POSTs to Next.js)
```json
{
  "job_id": "...",
  "job_type": "stt",
  "status": "completed",
  "output_filename": "{job_id}.vtt",
  "error": null,
  "completed_at": "2024-01-15T10:05:32Z",
  "metadata": { "course_id": "abc123", "material_id": "xyz456" }
}
```
