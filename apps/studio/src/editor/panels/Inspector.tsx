import { COMPONENTS, getComponentSchema, type ComponentData, type EntityData, type GameObject } from '@bazi/engine';
import { useEffect, useState } from 'react';
import {
  addComponent,
  deleteAsset,
  deleteEntities,
  deletePrefab,
  duplicateEntities,
  instantiatePrefab,
  makePrefab,
  moveComponent,
  removeComponent,
  renameAsset,
  renamePrefab,
  resetComponent,
  setComponentProp,
  setTransform,
  updateEntity,
} from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { toast } from '../../store/ui';
import { Icon } from '../../ui/Icon';
import { Switch, useMenu, type MenuItem } from '../../ui/primitives';
import { useSession } from '../session';
import { FieldEditor, TagsInput, Vec3Input } from './Fields';

function ComponentCard({ entity, component, index }: { entity: EntityData; component: ComponentData; index: number }) {
  const schema = getComponentSchema(component.type);
  const [open, setOpen] = useState(true);
  const menu = useMenu();
  const props = component as Record<string, unknown>;
  const enabled = component.enabled !== false;
  return (
    <div className="section">
      <div className="section-title" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} className="faint" />
        <span className="icon-box"><Icon name={schema?.icon ?? 'Puzzle'} size={13} /></span>
        <span className="grow truncate" style={{ opacity: enabled ? 1 : 0.5 }}>{schema?.label ?? component.type}</span>
        <span onClick={(e) => e.stopPropagation()}>
          <Switch checked={enabled} onChange={(v) => setComponentProp(entity.id, index, 'enabled', v)} label="Enabled" />
        </span>
        <button
          className="btn sm ghost icon"
          aria-label="Component menu"
          onClick={(e) => {
            e.stopPropagation();
            menu.open(e.currentTarget.getBoundingClientRect(), [
              { label: 'Move up', icon: 'ChevronDown', disabled: index === 0, onSelect: () => moveComponent(entity.id, index, -1) },
              { label: 'Move down', icon: 'ChevronDown', disabled: index === entity.components.length - 1, onSelect: () => moveComponent(entity.id, index, 1) },
              { label: 'Reset to defaults', icon: 'RotateCw', onSelect: () => resetComponent(entity.id, index) },
              { separator: true },
              { label: 'Remove', icon: 'Trash', danger: true, onSelect: () => removeComponent(entity.id, index) },
            ]);
          }}
        >
          <Icon name="EllipsisVertical" size={14} />
        </button>
      </div>
      {open && (
        <div className="section-content">
          {schema?.description && <div className="faint" style={{ fontSize: 12 }}>{schema.description}</div>}
          {schema ? (
            schema.fields
              .filter((f) => !f.showIf || f.showIf(props))
              .map((f) => <FieldEditor key={f.key} field={f} value={props[f.key]} entityId={entity.id} onChange={(v) => setComponentProp(entity.id, index, f.key, v)} />)
          ) : (
            <div className="faint">Unknown component type “{component.type}”.</div>
          )}
        </div>
      )}
      {menu.element}
    </div>
  );
}

function addComponentItems(entity: EntityData): MenuItem[] {
  const mode = editor().project?.settings.mode ?? '3d';
  const items: MenuItem[] = [];
  let category = '';
  for (const c of COMPONENTS) {
    if (c.modes && !c.modes.includes(mode)) continue;
    if (!c.multiple && entity.components.some((x) => x.type === c.type)) continue;
    if (c.category !== category) {
      category = c.category;
      items.push({ heading: category });
    }
    items.push({ label: c.label, icon: c.icon, onSelect: () => addComponent(entity.id, c.type) });
  }
  return items;
}

/** Live values while the game is running (debugging aid). */
function LiveState({ id }: { id: string }) {
  const runtime = useSession((s) => s.playRuntime);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const go: GameObject | undefined = runtime?.entities.get(id);
  if (!runtime) return null;
  if (!go) return <div className="section-content faint">This entity is not alive in the running game (destroyed or disabled).</div>;
  const f = (n: number) => n.toFixed(2);
  const p = go.position;
  const v = go.velocity;
  const vars = Object.entries(go.vars);
  return (
    <div className="section">
      <div className="section-title" style={{ cursor: 'default' }}>
        <span className="icon-box" style={{ background: 'rgba(52,211,153,.2)', color: 'var(--success)' }}><Icon name="Bug" size={13} /></span>
        Live (playing)
      </div>
      <div className="section-content mono" style={{ fontSize: 12 }}>
        <div>position  {f(p.x)}, {f(p.y)}, {f(p.z)}</div>
        <div>velocity  {f(v.x)}, {f(v.y)}, {f(v.z)}</div>
        <div>grounded  {String(go.isGrounded())}</div>
        <div>behaviours {go.behaviourCount}</div>
        {vars.map(([k, val]) => (
          <div key={k}>vars.{k} = {JSON.stringify(val)}</div>
        ))}
        <div className="faint" style={{ fontFamily: 'var(--font)' }}>Edits here apply after you stop playing.</div>
      </div>
    </div>
  );
}

