import { getComponentSchema, prop } from '../components/registry';
import { compileScript } from '../runtime/compile';
import type { ComponentData, EntityData, ProjectData } from '../types';
import { getNodeDef } from '../visual/nodes';

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  severity: Severity;
  message: string;
  sceneId?: string;
  entityId?: string;
  scriptId?: string;
  graphId?: string;
}

const CONTROLLERS_NEEDING_BODY = ['PlatformerController', 'FirstPersonController'];
const ASSET_FIELDS: Record<string, string> = { Mesh: 'texture', Sprite: 'image', Model: 'model', AudioSource: 'clip' };
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/**
 * Static audit of a project: broken references, missing setup, script syntax
 * errors and performance smells. Powers the editor's "Problems" panel and
 * gates publishing on errors.
 */
export function validateProject(project: ProjectData): Problem[] {
  const out: Problem[] = [];
  const assetIds = new Set(project.assets.map((a) => a.id));
  const scriptRefs = new Set(project.scripts.flatMap((s) => [s.id, s.name]));
  const graphRefs = new Set(project.graphs.flatMap((g) => [g.id, g.name]));
  const prefabRefs = new Set(project.prefabs.flatMap((p) => [p.id, p.name.toLowerCase()]));
  const hasPrefab = (ref: string) => prefabRefs.has(ref) || prefabRefs.has(ref.toLowerCase());
  const sceneRefs = new Set(project.scenes.flatMap((s) => [s.id, s.name.toLowerCase()]));

  if (project.scenes.length === 0) out.push({ severity: 'error', message: 'The project has no scenes.' });
  if (!project.scenes.some((s) => s.id === project.settings.startScene))
    out.push({ severity: 'error', message: 'The start scene is missing. Choose one in Project Settings.' });

  const checkEntities = (entities: EntityData[], ctx: { sceneId?: string; where: string; prefabNames: Set<string> }) => {
    const ids = new Set<string>();
    for (const e of entities) {
      if (ids.has(e.id)) out.push({ severity: 'error', message: `Duplicate entity id "${e.id}" in ${ctx.where}.`, sceneId: ctx.sceneId, entityId: e.id });
      ids.add(e.id);
    }
    for (const e of entities) {
      const at = { sceneId: ctx.sceneId, entityId: e.id };
      const name = `"${e.name}" (${ctx.where})`;
      if (e.parent && !ids.has(e.parent)) out.push({ severity: 'error', message: `${name} has a missing parent.`, ...at });
      const types = new Set(e.components.map((c) => c.type));
      for (const c of e.components) {
        const schema = getComponentSchema(c.type);
        if (!schema) {
          out.push({ severity: 'warning', message: `${name}: unknown component "${c.type}".`, ...at });
          continue;
        }
        if (!schema.multiple && e.components.filter((x) => x.type === c.type).length > 1)
          out.push({ severity: 'warning', message: `${name}: more than one ${schema.label}; only the first is used.`, ...at });
        if (schema.modes && !schema.modes.includes(project.settings.mode))
          out.push({ severity: 'info', message: `${name}: ${schema.label} is meant for ${schema.modes.join('/')} games.`, ...at });
        checkComponent(c, name, at);
      }
      if (types.has('RigidBody') && !types.has('Collider'))
        out.push({ severity: 'warning', message: `${name}: Rigid Body needs a Collider to be simulated.`, ...at });
      for (const ctl of CONTROLLERS_NEEDING_BODY)
        if (types.has(ctl) && !(types.has('RigidBody') && types.has('Collider')))
          out.push({ severity: 'warning', message: `${name}: ${getComponentSchema(ctl)!.label} needs a Rigid Body and a Collider.`, ...at });
      if ((types.has('Collectible') || types.has('Damage') || types.has('Goal')) && !types.has('Collider'))
        out.push({ severity: 'warning', message: `${name}: needs a Collider to detect touches.`, ...at });
      const follow = e.components.find((c) => c.type === 'FollowCamera');
      if (follow) {
        const target = prop<string>(follow, 'target');
        if (target && !entities.some((x) => x.name === target) && !ctx.prefabNames.has(target.toLowerCase()) && project.prefabs.every((p) => p.entities.every((pe) => pe.name !== target)))
          out.push({ severity: 'warning', message: `${name}: follow target "${target}" was not found.`, ...at });
      }
    }
  };

  const checkComponent = (c: ComponentData, name: string, at: { sceneId?: string; entityId?: string }) => {
    const assetField = ASSET_FIELDS[c.type];
    const assetRef = assetField ? String(c[assetField] ?? '') : '';
    if (assetRef && !assetIds.has(assetRef)) out.push({ severity: 'error', message: `${name}: ${c.type} uses a missing asset.`, ...at });
    if (c.type === 'Model' && !assetRef) out.push({ severity: 'warning', message: `${name}: 3D Model has no model file.`, ...at });
    if (c.type === 'Script') {
      const ref = String(c.script ?? '');
      if (!ref) out.push({ severity: 'warning', message: `${name}: Script component has no script selected.`, ...at });
      else if (!scriptRefs.has(ref)) out.push({ severity: 'error', message: `${name}: script "${ref}" does not exist.`, ...at });
    }
    if (c.type === 'VisualScript') {
      const ref = String(c.graph ?? '');
      if (!ref) out.push({ severity: 'warning', message: `${name}: Visual Script has no graph selected.`, ...at });
      else if (!graphRefs.has(ref)) out.push({ severity: 'error', message: `${name}: graph "${ref}" does not exist.`, ...at });
    }
    if ((c.type === 'Spawner' || c.type === 'Shooter') && !hasPrefab(String(c.prefab ?? '')))
      out.push({ severity: 'error', message: `${name}: ${c.type} needs an existing prefab.`, ...at });
    if (c.type === 'Goal' && c.scene && !sceneRefs.has(String(c.scene)) && !sceneRefs.has(String(c.scene).toLowerCase()))
      out.push({ severity: 'error', message: `${name}: Goal points to a missing scene.`, ...at });
    if (c.type === 'SpawnMenu') {
      for (const line of String(c.items ?? '').split('\n')) {
        const ref = line.split(':')[0]?.trim();
        if (ref && !hasPrefab(ref)) out.push({ severity: 'error', message: `${name}: card "${ref}" uses a missing prefab.`, ...at });
      }
    }
    if (c.type === 'RouteBuilder' && !hasPrefab(String(c.vehicle ?? ''))) out.push({ severity: 'warning', message: `${name}: Route Builder has no vehicle prefab, so no trains will run.`, ...at });
    if (c.type === 'Animator') {
      const ref = String(c.controller ?? '');
      if (!ref) out.push({ severity: 'warning', message: `${name}: Animator has no controller.`, ...at });
      else if (!(project.animators ?? []).some((a) => a.id === ref || a.name === ref)) out.push({ severity: 'error', message: `${name}: Animator uses a missing controller.`, ...at });
    }
    if (c.type === 'TileMap') {
      for (const line of String(c.legend ?? '').split('\n')) {
        const idx = line.indexOf('=');
        if (idx < 1) continue;
        const ref = line.slice(idx + 1).trim();
        if (!hasPrefab(ref)) out.push({ severity: 'error', message: `${name}: tile "${line.slice(0, idx)}" uses missing prefab "${ref}".`, ...at });
      }
    }
  };

  const prefabNames = new Set(project.prefabs.map((p) => p.name.toLowerCase()));
  for (const scene of project.scenes) {
    checkEntities(scene.entities, { sceneId: scene.id, where: scene.name, prefabNames });
    const all = scene.entities.flatMap((e) => e.components);
    if (!all.some((c) => c.type === 'Camera'))
      out.push({ severity: 'warning', message: `Scene "${scene.name}" has no camera — a default one will be used.`, sceneId: scene.id });
    if (project.settings.mode === '3d' && !all.some((c) => c.type === 'Light') && scene.environment.ambientIntensity < 0.2)
      out.push({ severity: 'warning', message: `Scene "${scene.name}" has no lights and will look dark.`, sceneId: scene.id });
    const shadowLights = all.filter((c) => c.type === 'Light' && c.castShadow && c.kind !== 'ambient' && c.kind !== 'hemisphere').length;
    if (shadowLights > 4)
      out.push({ severity: 'warning', message: `Scene "${scene.name}" has ${shadowLights} shadow-casting lights — this is slow on phones.`, sceneId: scene.id });
    if (scene.entities.length > 3000)
      out.push({ severity: 'warning', message: `Scene "${scene.name}" has ${scene.entities.length} entities; consider prefabs + tile maps.`, sceneId: scene.id });
  }
  for (const prefab of project.prefabs) {
    if (!prefab.entities.some((e) => !e.parent)) out.push({ severity: 'error', message: `Prefab "${prefab.name}" has no root entity.` });
    checkEntities(prefab.entities, { where: `prefab ${prefab.name}`, prefabNames });
  }

  for (const script of project.scripts) {
    const { error } = compileScript(script);
    if (error) out.push({ severity: 'error', message: `Script "${script.name}": ${error}`, scriptId: script.id });
  }

  for (const graph of project.graphs) {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    let hasEvent = false;
    for (const n of graph.nodes) {
      const def = getNodeDef(n.type);
      if (!def) out.push({ severity: 'error', message: `Graph "${graph.name}": unknown node "${n.type}".`, graphId: graph.id });
      if (def?.event) hasEvent = true;
    }
    if (graph.nodes.length && !hasEvent)
      out.push({ severity: 'warning', message: `Graph "${graph.name}" has no event node, so it never runs.`, graphId: graph.id });
    if (graph.edges.some((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target)))
      out.push({ severity: 'warning', message: `Graph "${graph.name}" has dangling connections.`, graphId: graph.id });
  }

  const mp = project.settings.multiplayer;
  if (mp.enabled) {
    if (!mp.playerPrefab) out.push({ severity: 'warning', message: 'Multiplayer is on but no player prefab is set (Project Settings → Multiplayer).' });
    else if (!hasPrefab(mp.playerPrefab)) out.push({ severity: 'error', message: 'The multiplayer player prefab does not exist.' });
    else {
      const p = project.prefabs.find((x) => x.id === mp.playerPrefab || x.name.toLowerCase() === mp.playerPrefab.toLowerCase());
      if (p && !p.entities.some((e) => e.components.some((c) => c.type === 'NetworkSync')))
        out.push({ severity: 'warning', message: `Player prefab "${p.name}" has no Network Sync component, so others won't see it move.` });
    }
  }

  for (const a of project.assets) if ((a.size ?? 0) > MAX_ASSET_BYTES) out.push({ severity: 'info', message: `Asset "${a.name}" is large (${Math.round((a.size ?? 0) / 1e6)} MB) and slows loading.` });

  return out;
}

export function hasBlockingProblems(problems: Problem[]): boolean {
  return problems.some((p) => p.severity === 'error');
}
