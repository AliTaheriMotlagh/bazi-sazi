import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { deleteEntities, duplicateEntities } from '../store/commands';
import { useConsole } from '../store/console';
import { editor, useEditor, type BottomTab, type RightTab } from '../store/editor';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/primitives';
import { AiPanel } from './ai/AiPanel';
import { AssetsPanel } from './panels/AssetsPanel';
import { ConsolePanel, ProblemsPanel, ProfilerPanel, useProblems } from './panels/DebugPanels';
import { Hierarchy } from './panels/Hierarchy';
import { Inspector } from './panels/Inspector';
import { SettingsPanel } from './panels/SettingsPanel';
import { PublishDialog } from './PublishDialog';
import { useSession, viewportBridge } from './session';
import { togglePlay, Toolbar } from './Toolbar';
import { GameView } from './viewport/GameView';
import { SceneView } from './viewport/SceneView';

// Heavy editors load on demand.
const ScriptEditor = lazy(() => import('./panels/ScriptEditor'));
const LogicEditor = lazy(() => import('./panels/LogicEditor'));

const AUTOSAVE_MS = 1500;
const THUMBNAIL_EVERY_MS = 60_000;

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Drag handle that writes a CSS variable on the editor root and remembers it. */
function Splitter({ cssVar, axis, invert, min, max, rootRef }: { cssVar: string; axis: 'x' | 'y'; invert?: boolean; min: number; max: number; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const [dragging, setDragging] = useState(false);
  const onDown = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    setDragging(true);
    const start = axis === 'x' ? e.clientX : e.clientY;
    const prev = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
    const target = invert ? next : prev;
    const initial = target ? (axis === 'x' ? target.getBoundingClientRect().width : target.getBoundingClientRect().height) : 300;
    const move = (ev: PointerEvent) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      const size = Math.min(max, Math.max(min, initial + (invert ? -delta : delta)));
      root.style.setProperty(cssVar, `${size}px`);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(`bz.layout${cssVar}`, root.style.getPropertyValue(cssVar));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className={`splitter ${axis === 'y' ? 'h' : ''} ${dragging ? 'dragging' : ''}`} onPointerDown={onDown} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} />;
}

function BottomPanel({ onToggleMax, maximized }: { onToggleMax(): void; maximized: boolean }) {
  const tab = useEditor((s) => s.bottomTab);
  const errors = useConsole((s) => s.errors);
  const problems = useProblems();
  const problemErrors = problems.filter((p) => p.severity === 'error').length;
  const tabs: [BottomTab, string, string, React.ReactNode?][] = [
    ['console', 'Console', 'Terminal', errors > 0 && <span className="count error">{errors}</span>],
    ['problems', 'Problems', 'TriangleAlert', problems.length > 0 && <span className={`count ${problemErrors ? 'error' : ''}`}>{problems.length}</span>],
    ['code', 'Code', 'Code'],
    ['logic', 'Visual Logic', 'Workflow'],
    ['profiler', 'Profiler', 'Gauge'],
  ];
  return (
    <div className="panel">
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, icon, extra]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => editor().set({ bottomTab: id })} role="tab" aria-selected={tab === id}>
            <Icon name={icon} size={13} /> {label} {extra}
          </button>
        ))}
        <span className="spacer" />
        <button className="btn sm ghost icon hide-phone" onClick={onToggleMax} title={maximized ? 'Restore' : 'Maximize'} aria-label="Maximize panel">
          <Icon name={maximized ? 'Minimize2' : 'Maximize2'} size={14} />
        </button>
      </div>
      <div className="panel-body" style={{ overflow: tab === 'code' || tab === 'logic' ? 'hidden' : 'auto' }}>
        <Suspense fallback={<div className="empty"><Spinner /></div>}>
          {tab === 'console' && <ConsolePanel />}
          {tab === 'problems' && <ProblemsPanel />}
          {tab === 'code' && <ScriptEditor />}
          {tab === 'logic' && <LogicEditor />}
          {tab === 'profiler' && <ProfilerPanel />}
        </Suspense>
      </div>
    </div>
  );
}

