import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { BarList, LineChart, ErrorNote, Loading, Stat, CATEGORY_LABELS } from '../components/ui.jsx';

export default function Analytics() {
  const { data, error, loading } = usePolling(() => api.get('/analytics'), 30000);
  if (loading && !data) return <Loading />;
  const d = data;
  const totalAi = d?.aiUsage.reduce((a, u) => ({ r: a.r + u.requests, f: a.f + u.failures, t: a.t + u.promptTokens + u.outputTokens }), { r: 0, f: 0, t: 0 }) || { r: 0, f: 0, t: 0 };
  const volume = d ? d.conversationsOverTime.map((p) => ({ ...p, replies: d.responseVolume.find((r) => r.day === p.day)?.count || 0 })) : [];
  return (
    <>
      <div className="page-head"><div><h1>Analytics</h1><p>Last 14 days.</p></div></div>
      <ErrorNote error={error} />
      {d && (
        <>
          <div className="grid cols-4">
            <Stat label="Pending requests" value={d.pendingRequests} />
            <Stat label="AI calls (14d)" value={totalAi.r} hint={`${totalAi.f} failed`} />
            <Stat label="AI tokens (14d)" value={totalAi.t.toLocaleString()} />
          </div>
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2 style={{ marginBottom: 6 }}>Conversations over time</h2>
              <div className="row small muted" style={{ marginBottom: 8 }}><span style={{ color: 'var(--green)' }}>● Contacts’ messages</span><span style={{ color: 'var(--blue)' }}>● Active chats</span></div>
              <LineChart points={d.conversationsOverTime} series={[{ key: 'messages', color: '#25d366', label: 'messages' }, { key: 'conversations', color: '#5aa9ff', label: 'chats' }]} />
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 6 }}>Assistant response volume</h2>
              <div className="small muted" style={{ marginBottom: 8 }}>Automated replies sent per day</div>
              <LineChart points={volume} series={[{ key: 'replies', color: '#f5b942', label: 'replies' }]} />
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Inquiries by category</h2>
              <BarList rows={d.inquiriesByCategory} labelKey="category" valueKey="count" format={(c) => CATEGORY_LABELS[c] || c} />
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Most common questions</h2>
              <BarList rows={d.commonQuestions} labelKey="question" valueKey="count" />
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginBottom: 6 }}>AI usage per day</h2>
            <LineChart points={d.aiUsage.map((u) => ({ ...u }))} series={[{ key: 'requests', color: '#25d366', label: 'requests' }, { key: 'failures', color: '#ff5d5d', label: 'failures' }]} />
          </div>
        </>
      )}
    </>
  );
}
