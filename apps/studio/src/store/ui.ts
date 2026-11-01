import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

type Theme = 'dark' | 'light';

interface UiState {
  toasts: Toast[];
  theme: Theme;
  toast(text: string, kind?: ToastKind): void;
  setTheme(theme: Theme): void;
}

const readTheme = (): Theme => {
  try {
    return localStorage.getItem('bz.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

let nextId = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  theme: readTheme(),
  toast(text, kind = 'info') {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3200);
  },
  setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('bz.theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
}));

export const toast = (text: string, kind?: ToastKind) => useUi.getState().toast(text, kind);
