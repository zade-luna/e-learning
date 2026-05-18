#!/usr/bin/env python3
"""
Run ONCE before starting the microservice to download Piper voice model weights.
Whisper weights are downloaded automatically on first transcription request.

Usage (from the accessibility-service/ directory):
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
