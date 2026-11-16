import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createApiRouter } from './routes/api.js';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Build the Express app (dashboard API + static React build). Pure function => easy to test. */
export function createApp({ config, frontendDir } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Heroku router

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:'], // QR code is served as a data URL
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowed = [config.APP_BASE_URL, ...(config.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [])].filter(Boolean);
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)), credentials: true }));

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // Platform health check (no sensitive data).
  app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));
  app.use('/api', createApiRouter({ config }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Static dashboard (React build) with SPA fallback.
  const dist = frontendDir || path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text').send('CYMOR ASSISTANT API is running. Frontend build not found (run: npm run build).'));
  }

  // Central error handler: never leak internals.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err: err.message }, 'Request failed');
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'Something went wrong' });
  });

  return app;
}
