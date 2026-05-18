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
