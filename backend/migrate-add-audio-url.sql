-- Add audio_url column to lessons for TTS-generated MP3s
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- Track accessibility jobs (STT + TTS) submitted to the microservice
CREATE TABLE IF NOT EXISTS accessibility_jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(255) UNIQUE NOT NULL,
    lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
    job_type VARCHAR(10) NOT NULL CHECK (job_type IN ('stt', 'tts')),
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accessibility_jobs_lesson_id ON accessibility_jobs(lesson_id);
