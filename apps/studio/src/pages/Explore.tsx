import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type GameInfo } from '../api/client';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/primitives';
import { SiteNav, timeAgo } from './SiteNav';

const SORTS = [
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'Newest' },
  { id: 'liked', label: 'Most liked' },
];

export function GameCard({ g }: { g: GameInfo }) {
  return (
    <Link to={`/play/${g.slug}`} className="card">
      <div className="card-thumb" style={g.thumbnail ? { backgroundImage: `url(${g.thumbnail})` } : { background: 'linear-gradient(135deg, #7c5cff, #22d3ee)' }}>
        {!g.thumbnail && <Icon name="Gamepad2" size={32} />}
      </div>
      <div className="card-body">
        <div className="card-title truncate">{g.title}</div>
        <div className="card-meta">
          <span className="truncate">by {g.author}</span>
          <span className="spacer" />
          <span className="row" style={{ gap: 3 }}><Icon name="Play" size={12} /> {g.plays}</span>
          <span className="row" style={{ gap: 3 }}><Icon name="Heart" size={12} /> {g.likes}</span>
        </div>
        <div className="row" style={{ gap: 4, marginTop: 2 }}>
          <span className="badge">{g.mode.toUpperCase()}</span>
          {g.multiplayer && <span className="badge accent"><Icon name="Users" size={11} /> Online</span>}
          <span className="faint" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{timeAgo(g.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function ExplorePage() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');
  const [mode, setMode] = useState<'' | '2d' | '3d'>('');
  const [multiplayer, setMultiplayer] = useState(false);
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .games({ q, sort, mode, multiplayer })
        .then((r) => {
          setGames(r.games);
          setError('');
        })
        .catch((err) => setError((err as Error).message));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, sort, mode, multiplayer]);

  return (
    <div className="site">
      <SiteNav />
      <main className="page">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 28 }}>Play games</h1>
          <span className="spacer" />
          <div style={{ position: 'relative', width: 'min(360px, 100%)' }}>
            <input className="input lg" placeholder="Search games or creators…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search games" />
          </div>
        </div>
        <div className="row" style={{ margin: '16px 0', flexWrap: 'wrap' }}>
          {SORTS.map((s) => (
            <button key={s.id} className={`btn sm ${sort === s.id ? 'active' : ''}`} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
          <span style={{ width: 12 }} />
          {(['', '2d', '3d'] as const).map((m) => (
            <button key={m || 'all'} className={`btn sm ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>{m ? m.toUpperCase() : 'All'}</button>
          ))}
          <button className={`btn sm ${multiplayer ? 'active' : ''}`} onClick={() => setMultiplayer(!multiplayer)}>
            <Icon name="Users" size={13} /> Multiplayer
          </button>
        </div>
        {error ? (
          <div className="empty">{error}</div>
        ) : games === null ? (
          <div className="empty"><Spinner /></div>
        ) : games.length === 0 ? (
          <div className="empty">
            No games found. <Link to="/">Be the first to make one!</Link>
          </div>
        ) : (
          <div className="grid">
            {games.map((g) => (
              <GameCard key={g.slug} g={g} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
