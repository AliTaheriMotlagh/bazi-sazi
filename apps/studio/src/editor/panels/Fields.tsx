import type { FieldSchema, ProjectData, Vec3 } from '@bazi/engine';
import { useRef, useState } from 'react';
import { newGraph, newScript } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { Icon } from '../../ui/Icon';
import { NumberInput, Switch } from '../../ui/primitives';

export function Vec3Input({ value, onChange, step = 0.1 }: { value: Vec3; onChange(v: Vec3): void; step?: number }) {
  const refs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  return (
    <div className="vec">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <div className="vec-field" key={axis}>
          <span className="axis" ref={refs[i]}>{axis}</span>
          <NumberInput
            value={value[i] ?? 0}
            step={step}
            scrubRef={refs[i]}
            onChange={(v) => {
              const next = [...value] as Vec3;
              next[i] = v;
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <div className="color-row">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label="Pick color" />
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TagsInput({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="tags-input">
      {value.map((t) => (
        <span className="tag-chip" key={t}>
          {t}
          <button onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>×</button>
        </span>
      ))}
      <input
        value={text}
        placeholder={value.length ? '' : 'Add tag (e.g. player, enemy)…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        list="bz-common-tags"
      />
      <datalist id="bz-common-tags">
        {['player', 'enemy', 'coin', 'ground', 'hazard', 'spawn', 'bullet', 'wall'].map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  );
}

function ParamsInput({ value, onChange }: { value: Record<string, unknown>; onChange(v: Record<string, unknown>): void }) {
  const entries = Object.entries(value ?? {});
  const parse = (s: string): unknown => (s === 'true' ? true : s === 'false' ? false : s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : s);
  return (
    <div className="col" style={{ gap: 4 }}>
      {entries.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <input
            className="input"
            value={k}
            placeholder="name"
            onChange={(e) => {
              const next = Object.fromEntries(entries.map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv])));
              onChange(next);
            }}
          />
          <input className="input" value={String(v)} placeholder="value" onChange={(e) => onChange({ ...value, [k]: parse(e.target.value) })} />
          <button className="btn sm ghost icon" onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} aria-label="Remove parameter">
            <Icon name="X" size={13} />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange({ ...value, [`param${entries.length + 1}`]: 0 })}>
        <Icon name="Plus" size={13} /> Add parameter
      </button>
    </div>
  );
}

function RefSelect({ value, options, onChange, empty = '(none)' }: { value: string; options: { value: string; label: string }[]; onChange(v: string): void; empty?: string }) {
  const known = options.some((o) => o.value === value);
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {!known && value && <option value={value}>{value} (missing)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

const refOptions = (project: ProjectData, field: FieldSchema, sceneId: string): { value: string; label: string }[] => {
  switch (field.type) {
    case 'asset':
      return project.assets.filter((a) => !field.assetType || a.type === field.assetType).map((a) => ({ value: a.id, label: a.name }));
    case 'script':
      return project.scripts.map((s) => ({ value: s.id, label: s.name }));
    case 'graph':
      return project.graphs.map((g) => ({ value: g.id, label: g.name }));
    case 'prefab':
      return project.prefabs.map((p) => ({ value: p.name, label: p.name }));
    case 'scene':
      return project.scenes.map((s) => ({ value: s.name, label: s.name }));
    case 'action':
      return Object.keys(project.settings.input).map((a) => ({ value: a, label: a }));
    case 'entity': {
      const scene = project.scenes.find((s) => s.id === sceneId);
      const names = new Set([...(scene?.entities.map((e) => e.name) ?? []), ...project.prefabs.map((p) => p.name)]);
      return [...names].map((n) => ({ value: n, label: n }));
    }
    default:
      return [];
  }
};

/** Renders the right editor for a schema field. */
export function FieldEditor({ field, value, onChange, entityId }: { field: FieldSchema; value: unknown; onChange(v: unknown): void; entityId?: string }) {
  const project = useEditor((s) => s.project)!;
  const sceneId = useEditor((s) => s.sceneId);
  const labelRef = useRef<HTMLSpanElement>(null);
  const v = value ?? field.default;
  let control: React.ReactNode;
  let stack = false;

  switch (field.type) {
    case 'number': {
      const hasRange = field.min !== undefined && field.max !== undefined;
      const input = <NumberInput value={Number(v)} onChange={onChange} step={field.step ?? 0.1} min={field.min} max={field.max} scrubRef={labelRef} />;
      control = hasRange ? (
        <div className="slider-row">
          <input type="range" min={field.min} max={field.max} step={field.step ?? 0.01} value={Number(v)} onChange={(e) => onChange(Number(e.target.value))} aria-label={field.label} />
          {input}
        </div>
      ) : (
        input
      );
      break;
    }
    case 'boolean':
      control = <Switch checked={!!v} onChange={onChange} label={field.label} />;
      break;
    case 'color':
      control = <ColorInput value={String(v)} onChange={onChange} />;
      break;
    case 'vec3':
      control = <Vec3Input value={v as Vec3} onChange={onChange} />;
      break;
    case 'select':
      control = (
        <select className="select" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
      break;
    case 'text':
      stack = true;
      control = <textarea className={`textarea ${field.key === 'map' ? 'mono' : ''}`} value={String(v)} onChange={(e) => onChange(e.target.value)} rows={field.key === 'map' ? 8 : 3} spellCheck={false} />;
      break;
    case 'params':
      stack = true;
      control = <ParamsInput value={v as Record<string, unknown>} onChange={onChange} />;
      break;
    case 'script':
    case 'graph': {
      const isScript = field.type === 'script';
      control = (
        <div className="row" style={{ gap: 4 }}>
          <div className="grow">
            <RefSelect value={String(v)} options={refOptions(project, field, sceneId)} onChange={onChange} />
          </div>
          {v ? (
            <button className="btn sm icon" title="Open editor" onClick={() => (isScript ? editor().openScript(String(v)) : editor().openGraph(String(v)))} aria-label="Edit">
              <Icon name="Pencil" size={13} />
            </button>
          ) : (
            <button
              className="btn sm"
              title="Create new"
              onClick={() => {
                const name = editor().project?.scenes.find((s) => s.id === sceneId)?.entities.find((e) => e.id === entityId)?.name ?? 'New';
                onChange(isScript ? newScript(`${name} Script`) : newGraph(`${name} Logic`));
              }}
            >
              <Icon name="Plus" size={13} /> New
            </button>
          )}
        </div>
      );
      break;
    }
    case 'asset':
    case 'prefab':
    case 'scene':
    case 'action':
      control = <RefSelect value={String(v)} options={refOptions(project, field, sceneId)} onChange={onChange} />;
      break;
    case 'entity': {
      const listId = `ents-${field.key}`;
      control = (
        <>
          <input className="input" list={listId} value={String(v)} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {refOptions(project, field, sceneId).map((o) => <option key={o.value} value={o.value} />)}
          </datalist>
        </>
      );
      break;
    }
    default:
      control = <input className="input" value={String(v)} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className={`prop ${stack ? 'stack' : ''}`}>
      <span ref={labelRef} className={`prop-label ${field.type === 'number' ? 'scrub' : ''}`} title={field.help ?? field.label}>
        {field.label}
      </span>
      {control}
      {field.help && stack && <span className="prop-help">{field.help}</span>}
    </div>
  );
}
