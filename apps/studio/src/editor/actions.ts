import { PRESETS, createFromPreset, deleteEntities, duplicateEntities, addScene, currentScene, newGraph, newScript } from '../store/commands';
import { api } from '../api/client';
import type { NativeTarget } from '../export/native';
import { editor, type ViewportOptions } from '../store/editor';
import { toast, useUi } from '../store/ui';
import { editorHost, session, useSession, viewportBridge } from './session';

export type ActionGroup = 'File' | 'Edit' | 'Create' | 'View' | 'Window' | 'Build' | 'Help';

/**
 * One editor command. Menus, the toolbar, keyboard shortcuts and the command
 * palette are all generated from this list (single source of truth).
 */
export interface EditorAction {
  id: string;
  label: string;
  group: ActionGroup;
  icon?: string;
  /** Display + matching, e.g. "Mod+Shift+Z". Mod = Ctrl (Cmd on macOS). */
  keys?: string[];
  run(): void;
  enabled?(): boolean;
  checked?(): boolean;
  /** Allowed while the game is running. */
  inPlay?: boolean;
  /** Fires even while typing in a text field. */
  inInputs?: boolean;
  /** Hide from menus (palette/shortcut only). */
  hidden?: boolean;
}

const hasSelection = () => editor().selection.length > 0;
const editing = () => editor().playState === 'edit';
const setView = (patch: Partial<ViewportOptions>) => editor().setViewport(patch);

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadBlob(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Build a standalone game (lazy-loaded) and download it. */
async function exportGame(kind: 'html' | 'zip' | NativeTarget): Promise<void> {
  const project = editor().project;
  if (!project) return;
  const { exportHtml, exportZip } = await import('../export/exportGame');
  toast('Preparing export…', 'info');
  try {
    const { blob, name, skipped } = kind === 'html' ? await exportHtml(project, () => undefined) : await exportZip(project, () => undefined, kind === 'zip' ? undefined : kind);
    downloadBlob(name, blob);
    toast(skipped.length ? `Exported ${name} (${skipped.length} asset${skipped.length > 1 ? 's' : ''} could not be included: ${skipped.slice(0, 3).join(', ')})` : `Exported ${name} (${(blob.size / 1048576).toFixed(1)} MB)`, skipped.length ? 'info' : 'success');
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

export const ACTIONS: EditorAction[] = [
  // ── File
  { id: 'file.home', label: 'All projects', group: 'File', icon: 'House', run: () => (window.location.href = '/') },
  { id: 'file.save', label: 'Save', group: 'File', icon: 'Save', keys: ['Mod+S'], inPlay: true, inInputs: true, run: () => void editorHost.save(true).then((ok) => ok && toast('Saved', 'success')) },
  { id: 'file.import', label: 'Import files…', group: 'File', icon: 'Upload', keys: ['Mod+I'], run: () => editorHost.uploadFiles() },
  {
    id: 'file.export',
    label: 'Export project (.json)',
    group: 'File',
    icon: 'Download',
    run: () => {
      const p = editor().project!;
      download(`${p.name.replace(/[^\w-]+/g, '_')}.bazi.json`, JSON.stringify(p, null, 2));
    },
  },
  { id: 'file.export.html', label: 'Export game: single HTML file', group: 'File', icon: 'Download', run: () => void exportGame('html') },
  { id: 'file.export.zip', label: 'Export game: ZIP for web hosting', group: 'File', icon: 'Archive', run: () => void exportGame('zip') },
  { id: 'file.export.electron', label: 'Export app: desktop (Electron)', group: 'File', icon: 'Monitor', run: () => void exportGame('electron') },
  { id: 'file.export.tauri', label: 'Export app: desktop (Tauri)', group: 'File', icon: 'Monitor', run: () => void exportGame('tauri') },
  { id: 'file.export.capacitor', label: 'Export app: Android / iOS (Capacitor)', group: 'File', icon: 'Smartphone', run: () => void exportGame('capacitor') },
  {
    id: 'file.collab',
    label: 'Live collaboration: start / stop',
    group: 'File',
    icon: 'Users',
    run: () =>
      void import('../collab/connect').then(({ startCollab, stopCollab, useCollab }) => {
        if (useCollab.getState().status === 'off') {
          startCollab();
          toast('Connecting to live collaboration…', 'info');
        } else stopCollab();
      }),
  },
  {
    id: 'file.collab.invite',
    label: 'Invite a collaborator…',
    group: 'File',
    icon: 'Users',
    run: () => {
      const projectId = editor().projectId;
      const username = projectId ? window.prompt('Username of the person to invite (they need an account):') : null;
      if (!projectId || !username) return;
      void api.addCollaborator(projectId, username.trim()).then(
        () => toast(`${username} can now edit this project. Both of you choose "Live collaboration".`, 'success'),
        (err: Error) => toast(err.message, 'error'),
      );
    },
  },
  { id: 'file.history', label: 'Version history…', group: 'File', icon: 'Clock', run: () => editorHost.openHistory() },
  { id: 'file.library', label: 'Prefab library…', group: 'File', icon: 'Package', run: () => editorHost.openLibrary() },
  { id: 'file.settings', label: 'Project settings', group: 'File', icon: 'Settings', run: () => editor().set({ rightTab: 'settings' }) },

  // ── Edit
  { id: 'edit.undo', label: 'Undo', group: 'Edit', icon: 'Undo2', keys: ['Mod+Z'], enabled: () => editor().past.length > 0, run: () => editor().undo() },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', icon: 'Redo2', keys: ['Mod+Shift+Z', 'Mod+Y'], enabled: () => editor().future.length > 0, run: () => editor().redo() },
  { id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', icon: 'Copy', keys: ['Mod+D'], enabled: hasSelection, run: () => void duplicateEntities(editor().selection) },
  { id: 'edit.delete', label: 'Delete', group: 'Edit', icon: 'Trash', keys: ['Delete', 'Backspace'], enabled: hasSelection, run: () => deleteEntities(editor().selection) },
  { id: 'edit.selectAll', label: 'Select all', group: 'Edit', icon: 'MousePointer2', keys: ['Mod+A'], run: () => editor().select(currentScene()?.entities.map((e) => e.id) ?? []) },
  { id: 'edit.deselect', label: 'Deselect', group: 'Edit', keys: ['Escape'], run: () => editor().select([]), hidden: true },
  { id: 'edit.focus', label: 'Focus selection', group: 'Edit', icon: 'ScanEye', keys: ['F'], enabled: hasSelection, run: () => viewportBridge.focusSelection() },
  { id: 'tool.move', label: 'Move tool', group: 'Edit', icon: 'Move3d', keys: ['W'], checked: () => editor().tool === 'translate', run: () => editor().set({ tool: 'translate' }) },
  { id: 'tool.rotate', label: 'Rotate tool', group: 'Edit', icon: 'Rotate3d', keys: ['E'], checked: () => editor().tool === 'rotate', run: () => editor().set({ tool: 'rotate' }) },
  { id: 'tool.scale', label: 'Scale tool', group: 'Edit', icon: 'Scale3d', keys: ['R'], checked: () => editor().tool === 'scale', run: () => editor().set({ tool: 'scale' }) },
  { id: 'tool.snap', label: 'Snap to grid', group: 'Edit', icon: 'Magnet', keys: ['G'], checked: () => editor().snap, run: () => editor().set({ snap: !editor().snap }) },

  // ── Create
  ...PRESETS.map<EditorAction>((p) => ({
    id: `create.${p.label}`,
    label: `${p.group} › ${p.label}`,
    group: 'Create',
    icon: p.icon,
    enabled: () => !p.modes || p.modes.includes(editor().project?.settings.mode ?? '3d'),
    run: () => void createFromPreset(p),
  })),
  { id: 'create.script', label: 'Script (code)', group: 'Create', icon: 'FileCode', run: () => void newScript('New Script', { attachTo: editor().selection[0] }) },
  { id: 'create.graph', label: 'Visual script (nodes)', group: 'Create', icon: 'Workflow', run: () => void newGraph('New Logic', editor().selection[0]) },
  { id: 'create.scene', label: 'Scene / level', group: 'Create', icon: 'Clapperboard', run: () => void addScene('Level') },

  // ── View (scene viewport)
  ...(['perspective', 'top', 'front', 'right'] as const).map<EditorAction>((v, i) => ({
    id: `view.${v}`,
    label: `${v[0].toUpperCase()}${v.slice(1)} view`,
    group: 'View',
    icon: v === 'perspective' ? 'Box' : 'Square',
    keys: [`Alt+${i + 1}`],
    checked: () => editor().viewport.view === v,
    run: () => setView({ view: v }),
  })),
  ...(['lit', 'clay', 'wireframe'] as const).map<EditorAction>((s, i) => ({
    id: `shading.${s}`,
    label: `${s === 'clay' ? 'Detail lighting (clay)' : s[0].toUpperCase() + s.slice(1)} shading`,
    group: 'View',
    icon: s === 'lit' ? 'Sun' : s === 'clay' ? 'Brush' : 'Grid2x2',
    keys: [`Alt+${i + 5}`],
    checked: () => editor().viewport.shading === s,
    run: () => setView({ shading: s }),
  })),
  { id: 'view.grid', label: 'Show grid', group: 'View', icon: 'Grid3x3', checked: () => editor().viewport.grid, run: () => setView({ grid: !editor().viewport.grid }) },
  { id: 'view.gizmos', label: 'Show icons (lights, cameras)', group: 'View', icon: 'Lightbulb', checked: () => editor().viewport.gizmos, run: () => setView({ gizmos: !editor().viewport.gizmos }) },
  { id: 'view.stats', label: 'Show stats', group: 'View', icon: 'Activity', checked: () => editor().viewport.stats, run: () => setView({ stats: !editor().viewport.stats }) },

  // ── Window
  { id: 'window.place', label: 'Place panel', group: 'Window', icon: 'PanelLeft', checked: () => editor().layout.place, run: () => editor().toggleLayout('place') },
  { id: 'window.outliner', label: 'Outliner', group: 'Window', icon: 'ListTree', checked: () => editor().layout.outliner, run: () => editor().toggleLayout('outliner') },
  { id: 'window.details', label: 'Details', group: 'Window', icon: 'PanelRight', checked: () => editor().layout.details, run: () => editor().toggleLayout('details') },
  { id: 'window.drawer', label: 'Content drawer', group: 'Window', icon: 'PanelBottom', keys: ['Mod+B'], checked: () => editor().layout.drawer, run: () => editor().toggleLayout('drawer') },
  { id: 'window.content', label: 'Content browser', group: 'Window', icon: 'FolderTree', run: () => (editor().toggleLayout('drawer', true), editor().set({ bottomTab: 'content' })) },
  { id: 'window.log', label: 'Output log', group: 'Window', icon: 'Terminal', run: () => (editor().toggleLayout('drawer', true), editor().set({ bottomTab: 'console' })) },
  { id: 'window.problems', label: 'Message log (problems)', group: 'Window', icon: 'TriangleAlert', run: () => (editor().toggleLayout('drawer', true), editor().set({ bottomTab: 'problems' })) },
  { id: 'window.profiler', label: 'Profiler', group: 'Window', icon: 'Gauge', run: () => (editor().toggleLayout('drawer', true), editor().set({ bottomTab: 'profiler' })) },
  { id: 'window.ai', label: 'AI assistant', group: 'Window', icon: 'Bot', keys: ['Mod+Shift+A'], run: () => (editor().toggleLayout('details', true), editor().set({ rightTab: 'ai' })) },
  { id: 'window.palette', label: 'Command palette', group: 'Window', icon: 'Command', keys: ['Mod+K'], inPlay: true, inInputs: true, run: () => editor().set({ paletteOpen: !editor().paletteOpen }) },
  { id: 'window.theme', label: 'Toggle light / dark theme', group: 'Window', icon: 'SunMoon', run: () => useUi.getState().setTheme(useUi.getState().theme === 'dark' ? 'light' : 'dark') },
  {
    id: 'window.reset',
    label: 'Reset layout',
    group: 'Window',
    icon: 'RotateCcw',
    run: () => {
      for (const k of ['place', 'outliner', 'details', 'drawer'] as const) editor().toggleLayout(k, true);
      for (const v of ['--left-w', '--right-w', '--bottom-h', '--outliner-h']) {
        try {
          localStorage.removeItem(`bz.layout${v}`);
        } catch {
          /* ignore */
        }
        document.querySelector<HTMLElement>('.editor')?.style.removeProperty(v);
      }
    },
  },

  // ── Build
  { id: 'build.play', label: 'Play / Stop', group: 'Build', icon: 'Play', keys: ['Mod+P'], inPlay: true, inInputs: true, run: () => togglePlay() },
  { id: 'build.pause', label: 'Pause / Resume', group: 'Build', icon: 'Pause', keys: ['Mod+Shift+P'], inPlay: true, enabled: () => !editing(), run: () => editor().set({ playState: editor().playState === 'paused' ? 'playing' : 'paused' }) },
  { id: 'build.step', label: 'Step one frame', group: 'Build', icon: 'StepForward', inPlay: true, enabled: () => editor().playState === 'paused', run: () => session().playRuntime?.step() },
  ...(['free', 'desktop', 'phone', 'phone-landscape', 'tablet'] as const).map<EditorAction>((d) => ({
    id: `device.${d}`,
    label: `Preview on: ${{ free: 'Fill viewport', desktop: 'Desktop 16:9', phone: 'Phone (portrait)', 'phone-landscape': 'Phone (landscape)', tablet: 'Tablet' }[d]}`,
    group: 'Build',
    icon: d === 'free' ? 'Maximize' : d === 'desktop' ? 'Monitor' : d === 'tablet' ? 'Tablet' : 'Smartphone',
    inPlay: true,
    checked: () => editor().device === d,
    run: () => editor().set({ device: d }),
  })),
  { id: 'build.colliders', label: 'Show colliders while playing', group: 'Build', icon: 'Box', inPlay: true, checked: () => useSession.getState().physicsDebug, run: () => useSession.getState().set({ physicsDebug: !useSession.getState().physicsDebug }) },
  { id: 'build.publish', label: 'Publish & share…', group: 'Build', icon: 'Rocket', run: () => editorHost.openPublish() },

  // ── Help
  { id: 'help.tutorial', label: 'Interactive tutorial', group: 'Help', icon: 'GraduationCap', run: () => editor().set({ tutorialOpen: true }) },
  { id: 'help.welcome', label: 'Welcome & templates', group: 'Help', icon: 'Sparkles', run: () => editorHost.openWelcome() },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Help', icon: 'Keyboard', keys: ['Shift+?'], run: () => editorHost.openShortcuts() },
  { id: 'help.guide', label: 'Step-by-step guide (docs)', group: 'Help', icon: 'BookOpen', run: () => window.open('/learn', '_blank', 'noopener') },
];

export function togglePlay(): void {
  const { playState, set, openDoc } = editor();
  if (playState === 'edit') {
    set({ playState: 'playing' });
    openDoc('game');
  } else {
    set({ playState: 'edit' });
    editor().closeDoc('game');
  }
}

export const actionById = (id: string) => ACTIONS.find((a) => a.id === id);

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Human-readable shortcut ("⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere). */
export function formatKeys(spec: string): string {
  if (!isMac) return spec.replace('Mod', 'Ctrl');
  return spec.replace('Mod+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥');
}

function matches(spec: string, e: KeyboardEvent): boolean {
  const parts = spec.split('+');
  const key = parts.pop()!.toLowerCase();
  const mod = parts.includes('Mod');
  if (mod !== (e.ctrlKey || e.metaKey)) return false;
  if (parts.includes('Alt') !== e.altKey) return false;
  const shift = parts.includes('Shift');
  // "?" already implies shift on most layouts.
  if (key !== '?' && shift !== e.shiftKey) return false;
  const pressed = e.key.toLowerCase();
  if (/^\d$/.test(key)) return e.code === `Digit${key}`;
  return pressed === key;
}

/** Find the action a key press should trigger in the current context. */
export function actionForKey(e: KeyboardEvent): EditorAction | undefined {
  const t = e.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest('.monaco-editor');
  const playing = !editing();
  return ACTIONS.find((a) => a.keys?.some((k) => matches(k, e)) && (!typing || a.inInputs) && (!playing || a.inPlay) && (a.enabled?.() ?? true));
}
