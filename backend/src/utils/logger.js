import pino from 'pino';

// Secrets and message bodies must never reach the logs.
const redact = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.creds',
  '*.keys',
  'text',
  'body',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: redact, censor: '[redacted]' },
  base: { app: 'cymor-assistant' },
});

export const child = (name) => logger.child({ module: name });
