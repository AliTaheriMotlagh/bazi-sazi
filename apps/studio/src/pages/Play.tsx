import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, embedUrl, gameUrl, type GameInfo } from '../api/client';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/primitives';
import { SiteNav, timeAgo } from './SiteNav';

export function PlayPage() {
  const { slug = '' } = useParams();
  const [game, setGame] = useState<GameInfo | null>(null);
  const [error, setError] = useState('');
  const [room, setRoom] = useState('public');
  const [activeRoom, setActiveRoom] = useState('public');
  const frame = useRef<HTMLIFrameElement>(null);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    api
      .game(slug)
      .then((r) => setGame(r.game))
      .catch((err) => setError((err as Error).message));
  }, [slug, user]);

  const like = async () => {
    if (!user) return toast('Sign in to like games', 'info');
    const r = await api.like(slug);
    setGame((g) => (g ? { ...g, liked: r.liked, likes: r.likes } : g));
  };

  const share = async () => {
    const url = gameUrl(slug) + (activeRoom !== 'public' ? `?room=${activeRoom}` : '');
    try {
      if (navigator.share) await navigator.share({ title: game?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied!', 'success');
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="site">
      <SiteNav />
      <main className="page" style={{ paddingTop: 16 }}>
        {error ? (
          <div className="empty">
            {error} <Link to="/explore">Browse games</Link>
          </div>
        ) : !game ? (
          <div className="empty"><Spinner /></div>
        ) : (
          <>
            <div style={{ position: 'relative', aspectRatio: '16 / 9', maxHeight: '75vh', width: '100%', borderRadius: 16, overflow: 'hidden', background: '#000', border: '1px solid var(--border)' }}>
              {/* No allow-same-origin: the game runs in an opaque origin and can't touch the studio. */}
              <iframe
                ref={frame}
                key={activeRoom}
                title={game.title}
                src={embedUrl(slug, activeRoom)}
                sandbox="allow-scripts allow-pointer-lock allow-popups"
                allow="fullscreen; gamepad; xr-spatial-tracking; autoplay; accelerometer; gyroscope"
                style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
              />
            </div>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
              <div className="grow">
                <h1 style={{ fontSize: 24 }}>{game.title}</h1>
                <div className="card-meta" style={{ marginTop: 6 }}>
                  <span>by <b>{game.author}</b></span>
                  <span>{game.plays} plays</span>
                  <span>updated {timeAgo(game.updatedAt)}</span>
                  <span className="badge">{game.mode.toUpperCase()}</span>
                  {game.multiplayer && <span className="badge accent">Up to {game.maxPlayers} players</span>}
                </div>
              </div>
              <button className={`btn ${game.liked ? 'active' : ''}`} onClick={like}>
                <Icon name="Heart" size={15} /> {game.likes}
              </button>
              <button className="btn" onClick={share}>
                <Icon name="Share2" size={15} /> Share
              </button>
              <button className="btn" onClick={() => frame.current?.requestFullscreen?.()}>
                <Icon name="Maximize2" size={15} /> Fullscreen
              </button>
              <a className="btn primary" href={gameUrl(slug)} target="_blank" rel="noopener">
                <Icon name="ExternalLink" size={15} /> Open
              </a>
            </div>
            {game.multiplayer && (
              <div className="row" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'var(--bg-elev)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <Icon name="Users" />
                <span>Play with friends in a private room:</span>
                <input className="input" style={{ width: 160 }} value={room} onChange={(e) => setRoom(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} aria-label="Room code" />
                <button className="btn primary sm" onClick={() => setActiveRoom(room || 'public')}>Join room</button>
                <span className="faint">Current: {activeRoom}</span>
              </div>
            )}
            {game.description && <p className="muted" style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{game.description}</p>}
          </>
        )}
      </main>
    </div>
  );
}
