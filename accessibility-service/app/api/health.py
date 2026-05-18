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
