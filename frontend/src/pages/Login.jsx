import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Field } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ paddingBottom: 20 }}>
          <div className="brand-logo">C</div>
          <div>
            <div className="brand-name">CYMOR ASSISTANT</div>
            <div className="brand-sub">Administrator sign-in</div>
          </div>
        </div>
        <Field label="Username"><input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small" style={{ textAlign: 'center', marginTop: 18 }}>Powered by CYMOR TECH SERVICES</p>
      </form>
    </div>
  );
}
