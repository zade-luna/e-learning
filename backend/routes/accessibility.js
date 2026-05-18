const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const authenticateToken = require('../middleware/auth');
const checkRole = require('../middleware/roleCheck');
const logger = require('../logger');

const ACCESSIBILITY_SERVICE_URL = process.env.ACCESSIBILITY_SERVICE_URL || 'http://localhost:8000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

// URLs sent to the microservice must use host.docker.internal so Docker containers
// can reach the host machine. Replace localhost with host.docker.internal.
const toDockerUrl = (url) => url.replace('://localhost', '://host.docker.internal');

// POST /api/accessibility/jobs — teacher submits an STT or TTS job
router.post('/jobs', authenticateToken, checkRole('teacher', 'admin'), async (req, res) => {
  const { lessonId, jobType } = req.body;

  if (!lessonId || !['stt', 'tts'].includes(jobType)) {
    return res.status(400).json({ error: 'lessonId and jobType (stt|tts) are required' });
  }

  try {

    const lessonResult = await pool.query('SELECT * FROM lessons WHERE id = $1', [lessonId]);
    if (lessonResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    const lesson = lessonResult.rows[0];

    // Verify ownership for teachers
    if (req.user.role === 'teacher') {
      const ownerCheck = await pool.query(
        `SELECT c.teacher_id FROM courses c
         JOIN lessons l ON c.id = l.course_id
         WHERE l.id = $1`,
        [lessonId]
      );
      if (!ownerCheck.rows.length || ownerCheck.rows[0].teacher_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    let fileUrl;
    if (jobType === 'stt') {
      if (!lesson.video_url) {
        return res.status(400).json({ error: 'This lesson has no video to transcribe.' });
      }
      fileUrl = lesson.video_url.startsWith('http')
        ? lesson.video_url
        : `${BACKEND_URL}${lesson.video_url}`;
    } else {
      if (!lesson.document_url) {
        return res.status(400).json({ error: 'This lesson has no document to convert to audio.' });
      }
      fileUrl = lesson.document_url.startsWith('http')
        ? lesson.document_url
        : `${BACKEND_URL}${lesson.document_url}`;
    }

    const callbackUrl = toDockerUrl(`${BACKEND_URL}/api/internal/accessibility-callback`);
    fileUrl = toDockerUrl(fileUrl);

    const response = await fetch(`${ACCESSIBILITY_SERVICE_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_url: fileUrl,
        job_type: jobType,
        callback_url: callbackUrl,
        metadata: { lesson_id: lessonId, job_type: jobType },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Accessibility service error', { status: response.status, errText });
      return res.status(502).json({
        error: 'Accessibility service returned an error',
        detail: errText,
      });
    }

    const data = await response.json();

    // Track job in DB
    await pool.query(
      `INSERT INTO accessibility_jobs (job_id, lesson_id, job_type, status)
       VALUES ($1, $2, $3, 'queued')
       ON CONFLICT (job_id) DO NOTHING`,
      [data.job_id, lessonId, jobType]
    );

    logger.info('Accessibility job submitted', { jobId: data.job_id, lessonId, jobType });
    res.status(202).json(data);
  } catch (err) {
    logger.error('Submit accessibility job failed', { error: err.message });
    res.status(500).json({ error: 'Failed to submit accessibility job' });
  }
});

// GET /api/accessibility/jobs/:jobId — poll job status (proxied from microservice)
router.get('/jobs/:jobId', authenticateToken, async (req, res) => {
  try {
    const response = await fetch(
      `${ACCESSIBILITY_SERVICE_URL}/jobs/${req.params.jobId}`
    );
    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Job not found' });
      }
      return res.status(502).json({ error: 'Accessibility service error' });
    }
    res.json(await response.json());
  } catch (err) {
    logger.error('Poll job status failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// GET /api/accessibility/lessons/:lessonId/jobs — get all jobs for a lesson
router.get('/lessons/:lessonId/jobs', authenticateToken, checkRole('teacher', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM accessibility_jobs WHERE lesson_id = $1 ORDER BY created_at DESC`,
      [req.params.lessonId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get lesson jobs failed', { error: err.message });
    res.status(500).json({ error: 'Failed to get lesson jobs' });
  }
});

module.exports = router;
