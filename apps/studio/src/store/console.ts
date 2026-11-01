import type { LogEntry } from '@bazi/engine';
import { create } from 'zustand';

const MAX = 600;

interface ConsoleState {
  logs: LogEntry[];
  errors: number;
  warnings: number;
  push(entry: Omit<LogEntry, 'time'>): void;
  clear(): void;
}

/** Buffer log bursts (e.g. a log() in update) into one render per frame. */
let pending: LogEntry[] = [];
let scheduled = false;

export const useConsole = create<ConsoleState>((set) => ({
  logs: [],
  errors: 0,
  warnings: 0,
  push(entry) {
    pending.push({ ...entry, time: Date.now() });
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const batch = pending;
      pending = [];
      set((s) => {
        const logs = [...s.logs, ...batch].slice(-MAX);
        return {
          logs,
          errors: s.errors + batch.filter((l) => l.level === 'error').length,
          warnings: s.warnings + batch.filter((l) => l.level === 'warn').length,
        };
      });
    });
  },
  clear: () => set({ logs: [], errors: 0, warnings: 0 }),
}));

export const logToConsole = (entry: Omit<LogEntry, 'time'>) => useConsole.getState().push(entry);
