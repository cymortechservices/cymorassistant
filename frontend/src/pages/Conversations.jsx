import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Pill, ErrorNote, Loading, Switch, fmtDate, fmtTime, CATEGORY_LABELS, Toast } from '../components/ui.jsx';

export function ConversationList() {
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState('');
  const nav = useNavigate();
  const { data, error, loading } = usePolling(() => api.get(`/conversations?search=${encodeURIComponent(search)}&status=${only}`), 10000, [search, only]);

  return (
    <>
      <div className="page-head"><div><h1>Conversations</h1><p>Every chat the assistant is handling.</p></div></div>
      <div className="toolbar">
        <input className="input" placeholder="Search name, number, message…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" style={{ maxWidth: 200 }} value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="">All conversations</option><option value="takeover">Human takeover only</option>
        </select>
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Contact</th><th>Latest message</th><th>Last activity</th><th>Status</th><th>Category</th><th>Automation</th></tr></thead>
            <tbody>
              {data?.conversations.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => nav(`/conversations/${c.id}`)}>
                  <td><b>{c.name || 'Unknown'}</b><div className="small muted">+{c.phone || '—'}</div></td>
                  <td className="clip small">{c.lastMessage?.replace(/\n+/g, ' ') || '—'}</td>
                  <td className="small">{fmtDate(c.lastInteractionAt)}</td>
                  <td><Pill tone={c.humanTakeover ? 'info' : c.state === 'CONVERSATION_ENDED' ? 'plain' : 'ok'}>{c.state.replaceAll('_', ' ').toLowerCase()}</Pill></td>
                  <td><Pill tone="plain">{CATEGORY_LABELS[c.category] || c.category}</Pill>{c.hasOpenRequest && <Pill tone="warn">request</Pill>}</td>
                  <td>{c.humanTakeover ? <Pill tone="info">you</Pill> : c.automationEnabled ? <Pill tone="ok">AI</Pill> : <Pill tone="bad">off</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.conversations.length && <div className="empty">No conversations yet. They appear here when contacts message you.</div>}
        </div>
      )}
    </>
  );
}

export function ConversationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = usePolling(() => api.get(`/conversations/${id}`), 6000, [id]);
  const [toast, setToast] = useState('');

  async function run(fn, msg) {
    try { await fn(); setToast(msg); reload(); } catch (e) { setToast(e.message); }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote error={error} />;
  const c = data.conversation;
  return (
    <>
      <div className="page-head">
        <div><Link to="/conversations" className="small">← All conversations</Link><h1 style={{ marginTop: 6 }}>{c.name || 'Unknown contact'}</h1><p>+{c.phone}</p></div>
        <div className="row">
          <Pill tone={c.humanTakeover ? 'info' : 'ok'}>{c.humanTakeover ? 'Human takeover' : c.state.replaceAll('_', ' ').toLowerCase()}</Pill>
          <Pill tone="plain">{CATEGORY_LABELS[c.category] || c.category}</Pill>
        </div>
      </div>
      <div className="split">
        <div className="card" style={{ padding: 0 }}>
          <div className="chat">
            {data.messages.length === 0 && <div className="empty">No messages stored.</div>}
            {data.messages.map((m) => (
              <div key={m.id} className={`bubble ${m.sender}`}>
                {m.text || <i className="muted">[{m.type}]</i>}
                <div className="meta">{m.sender === 'assistant' ? 'CYMOR ASSISTANT' : m.sender === 'owner' ? 'You' : 'Contact'} · {fmtTime(m.timestamp)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid">
          <div className="card">
            <h3>Control</h3>
            <p className="small muted">Take over to reply personally. The AI stays silent in this chat until you release it.</p>
            <div className="row" style={{ marginBottom: 14 }}>
              {c.humanTakeover
                ? <button className="btn primary" onClick={() => run(() => api.post(`/conversations/${id}/takeover`, { on: false }), 'AI resumed for this chat')}>Release to AI</button>
                : <button className="btn" onClick={() => run(() => api.post(`/conversations/${id}/takeover`, { on: true }), 'Takeover active')}>Take over</button>}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">AI enabled for this contact</span>
              <Switch checked={c.automationEnabled} onChange={(v) => run(() => api.post(`/conversations/${id}/automation`, { enabled: v }), v ? 'AI enabled' : 'AI disabled for this contact')} />
            </div>
          </div>
          {Object.keys(c.collected || {}).length > 0 && (
            <div className="card"><h3 style={{ marginBottom: 8 }}>Details collected</h3>{Object.entries(c.collected).map(([k, v]) => <div key={k} className="small"><span className="muted">{k}:</span> {String(v)}</div>)}</div>
          )}
          {data.requests.map((r) => (
            <div className="card" key={r._id}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h3>Request</h3><Pill tone={r.status === 'pending' ? 'warn' : 'ok'}>{r.status}</Pill></div>
              <p className="small">{r.description}</p>
              {r.status === 'pending' && <button className="btn small" onClick={() => run(() => api.patch(`/requests/${r._id}`, { status: 'reviewed' }), 'Marked as reviewed')}>Mark reviewed</button>}
            </div>
          ))}
          <div className="card">
            <h3>Privacy</h3>
            <p className="small muted">Permanently delete this contact’s stored messages and requests.</p>
            <button className="btn small danger" onClick={async () => { if (window.confirm('Delete ALL stored data for this contact? This cannot be undone.')) { await api.del(`/conversations/${id}`); nav('/conversations'); } }}>Delete contact data</button>
          </div>
        </div>
      </div>
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
