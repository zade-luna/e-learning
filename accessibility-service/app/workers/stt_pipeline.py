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
