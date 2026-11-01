import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { toast, useUi } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Modal, useMenu } from '../ui/primitives';

export function AuthDialog({ mode: initial, onClose }: { mode: 'login' | 'register' | 'upgrade'; onClose(): void }) {
  const [mode, setMode] = useState(initial);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const auth = useAuth();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await auth.login(username, password);
      else if (mode === 'register') await auth.register(username, password);
      else await auth.upgrade(username, password);
      toast(mode === 'login' ? 'Welcome back!' : 'Account ready — your work is saved.', 'success');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const title = mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Save your guest account';
  return (
    <Modal title={title} onClose={onClose} icon="User">
      <form className="col" onSubmit={submit} style={{ gap: 12 }}>
        {mode === 'upgrade' && <p className="muted" style={{ margin: 0 }}>Pick a username and password to keep all your projects and published games.</p>}
        <label>
          <span className="field-label">Username</span>
          <input className="input lg" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Password</span>
          <input className="input lg" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="badge error" style={{ padding: '6px 10px' }}>{error}</div>}
        <button className="btn primary lg" disabled={busy || !username || !password}>
          {busy ? 'Please wait…' : title}
        </button>
        {mode !== 'upgrade' && (
          <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <a href="#" onClick={(e) => (e.preventDefault(), setMode(mode === 'login' ? 'register' : 'login'))}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </a>
          </p>
        )}
      </form>
    </Modal>
  );
}

export function SiteNav() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { theme, setTheme } = useUi();
  const [dialog, setDialog] = useState<null | 'login' | 'register' | 'upgrade'>(null);
  const menu = useMenu();
  return (
    <nav className="site-nav">
      <Link to="/" className="logo">
        <img src="/favicon.svg" alt="" />
        Bazi-Sazi
      </Link>
      <div className="nav-links">
        <NavLink to="/" end>Create</NavLink>
        <NavLink to="/explore">Play games</NavLink>
        <NavLink to="/learn">Learn</NavLink>
      </div>
      <div className="spacer" />
      <button className="btn ghost icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
        <Icon name={theme === 'dark' ? 'SunMedium' : 'Moon'} />
      </button>
      {user ? (
        <button
          className="btn"
          onClick={(e) =>
            menu.open(e.currentTarget.getBoundingClientRect(), [
              { heading: user.guest ? 'Guest account' : `Signed in as ${user.username}` },
              ...(user.guest ? [{ label: 'Save account…', icon: 'Save', onSelect: () => setDialog('upgrade') }] : []),
              { label: 'Sign out', icon: 'LogOut', onSelect: logout },
            ])
          }
        >
          <Icon name="User" size={15} />
          <span className="truncate" style={{ maxWidth: 120 }}>{user.username}</span>
        </button>
      ) : (
        <button className="btn primary" onClick={() => setDialog('login')}>Sign in</button>
      )}
      {menu.element}
      {dialog && <AuthDialog mode={dialog} onClose={() => setDialog(null)} />}
    </nav>
  );
}

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString();
}
