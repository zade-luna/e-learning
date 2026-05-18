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
