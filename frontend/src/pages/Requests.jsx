import { Fragment, useState } from 'react';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Pill, ErrorNote, Loading, fmtDate, CATEGORY_LABELS, Toast } from '../components/ui.jsx';

const TABS = [
  { id: 'pending', label: 'Pending', q: 'status=pending' },
  { id: 'completed', label: 'Completed', q: 'status=completed' },
  { id: 'reviewed', label: 'Reviewed', q: 'status=reviewed' },
  { id: 'kuccps', label: 'KUCCPS', q: 'category=kuccps' },
  { id: 'software', label: 'Software', q: 'category=software_development' },
  { id: 'web', label: 'Websites', q: 'category=web_development' },
  { id: 'urgent', label: 'Urgent', q: 'priority=urgent' },
  { id: 'all', label: 'All', q: '' },
];

export default function Requests() {
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState('');
  const q = [TABS.find((t) => t.id === tab).q, search ? `search=${encodeURIComponent(search)}` : ''].filter(Boolean).join('&');
  const { data, error, loading, reload } = usePolling(() => api.get(`/requests?${q}`), 15000, [q]);

  async function update(id, patch, msg) {
    try { await api.patch(`/requests/${id}`, patch); setToast(msg); reload(); } catch (e) { setToast(e.message); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Requests</h1><p>Inquiries captured by the assistant for you to follow up.</p></div></div>
      <div className="tabs">{TABS.map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      <div className="toolbar"><input className="input" placeholder="Search requests…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Contact</th><th>Category</th><th>Request</th><th>Priority</th><th>Status</th><th>Received</th></tr></thead>
            <tbody>
              {data?.requests.map((r) => (
                <Fragment key={r._id}>
                  <tr className="clickable" onClick={() => setOpen(open === r._id ? null : r._id)}>
                    <td><b>{r.contactName || 'Unknown'}</b><div className="small muted">+{r.phone}</div></td>
                    <td><Pill tone="plain">{CATEGORY_LABELS[r.category] || r.category}</Pill></td>
                    <td className="clip small">{r.description}</td>
                    <td><Pill tone={r.priority === 'urgent' ? 'bad' : r.priority === 'high' ? 'warn' : 'plain'}>{r.priority}</Pill></td>
                    <td><Pill tone={r.status === 'pending' ? 'warn' : 'ok'}>{r.status}</Pill></td>
                    <td className="small">{fmtDate(r.createdAt)}</td>
                  </tr>
                  {open === r._id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--surface)' }}>
                        <p style={{ margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{r.description}</p>
                        {Object.keys(r.collected || {}).length > 0 && <p className="small muted">{Object.entries(r.collected).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
                        <NoteEditor request={r} onSave={(notes) => update(r._id, { ownerNotes: notes }, 'Notes saved')} />
                        <div className="row" style={{ marginTop: 10 }}>
                          {r.status === 'pending' && <button className="btn small" onClick={() => update(r._id, { status: 'reviewed' }, 'Marked reviewed')}>Mark reviewed</button>}
                          {r.status !== 'completed' && <button className="btn small primary" onClick={() => update(r._id, { status: 'completed' }, 'Marked completed')}>Mark completed</button>}
                          {r.status !== 'pending' && <button className="btn small" onClick={() => update(r._id, { status: 'pending' }, 'Reopened')}>Reopen</button>}
                          <a className="btn small" href={`https://wa.me/${r.phone}`} target="_blank" rel="noreferrer noopener">Open in WhatsApp</a>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!data?.requests.length && <div className="empty">Nothing here.</div>}
        </div>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}

function NoteEditor({ request, onSave }) {
  const [v, setV] = useState(request.ownerNotes || '');
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <textarea className="input" style={{ flex: 1, minHeight: 60 }} placeholder="Private notes…" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn small" onClick={() => onSave(v)}>Save notes</button>
    </div>
  );
}
