import {
  compileScript,
  getComponentSchema,
  getNodeDef,
  nodeDocs,
  summarizeProject,
  uid,
  validateProject,
  type ComponentData,
  type GraphData,
  type Vec3,
} from '@bazi/engine';
import {
  addEntity,
  addScene,
  deleteEntities,
  findEntity,
  makePrefab,
  newScript,
  updateEntity,
  updateScript,
  upsertComponent,
} from '../../store/commands';
import { editor } from '../../store/editor';

/**
 * Tools the AI can call. Every tool goes through the same editor commands
 * as the UI, so AI changes are validated, visible and undoable (Ctrl+Z).
 */
type Json = Record<string, unknown>;
interface Tool {
  description: string;
  parameters: Json;
  run(args: Json): unknown;
}

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const componentList = {
  type: 'array',
  description: 'Components: [{ "type": "Mesh", "color": "#ff0000" }, { "type": "RigidBody" }, ...]. Omitted props use defaults.',
  items: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], additionalProperties: true },
};

function requireEntity(ref: unknown) {
  const e = findEntity(String(ref ?? ''));
  if (!e) throw new Error(`Entity "${ref}" not found in the current scene. Call get_project to see entity ids.`);
  return e;
}

function checkComponents(list: unknown): ComponentData[] {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const type = String((c as Json).type);
    if (!getComponentSchema(type)) throw new Error(`Unknown component type "${type}".`);
    return c as ComponentData;
  });
}

function resolveRefs(c: ComponentData): ComponentData {
  // Let the AI reference scripts/graphs by name.
  const project = editor().project!;
  if (c.type === 'Script' && typeof c.script === 'string') {
    const s = project.scripts.find((x) => x.id === c.script || x.name === c.script);
    if (s) c.script = s.id;
  }
  if (c.type === 'VisualScript' && typeof c.graph === 'string') {
    const g = project.graphs.find((x) => x.id === c.graph || x.name === c.graph);
    if (g) c.graph = g.id;
  }
  return c;
}

