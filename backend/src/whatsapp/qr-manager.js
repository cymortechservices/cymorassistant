import QRCode from 'qrcode';
import { WhatsAppSession } from '../models/index.js';
import { child } from '../utils/logger.js';

const log = child('qr');

/** WhatsApp rotates QR codes roughly every 20-60 seconds. */
export const QR_TTL_MS = 60_000;

/**
 * Stores the current pairing QR in MongoDB so the web dyno (which is a
 * separate process from the worker) can show it to the authenticated admin.
 * The QR is cleared as soon as pairing succeeds or the connection closes.
 */
export class QrManager {
  constructor({ sessionId, printToTerminal = false }) {
    this.sessionId = sessionId;
    this.printToTerminal = printToTerminal;
  }

  async publish(qrString) {
    await WhatsAppSession.updateOne(
      { sessionId: this.sessionId },
      { $set: { qr: qrString, qrUpdatedAt: new Date(), connectionState: 'qr_pending' } },
      { upsert: true },
    );
    if (this.printToTerminal) {
      try {
        const ascii = await QRCode.toString(qrString, { type: 'terminal', small: true });
        // Local development only; never enabled in production.
        console.log('\nScan this QR with WhatsApp > Linked Devices > Link a Device:\n' + ascii);
      } catch (e) {
        log.warn({ err: e.message }, 'Could not render terminal QR');
      }
    }
    log.info('New pairing QR published');
  }

  async clear() {
    await WhatsAppSession.updateOne({ sessionId: this.sessionId }, { $set: { qr: null, qrUpdatedAt: null } });
  }
}

/** Convert a stored QR string into a PNG data URL for the admin dashboard. */
export async function qrToDataUrl(qrString) {
  return QRCode.toDataURL(qrString, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
}
