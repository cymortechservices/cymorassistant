import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/models/index.js', async (importOriginal) => (await import('../helpers/model-stubs.js')).mockModels(importOriginal));

const { createApp } = await import('../../src/app.js');
const { loadConfig } = await import('../../src/config/index.js');

const config = loadConfig({ ...process.env, NODE_ENV: 'test', APP_BASE_URL: 'https://cymor.example.com' });
const app = createApp({ config, frontendDir: '/nonexistent' });
const good = { username: 'admin', password: 'correct horse battery' };

async function login() {
  const res = await request(app).post('/api/auth/login').send(good);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('cymor_session='));
  return { res, cookie, csrf: res.body.csrf };
}

describe('dashboard authentication', () => {
  it('health endpoints are public but reveal nothing sensitive', async () => {
    const a = await request(app).get('/healthz');
    expect(a.status).toBe(200);
    expect(Object.keys(a.body).sort()).toEqual(['status', 'uptime']);
    const b = await request(app).get('/api/health');
    expect(b.body).toEqual({ status: 'ok' });
  });

  it('protects every admin route without a session (QR pairing is NOT public)', async () => {
    for (const path of ['/api/whatsapp/status', '/api/overview', '/api/conversations', '/api/requests', '/api/settings', '/api/analytics', '/api/audit']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/qr|data:image/i);
    }
  });

  it('rejects wrong credentials without saying which part was wrong', async () => {
    const r1 = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong password!' });
    const r2 = await request(app).post('/api/auth/login').send({ username: 'nobody', password: good.password });
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r1.body).toEqual(r2.body);
    expect(r1.headers['set-cookie']).toBeUndefined();
  });

  it('rejects malformed login bodies', async () => {
    expect((await request(app).post('/api/auth/login').send({ username: 1 })).status).toBe(400);
  });

  it('login issues an httpOnly SameSite=Strict cookie and a CSRF token', async () => {
    const { res, cookie } = await login();
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.body.csrf).toMatch(/^[0-9a-f]{48}$/);
  });

  it('an authenticated admin can read the pairing status', async () => {
    const { cookie } = await login();
    const res = await request(app).get('/api/whatsapp/status').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body).toMatchObject({ state: 'disconnected', qr: null });
  });

  it('blocks state-changing requests without a valid CSRF token', async () => {
    const { cookie, csrf } = await login();
    const noToken = await request(app).post('/api/whatsapp/action').set('Cookie', cookie).send({ action: 'disconnect' });
    expect(noToken.status).toBe(403);
    const badToken = await request(app).post('/api/whatsapp/action').set('Cookie', cookie).set('X-CSRF-Token', 'x'.repeat(48)).send({ action: 'disconnect' });
    expect(badToken.status).toBe(403);
    const ok = await request(app).post('/api/whatsapp/action').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ action: 'disconnect' });
    expect(ok.status).toBe(200);
  });

  it('rejects tampered / forged session cookies', async () => {
    const forged = 'cymor_session=' + 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.';
    expect((await request(app).get('/api/overview').set('Cookie', forged)).status).toBe(401);
    expect((await request(app).get('/api/overview').set('Cookie', 'cymor_session=garbage')).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const { cookie, csrf } = await login();
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(res.headers['set-cookie'][0]).toMatch(/cymor_session=;/);
  });

  it('validates settings input and never returns raw secrets', async () => {
    const { cookie, csrf } = await login();
    const get = await request(app).get('/api/settings').set('Cookie', cookie);
    const body = JSON.stringify(get.body);
    expect(body).not.toContain(process.env.GEMINI_API_KEY);
    expect(body).not.toContain(process.env.JWT_SECRET);
    expect(body).not.toContain(process.env.DASHBOARD_PASSWORD_HASH);
    expect(get.body.secrets.geminiApiKey).toMatch(/hidden/);
    const bad = await request(app).put('/api/settings').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ ai: { temperature: 99 } });
    expect(bad.status).toBe(400);
    const unknownKey = await request(app).put('/api/settings').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ GEMINI_API_KEY: 'steal' });
    expect(unknownKey.status).toBe(400);
  });

  it('sets security headers (helmet) and hides the framework', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not allow cross-origin credentialed requests from unknown origins', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await request(app).get('/healthz').set('Origin', 'https://cymor.example.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://cymor.example.com');
  });
});
