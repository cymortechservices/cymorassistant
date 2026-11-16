/**
 * Exponential backoff with jitter for WhatsApp reconnection.
 * Stops (returns null) once maxAttempts is exceeded so a permanently failing
 * session cannot hammer WhatsApp servers.
 */
export class ReconnectManager {
  constructor({ baseMs = 2000, maxMs = 5 * 60_000, maxAttempts = 15, random = Math.random } = {}) {
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.maxAttempts = maxAttempts;
    this.random = random;
    this.attempts = 0;
  }

  nextDelay() {
    if (this.attempts >= this.maxAttempts) return null;
    const exp = Math.min(this.maxMs, this.baseMs * 2 ** this.attempts);
    this.attempts += 1;
    const jitter = exp * 0.2 * this.random();
    return Math.round(exp + jitter);
  }

  reset() {
    this.attempts = 0;
  }
}

/**
 * Decide what to do with a Baileys `connection: 'close'` status code.
 * Returns one of: 'reconnect' | 'restart' | 'logged_out' | 'replaced' | 'bad_session'.
 */
export function classifyDisconnect(statusCode, DisconnectReason) {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
      return 'logged_out';
    case DisconnectReason.connectionReplaced:
      return 'replaced';
    case DisconnectReason.badSession:
      return 'bad_session';
    case DisconnectReason.restartRequired:
      return 'restart'; // expected right after scanning the QR
    case DisconnectReason.forbidden:
      return 'logged_out';
    default:
      return 'reconnect';
  }
}
