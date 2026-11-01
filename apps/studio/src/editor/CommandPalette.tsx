import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { editor, useEditor } from '../store/editor';
import { Icon } from '../ui/Icon';
import { ACTIONS, formatKeys } from './actions';
import { viewportBridge } from './session';

interface Entry {
  id: string;
  label: string;
  hint: string;
  icon: string;
  run(): void;
}

/** Fuzzy subsequence score: consecutive and word-start matches rank higher. */
function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let qi = 0;
  let s = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      s += i === 0 || t[i - 1] === ' ' ? 3 : 1;
      qi++;
    }
  }
  return qi === q.length ? s : 0;
}

/** Ctrl/Cmd+K: run any command, jump to any entity, script, graph or scene. */
export function CommandPalette() {
  const open = useEditor((s) => s.paletteOpen);
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    if (!project) return [];
    const scene = project.scenes.find((s) => s.id === sceneId);
    return [
      ...ACTIONS.filter((a) => !a.enabled || a.enabled()).map((a) => ({ id: a.id, label: a.label, hint: a.keys ? formatKeys(a.keys[0]) : a.group, icon: a.icon ?? 'Command', run: a.run })),
      ...(scene?.entities ?? []).map((e) => ({ id: `ent:${e.id}`, label: `Go to ${e.name}`, hint: 'Entity', icon: 'Crosshair', run: () => (editor().select([e.id]), setTimeout(() => viewportBridge.focusSelection(), 30)) })),
      ...project.scripts.map((s) => ({ id: `sc:${s.id}`, label: `Open script ${s.name}`, hint: 'Script', icon: 'FileCode', run: () => editor().openScript(s.id) })),
      ...project.graphs.map((g) => ({ id: `g:${g.id}`, label: `Open visual script ${g.name}`, hint: 'Graph', icon: 'Workflow', run: () => editor().openGraph(g.id) })),
      ...project.scenes.map((s) => ({ id: `s:${s.id}`, label: `Open scene ${s.name}`, hint: 'Scene', icon: 'Clapperboard', run: () => editor().setScene(s.id) })),
    ];
  }, [project, sceneId]);

  const results = useMemo(
    () =>
      entries
        .map((e) => ({ e, s: score(query, e.label) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.e),
    [entries, query],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);
  useEffect(() => {
    list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;
  const close = () => editor().set({ paletteOpen: false });
  const run = (e?: Entry) => {
    if (!e) return;
    close();
    e.run();
  };
  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="Search" size={16} />
          <input
            autoFocus
            placeholder="Type a command, entity, script or scene…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter') run(results[index]);
              if (e.key === 'Escape') close();
              e.stopPropagation();
            }}
          />
        </div>
        <div className="palette-list" ref={list} role="listbox">
          {results.map((r, i) => (
            <button key={r.id} className={`palette-item ${i === index ? 'selected' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(r)} role="option" aria-selected={i === index}>
              <Icon name={r.icon} size={15} />
              <span className="grow truncate">{r.label}</span>
              <span className="hint">{r.hint}</span>
            </button>
          ))}
          {results.length === 0 && <div className="empty">No matches</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
