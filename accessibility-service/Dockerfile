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
