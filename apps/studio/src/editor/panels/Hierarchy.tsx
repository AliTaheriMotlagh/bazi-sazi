import { getComponentSchema, type EntityData } from '@bazi/engine';
import { useMemo, useState } from 'react';
import { createFromPreset, deleteEntities, duplicateEntities, makePrefab, PRESETS, reparent, updateEntity } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { toast } from '../../store/ui';
import { Icon } from '../../ui/Icon';
import { useMenu, type MenuItem } from '../../ui/primitives';
import { viewportBridge } from '../session';

const ROW_MIME = 'application/x-bazi-entity';

function entityIcon(e: EntityData): string {
  for (const type of ['Camera', 'Light', 'Model', 'Mesh', 'Sprite', 'Text', 'TileMap', 'Particles', 'HudText', 'AudioSource']) {
    if (e.components.some((c) => c.type === type)) return getComponentSchema(type)?.icon ?? 'Square';
  }
  return e.components.length ? (getComponentSchema(e.components[0].type)?.icon ?? 'Square') : 'Square';
}

/** Items for the "Create" menu, filtered for the project mode. */
export function createMenuItems(parent: string | null = null): MenuItem[] {
  const mode = editor().project?.settings.mode ?? '3d';
  const items: MenuItem[] = [];
  let group = '';
  for (const preset of PRESETS.filter((p) => !p.modes || p.modes.includes(mode))) {
    if (preset.group !== group) {
      group = preset.group;
      items.push({ heading: group });
    }
    items.push({ label: preset.label, icon: preset.icon, onSelect: () => createFromPreset(preset, parent) });
  }
  return items;
}

