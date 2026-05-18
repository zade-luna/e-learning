const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const { Server: SocketIOServer } = require('socket.io');
require('dotenv').config();

const logger = require('./logger');
const pool = require('./db/connection');

const app = express();
const httpServer = http.createServer(app);

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow serving uploaded files cross-origin
}));
const FRONTEND_URL_RAW = process.env.FRONTEND_URL || 'http://localhost:3000';
const ALLOWED_ORIGINS = FRONTEND_URL_RAW.split(',').map((s) => s.trim()).filter(Boolean);

function isDevLocalOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    return (
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      (u.protocol === 'http:' || u.protocol === 'https:')
    );
  } catch {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production' && isDevLocalOrigin(origin)) {
      return callback(null, true);
    }
    logger.warn('CORS blocked origin', { origin });
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' })); // Body limit
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(hpp()); // HTTP Parameter Pollution protection
app.use(compression()); // Gzip compression for all responses

// Socket.io — attached to the same HTTP server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && isDevLocalOrigin(origin)) return callback(null, true);
      callback(new Error('Not allowed'));
    },
    credentials: true,
  },
  path: '/socket.io',
});

io.on('connection', (socket) => {
  const userId = socket.handshake.auth?.userId;
  if (userId) socket.join(`teacher:${userId}`);
});

// Export io instance so route handlers can emit events
app.set('io', io);

// HTTP request logging (skip /health to reduce noise)
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.url === '/health',
}));

// Serve uploaded files as static assets
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const lessonRoutes = require('./routes/lessons');
const enrollmentRoutes = require('./routes/enrollments');
const progressRoutes = require('./routes/progress');
const quizRoutes = require('./routes/quizzes');
const feedbackRoutes = require('./routes/feedback');
const auditRoutes = require('./routes/audit');
const systemRoutes = require('./routes/system');
const accessibilityRoutes = require('./routes/accessibility');
const internalRoutes = require('./routes/internal');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/accessibility', accessibilityRoutes);
app.use('/api/internal', internalRoutes);

// Health check — public, no auth required
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});

// Root info
app.get('/', (req, res) => {
  res.json({ message: 'E-learning API is running', version: '1.0.0' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, url: req.url, method: req.method });
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { env: process.env.NODE_ENV || 'development' });
});