import type { ProjectData } from '@bazi/engine';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';

enablePatches();

export type GizmoTool = 'translate' | 'rotate' | 'scale';
export type PlayState = 'edit' | 'playing' | 'paused';
export type BottomTab = 'console' | 'problems' | 'code' | 'logic' | 'profiler';
export type RightTab = 'inspector' | 'ai' | 'settings';
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/** One undoable command, stored as forward/inverse patches (command pattern). */
interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  key?: string;
  at: number;
}

const HISTORY_LIMIT = 300;
const COALESCE_MS = 1200;

export interface EditorState {
  projectId: string | null;
  project: ProjectData | null;
  sceneId: string;
  selection: string[];
  /** Asset/script/graph/prefab selected in the assets panel (for the inspector). */
  selectedAsset: { kind: 'asset' | 'prefab'; id: string } | null;
  tool: GizmoTool;
  snap: boolean;
  playState: PlayState;
  past: HistoryEntry[];
  future: HistoryEntry[];
  saveState: SaveState;
  revision: number;
  bottomTab: BottomTab;
  rightTab: RightTab;
  bottomMaximized: boolean;
  activeScriptId: string | null;
  activeGraphId: string | null;

  open(projectId: string, project: ProjectData): void;
  close(): void;
  /** Apply an undoable change. Same `key` within a short window merges (slider drags, typing). */
  apply(label: string, recipe: (draft: ProjectData) => void, key?: string): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  setScene(sceneId: string): void;
  set(partial: Partial<EditorState>): void;
  openScript(id: string): void;
  openGraph(id: string): void;
}

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  project: null,
  sceneId: '',
  selection: [],
  selectedAsset: null,
  tool: 'translate',
  snap: false,
  playState: 'edit',
  past: [],
  future: [],
  saveState: 'saved',
  revision: 0,
  bottomTab: 'console',
  rightTab: 'inspector',
  bottomMaximized: false,
  activeScriptId: null,
  activeGraphId: null,

  open(projectId, project) {
    set({
      projectId,
      project,
      sceneId: project.scenes.some((s) => s.id === project.settings.startScene) ? project.settings.startScene : project.scenes[0].id,
      selection: [],
      selectedAsset: null,
      past: [],
      future: [],
      saveState: 'saved',
      playState: 'edit',
      revision: 0,
      activeScriptId: project.scripts[0]?.id ?? null,
      activeGraphId: project.graphs[0]?.id ?? null,
    });
  },

  close() {
    set({ projectId: null, project: null, selection: [], past: [], future: [] });
  },

  apply(label, recipe, key) {
    const { project, past } = get();
    if (!project) return;
    const [next, patches, inverse] = produceWithPatches(project, recipe);
    if (patches.length === 0) return;
    const history = past.slice();
    const last = history[history.length - 1];
    const now = Date.now();
    if (key && last?.key === key && now - last.at < COALESCE_MS) {
      history[history.length - 1] = { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now };
    } else {
      history.push({ label, patches, inverse, key, at: now });
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    set((s) => ({ project: next, past: history, future: [], saveState: 'unsaved', revision: s.revision + 1 }));
  },

  undo() {
    const { project, past, future } = get();
    const entry = past[past.length - 1];
    if (!project || !entry) return;
    const next = applyPatches(project, entry.inverse);
    set((s) => ({ project: next, past: past.slice(0, -1), future: [...future, entry], saveState: 'unsaved', revision: s.revision + 1, selection: pruneSelection(next, s.sceneId, s.selection) }));
  },

  redo() {
    const { project, past, future } = get();
    const entry = future[future.length - 1];
    if (!project || !entry) return;
    const next = applyPatches(project, entry.patches);
    set((s) => ({ project: next, past: [...past, { ...entry, key: undefined }], future: future.slice(0, -1), saveState: 'unsaved', revision: s.revision + 1, selection: pruneSelection(next, s.sceneId, s.selection) }));
  },

  select(ids, additive = false) {
    set((s) => {
      let selection = ids;
      if (additive) {
        const current = new Set(s.selection);
        for (const id of ids) {
          if (current.has(id)) current.delete(id);
          else current.add(id);
        }
        selection = [...current];
      }
      return { selection, selectedAsset: null, rightTab: s.rightTab === 'settings' && ids.length ? 'inspector' : s.rightTab };
    });
  },

  setScene(sceneId) {
    set({ sceneId, selection: [] });
  },

  set: (partial) => set(partial),

  openScript(id) {
    set((s) => ({ activeScriptId: id, bottomTab: 'code', bottomMaximized: s.bottomMaximized }));
  },

  openGraph(id) {
    set({ activeGraphId: id, bottomTab: 'logic' });
  },
}));

function pruneSelection(project: ProjectData, sceneId: string, selection: string[]): string[] {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const ids = new Set(scene.entities.map((e) => e.id));
  return selection.filter((id) => ids.has(id));
}

/** Non-reactive accessors for command code. */
export const editor = () => useEditor.getState();
