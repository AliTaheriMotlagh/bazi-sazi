import { normalizeProject } from '@bazi/engine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useConsole } from '../store/console';
import { editor, useEditor, type BottomTab, type RightTab } from '../store/editor';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/primitives';
import { actionForKey } from './actions';
import { AiPanel } from './ai/AiPanel';
import { CommandPalette } from './CommandPalette';
import { DocumentArea } from './DocumentArea';
import { ShortcutsDialog, Tutorial, WelcomeDialog } from './Help';
import { MenuBar } from './MenuBar';
import { ContentBrowser } from './panels/ContentBrowser';
import { ConsolePanel, ProblemsPanel, ProfilerPanel, useProblems } from './panels/DebugPanels';
import { Hierarchy } from './panels/Hierarchy';
import { Inspector } from './panels/Inspector';
import { SettingsPanel } from './panels/SettingsPanel';
import { PlacePanel } from './PlacePanel';
import { PublishDialog } from './PublishDialog';
import { editorHost, useSession, viewportBridge } from './session';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

const AUTOSAVE_MS = 1500;
const THUMBNAIL_EVERY_MS = 60_000;
const LAYOUT_VARS = ['--left-w', '--right-w', '--bottom-h', '--outliner-h'];

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

/** Drag handle that resizes a neighbouring panel through a CSS variable (remembered per browser). */
function Splitter({ cssVar, axis, invert, min, max, rootRef }: { cssVar: string; axis: 'x' | 'y'; invert?: boolean; min: number; max: number; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const [dragging, setDragging] = useState(false);
  const onDown = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    setDragging(true);
    const start = axis === 'x' ? e.clientX : e.clientY;
    const el = e.currentTarget as HTMLElement;
    const target = (invert ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
    const initial = target ? (axis === 'x' ? target.getBoundingClientRect().width : target.getBoundingClientRect().height) : 300;
    const move = (ev: PointerEvent) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      root.style.setProperty(cssVar, `${Math.min(max, Math.max(min, initial + (invert ? -delta : delta)))}px`);
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

/** Bottom drawer: Content Browser, Output Log, Message Log, Profiler. */
function BottomDrawer() {
  const tab = useEditor((s) => s.bottomTab);
  const errors = useConsole((s) => s.errors);
  const problems = useProblems();
  const problemErrors = problems.filter((p) => p.severity === 'error').length;
  const tabs: [BottomTab, string, string, React.ReactNode?][] = [
    ['content', 'Content Browser', 'FolderTree'],
    ['console', 'Output Log', 'Terminal', errors > 0 && <span className="count error">{errors}</span>],
    ['problems', 'Message Log', 'TriangleAlert', problems.length > 0 && <span className={`count ${problemErrors ? 'error' : ''}`}>{problems.length}</span>],
    ['profiler', 'Profiler', 'Gauge'],
  ];
  return (
    <div className="panel drawer-panel">
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, icon, extra]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => editor().set({ bottomTab: id })} role="tab" aria-selected={tab === id}>
            <Icon name={icon} size={13} /> {label} {extra}
          </button>
        ))}
        <span className="spacer" />
        <button className="btn sm ghost icon" onClick={() => editor().toggleLayout('drawer', false)} title="Hide drawer (Ctrl+B)" aria-label="Hide drawer">
          <Icon name="ChevronDown" size={14} />
        </button>
      </div>
      <div className="panel-body" style={{ overflow: tab === 'content' ? 'hidden' : 'auto' }}>
        {tab === 'content' && <ContentBrowser />}
        {tab === 'console' && <ConsolePanel />}
        {tab === 'problems' && <ProblemsPanel />}
        {tab === 'profiler' && <ProfilerPanel />}
      </div>
    </div>
  );
}

