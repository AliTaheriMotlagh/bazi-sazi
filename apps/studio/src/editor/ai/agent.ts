import { componentDocs, SCRIPT_API_DTS } from '@bazi/engine';
import { api, type AiMessage } from '../../api/client';
import { editor } from '../../store/editor';
import { runTool, TOOL_SPECS } from './tools';

const MAX_STEPS = 14;

function systemPrompt(): string {
  const p = editor().project!;
  return `You are the built-in game-development assistant of Bazi-Sazi, a web game engine studio. You help people of every skill level — many are complete beginners — design and build games. You can directly edit their project with tools; prefer doing the work over explaining how.

Project: "${p.name}" (${p.settings.mode.toUpperCase()} game).

HOW THE ENGINE WORKS
- A project has scenes; scenes contain entities (name, tags, transform, components). Rotation is in degrees. 1 unit ≈ 1 meter. Primitive meshes are 1 unit; size them with scale.
- 2D games use the XY plane (camera looks down -Z), Sprites for visuals. 3D games use Y-up, Meshes/Models.
- Physics: RigidBody + Collider. A Collider without RigidBody is static level geometry. Triggers (isTrigger) detect overlaps.
- No-code behaviours (components) cover most games: PlatformerController, TopDownController, FirstPersonController, FollowCamera, Rotator, Oscillator, Collectible, Health, Damage, Spawner, Shooter, DestroyAfter, Goal, HudText, TileMap, NetworkSync.
- Game variables (game.vars) are shown with {name} in HudText/Text, e.g. "Score: {score}". Collectible adds to a variable.
- Spawner/Shooter/TileMap reference prefabs BY NAME. Create prefabs first with create_prefab.
- Tags connect things: Damage.targetTag, Collectible.collectorTag, Goal.tag. Players should be tagged "player".
- Scripts are JavaScript (or TypeScript) with hook functions and an injected API (self, game, input, audio, net, params, THREE, log, vec3, random, clamp, lerp). No imports, no exports.
- Visual scripts are node graphs (events → actions). Use them when the user wants no-code logic.

COMPONENTS (type: description {prop:type=default})
${componentDocs()}

SCRIPT API (TypeScript declarations)
${SCRIPT_API_DTS}

RULES
- Call get_project first if you need ids or the current state. Reference entities by id (or exact name).
- Build complete, playable results: camera, lights (3D), player with controller, level geometry, goals/score, HUD.
- After building or changing logic, call get_problems and fix any errors.
- Keep explanations short, friendly and concrete. Tell the user how to test it (press ▶ Play) and the controls.
- Never invent component types or props that are not listed. Unknown props are ignored.`;
}

export interface AgentEvent {
  kind: 'text' | 'tool' | 'error';
  text: string;
  ok?: boolean;
}

/**
 * Tool-use loop: send the conversation, execute any tool calls against the
 * editor, send results back, repeat until the model answers in text.
 */
export async function runAgent(history: AiMessage[], opts: { model: string; apiKey?: string; onEvent(e: AgentEvent): void; signal?: AbortSignal }): Promise<AiMessage[]> {
  const messages = [...history];
  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) break;
    const res = await api.aiChat({ model: opts.model, messages: [{ role: 'system', content: systemPrompt() }, ...messages], tools: TOOL_SPECS, temperature: 0.3 }, opts.apiKey);
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new Error('The AI returned an empty response.');
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    if (msg.content?.trim()) opts.onEvent({ kind: 'text', text: msg.content.trim() });
    if (!msg.tool_calls?.length) return messages;
    for (const call of msg.tool_calls) {
      const { ok, result } = runTool(call.function.name, call.function.arguments);
      opts.onEvent({ kind: 'tool', text: describe(call.function.name, call.function.arguments, result), ok });
      let content = JSON.stringify(result);
      if (content.length > 24000) content = `${content.slice(0, 24000)}…(truncated)`;
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });
    }
  }
  opts.onEvent({ kind: 'error', text: 'Stopped after many steps. Ask me to continue if needed.' });
  return messages;
}

function describe(name: string, rawArgs: string, result: unknown): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    /* ignore */
  }
  const err = (result as { error?: string; syntaxError?: string })?.error ?? (result as { syntaxError?: string })?.syntaxError;
  const label: Record<string, string> = {
    get_project: 'Read the project',
    create_entity: `Created “${args.name}”`,
    update_entity: `Updated ${args.id}`,
    set_component: `Set ${args.type} on ${args.entity}`,
    remove_component: `Removed ${args.type} from ${args.entity}`,
    delete_entity: `Deleted ${args.id}`,
    write_script: `Wrote script “${args.name}”`,
    read_script: `Read script “${args.name}”`,
    list_visual_nodes: 'Looked up visual nodes',
    write_visual_script: `Built visual script “${args.name}”`,
    create_prefab: `Created prefab “${args.name}”`,
    update_settings: 'Changed project settings',
    create_scene: `Added scene “${args.name}”`,
    switch_scene: `Opened scene “${args.name}”`,
    get_problems: `Checked for problems (${((result as { problems?: unknown[] })?.problems ?? []).length})`,
    select_entity: `Selected ${args.id}`,
  };
  return `${label[name] ?? name}${err ? ` — ${err}` : ''}`;
}