export const TOOLS: Record<string, Tool> = {
  get_project: {
    description: 'Get a compact JSON overview of the project: settings, current scene entities (with ids and non-default component props), prefabs, scripts, graphs and assets.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const { project, sceneId } = editor();
      return summarizeProject(project!, sceneId);
    },
  },
  create_entity: {
    description: 'Create an entity in the current scene. Rotation is in degrees. Sizes come from scale (primitive meshes are 1 unit).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parent: { type: 'string', description: 'Parent entity id or name' },
        position: vec3,
        rotation: vec3,
        scale: vec3,
        tags: { type: 'array', items: { type: 'string' } },
        components: componentList,
      },
      required: ['name'],
    },
    run: (a) => {
      const components = checkComponents(a.components).map((c) => resolveRefs(c));
      const parent = a.parent ? requireEntity(a.parent).id : null;
      const id = addEntity(
        {
          name: String(a.name),
          parent,
          position: a.position as Vec3,
          rotation: a.rotation as Vec3,
          scale: a.scale as Vec3,
          tags: (a.tags as string[]) ?? [],
          components: [],
        },
        { label: `AI: create ${a.name}` },
      );
      for (const c of components) upsertComponent(id, c.type, c);
      return { id };
    },
  },
  update_entity: {
    description: 'Change an entity\'s name, transform, tags, enabled state or parent (null = root).',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Entity id or name' }, name: { type: 'string' }, position: vec3, rotation: vec3, scale: vec3, tags: { type: 'array', items: { type: 'string' } }, enabled: { type: 'boolean' }, parent: { type: ['string', 'null'] } },
      required: ['id'],
    },
    run: (a) => {
      const e = requireEntity(a.id);
      const parent = a.parent === undefined ? undefined : a.parent === null ? null : requireEntity(a.parent).id;
      updateEntity(e.id, (x) => {
        if (typeof a.name === 'string') x.name = a.name;
        if (a.position) x.transform.position = a.position as Vec3;
        if (a.rotation) x.transform.rotation = a.rotation as Vec3;
        if (a.scale) x.transform.scale = a.scale as Vec3;
        if (Array.isArray(a.tags)) x.tags = a.tags as string[];
        if (typeof a.enabled === 'boolean') x.enabled = a.enabled;
        if (parent !== undefined && parent !== x.id) x.parent = parent;
      }, `AI: edit ${e.name}`);
      return { ok: true };
    },
  },
  set_component: {
    description: 'Add a component to an entity, or update props of an existing one of that type.',
    parameters: { type: 'object', properties: { entity: { type: 'string', description: 'Entity id or name' }, type: { type: 'string' }, props: { type: 'object', additionalProperties: true } }, required: ['entity', 'type'] },
    run: (a) => {
      const e = requireEntity(a.entity);
      const [c] = checkComponents([{ ...((a.props as Json) ?? {}), type: a.type }]);
      upsertComponent(e.id, c.type, resolveRefs(c));
      return { ok: true };
    },
  },
  remove_component: {
    description: 'Remove a component type from an entity.',
    parameters: { type: 'object', properties: { entity: { type: 'string' }, type: { type: 'string' } }, required: ['entity', 'type'] },
    run: (a) => {
      const e = requireEntity(a.entity);
      updateEntity(e.id, (x) => void (x.components = x.components.filter((c) => c.type !== a.type)), `AI: remove ${a.type}`);
      return { ok: true };
    },
  },
  delete_entity: {
    description: 'Delete an entity and its children.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'Entity id or name' } }, required: ['id'] },
    run: (a) => {
      deleteEntities([requireEntity(a.id).id]);
      return { ok: true };
    },
  },
  write_script: {
    description: 'Create or overwrite a script (by name). Optionally attach it to an entity with params. Returns syntax errors if any — fix them.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string', description: 'Script body using hooks like function start(), function update(dt), function onCollision(other)' },
        language: { type: 'string', enum: ['javascript', 'typescript'] },
        attach_to: { type: 'string', description: 'Entity id or name' },
        params: { type: 'object', additionalProperties: true },
      },
      required: ['name', 'code'],
    },
    run: (a) => {
      const project = editor().project!;
      const language = a.language === 'typescript' ? 'typescript' : 'javascript';
      const existing = project.scripts.find((s) => s.name === a.name);
      const code = String(a.code);
      let id = existing?.id;
      if (existing) updateScript(existing.id, { code, language });
      else id = newScript(String(a.name), { code, language });
      if (a.attach_to) {
        const e = requireEntity(a.attach_to);
        updateEntity(e.id, (x) => {
          const c = x.components.find((cc) => cc.type === 'Script' && cc.script === id);
          if (c) c.params = (a.params as Json) ?? c.params;
          else x.components.push({ type: 'Script', script: id, params: (a.params as Json) ?? {} });
        }, 'AI: attach script');
      }
      const { error } = compileScript({ code, language });
      return error ? { id, syntaxError: error } : { id, ok: true };
    },
  },
  read_script: {
    description: 'Read the code of a script by name or id.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (a) => {
      const s = editor().project!.scripts.find((x) => x.name === a.name || x.id === a.name);
      if (!s) throw new Error(`Script "${a.name}" not found`);
      return { name: s.name, language: s.language, code: s.code };
    },
  },
  list_visual_nodes: {
    description: 'List all visual-scripting node types with their pins and fields.',
    parameters: { type: 'object', properties: {} },
    run: () => ({ nodes: nodeDocs() }),
  },
  write_visual_script: {
    description:
      'Create or replace a visual script graph (no-code logic). Nodes: [{id, type, x, y, data}] where data holds field and inline input values. Edges: [{from: "nodeId.pin", to: "nodeId.pin"}]. Exec flow goes from an event\'s "out" to an action\'s "in". Call list_visual_nodes first.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, data: { type: 'object', additionalProperties: true } }, required: ['id', 'type'] } },
        edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
        attach_to: { type: 'string' },
      },
      required: ['name', 'nodes', 'edges'],
    },
    run: (a) => {
      const nodes = (a.nodes as Json[]).map((n, i) => {
        if (!getNodeDef(String(n.type))) throw new Error(`Unknown node type "${n.type}". Use list_visual_nodes.`);
        return { id: String(n.id), type: String(n.type), position: { x: Number(n.x ?? (i % 4) * 260), y: Number(n.y ?? Math.floor(i / 4) * 180) }, data: (n.data as Json) ?? {} };
      });
      const ids = new Set(nodes.map((n) => n.id));
      const edges = (a.edges as { from: string; to: string }[]).map((e) => {
        const [source, sourceHandle] = e.from.split('.');
        const [target, targetHandle] = e.to.split('.');
        if (!ids.has(source) || !ids.has(target)) throw new Error(`Edge ${e.from} -> ${e.to} references a missing node`);
        return { id: uid('ed_'), source, sourceHandle: sourceHandle ?? 'out', target, targetHandle: targetHandle ?? 'in' };
      });
      const project = editor().project!;
      const existing = project.graphs.find((g) => g.name === a.name);
      const graph: GraphData = { id: existing?.id ?? uid('g_'), name: String(a.name), nodes, edges };
      editor().apply(`AI: visual script ${graph.name}`, (d) => {
        const i = d.graphs.findIndex((g) => g.id === graph.id);
        if (i >= 0) d.graphs[i] = graph;
        else d.graphs.push(graph);
      });
      if (a.attach_to) {
        const e = requireEntity(a.attach_to);
        if (!e.components.some((c) => c.type === 'VisualScript' && c.graph === graph.id))
          updateEntity(e.id, (x) => void x.components.push({ type: 'VisualScript', graph: graph.id }), 'AI: attach graph');
      }
      editor().openGraph(graph.id);
      return { id: graph.id, ok: true };
    },
  },
  create_prefab: {
    description: 'Create a reusable prefab (for Spawner, Shooter, TileMap legends, multiplayer players) from components, or from an existing entity.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, from_entity: { type: 'string' }, components: componentList, scale: vec3, tags: { type: 'array', items: { type: 'string' } }, remove_from_scene: { type: 'boolean' } },
      required: ['name'],
    },
    run: (a) => {
      const name = String(a.name);
      if (a.from_entity) {
        const e = requireEntity(a.from_entity);
        const id = makePrefab(e.id, name);
        if (a.remove_from_scene) deleteEntities([e.id]);
        return { id };
      }
      const components = checkComponents(a.components).map(resolveRefs);
      const id = addEntity({ name, scale: a.scale as Vec3, tags: (a.tags as string[]) ?? [] }, { select: false, label: `AI: prefab ${name}` });
      for (const c of components) upsertComponent(id, c.type, c);
      const prefabId = makePrefab(id, name);
      deleteEntities([id]);
      return { id: prefabId };
    },
  },
  update_settings: {
    description: 'Change project settings. Accepts any subset, e.g. {"mode":"2d","gravity":[0,-30,0],"background":"#000","multiplayer":{"enabled":true,"playerPrefab":"Player"},"graphics":{"bloom":true},"xr":{"enabled":true}}.',
    parameters: { type: 'object', properties: { settings: { type: 'object', additionalProperties: true } }, required: ['settings'] },
    run: (a) => {
      const patch = a.settings as Json;
      editor().apply('AI: settings', (d) => {
        for (const [k, v] of Object.entries(patch)) {
          const cur = (d.settings as unknown as Json)[k];
          (d.settings as unknown as Json)[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v) ? { ...cur, ...(v as Json) } : v;
        }
      });
      return { ok: true };
    },
  },
  create_scene: {
    description: 'Add a new scene (level) with a default camera and lights, and switch to it.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (a) => ({ id: addScene(String(a.name)) }),
  },
  switch_scene: {
    description: 'Open another scene for editing by name or id.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (a) => {
      const s = editor().project!.scenes.find((x) => x.name === a.name || x.id === a.name);
      if (!s) throw new Error('Scene not found');
      editor().setScene(s.id);
      return { ok: true };
    },
  },
  get_problems: {
    description: 'Run the project audit: broken references, missing setup, script errors. Use after making changes.',
    parameters: { type: 'object', properties: {} },
    run: () => ({ problems: validateProject(editor().project!).map((p) => `${p.severity}: ${p.message}`) }),
  },
  select_entity: {
    description: 'Select an entity in the editor so the user sees it.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (a) => {
      editor().select([requireEntity(a.id).id]);
      return { ok: true };
    },
  },
};

export const TOOL_SPECS = Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', function: { name, description: t.description, parameters: t.parameters } }));

export function runTool(name: string, rawArgs: string): { ok: boolean; result: unknown } {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, result: { error: `Unknown tool ${name}` } };
  try {
    const args = rawArgs ? (JSON.parse(rawArgs) as Json) : {};
    return { ok: true, result: tool.run(args) ?? { ok: true } };
  } catch (err) {
    return { ok: false, result: { error: (err as Error).message } };
  }
}