function RightPanel() {
  const tab = useEditor((s) => s.rightTab);
  const tabs: [RightTab, string, string][] = [
    ['inspector', 'Inspector', 'SlidersHorizontal'],
    ['settings', 'Project', 'Settings'],
    ['ai', 'AI Assistant', 'Bot'],
  ];
  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, icon]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => editor().set({ rightTab: id })} role="tab" aria-selected={tab === id}>
            <Icon name={icon} size={13} /> {label}
          </button>
        ))}
      </div>
      <div className="panel-body" style={{ overflow: tab === 'ai' ? 'hidden' : 'auto' }}>
        {tab === 'inspector' && <Inspector />}
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'ai' && <AiPanel />}
      </div>
    </div>
  );
}

type PhoneView = 'scene' | 'objects' | 'inspect' | 'logic' | 'ai';

export default function EditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const project = useEditor((s) => s.project);
  const loadedId = useEditor((s) => s.projectId);
  const playState = useEditor((s) => s.playState);
  const [published, setPublished] = useState<{ slug: string; title: string; description: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [phoneView, setPhoneView] = useState<PhoneView>('scene');
  const isTablet = useMedia('(max-width: 1100px)');
  const isPhone = useMedia('(max-width: 720px)');
  const root = useRef<HTMLDivElement>(null);
  const lastThumb = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);

  // ── load
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await useAuth.getState().ensure();
        const rec = await api.project(id);
        if (cancelled) return;
        editor().open(rec.id, rec.data);
        setPublished(rec.game ? { slug: rec.game.slug, title: rec.game.title, description: rec.game.description } : null);
        document.title = `${rec.data.name} — Bazi-Sazi`;
      } catch (err) {
        toast((err as Error).message, 'error');
        navigate('/');
      }
    })();
    return () => {
      cancelled = true;
      editor().close();
      document.title = 'Bazi-Sazi Game Studio';
    };
  }, [id, navigate]);

  // ── restore panel sizes
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    for (const v of ['--left-w', '--right-w', '--bottom-h', '--assets-h']) {
      try {
        const saved = localStorage.getItem(`bz.layout${v}`);
        if (saved) el.style.setProperty(v, saved);
      } catch {
        /* ignore */
      }
    }
  }, [loadedId]);

  // ── save (single-flight, re-runs if edits arrived during the request)
  const save = useCallback(async (withThumbnail = false): Promise<boolean> => {
    if (saving.current) await saving.current;
    const { project: data, projectId } = editor();
    if (!data || !projectId) return false;
    const revision = editor().revision;
    const wantThumb = withThumbnail || Date.now() - lastThumb.current > THUMBNAIL_EVERY_MS;
    const thumbnail = wantThumb ? viewportBridge.capture() : null;
    if (thumbnail) lastThumb.current = Date.now();
    editor().set({ saveState: 'saving' });
    saving.current = api
      .saveProject(projectId, data, thumbnail)
      .then(() => {
        editor().set({ saveState: editor().revision === revision ? 'saved' : 'unsaved' });
        return true;
      })
      .catch((err) => {
        editor().set({ saveState: 'error' });
        toast(`Save failed: ${(err as Error).message}`, 'error');
        return false;
      })
      .finally(() => (saving.current = null));
    return saving.current;
  }, []);

  // ── autosave
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.revision === prev.revision || !s.projectId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void save(), AUTOSAVE_MS);
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (editor().saveState !== 'saved') e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeunload', beforeUnload);
      if (editor().saveState === 'unsaved') void save();
    };
  }, [save]);

  // ── pause the edit viewport while playing (saves GPU/battery)
  const editRuntime = useSession((s) => s.editRuntime);
  useEffect(() => {
    if (!editRuntime) return;
    if (playState === 'edit') editRuntime.start();
    else editRuntime.stop();
  }, [playState, editRuntime]);

  // ── keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest('.monaco-editor');
      const mod = e.ctrlKey || e.metaKey;
      const ed = editor();
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        return togglePlay();
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(true).then((ok) => ok && toast('Saved', 'success'));
        return;
      }
      if (typing || ed.playState !== 'edit') return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        ed.redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateEntities(ed.selection);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.selection.length) {
        e.preventDefault();
        deleteEntities(ed.selection);
      } else if (!mod && e.key === 'w') ed.set({ tool: 'translate' });
      else if (!mod && e.key === 'e') ed.set({ tool: 'rotate' });
      else if (!mod && e.key === 'r') ed.set({ tool: 'scale' });
      else if (!mod && e.key === 'f') viewportBridge.focusSelection();
      else if (e.key === 'Escape') ed.select([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Phone: selecting something jumps to the inspector.
  const selection = useEditor((s) => s.selection);
  useEffect(() => {
    if (isPhone && selection.length && phoneView === 'objects') setPhoneView('inspect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  if (!project || loadedId !== id)
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }} className="muted">
        <div className="row"><Spinner /> Opening project…</div>
      </div>
    );

  const showLeft = isPhone ? phoneView === 'objects' : !isTablet || leftOpen;
  const showRight = isPhone ? phoneView === 'inspect' || phoneView === 'ai' : !isTablet || rightOpen;
  const phoneBottom = isPhone && phoneView === 'logic';

  const setPhone = (v: PhoneView) => {
    setPhoneView(v);
    if (v === 'ai') editor().set({ rightTab: 'ai' });
    if (v === 'inspect') editor().set({ rightTab: 'inspector' });
    if (v === 'logic' && !['code', 'logic', 'console', 'problems'].includes(editor().bottomTab)) editor().set({ bottomTab: 'logic' });
  };

  const left = (
    <div className={`left-stack ${isTablet ? `drawer ${showLeft ? 'open' : ''}` : ''}`} style={{ background: 'var(--panel)' }}>
      <Hierarchy />
      <Splitter cssVar="--assets-h" axis="y" invert min={120} max={700} rootRef={root} />
      <AssetsPanel />
    </div>
  );
  const right = (
    <div className={isTablet ? `drawer right ${showRight ? 'open' : ''}` : ''} style={{ minHeight: 0, background: 'var(--panel)' }}>
      <RightPanel />
    </div>
  );

  return (
    <div className="editor" ref={root}>
      <Toolbar
        onSave={() => void save(true).then((ok) => ok && toast('Saved', 'success'))}
        onPublish={() => setPublishOpen(true)}
        onToggleLeft={() => {
          setLeftOpen(!leftOpen);
          setRightOpen(false);
        }}
        onToggleRight={() => {
          setRightOpen(!rightOpen);
          setLeftOpen(false);
        }}
        published={!!published}
      />
      <div className="workspace" style={{ position: isTablet ? 'relative' : undefined }}>
        {left}
        {!isTablet && <Splitter cssVar="--left-w" axis="x" min={200} max={520} rootRef={root} />}
        <div className={`center ${maximized ? 'maximized' : ''} ${phoneBottom ? 'phone-bottom' : ''}`}>
          <div style={{ position: 'relative', minHeight: 0, display: 'grid' }}>
            <SceneView />
            {playState !== 'edit' && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', zIndex: 10 }}>
                <GameView />
              </div>
            )}
          </div>
          <Splitter cssVar="--bottom-h" axis="y" invert min={34} max={900} rootRef={root} />
          <BottomPanel maximized={maximized} onToggleMax={() => setMaximized(!maximized)} />
        </div>
        {!isTablet && <Splitter cssVar="--right-w" axis="x" invert min={260} max={640} rootRef={root} />}
        {right}
      </div>
      {isPhone && (
        <nav className="mobile-tabs" aria-label="Editor sections">
          {(
            [
              ['scene', 'Scene', 'Box'],
              ['objects', 'Objects', 'Layers'],
              ['inspect', 'Inspect', 'SlidersHorizontal'],
              ['logic', 'Logic', 'Workflow'],
              ['ai', 'AI', 'Bot'],
            ] as [PhoneView, string, string][]
          ).map(([v, label, icon]) => (
            <button key={v} className={phoneView === v ? 'active' : ''} onClick={() => setPhone(v)}>
              <Icon name={icon} size={19} />
              {label}
            </button>
          ))}
        </nav>
      )}
      {isTablet && !isPhone && (leftOpen || rightOpen) && (
        <div
          style={{ position: 'fixed', inset: 'var(--toolbar-h) 0 0 0', zIndex: 30, background: 'rgba(0,0,0,.25)' }}
          onClick={() => {
            setLeftOpen(false);
            setRightOpen(false);
          }}
        />
      )}
      {publishOpen && <PublishDialog published={published} onPublished={setPublished} onClose={() => setPublishOpen(false)} save={() => save(true)} />}
    </div>
  );
}