export function Hierarchy() {
  const scene = useEditor((s) => s.project?.scenes.find((x) => x.id === s.sceneId));
  const selection = useEditor((s) => s.selection);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [drop, setDrop] = useState<{ id: string; where: 'before' | 'inside' } | null>(null);
  const menu = useMenu();

  const children = useMemo(() => {
    const map = new Map<string | null, EntityData[]>();
    for (const e of scene?.entities ?? []) {
      const key = e.parent && scene!.entities.some((p) => p.id === e.parent) ? e.parent : null;
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [scene]);

  if (!scene) return null;
  const q = filter.trim().toLowerCase();

  const contextMenu = (e: React.MouseEvent, entity: EntityData) => {
    e.preventDefault();
    if (!selection.includes(entity.id)) editor().select([entity.id]);
    const ids = selection.includes(entity.id) ? selection : [entity.id];
    menu.open(e, [
      { label: 'Rename', icon: 'Pencil', hint: 'F2', onSelect: () => setRenaming(entity.id) },
      { label: 'Duplicate', icon: 'Copy', hint: 'Ctrl+D', onSelect: () => duplicateEntities(ids) },
      { label: 'Focus in view', icon: 'Crosshair', hint: 'F', onSelect: () => viewportBridge.focusSelection() },
      { label: entity.enabled ? 'Disable' : 'Enable', icon: entity.enabled ? 'EyeOff' : 'Eye', onSelect: () => updateEntity(entity.id, (x) => void (x.enabled = !x.enabled), 'Toggle enabled') },
      {
        label: 'Save as prefab',
        icon: 'Package',
        onSelect: () => {
          makePrefab(entity.id);
          toast(`Prefab "${entity.name}" saved — find it in Assets → Prefabs`, 'success');
        },
      },
      ...(entity.parent ? [{ label: 'Move to root', icon: 'Layers', onSelect: () => reparent(entity.id, null) }] : []),
      { separator: true },
      { heading: 'Create child' },
      ...createMenuItems(entity.id).filter((i) => !i.heading).slice(0, 8),
      { separator: true },
      { label: 'Delete', icon: 'Trash', danger: true, hint: 'Del', onSelect: () => deleteEntities(ids) },
    ]);
  };

  const onDragOver = (e: React.DragEvent, entity: EntityData) => {
    if (!e.dataTransfer.types.includes(ROW_MIME)) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrop({ id: entity.id, where: e.clientY - r.top < r.height * 0.3 ? 'before' : 'inside' });
  };
  const onDrop = (e: React.DragEvent, target: EntityData | null) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData(ROW_MIME);
    const where = drop?.where;
    setDrop(null);
    if (!id || id === target?.id) return;
    if (!target) reparent(id, null);
    else if (where === 'before') reparent(id, target.parent, target.id);
    else {
      reparent(id, target.id);
      setCollapsed((c) => {
        const n = new Set(c);
        n.delete(target.id);
        return n;
      });
    }
  };

  const renderRow = (e: EntityData, depth: number): React.ReactNode => {
    const kids = children.get(e.id) ?? [];
    const matches = !q || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q));
    const open = !collapsed.has(e.id) || !!q;
    const renderedKids = open ? kids.map((k) => renderRow(k, depth + 1)) : null;
    if (!matches && !(renderedKids ?? []).some(Boolean)) return null;
    const isSel = selection.includes(e.id);
    return (
      <div key={e.id}>
        {matches && (
          <div
            className={`tree-row ${isSel ? 'selected' : ''} ${e.enabled ? '' : 'disabled'} ${drop?.id === e.id ? `drop-${drop.where}` : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable={renaming !== e.id}
            onDragStart={(ev) => {
              ev.dataTransfer.setData(ROW_MIME, e.id);
              ev.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(ev) => onDragOver(ev, e)}
            onDragLeave={() => setDrop(null)}
            onDrop={(ev) => onDrop(ev, e)}
            onClick={(ev) => editor().select([e.id], ev.shiftKey || ev.metaKey || ev.ctrlKey)}
            onDoubleClick={() => setRenaming(e.id)}
            onContextMenu={(ev) => contextMenu(ev, e)}
            role="treeitem"
            aria-selected={isSel}
          >
            <button
              className="tree-caret"
              style={{ visibility: kids.length ? 'visible' : 'hidden' }}
              onClick={(ev) => {
                ev.stopPropagation();
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(e.id)) n.delete(e.id);
                  else n.add(e.id);
                  return n;
                });
              }}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={13} />
            </button>
            <Icon name={entityIcon(e)} size={14} className="tree-icon" />
            <span className="tree-name">
              {renaming === e.id ? (
                <input
                  className="input"
                  autoFocus
                  defaultValue={e.name}
                  onClick={(ev) => ev.stopPropagation()}
                  onBlur={(ev) => {
                    const name = ev.target.value.trim();
                    if (name && name !== e.name) updateEntity(e.id, (x) => void (x.name = name), 'Rename');
                    setRenaming(null);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                    if (ev.key === 'Escape') setRenaming(null);
                    ev.stopPropagation();
                  }}
                />
              ) : (
                e.name
              )}
            </span>
            {e.tags.slice(0, 2).map((t) => (
              <span key={t} className="badge" style={{ fontSize: 10, padding: '0 5px' }}>{t}</span>
            ))}
          </div>
        )}
        {renderedKids}
      </div>
    );
  };

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-head">
        <span className="grow">Hierarchy</span>
        <button className="btn sm ghost icon" title="Create" aria-label="Create entity" onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), createMenuItems(), true)}>
          <Icon name="Plus" size={15} />
        </button>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <input className="input" placeholder="Filter by name or tag…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter entities" />
      </div>
      <div
        className="panel-body tree"
        role="tree"
        onDragOver={(e) => e.dataTransfer.types.includes(ROW_MIME) && e.preventDefault()}
        onDrop={(e) => onDrop(e, null)}
        onClick={(e) => e.target === e.currentTarget && editor().select([])}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          menu.open(e, createMenuItems(), true);
        }}
      >
        {(children.get(null) ?? []).map((e) => renderRow(e, 0))}
        {scene.entities.length === 0 && (
          <div className="empty">
            The scene is empty.
            <br />
            <button className="btn primary sm" style={{ marginTop: 10 }} onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), createMenuItems(), true)}>
              <Icon name="Plus" size={14} /> Add something
            </button>
          </div>
        )}
      </div>
      {menu.element}
    </div>
  );
}
