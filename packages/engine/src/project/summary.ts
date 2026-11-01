import { COMPONENTS, getComponentSchema } from '../components/registry';
import type { ComponentData, ProjectData } from '../types';
import { NODES } from '../visual/nodes';

/** Drop props equal to their defaults so the AI sees compact JSON. */
export function compactComponent(c: ComponentData): Record<string, unknown> {
  const schema = getComponentSchema(c.type);
  const out: Record<string, unknown> = { type: c.type };
  for (const [k, v] of Object.entries(c)) {
    if (k === 'type') continue;
    const field = schema?.fields.find((f) => f.key === k);
    if (field && JSON.stringify(field.default) === JSON.stringify(v)) continue;
    out[k] = v;
  }
  return out;
}

/** A compact, token-friendly snapshot of a project for the AI assistant. */
export function summarizeProject(project: ProjectData, sceneId: string): Record<string, unknown> {
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  return {
    name: project.name,
    mode: project.settings.mode,
    settings: {
      gravity: project.settings.gravity,
      background: project.settings.background,
      multiplayer: project.settings.multiplayer,
      xr: project.settings.xr.enabled,
      bloom: project.settings.graphics.bloom,
      input: project.settings.input,
    },
    scenes: project.scenes.map((s) => ({ id: s.id, name: s.name, entities: s.entities.length, current: s.id === scene?.id })),
    currentScene: scene && {
      id: scene.id,
      name: scene.name,
      environment: scene.environment,
      entities: scene.entities.map((e) => ({
        id: e.id,
        name: e.name,
        parent: e.parent,
        tags: e.tags.length ? e.tags : undefined,
        enabled: e.enabled ? undefined : false,
        position: e.transform.position,
        rotation: e.transform.rotation.some((v) => v !== 0) ? e.transform.rotation : undefined,
        scale: e.transform.scale.some((v) => v !== 1) ? e.transform.scale : undefined,
        components: e.components.map(compactComponent),
      })),
    },
    prefabs: project.prefabs.map((p) => ({ id: p.id, name: p.name, root: p.entities.find((e) => !e.parent)?.components.map((c) => c.type) })),
    scripts: project.scripts.map((s) => ({ id: s.id, name: s.name, language: s.language, lines: s.code.split('\n').length })),
    graphs: project.graphs.map((g) => ({ id: g.id, name: g.name, nodes: g.nodes.length })),
    assets: project.assets.map((a) => ({ id: a.id, name: a.name, type: a.type })),
  };
}

/** Component reference, one line per component, for the AI system prompt. */
export function componentDocs(): string {
  return COMPONENTS.map((c) => {
    const fields = c.fields
      .map((f) => `${f.key}:${f.type === 'select' ? f.options!.join('|') : f.type}=${JSON.stringify(f.default)}`)
      .join(', ');
    return `- ${c.type}${c.modes ? ` [${c.modes.join('/')} only]` : ''}: ${c.description} {${fields}}`;
  }).join('\n');
}

/** Visual-scripting node reference for the AI. */
export function nodeDocs(): string {
  return NODES.map((n) => {
    const pins = (list: typeof n.inputs) => list.map((p) => `${p.id}:${p.kind}`).join(',');
    const fields = n.fields?.length ? ` fields(${n.fields.map((f) => `${f.id}${f.options ? `=${f.options.join('|')}` : ''}`).join(',')})` : '';
    return `- ${n.type} "${n.title}": in(${pins(n.inputs)}) out(${pins(n.outputs)})${fields}`;
  }).join('\n');
}
