import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useEditor } from '../store/editor';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem, type MenuState } from '../ui/primitives';
import { ACTIONS, formatKeys, type ActionGroup, type EditorAction } from './actions';

const GROUPS: ActionGroup[] = ['File', 'Edit', 'Create', 'View', 'Window', 'Build', 'Help'];
/** Visual separators inside menus (before these action ids). */
const SEPARATE_BEFORE = new Set(['edit.duplicate', 'edit.focus', 'tool.move', 'shading.lit', 'view.grid', 'window.content', 'window.palette', 'build.step', 'device.free', 'build.publish', 'help.shortcuts', 'file.settings', 'create.script']);

export function toMenuItem(a: EditorAction): MenuItem {
  const checked = a.checked?.();
  return {
    label: a.label.includes(' › ') ? a.label.split(' › ')[1] : a.label,
    icon: checked === undefined ? a.icon : checked ? 'Check' : 'Dot',
    hint: a.keys?.[0] ? formatKeys(a.keys[0]) : undefined,
    disabled: a.enabled ? !a.enabled() : false,
    onSelect: a.run,
  };
}

function itemsFor(group: ActionGroup): MenuItem[] {
  const out: MenuItem[] = [];
  let heading = '';
  for (const a of ACTIONS.filter((x) => x.group === group && !x.hidden)) {
    if (group === 'Create' && a.label.includes(' › ')) {
      const h = a.label.split(' › ')[0];
      if (a.enabled && !a.enabled()) continue;
      if (h !== heading) out.push({ heading: (heading = h) });
    } else if (SEPARATE_BEFORE.has(a.id) && out.length) out.push({ separator: true });
    out.push(toMenuItem(a));
  }
  return out;
}

/** Desktop-style menu bar: click to open, hover to switch while open. */
export function MenuBar({ published }: { published: boolean }) {
  const [open, setOpen] = useState<{ group: ActionGroup; state: MenuState } | null>(null);
  const name = useEditor((s) => s.project?.name ?? '');
  const saveState = useEditor((s) => s.saveState);
  const user = useAuth((s) => s.user);
  const show = (group: ActionGroup, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen({ group, state: { x: r.left, y: r.bottom + 2, items: itemsFor(group), search: group === 'Create' } });
  };
  return (
    <nav className="menubar" aria-label="Main menu">
      <Link to="/" className="menubar-logo" title="All projects">
        <img src="/favicon.svg" alt="Bazi-Sazi" />
      </Link>
      {GROUPS.map((g) => (
        <button
          key={g}
          className={`menubar-item ${open?.group === g ? 'open' : ''}`}
          onClick={(e) => (open?.group === g ? setOpen(null) : show(g, e.currentTarget))}
          onMouseEnter={(e) => open && open.group !== g && show(g, e.currentTarget)}
        >
          {g}
        </button>
      ))}
      <div className="menubar-title">
        <span className={`save-dot ${saveState}`} />
        <span className="truncate">{name}</span>
        {published && <span className="badge accent" style={{ fontSize: 10 }}><Icon name="Globe" size={10} /> Live</span>}
      </div>
      <span className="menubar-user truncate">{user?.username}</span>
      {open && <Menu key={open.group} state={open.state} onClose={() => setOpen(null)} />}
    </nav>
  );
}
