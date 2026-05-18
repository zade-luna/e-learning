const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../db/connection');
const logger = require('../logger');

const ACCESSIBILITY_SERVICE_URL = process.env.ACCESSIBILITY_SERVICE_URL || 'http://localhost:8000';

// Ensure upload directories exist at startup
const SUBTITLES_DIR = path.join(__dirname, '../uploads/subtitles');
const AUDIO_DIR = path.join(__dirname, '../uploads/audio');
[SUBTITLES_DIR, AUDIO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// POST /api/internal/accessibility-callback
// Called by the accessibility microservice when a job finishes.
// No auth — this endpoint is internal-only (not exposed to browser clients).
router.post('/accessibility-callback', async (req, res) => {
  // Respond immediately so the microservice does not timeout waiting for us
  res.status(200).json({ received: true });

  const io = req.app.get('io'); // Socket.io instance (may be undefined if not set up yet)
  const { job_id, job_type, status, output_filename, error: jobError, metadata } = req.body;
  logger.info('Accessibility callback received', { job_id, job_type, status });

  // Best-effort: update job status row
  try {
    await pool.query(
      `UPDATE accessibility_jobs SET status = $1, updated_at = NOW() WHERE job_id = $2`,
      [status, job_id]
    );
  } catch (e) {
    logger.warn('Could not update accessibility_jobs status', { error: e.message });
  }

  if (status !== 'completed' || !output_filename || !metadata?.lesson_id) {
    if (status === 'failed') {
      logger.error('Accessibility job failed', { job_id, error: jobError });
      // Notify teacher that the job failed
      if (io && metadata?.lesson_id) {
        try {
          const teacherRow = await pool.query(
            `SELECT c.teacher_id FROM courses c JOIN lessons l ON l.course_id = c.id WHERE l.id = $1`,
            [metadata.lesson_id]
          );
          if (teacherRow.rows.length > 0) {
            io.to(`teacher:${teacherRow.rows[0].teacher_id}`).emit('accessibility:job_done', {
              jobId: job_id, jobType: job_type, lessonId: metadata.lesson_id, status: 'failed', error: jobError,
            });
          }
        } catch (_) {}
      }
    }
    return;
  }

  try {
    // Download the output file from the microservice
    const downloadResp = await fetch(
      `${ACCESSIBILITY_SERVICE_URL}/jobs/${job_id}/download`
    );
    if (!downloadResp.ok) {
      logger.error('Failed to download accessibility output', {
        job_id,
        status: downloadResp.status,
      });
      return;
    }

    const ext = path.extname(output_filename); // .vtt or .mp3
    const destDir = ext === '.vtt' ? SUBTITLES_DIR : AUDIO_DIR;
    const destPath = path.join(destDir, output_filename);

    const buffer = Buffer.from(await downloadResp.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    const relativeUrl =
      ext === '.vtt'
        ? `/uploads/subtitles/${output_filename}`
        : `/uploads/audio/${output_filename}`;

    // Update the lesson row — STT → subtitle_url, TTS → audio_url
    const updateField = job_type === 'stt' ? 'subtitle_url' : 'audio_url';
    await pool.query(
      `UPDATE lessons SET ${updateField} = $1, updated_at = NOW() WHERE id = $2`,
      [relativeUrl, metadata.lesson_id]
    );

    logger.info('Lesson updated with accessibility output', {
      lessonId: metadata.lesson_id,
      field: updateField,
      url: relativeUrl,
    });

    // Notify the teacher via WebSocket
    try {
      const teacherRow = await pool.query(
        `SELECT c.teacher_id FROM courses c
         JOIN lessons l ON l.course_id = c.id
         WHERE l.id = $1`,
        [metadata.lesson_id]
      );
      if (io && teacherRow.rows.length > 0) {
        io.to(`teacher:${teacherRow.rows[0].teacher_id}`).emit('accessibility:job_done', {
          jobId: job_id,
          jobType: job_type,
          lessonId: metadata.lesson_id,
          status: 'completed',
          url: relativeUrl,
        });
      }
    } catch (wsErr) {
      logger.warn('Could not emit WS event', { error: wsErr.message });
    }

    // Tell the microservice it is safe to clean up its copy
    await fetch(`${ACCESSIBILITY_SERVICE_URL}/jobs/${job_id}/confirm`, {
      method: 'DELETE',
    });
  } catch (err) {
    logger.error('Failed to process accessibility callback', {
      job_id,
      error: err.message,
    });
  }
});

module.exports = router;
