import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Field, Switch, ErrorNote, Loading, Toast } from '../components/ui.jsx';

const TABS = ['General', 'Business profile', 'Services & FAQs', 'Notifications', 'Automation', 'AI'];
const set = (obj, path, v) => { const o = structuredClone(obj); let t = o; path.slice(0, -1).forEach((k) => { t = t[k]; }); t[path.at(-1)] = v; return o; };

export default function Settings() {
  const { data, error, loading, reload } = usePolling(() => api.get('/settings'), 0);
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('General');
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (loading && !s) return <Loading />;
  if (!s) return <ErrorNote error={error} />;

  const upd = (path, v) => setS((cur) => set(cur, path, v));
  const text = (path, props = {}) => <input className="input" value={path.reduce((o, k) => o?.[k], s) ?? ''} onChange={(e) => upd(path, e.target.value)} {...props} />;
  const num = (path, props = {}) => <input className="input" type="number" value={path.reduce((o, k) => o?.[k], s) ?? 0} onChange={(e) => upd(path, Number(e.target.value))} {...props} />;
  const sw = (path, label, help) => (
    <div className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div><div>{label}</div>{help && <div className="small muted">{help}</div>}</div>
      <Switch checked={path.reduce((o, k) => o?.[k], s)} onChange={(v) => upd(path, v)} label={label} />
    </div>
  );

  async function save() {
    setSaving(true);
    try {
      const payload = {
        assistantEnabled: s.assistantEnabled, ownerPhone: s.ownerPhone, footer: s.footer, personalityNotes: s.personalityNotes,
        ai: { model: s.ai.model, temperature: s.ai.temperature, timeoutMs: s.ai.timeoutMs, maxRetries: s.ai.maxRetries, historyMessages: s.ai.historyMessages },
        notifications: s.notifications, automation: s.automation, ownerProfile: s.ownerProfile, company: s.company, services: s.services, faqs: s.faqs, policies: s.policies,
      };
      await api.put('/settings', payload);
      setToast('Settings saved ✓');
      reload();
    } catch (e) {
      setToast(`${e.message}${e.details ? ` — ${e.details[0]}` : ''}`);
    } finally {
      setSaving(false);
    }
  }

  const lines = (arr) => (arr || []).join('\n');
  const fromLines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div><h1>Settings</h1><p>Changes apply immediately; no code edits needed.</p></div>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
      <div className="tabs">{TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === 'General' && (
        <div className="card">
          {sw(['assistantEnabled'], 'Assistant ON', 'Master switch for automatic replies.')}
          <div style={{ height: 14 }} />
          <Field label="Owner phone number" help="International format, e.g. 2547XXXXXXXX. Used to verify owner commands and to send you notifications.">{text(['ownerPhone'], { placeholder: '2547XXXXXXXX' })}</Field>
          <Field label="Message footer (added automatically to every automated reply)">{text(['footer'])}</Field>
          <Field label="Extra personality / style notes" help="Optional. Lower priority than the built-in safety rules.">
            <textarea className="input" value={s.personalityNotes} onChange={(e) => upd(['personalityNotes'], e.target.value)} placeholder="e.g. Use a few more Swahili greetings." />
          </Field>
          <Field label="Secrets"><div className="small muted">Gemini API key: {data.secrets.geminiApiKey} · MongoDB: {data.secrets.mongodb} · Session encryption key: {data.secrets.encryptionKey}<br />Secrets live in Heroku Config Vars and are never shown here.</div></Field>
        </div>
      )}

      {tab === 'Business profile' && (
        <div className="card">
          <Field label="Owner name">{text(['ownerProfile', 'name'])}</Field>
          <Field label="Position">{text(['ownerProfile', 'position'])}</Field>
          <Field label="Company">{text(['ownerProfile', 'company'])}</Field>
          <Field label="Professions (one per line)"><textarea className="input" value={lines(s.ownerProfile.professions)} onChange={(e) => upd(['ownerProfile', 'professions'], fromLines(e.target.value))} /></Field>
          <Field label="Company description"><textarea className="input" value={s.company.description} onChange={(e) => upd(['company', 'description'], e.target.value)} /></Field>
          <Field label="Consultation information"><textarea className="input" value={s.policies.consultationInfo} onChange={(e) => upd(['policies', 'consultationInfo'], e.target.value)} /></Field>
          <Field label="Working hours (optional)">{text(['policies', 'workingHours'], { placeholder: 'Leave empty if unknown — the assistant will not invent hours' })}</Field>
          <Field label="Official links (one per line)"><textarea className="input" value={lines(s.policies.officialLinks)} onChange={(e) => upd(['policies', 'officialLinks'], fromLines(e.target.value))} /></Field>
          <Field label="Communication policies (one per line)"><textarea className="input" style={{ minHeight: 130 }} value={lines(s.policies.communication)} onChange={(e) => upd(['policies', 'communication'], fromLines(e.target.value))} /></Field>
        </div>
      )}

      {tab === 'Services & FAQs' && (
        <div className="grid">
          {s.services.map((svc, i) => (
            <div className="card" key={svc.id || i}>
              <Field label="Service group">{text(['services', i, 'title'])}</Field>
              <Field label="Items (one per line)"><textarea className="input" style={{ minHeight: 120 }} value={lines(svc.items)} onChange={(e) => upd(['services', i, 'items'], fromLines(e.target.value))} /></Field>
              <button className="btn small danger" onClick={() => setS({ ...s, services: s.services.filter((_, j) => j !== i) })}>Remove group</button>
            </div>
          ))}
          <button className="btn" onClick={() => setS({ ...s, services: [...s.services, { id: `svc_${Date.now()}`, title: 'New service group', items: [] }] })}>+ Add service group</button>
          <div className="section-title"><h2>FAQs</h2></div>
          {s.faqs.map((f, i) => (
            <div className="card" key={i}>
              <Field label="Question">{text(['faqs', i, 'q'])}</Field>
              <Field label="Answer"><textarea className="input" value={f.a} onChange={(e) => upd(['faqs', i, 'a'], e.target.value)} /></Field>
              <button className="btn small danger" onClick={() => setS({ ...s, faqs: s.faqs.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button className="btn" onClick={() => setS({ ...s, faqs: [...s.faqs, { q: '', a: '' }] })}>+ Add FAQ</button>
        </div>
      )}

      {tab === 'Notifications' && (
        <div className="card">
          {sw(['notifications', 'enabled'], 'Send WhatsApp notifications to me')}
          {sw(['notifications', 'newInquiry'], 'New inquiries')}
          {sw(['notifications', 'urgent'], 'Urgent inquiries')}
          {sw(['notifications', 'kuccps'], 'KUCCPS consultation requests')}
          {sw(['notifications', 'unansweredQuestion'], 'Questions the assistant could not answer')}
          {sw(['notifications', 'dailySummary'], 'Daily conversation summary')}
          <div style={{ height: 14 }} />
          <Field label="Daily summary hour (0–23, Nairobi time)">{num(['notifications', 'dailySummaryHour'], { min: 0, max: 23 })}</Field>
        </div>
      )}

      {tab === 'Automation' && (
        <div className="card">
          {sw(['automation', 'autoTakeoverOnOwnerReply'], 'Auto takeover when I reply personally', 'When you type in a customer chat from your phone, the AI stops in that chat.')}
          {sw(['automation', 'groupsEnabled'], 'Group chats', 'Reserved: groups are ignored in this release.')}
          <div style={{ height: 14 }} />
          <Field label="Release takeover after owner inactivity (minutes, 0 = never)">{num(['automation', 'takeoverInactivityMinutes'], { min: 0 })}</Field>
          <Field label="Retention: delete messages older than (days, 0 = keep forever)">{num(['automation', 'retentionDays'], { min: 0 })}</Field>
        </div>
      )}

      {tab === 'AI' && (
        <div className="card">
          <Field label="Gemini model" help={`Leave empty to use the environment default (${data.envDefaults.model}).`}>{text(['ai', 'model'], { placeholder: data.envDefaults.model })}</Field>
          <Field label="Temperature (0–1.5)">{num(['ai', 'temperature'], { step: 0.1, min: 0, max: 1.5 })}</Field>
          <Field label="Request timeout (ms)">{num(['ai', 'timeoutMs'], { min: 3000, max: 60000 })}</Field>
          <Field label="Retries on temporary errors">{num(['ai', 'maxRetries'], { min: 0, max: 4 })}</Field>
          <Field label="Messages of history sent to the AI">{num(['ai', 'historyMessages'], { min: 4, max: 40 })}</Field>
          <p className="small muted">The API key is set via the GEMINI_API_KEY config var. Model changes take effect after the worker restarts.</p>
        </div>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
