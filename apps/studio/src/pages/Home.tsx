import { TEMPLATES, type ProjectData, type Template } from '@bazi/engine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ProjectSummary } from '../api/client';
import { useAuth } from '../store/auth';
import { isNetworkError, localSummaries } from '../store/offline';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Spinner, useMenu } from '../ui/primitives';
import { AuthDialog, SiteNav, timeAgo } from './SiteNav';

const FEATURES = ['2D & 3D', 'Physics', 'Visual scripting', 'JS / TS code', 'AI assistant', 'Multiplayer', 'VR / WebXR', 'Phone & tablet', 'One-click publish'];

function downloadJson(project: ProjectData): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${project.name.replace(/[^\w-]+/g, '_')}.bazi.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function HomePage() {
  const navigate = useNavigate();
  const { user, ready, ensure } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useMenu();

  const refresh = useCallback(async () => {
    if (!useAuth.getState().user) return setProjects([]);
    try {
      setProjects((await api.projects()).projects);
    } catch (err) {
      // Server unreachable: show what is stored on this device so work can continue.
      if (isNetworkError(err)) {
        const local = await localSummaries();
        if (local.length) {
          toast('You are offline — showing projects stored on this device', 'info');
          return setProjects(local);
        }
      }
      toast((err as Error).message, 'error');
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, user, refresh]);

  const createFrom = async (data: ProjectData, key: string) => {
    setCreating(key);
    try {
      await ensure();
      const { id } = await api.createProject(data);
      navigate(`/edit/${id}`);
    } catch (err) {
      toast((err as Error).message, 'error');
      setCreating(null);
    }
  };

  const startTemplate = (t: Template) => void createFrom(t.build(), t.id);

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as ProjectData;
      if (data.format !== 'bazi-sazi') throw new Error('This is not a Bazi-Sazi project file.');
      await createFrom(data, 'import');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const projectMenu = (e: React.MouseEvent, p: ProjectSummary) => {
    e.preventDefault();
    e.stopPropagation();
    menu.open(e.currentTarget.getBoundingClientRect(), [
      { label: 'Open', icon: 'FolderOpen', onSelect: () => navigate(`/edit/${p.id}`) },
      ...(p.publishedSlug ? [{ label: 'Play published game', icon: 'Play', onSelect: () => navigate(`/play/${p.publishedSlug}`) }] : []),
      {
        label: 'Duplicate',
        icon: 'Copy',
        onSelect: async () => {
          const { data } = await api.project(p.id);
          await createFrom({ ...data, name: `${data.name} copy` }, 'dup');
        },
      },
      { label: 'Export file', icon: 'Download', onSelect: async () => downloadJson((await api.project(p.id)).data) },
      { separator: true },
      {
        label: 'Delete',
        icon: 'Trash',
        danger: true,
        onSelect: async () => {
          if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
          await api.deleteProject(p.id);
          toast('Project deleted');
          void refresh();
        },
      },
    ]);
  };

  return (
    <div className="site">
      <SiteNav />
      <main className="page">
        <section className="hero">
          <h1>
            Make <em>any game</em> right in your browser — then share it with one link.
          </h1>
          <p>Drag, drop and click to build 2D, 3D, VR and multiplayer games. No install, no experience needed — and full code + AI power when you want it.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary lg" onClick={() => document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth' })}>
              <Icon name="Plus" /> New game
            </button>
            <Link className="btn lg" to="/explore">
              <Icon name="Gamepad2" /> Play games
            </Link>
          </div>
          <div className="feature-pills">
            {FEATURES.map((f) => (
              <span key={f} className="badge">{f}</span>
            ))}
          </div>
        </section>

        {user?.guest && (
          <div className="row" style={{ marginTop: 16, padding: '10px 14px', borderRadius: 12, background: 'var(--accent-soft)' }}>
            <Icon name="Info" />
            <span className="grow">You are using a guest account. Save it with a username so you never lose your games.</span>
            <button className="btn primary sm" onClick={() => setUpgrade(true)}>Save account</button>
          </div>
        )}

        <div className="section-head" id="templates">
          <h2>Start from a template</h2>
          <span className="spacer" />
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="Upload" size={15} /> Import file
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </div>
        <div className="grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="card" onClick={() => startTemplate(t)} disabled={!!creating}>
              {/* Screenshot from public/templates (captured in play mode); the gradient shows while it loads. */}
              <div className="card-thumb" style={{ backgroundImage: `url(/templates/${t.id}.jpg), linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }}>
                {creating === t.id && <Spinner size={28} />}
              </div>
              <div className="card-body">
                <div className="card-title">{t.name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{t.description}</div>
                <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {t.tags.map((tag) => (
                    <span key={tag} className="badge">{tag}</span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="section-head">
          <h2>My projects</h2>
        </div>
        {projects === null ? (
          <div className="empty"><Spinner /></div>
        ) : projects.length === 0 ? (
          <div className="empty">No projects yet — pick a template above to start your first game.</div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} to={`/edit/${p.id}`} className="card" onContextMenu={(e) => projectMenu(e, p)}>
                <div className="card-thumb" style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : { background: 'linear-gradient(135deg, var(--surface), var(--surface-hover))' }}>
                  {!p.thumbnail && <Icon name={p.mode === '2d' ? 'Gamepad2' : 'Box'} size={30} />}
                </div>
                <div className="card-body">
                  <div className="card-title truncate">{p.name}</div>
                  <div className="card-meta">
                    <span className="badge">{p.mode.toUpperCase()}</span>
                    <span>{timeAgo(p.updatedAt)}</span>
                    {p.publishedSlug && <span className="badge accent"><Icon name="Globe" size={11} /> Live</span>}
                  </div>
                </div>
                <div className="card-actions">
                  <button className="btn sm icon" onClick={(e) => projectMenu(e, p)} aria-label="Project actions">
                    <Icon name="EllipsisVertical" size={15} />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      {menu.element}
      {upgrade && <AuthDialog mode="upgrade" onClose={() => setUpgrade(false)} />}
    </div>
  );
}
