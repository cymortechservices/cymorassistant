import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import WhatsApp from './pages/WhatsApp.jsx';
import { ConversationList, ConversationDetail } from './pages/Conversations.jsx';
import Requests from './pages/Requests.jsx';
import Analytics from './pages/Analytics.jsx';
import Settings from './pages/Settings.jsx';
import { Loading } from './components/ui.jsx';

function Gate() {
  const { user } = useAuth();
  if (user === undefined) return <div style={{ padding: 40 }}><Loading /></div>;
  if (user === null) return <Login />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Overview />} />
        <Route path="whatsapp" element={<WhatsApp />} />
        <Route path="conversations" element={<ConversationList />} />
        <Route path="conversations/:id" element={<ConversationDetail />} />
        <Route path="requests" element={<Requests />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider><Gate /></AuthProvider>
    </BrowserRouter>
  );
}
