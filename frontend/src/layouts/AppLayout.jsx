import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { icons } from '../components/ui.jsx';

const NAV = [
  { to: '/', label: 'Overview', icon: icons.grid, end: true },
  { to: '/whatsapp', label: 'WhatsApp', icon: icons.link },
  { to: '/conversations', label: 'Conversations', icon: icons.chat },
  { to: '/requests', label: 'Requests', icon: icons.inbox },
  { to: '/analytics', label: 'Analytics', icon: icons.chart },
  { to: '/settings', label: 'Settings', icon: icons.gear },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">C</div>
          <div>
            <div className="brand-name">CYMOR ASSISTANT</div>
            <div className="brand-sub">Your Personal Digital Representative</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}>
              {n.icon}<span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div style={{ marginBottom: 8 }}>Signed in as <b>{user?.username}</b></div>
          <button className="btn small" onClick={logout}>Sign out</button>
          <div style={{ marginTop: 12 }}>Powered by CYMOR TECH SERVICES</div>
        </div>
      </aside>
      <div>
        <div className="topbar-mobile">
          <button className="btn small" onClick={() => setOpen(true)} aria-label="Open menu">☰ Menu</button>
          <b style={{ fontFamily: 'var(--display)', letterSpacing: '.06em' }}>CYMOR ASSISTANT</b>
        </div>
        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}
