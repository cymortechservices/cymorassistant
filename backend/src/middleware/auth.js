import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const COOKIE_NAME = 'cymor_session';
const SESSION_HOURS = 12;

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // keep timing roughly constant
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
};

/** Verify dashboard credentials. Username compare is constant-time; password uses bcrypt. */
export async function verifyCredentials(config, username, password) {
  const userOk = safeEqual(username ?? '', config.DASHBOARD_USERNAME);
  let passOk = false;
  try {
    passOk = await bcrypt.compare(String(password ?? ''), config.DASHBOARD_PASSWORD_HASH);
  } catch {
    passOk = false;
  }
  return userOk && passOk;
}

/** Issue a session: JWT in an httpOnly cookie + a CSRF token bound to the JWT. */
export function issueSession(config, res) {
  const csrf = crypto.randomBytes(24).toString('hex');
  const token = jwt.sign({ sub: 'admin', csrf }, config.JWT_SECRET, { expiresIn: `${SESSION_HOURS}h`, algorithm: 'HS256' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/',
  });
  return csrf;
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Authentication + CSRF (for state-changing methods). */
export function requireAdmin(config) {
  return (req, res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    let payload;
    try {
      payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Session expired' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const header = req.get('x-csrf-token');
      if (!header || !safeEqual(header, payload.csrf)) return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    req.admin = { sub: payload.sub, csrf: payload.csrf };
    next();
  };
}