/** Right column bottom: Details / World Settings / AI. */
function DetailsPanel() {
  const tab = useEditor((s) => s.rightTab);
  const tabs: [RightTab, string, string][] = [
    ['inspector', 'Details', 'SlidersHorizontal'],
    ['settings', 'World Settings', 'Mountain'],
    ['ai', 'AI', 'Sparkles'],
  ];
  return (
    <div className="panel details" style={{ height: '100%' }}>
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

type PhoneView = 'scene' | 'objects' | 'details' | 'content' | 'ai';

export default function EditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const project = useEditor((s) => s.project);
  const loadedId = useEditor((s) => s.projectId);
  const playState = useEditor((s) => s.playState);
  const layout = useEditor((s) => s.layout);
  const [published, setPublished] = useState<{ slug: string; title: string; description: string } | null>(null);
  const [dialog, setDialog] = useState<null | 'publish' | 'shortcuts' | 'welcome'>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [phoneView, setPhoneView] = useState<PhoneView>('scene');
  const isTablet = useMedia('(max-width: 1100px)');
  const isPhone = useMedia('(max-width: 720px)');
  const root = useRef<HTMLDivElement>(null);
  const lastThumb = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);

  // ── load (projects from any version are migrated on open)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await useAuth.getState().ensure();
        const rec = await api.project(id);
        if (cancelled) return;
        editor().open(rec.id, normalizeProject(rec.data));
        setPublished(rec.game ? { slug: rec.game.slug, title: rec.game.title, description: rec.game.description } : null);
        document.title = `${rec.data.name} — Bazi-Sazi`;
        try {
          if (!localStorage.getItem('bz.welcomed')) {
            localStorage.setItem('bz.welcomed', '1');
            setDialog('welcome');
          }
        } catch {
          /* ignore */
        }
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
    for (const v of LAYOUT_VARS) {
      try {
        const saved = localStorage.getItem(`bz.layout${v}`);
        if (saved) el.style.setProperty(v, saved);
      } catch {
        /* ignore */
      }
    }
  }, [loadedId]);

  // ── save (single-flight; marks "unsaved" again if edits arrived during the request)
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

  // ── host callbacks used by actions
  useEffect(() => {
    editorHost.save = save;
    editorHost.openPublish = () => setDialog('publish');
    editorHost.openShortcuts = () => setDialog('shortcuts');
    editorHost.openWelcome = () => setDialog('welcome');
  }, [save]);

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

  // ── keyboard shortcuts come from the action registry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewportBridge.flying) return;
      const action = actionForKey(e);
      if (!action) return;
      e.preventDefault();
      action.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Phone: selecting something jumps to the details.
  const selection = useEditor((s) => s.selection);
  useEffect(() => {
    if (isPhone && selection.length && phoneView === 'objects') setPhoneView('details');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  if (!project || loadedId !== id)
    return (
      <div className="loading-screen">
        <img src="/favicon.svg" alt="" />
        <div className="row muted"><Spinner /> Opening project…</div>
      </div>
    );

  const showPlace = isPhone ? phoneView === 'objects' : isTablet ? leftOpen : layout.place;
  const showRight = isPhone ? phoneView === 'details' || phoneView === 'ai' : isTablet ? rightOpen : layout.outliner || layout.details;
  const showDrawer = isPhone ? phoneView === 'content' : layout.drawer;
  const setPhone = (v: PhoneView) => {
    setPhoneView(v);
    if (v === 'ai') editor().set({ rightTab: 'ai' });
    if (v === 'details') editor().set({ rightTab: 'inspector' });
    if (v === 'content') editor().set({ bottomTab: 'content' });
  };
  const cols = isTablet ? '1fr' : [layout.place ? 'var(--left-w, 250px) 4px' : '', '1fr', showRight ? '4px var(--right-w, 340px)' : ''].filter(Boolean).join(' ');

  const left = (
    <div className={isTablet ? `drawer ${showPlace ? 'open' : ''}` : ''} style={{ minHeight: 0, display: !isTablet && !showPlace ? 'none' : undefined }}>
      {isPhone ? (
        <div className="phone-objects">
          <Hierarchy />
          <PlacePanel />
        </div>
      ) : (
        <PlacePanel />
      )}
    </div>
  );
  const right = (
    <div className={`right-col ${isTablet ? `drawer right ${showRight ? 'open' : ''}` : ''}`} style={{ display: !isTablet && !showRight ? 'none' : undefined, gridTemplateRows: layout.outliner && layout.details && !isPhone ? 'var(--outliner-h, 38%) 4px 1fr' : '1fr' }}>
      {layout.outliner && !isPhone && <Hierarchy />}
      {layout.outliner && layout.details && !isPhone && <Splitter cssVar="--outliner-h" axis="y" min={120} max={900} rootRef={root} />}
      {(layout.details || isPhone) && <DetailsPanel />}
    </div>
  );

  return (
    <div className="editor" ref={root}>
      <MenuBar published={!!published} />
      <Toolbar
        published={!!published}
        onToggleLeft={() => (setLeftOpen(!leftOpen), setRightOpen(false))}
        onToggleRight={() => (setRightOpen(!rightOpen), setLeftOpen(false))}
      />
      <div className="workspace" style={{ gridTemplateColumns: cols, position: isTablet ? 'relative' : undefined }}>
        {left}
        {!isTablet && layout.place && <Splitter cssVar="--left-w" axis="x" min={180} max={480} rootRef={root} />}
        <div className="center" style={{ gridTemplateRows: isPhone ? (phoneView === 'content' ? '0 0 1fr' : '1fr 0 0') : showDrawer ? '1fr 4px var(--bottom-h, 270px)' : '1fr 0 0' }}>
          <DocumentArea />
          {showDrawer && !isPhone ? <Splitter cssVar="--bottom-h" axis="y" invert min={120} max={900} rootRef={root} /> : <div />}
          {showDrawer ? <BottomDrawer /> : <div />}
        </div>
        {!isTablet && showRight && <Splitter cssVar="--right-w" axis="x" invert min={260} max={680} rootRef={root} />}
        {right}
      </div>
      {!isPhone && <StatusBar />}
      {isPhone && (
        <nav className="mobile-tabs" aria-label="Editor sections">
          {(
            [
              ['scene', 'Scene', 'Box'],
              ['objects', 'Objects', 'ListTree'],
              ['details', 'Details', 'SlidersHorizontal'],
              ['content', 'Content', 'FolderTree'],
              ['ai', 'AI', 'Sparkles'],
            ] as [PhoneView, string, string][]
          ).map(([v, label, icon]) => (
            <button key={v} className={phoneView === v ? 'active' : ''} onClick={() => setPhone(v)}>
              <Icon name={icon} size={19} />
              {label}
            </button>
          ))}
        </nav>
      )}
      {isTablet && !isPhone && (leftOpen || rightOpen) && <div className="drawer-scrim" onClick={() => (setLeftOpen(false), setRightOpen(false))} />}
      {!layout.drawer && !isPhone && (
        <button className="drawer-tab" onClick={() => editor().toggleLayout('drawer', true)}>
          <Icon name="FolderTree" size={13} /> Content Drawer
        </button>
      )}
      <CommandPalette />
      <Tutorial published={!!published} />
      {dialog === 'publish' && <PublishDialog published={published} onPublished={setPublished} onClose={() => setDialog(null)} save={() => save(true)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'welcome' && <WelcomeDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
