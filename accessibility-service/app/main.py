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
