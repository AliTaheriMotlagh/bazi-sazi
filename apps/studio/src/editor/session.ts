import type { Runtime } from '@bazi/engine';
import { create } from 'zustand';

/**
 * Live (non-serializable) editor objects shared between panels: the edit
 * viewport runtime and the play-mode runtime. Kept outside the project store
 * so they never end up in undo history or saved data.
 */
interface SessionState {
  editRuntime: Runtime | null;
  playRuntime: Runtime | null;
  physicsDebug: boolean;
  timeScale: number;
  set(partial: Partial<SessionState>): void;
}

export const useSession = create<SessionState>((set) => ({
  editRuntime: null,
  playRuntime: null,
  physicsDebug: false,
  timeScale: 1,
  set: (partial) => set(partial),
}));

export const session = () => useSession.getState();

/** Hooks the viewport registers so other UI (publish, toolbar) can use it. */
export const viewportBridge: {
  capture: () => string | null;
  focusSelection: () => void;
  dropPosition: (clientX: number, clientY: number) => [number, number, number];
  /** True while the fly camera has the keyboard (editor shortcuts pause). */
  flying: boolean;
} = {
  flying: false,
  capture: () => null,
  focusSelection: () => {},
  dropPosition: () => [0, 0, 0],
};

/**
 * Callbacks owned by the editor page (save, dialogs) that actions need.
 * The page registers real implementations on mount.
 */
export const editorHost: {
  save: (withThumbnail?: boolean) => Promise<boolean>;
  openPublish: () => void;
  openShortcuts: () => void;
  openWelcome: () => void;
  uploadFiles: () => void;
} = {
  save: async () => false,
  openPublish: () => {},
  openShortcuts: () => {},
  openWelcome: () => {},
  uploadFiles: () => {},
};