function EntityInspector({ entity }: { entity: EntityData }) {
  const menu = useMenu();
  const playing = useEditor((s) => s.playState !== 'edit');
  const t = entity.transform;
  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="row">
          <Switch checked={entity.enabled} onChange={(v) => updateEntity(entity.id, (e) => void (e.enabled = v), 'Toggle enabled')} label="Enabled" />
          <input className="input grow" value={entity.name} onChange={(e) => updateEntity(entity.id, (x) => void (x.name = e.target.value), 'Rename', `name:${entity.id}`)} aria-label="Name" style={{ fontWeight: 600 }} />
          <button
            className="btn sm ghost icon"
            aria-label="Entity actions"
            onClick={(e) =>
              menu.open(e.currentTarget.getBoundingClientRect(), [
                { label: 'Duplicate', icon: 'Copy', onSelect: () => duplicateEntities([entity.id]) },
                { label: 'Save as prefab', icon: 'Package', onSelect: () => (makePrefab(entity.id), toast('Prefab saved', 'success')) },
                { separator: true },
                { label: 'Delete', icon: 'Trash', danger: true, onSelect: () => deleteEntities([entity.id]) },
              ])
            }
          >
            <Icon name="EllipsisVertical" size={14} />
          </button>
        </div>
        <TagsInput value={entity.tags} onChange={(tags) => updateEntity(entity.id, (e) => void (e.tags = tags), 'Edit tags')} />
      </div>
      {playing && <LiveState id={entity.id} />}
      <div className="section">
        <div className="section-title" style={{ cursor: 'default' }}>
          <span className="icon-box"><Icon name="Move3d" size={13} /></span>
          Transform
        </div>
        <div className="section-content">
          <div className="prop"><span className="prop-label">Position</span><Vec3Input value={t.position} onChange={(v) => setTransform(entity.id, 'position', v)} /></div>
          <div className="prop"><span className="prop-label">Rotation °</span><Vec3Input value={t.rotation} step={1} onChange={(v) => setTransform(entity.id, 'rotation', v)} /></div>
          <div className="prop"><span className="prop-label">Scale</span><Vec3Input value={t.scale} onChange={(v) => setTransform(entity.id, 'scale', v)} /></div>
        </div>
      </div>
      {entity.components.map((c, i) => (
        <ComponentCard key={`${entity.id}:${i}:${c.type}`} entity={entity} component={c} index={i} />
      ))}
      <div style={{ padding: 12 }}>
        <button className="btn primary" style={{ width: '100%' }} onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), addComponentItems(entity), true)}>
          <Icon name="Plus" size={15} /> Add component
        </button>
      </div>
      {menu.element}
    </div>
  );
}

function AssetInspector() {
  const selected = useEditor((s) => s.selectedAsset)!;
  const project = useEditor((s) => s.project)!;
  if (selected.kind === 'prefab') {
    const prefab = project.prefabs.find((p) => p.id === selected.id);
    if (!prefab) return null;
    const root = prefab.entities.find((e) => !e.parent);
    return (
      <div className="inspector">
        <div className="insp-head">
          <span className="badge accent" style={{ alignSelf: 'flex-start' }}><Icon name="Package" size={11} /> Prefab</span>
          <input className="input" value={prefab.name} onChange={(e) => renamePrefab(prefab.id, e.target.value)} aria-label="Prefab name" />
          <div className="muted" style={{ fontSize: 12.5 }}>
            {prefab.entities.length} entit{prefab.entities.length === 1 ? 'y' : 'ies'} · components: {root?.components.map((c) => getComponentSchema(c.type)?.label ?? c.type).join(', ') || 'none'}
          </div>
          <div className="faint" style={{ fontSize: 12 }}>To edit a prefab: place it, change it, then right-click → “Save as prefab” with the same name.</div>
          <div className="row">
            <button className="btn primary grow" onClick={() => instantiatePrefab(prefab.id)}><Icon name="Plus" size={14} /> Place in scene</button>
            <button className="btn danger" onClick={() => (deletePrefab(prefab.id), editor().set({ selectedAsset: null }))}><Icon name="Trash" size={14} /></button>
          </div>
        </div>
      </div>
    );
  }
  const asset = project.assets.find((a) => a.id === selected.id);
  if (!asset) return null;
  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="badge accent" style={{ alignSelf: 'flex-start' }}>{asset.type}</span>
        <input className="input" value={asset.name} onChange={(e) => renameAsset(asset.id, e.target.value)} aria-label="Asset name" />
        {asset.type === 'image' && <img src={asset.url} alt={asset.name} style={{ maxWidth: '100%', borderRadius: 8, imageRendering: project.settings.graphics.pixelArt ? 'pixelated' : 'auto', background: 'repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0 / 16px 16px' }} />}
        {asset.type === 'audio' && <audio controls src={asset.url} style={{ width: '100%' }} />}
        <div className="muted" style={{ fontSize: 12 }}>{asset.size ? `${(asset.size / 1024).toFixed(0)} KB` : ''} · drag it into the scene to use it</div>
        <button className="btn danger" onClick={() => (deleteAsset(asset.id), editor().set({ selectedAsset: null }))}><Icon name="Trash" size={14} /> Delete asset</button>
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const selectedAsset = useEditor((s) => s.selectedAsset);
  const entity = useEditor((s) => (s.selection.length === 1 ? s.project?.scenes.find((x) => x.id === s.sceneId)?.entities.find((e) => e.id === s.selection[0]) : undefined));
  if (selectedAsset) return <AssetInspector />;
  if (selection.length > 1)
    return (
      <div className="empty">
        {selection.length} entities selected
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => duplicateEntities(selection)}><Icon name="Copy" size={14} /> Duplicate</button>
          <button className="btn danger" onClick={() => deleteEntities(selection)}><Icon name="Trash" size={14} /> Delete</button>
        </div>
      </div>
    );
  if (!entity)
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        <Icon name="Crosshair" size={28} />
        <p>Select something in the scene or hierarchy to edit it.</p>
        <p className="faint" style={{ fontSize: 12 }}>Tip: right-click the hierarchy to create objects, or ask the AI assistant.</p>
      </div>
    );
  return <EntityInspector entity={entity} />;
}
