import { useState } from 'react';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Pill, ErrorNote, Loading, stateTone, fmtDate, Toast } from '../components/ui.jsx';

const LABELS = {
  connected: 'Connected', connecting: 'Connecting…', qr_pending: 'Waiting for QR scan', reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected', logged_out: 'Logged out — scan a new QR code', failed: 'Failed — reconnect needed', replaced: 'Session opened elsewhere', error: 'Error',
};

export default function WhatsApp() {
  // Poll fast while pairing so the QR refreshes in near real time.
  const { data, error, loading, reload } = usePolling(() => api.get('/whatsapp/status'), 2500);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await api.post('/whatsapp/action', { action });
      setToast(r.message);
      setTimeout(reload, 2500);
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  const d = data;
  return (
    <>
      <div className="page-head">
        <div><h1>WhatsApp connection</h1><p>Link the owner’s WhatsApp account. This page is visible to signed-in administrators only.</p></div>
        {d && <Pill tone={stateTone(d.state)}>{LABELS[d.state] || d.state}</Pill>}
      </div>
      <ErrorNote error={error} />
      {d && !d.workerOnline && (
        <div className="card" style={{ borderColor: 'var(--amber)', marginBottom: 16 }}>
          <b style={{ color: 'var(--amber)' }}>Worker not detected.</b>
          <p className="small muted" style={{ margin: '6px 0 0' }}>The WhatsApp worker process is not reporting in. On Heroku make sure the <code>worker</code> dyno is scaled to 1 (<code>heroku ps:scale worker=1</code>). Locally run <code>npm run start:worker</code>.</p>
        </div>
      )}
      {d && (
        <div className="grid cols-2">
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>{d.state === 'connected' ? 'Linked account' : 'Scan to link'}</h2>
            {d.state === 'connected' && (
              <div>
                <p style={{ fontSize: '1.4rem', fontFamily: 'var(--display)', margin: '8px 0' }}>✅ Connected</p>
                <p className="muted">Account: <b style={{ color: 'var(--text)' }}>{d.me?.name || 'WhatsApp user'}</b>{d.me && <> (+{String(d.me.id).split(':')[0].split('@')[0]})</>}</p>
                <p className="muted small">Last connected: {fmtDate(d.lastConnectedAt)}</p>
              </div>
            )}
            {d.state !== 'connected' && d.qr && (
              <>
                <div className="qr-box"><img src={d.qr} alt="WhatsApp pairing QR code" /></div>
                <p className="muted small" style={{ textAlign: 'center', marginTop: 14 }}>Refreshes automatically · expires in ~{d.qrExpiresInSec}s</p>
              </>
            )}
            {d.state !== 'connected' && !d.qr && (
              <div className="empty">
                {d.state === 'qr_pending' ? 'Refreshing QR code…' : d.workerOnline ? 'Starting connection… a QR code will appear here in a few seconds.' : 'Waiting for the worker…'}
              </div>
            )}
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>How to link</h2>
            <ol className="steps">
              <li>Open <b>WhatsApp</b> on the owner’s phone.</li>
              <li>Tap <b>Settings → Linked devices</b> (on Android: ⋮ menu → Linked devices).</li>
              <li>Tap <b>Link a device</b> and unlock your phone if asked.</li>
              <li>Point the camera at the QR code on this page.</li>
              <li>Wait for “Connected”, then switch the assistant <b>ON</b> from the Overview page.</li>
            </ol>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '20px 0' }} />
            <div className="small muted" style={{ display: 'grid', gap: 4 }}>
              <span>Reconnect attempts: {d.reconnectAttempts}</span>
              {d.lastDisconnectReason && <span>Last disconnect: {d.lastDisconnectReason}</span>}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn small" disabled={busy} onClick={() => act('reconnect')}>Reconnect</button>
              <button className="btn small" disabled={busy || d.state === 'disconnected'} onClick={() => act('disconnect', 'Disconnect the worker from WhatsApp? Your saved session stays valid.')}>Disconnect</button>
              <button className="btn small danger" disabled={busy} onClick={() => act('logout', 'Log out and unlink this WhatsApp account? You will need to scan a new QR code.')}>Log out & unlink</button>
            </div>
          </div>
        </div>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
