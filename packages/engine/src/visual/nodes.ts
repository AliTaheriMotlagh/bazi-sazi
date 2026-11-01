import type { GraphNodeData, Vec3 } from '../types';
import type { GameObject } from '../runtime/GameObject';
import type { GameApi } from '../runtime/Runtime';

export type PinKind = 'exec' | 'number' | 'string' | 'boolean' | 'entity' | 'any';

export interface PinDef {
  id: string;
  label: string;
  kind: PinKind;
  default?: unknown;
  options?: string[];
}

export type NodeCategory =
  | 'Events'
  | 'Flow'
  | 'Actions'
  | 'Entity'
  | 'Variables'
  | 'Math'
  | 'Logic'
  | 'Input'
  | 'Scene'
  | 'Network';

export type ExecResult = string | null | void | { delay: number; pin: string };

export interface NodeCtx {
  node: GraphNodeData;
  self: GameObject;
  api: GameApi;
  /** Evaluate a data input (connected value or inline value). */
  in<T = unknown>(pin: string): T;
  /** Resolve an entity input: connected entity, entity name, or self. */
  entity(pin: string): GameObject | undefined;
  /** Static node setting. */
  field<T = unknown>(key: string): T;
  /** Publish a data output value (exec nodes). */
  out(pin: string, value: unknown): void;
  /** Synchronously run everything connected to an exec output. */
  fire(pin: string): void;
  /** Persistent per-node state. */
  state: Record<string, unknown>;
}

export interface NodeDef {
  type: string;
  title: string;
  category: NodeCategory;
  description: string;
  inputs: PinDef[];
  outputs: PinDef[];
  fields?: PinDef[];
  /** Marks an event node; value is the event name the interpreter dispatches. */
  event?: string;
  exec?(n: NodeCtx): ExecResult;
  compute?(n: NodeCtx): Record<string, unknown>;
}

// ── tiny DSL to keep definitions readable
const exec = (id = 'in', label = ''): PinDef => ({ id, label, kind: 'exec' });
const num = (id: string, label: string, def = 0): PinDef => ({ id, label, kind: 'number', default: def });
const str = (id: string, label: string, def = ''): PinDef => ({ id, label, kind: 'string', default: def });
const bool = (id: string, label: string, def = false): PinDef => ({ id, label, kind: 'boolean', default: def });
const ent = (id = 'target', label = 'Target'): PinDef => ({ id, label, kind: 'entity', default: '' });
const any = (id: string, label: string, def: unknown = ''): PinDef => ({ id, label, kind: 'any', default: def });
const sel = (id: string, label: string, options: string[], def = options[0]): PinDef => ({ id, label, kind: 'string', options, default: def });
const OUT = [exec('out')];
const xyz = (def: Vec3 = [0, 0, 0]) => [num('x', 'X', def[0]), num('y', 'Y', def[1]), num('z', 'Z', def[2])];

const ACTIONS = ['jump', 'fire', 'action', 'left', 'right', 'up', 'down', 'pause'];
const SOUNDS = ['coin', 'jump', 'hit', 'explosion', 'powerup', 'laser', 'blip', 'lose', 'win'];

const event = (type: string, title: string, eventName: string, description: string, outputs: PinDef[] = [], fields: PinDef[] = []): NodeDef => ({
  type,
  title,
  category: 'Events',
  description,
  inputs: [],
  outputs: [exec('out'), ...outputs],
  fields,
  event: eventName,
});

const action = (type: string, title: string, description: string, inputs: PinDef[], run: (n: NodeCtx) => void, extra: Partial<NodeDef> = {}): NodeDef => ({
  type,
  title,
  category: 'Actions',
  description,
  inputs: [exec(), ...inputs],
  outputs: OUT,
  exec: (n) => {
    run(n);
  },
  ...extra,
});

const pure = (type: string, title: string, category: NodeCategory, description: string, inputs: PinDef[], outputs: PinDef[], compute: (n: NodeCtx) => Record<string, unknown>, fields: PinDef[] = []): NodeDef => ({
  type,
  title,
  category,
  description,
  inputs,
  outputs,
  fields,
  compute,
});

const MATH_OPS: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b === 0 ? 0 : a / b),
  '%': (a, b) => (b === 0 ? 0 : a % b),
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const COMPARE_OPS: Record<string, (a: unknown, b: unknown) => boolean> = {
  '==': (a, b) => a == b,
  '!=': (a, b) => a != b,
  '<': (a, b) => Number(a) < Number(b),
  '>': (a, b) => Number(a) > Number(b),
  '<=': (a, b) => Number(a) <= Number(b),
  '>=': (a, b) => Number(a) >= Number(b),
};

const FUNCS: Record<string, (v: number) => number> = {
  abs: Math.abs,
  floor: Math.floor,
  round: Math.round,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  sign: Math.sign,
  negate: (v) => -v,
};

const perSecond = (n: NodeCtx) => (n.field<boolean>('perSecond') ? n.api.time.dt : 1);

const scopeVars = (n: NodeCtx): Record<string, unknown> => (n.field<string>('scope') === 'self' ? n.self.vars : n.api.vars);

export const NODES: NodeDef[] = [
  // ───────────── Events
  event('event.start', 'On Start', 'start', 'Runs once when the game starts.'),
  event('event.update', 'On Every Frame', 'update', 'Runs every frame.', [num('dt', 'Delta time')]),
  event('event.actionPressed', 'On Input Pressed', 'actionPressed', 'When an input action is pressed.', [], [sel('action', 'Action', ACTIONS)]),
  event('event.actionHeld', 'While Input Held', 'actionHeld', 'Every frame while an action is held.', [num('dt', 'Delta time')], [sel('action', 'Action', ACTIONS)]),
  event('event.actionReleased', 'On Input Released', 'actionReleased', 'When an input action is released.', [], [sel('action', 'Action', ACTIONS)]),
  event('event.collision', 'On Collision', 'collision', 'When this touches something (optionally filtered by tag).', [ent('other', 'Other')], [str('tag', 'Tag filter')]),
  event('event.trigger', 'On Trigger Enter', 'trigger', 'When something enters this trigger.', [ent('other', 'Other')], [str('tag', 'Tag filter')]),
  event('event.message', 'On Message', 'message', 'When this entity receives a message.', [any('data', 'Data'), ent('from', 'From')], [str('name', 'Message', 'hello')]),
  event('event.click', 'On Clicked', 'click', 'When the player clicks/taps this entity.'),
  event('event.timer', 'Every N Seconds', 'timer', 'Runs repeatedly on a timer.', [], [num('seconds', 'Seconds', 1)]),
  event('event.netMessage', 'On Network Message', 'netMessage', 'Multiplayer: another player sent a message.', [any('data', 'Data'), str('from', 'Player id')], [str('type', 'Type', 'chat')]),
  event('event.destroy', 'On Destroyed', 'destroy', 'Right before this entity is removed.'),

  // ───────────── Flow
  {
    type: 'flow.branch',
    title: 'Branch (If)',
    category: 'Flow',
    description: 'Continue on True or False.',
    inputs: [exec(), bool('condition', 'Condition', true)],
    outputs: [exec('true', 'True'), exec('false', 'False')],
    exec: (n) => (n.in<boolean>('condition') ? 'true' : 'false'),
  },
  {
    type: 'flow.sequence',
    title: 'Sequence',
    category: 'Flow',
    description: 'Run several outputs in order.',
    inputs: [exec()],
    outputs: [exec('then1', 'Then 1'), exec('then2', 'Then 2'), exec('then3', 'Then 3')],
    exec: (n) => {
      n.fire('then1');
      n.fire('then2');
      n.fire('then3');
      return null;
    },
  },
  {
    type: 'flow.delay',
    title: 'Wait',
    category: 'Flow',
    description: 'Wait some seconds, then continue.',
    inputs: [exec(), num('seconds', 'Seconds', 1)],
    outputs: OUT,
    exec: (n) => ({ delay: Math.max(0, n.in<number>('seconds')), pin: 'out' }),
  },
  {
    type: 'flow.forLoop',
    title: 'Repeat',
    category: 'Flow',
    description: 'Run "Body" N times, then "Done".',
    inputs: [exec(), num('count', 'Times', 3)],
    outputs: [exec('body', 'Body'), num('index', 'Index'), exec('done', 'Done')],
    exec: (n) => {
      const count = Math.min(10000, Math.max(0, Math.floor(n.in<number>('count'))));
      for (let i = 0; i < count; i++) {
        n.out('index', i);
        n.fire('body');
      }
      return 'done';
    },
  },
  {
    type: 'flow.doOnce',
    title: 'Do Once',
    category: 'Flow',
    description: 'Only lets execution through the first time.',
    inputs: [exec()],
    outputs: OUT,
    exec: (n) => {
      if (n.state.done) return null;
      n.state.done = true;
    },
  },
  {
    type: 'flow.chance',
    title: 'Random Chance',
    category: 'Flow',
    description: 'Continue on "Yes" with the given probability (0..1).',
    inputs: [exec(), num('chance', 'Chance', 0.5)],
    outputs: [exec('yes', 'Yes'), exec('no', 'No')],
    exec: (n) => (Math.random() < n.in<number>('chance') ? 'yes' : 'no'),
  },

  // ───────────── Actions: entity
  action('action.move', 'Move', 'Move by an amount (per second when enabled).', [ent(), ...xyz([1, 0, 0])], (n) => {
    const k = perSecond(n);
    n.entity('target')?.move(n.in<number>('x') * k, n.in<number>('y') * k, n.in<number>('z') * k);
  }, { fields: [bool('perSecond', 'Per second', true)] }),
  action('action.setPosition', 'Set Position', 'Teleport to a position.', [ent(), ...xyz()], (n) => {
    n.entity('target')?.setPosition(n.in<number>('x'), n.in<number>('y'), n.in<number>('z'));
  }),
  action('action.rotate', 'Rotate', 'Rotate by degrees (per second when enabled).', [ent(), ...xyz([0, 90, 0])], (n) => {
    const k = perSecond(n);
    n.entity('target')?.rotate(n.in<number>('x') * k, n.in<number>('y') * k, n.in<number>('z') * k);
  }, { fields: [bool('perSecond', 'Per second', true)] }),
  action('action.setVelocity', 'Set Velocity', 'Set physics velocity.', [ent(), ...xyz()], (n) => {
    n.entity('target')?.setVelocity(n.in<number>('x'), n.in<number>('y'), n.in<number>('z'));
  }),
  action('action.impulse', 'Push (Impulse)', 'Apply a physics impulse.', [ent(), ...xyz([0, 5, 0])], (n) => {
    n.entity('target')?.applyImpulse(n.in<number>('x'), n.in<number>('y'), n.in<number>('z'));
  }),
  action('action.jump', 'Jump', 'Jump if standing on the ground.', [ent(), num('force', 'Force', 10)], (n) => {
    const e = n.entity('target');
    if (e?.isGrounded()) {
      const v = e.velocity;
      e.setVelocity(v.x, n.in<number>('force'), v.z);
    }
  }),
  action('action.lookAt', 'Look At', 'Turn to face another entity.', [ent(), ent('other', 'Look at')], (n) => {
    const o = n.entity('other');
    if (o) {
      const p = o.worldPosition();
      n.entity('target')?.lookAt(p.x, p.y, p.z);
    }
  }),
  action('action.destroy', 'Destroy', 'Remove an entity.', [ent()], (n) => n.entity('target')?.destroy()),
  {
    type: 'action.spawn',
    title: 'Spawn Prefab',
    category: 'Actions',
    description: 'Create a copy of a prefab.',
    inputs: [exec(), str('prefab', 'Prefab'), ...xyz()],
    outputs: [exec('out'), ent('spawned', 'Spawned')],
    fields: [bool('atSelf', 'At this entity (+offset)', true)],
    exec: (n) => {
      const offset = [n.in<number>('x'), n.in<number>('y'), n.in<number>('z')] as Vec3;
      const base = n.field<boolean>('atSelf') ? n.self.worldPosition() : null;
      const position: Vec3 = base ? [base.x + offset[0], base.y + offset[1], base.z + offset[2]] : offset;
      n.out('spawned', n.api.spawn(n.in<string>('prefab'), { position }));
    },
  },
  action('action.setVisible', 'Set Visible', 'Show or hide.', [ent(), bool('visible', 'Visible', true)], (n) => {
    const e = n.entity('target');
    if (e) e.visible = n.in<boolean>('visible');
  }),
  action('action.setColor', 'Set Color', 'Change color (e.g. #ff0000).', [ent(), str('color', 'Color', '#ff4466')], (n) => {
    n.entity('target')?.setColor(n.in<string>('color'));
  }),
  action('action.setText', 'Set Text', 'Change a World Text.', [ent(), any('text', 'Text', 'Hi!')], (n) => {
    n.entity('target')?.setText(String(n.in('text')));
  }),
  action('action.animation', 'Play Animation', 'Play a 3D model animation clip.', [ent(), str('clip', 'Clip', 'Run')], (n) => {
    n.entity('target')?.playAnimation(n.in<string>('clip'));
  }),
  action('action.sendMessage', 'Send Message', 'Send a message to an entity (or every entity with a tag).', [ent(), str('message', 'Message', 'hello'), any('data', 'Data')], (n) => {
    const msg = n.in<string>('message');
    const data = n.in('data');
    const tag = n.field<string>('toTag');
    if (tag) for (const e of n.api.findAll(tag)) e.send(msg, data, n.self);
    else n.entity('target')?.send(msg, data, n.self);
  }, { fields: [str('toTag', 'Or: all with tag')] }),

  action('action.moveTo', 'Move To (Pathfinding)', 'Walk around obstacles to a point (needs Nav Agent).', [ent(), ...xyz()], (n) => {
    n.entity('target')?.moveTo(n.in<number>('x'), n.in<number>('y'), n.in<number>('z'));
  }),
  action('action.punch', 'Punch Scale', 'Juicy squash & stretch bounce.', [ent(), num('amount', 'Amount', 0.3)], (n) => {
    const e = n.entity('target');
    if (!e) return;
    const s = e.scale.clone();
    const k = 1 + n.in<number>('amount');
    n.api.tween(e.scale, { x: s.x * k, y: s.y * k, z: s.z * k }, 0.12, { yoyo: true, ease: 'outQuad' });
  }),
  action('action.animateMove', 'Animate Move', 'Smoothly move to a position over time.', [ent(), ...xyz(), num('seconds', 'Seconds', 0.5)], (n) => {
    const e = n.entity('target');
    if (e) n.api.tween(e.position, { x: n.in<number>('x'), y: n.in<number>('y'), z: n.in<number>('z') }, n.in<number>('seconds'), { ease: (n.field<string>('ease') as 'outQuad') ?? 'outQuad' });
  }, { fields: [sel('ease', 'Easing', ['outQuad', 'inOutSine', 'outBack', 'outBounce', 'outElastic', 'linear'])] }),
  action('fx.shake', 'Camera Shake', 'Shake the screen.', [num('strength', 'Strength', 0.3), num('seconds', 'Seconds', 0.3)], (n) => {
    n.api.fx.shake(n.in<number>('strength'), n.in<number>('seconds'));
  }, { category: 'Scene' }),
  action('fx.popText', 'Floating Text', 'Text that floats up from an entity (+10, -3, Critical!).', [ent(), any('text', 'Text', '+1'), str('color', 'Color', '#ffd166')], (n) => {
    const e = n.entity('target');
    if (e) n.api.fx.popText(e.worldPosition(), String(n.in('text')), n.in<string>('color'));
  }, { category: 'Scene' }),
  action('fx.burst', 'Particle Burst', 'One-shot explosion of particles.', [ent(), str('color', 'Color', '#ffd166'), num('count', 'Count', 40)], (n) => {
    const e = n.entity('target');
    if (e) n.api.fx.burst(e.worldPosition(), n.in<string>('color'), n.in<number>('count'));
  }, { category: 'Scene' }),

  // ───────────── Variables
  action('var.set', 'Set Variable', 'Store a value (game-wide or on this entity).', [any('value', 'Value', 0)], (n) => {
    scopeVars(n)[n.field<string>('name')] = n.in('value');
  }, { category: 'Variables', fields: [str('name', 'Name', 'score'), sel('scope', 'Scope', ['game', 'self'])] }),
  action('var.add', 'Add To Variable', 'Increase a number variable.', [num('amount', 'Amount', 1)], (n) => {
    const vars = scopeVars(n);
    const key = n.field<string>('name');
    vars[key] = (Number(vars[key]) || 0) + n.in<number>('amount');
  }, { category: 'Variables', fields: [str('name', 'Name', 'score'), sel('scope', 'Scope', ['game', 'self'])] }),
  pure('var.get', 'Get Variable', 'Variables', 'Read a variable.', [], [any('value', 'Value')], (n) => ({ value: scopeVars(n)[n.field<string>('name')] ?? 0 }), [
    str('name', 'Name', 'score'),
    sel('scope', 'Scope', ['game', 'self']),
  ]),

  // ───────────── Scene / UI / audio
  action('action.sound', 'Play Sound', 'Play a built-in sound or audio asset name.', [sel('sound', 'Sound', SOUNDS)], (n) => {
    n.api.audio.play(n.in<string>('sound'));
  }, { category: 'Scene' }),
  action('action.hud', 'Show HUD Text', 'Show text on screen.', [str('key', 'Slot', 'info'), any('text', 'Text', 'Hello')], (n) => {
    n.api.hud.set(n.in<string>('key'), String(n.in('text')));
  }, { category: 'Scene' }),
  action('action.banner', 'Show Message', 'Big centered message.', [any('text', 'Text', 'Level up!'), num('seconds', 'Seconds', 2)], (n) => {
    n.api.hud.message(String(n.in('text')), n.in<number>('seconds'));
  }, { category: 'Scene' }),
  action('scene.load', 'Load Scene', 'Switch to another scene.', [str('scene', 'Scene name')], (n) => n.api.loadScene(n.in<string>('scene')), { category: 'Scene' }),
  action('scene.restart', 'Restart', 'Restart the current scene.', [], (n) => n.api.restart(), { category: 'Scene' }),
  action('scene.win', 'Win', 'Show a win message.', [str('message', 'Message', 'You win!')], (n) => n.api.win(n.in<string>('message')), { category: 'Scene' }),
  action('scene.gameOver', 'Game Over', 'Show game over and restart.', [str('message', 'Message', 'Game over')], (n) => n.api.gameOver(n.in<string>('message')), { category: 'Scene' }),
  action('debug.log', 'Print', 'Write to the console.', [any('value', 'Value', 'Hello!')], (n) => {
    n.api.log('log', [n.in('value')], 'Visual script', n.self.id);
  }, { category: 'Scene' }),

  // ───────────── Network
  action('net.send', 'Send To Players', 'Multiplayer: send a message to all players.', [str('type', 'Type', 'chat'), any('data', 'Data')], (n) => {
    n.api.net?.send(n.in<string>('type'), n.in('data'));
  }, { category: 'Network' }),
  action('net.setState', 'Set Shared State', 'Multiplayer: set a shared room value.', [str('key', 'Key', 'round'), any('value', 'Value', 1)], (n) => {
    n.api.net?.setState(n.in<string>('key'), n.in('value'));
  }, { category: 'Network' }),
  pure('net.getState', 'Get Shared State', 'Network', 'Multiplayer: read a shared room value.', [str('key', 'Key', 'round')], [any('value', 'Value')], (n) => ({
    value: n.api.net?.state[n.in<string>('key')] ?? 0,
  })),
  pure('net.info', 'Network Info', 'Network', 'Multiplayer status.', [], [bool('isHost', 'Is host'), num('players', 'Players'), str('id', 'My id')], (n) => ({
    isHost: n.api.net?.isHost ?? true,
    players: n.api.net ? n.api.net.players.size : 1,
    id: n.api.net?.id ?? '',
  })),

  // ───────────── Entity data
  pure('data.self', 'This Entity', 'Entity', 'The entity running this graph.', [], [ent('entity', 'Entity')], (n) => ({ entity: n.self })),
  pure('data.find', 'Find Entity', 'Entity', 'Find by name.', [str('name', 'Name', 'Player')], [ent('entity', 'Entity'), bool('found', 'Found')], (n) => {
    const e = n.api.find(n.in<string>('name'));
    return { entity: e, found: !!e };
  }),
  pure('data.position', 'Get Position', 'Entity', 'World position of an entity.', [ent()], [num('x', 'X'), num('y', 'Y'), num('z', 'Z')], (n) => {
    const p = n.entity('target')?.worldPosition();
    return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 };
  }),
  pure('data.velocity', 'Get Velocity', 'Entity', 'Physics velocity.', [ent()], [num('x', 'X'), num('y', 'Y'), num('z', 'Z')], (n) => {
    const v = n.entity('target')?.velocity;
    return { x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0 };
  }),
  pure('data.distance', 'Distance', 'Entity', 'Distance between two entities.', [ent('a', 'A'), ent('b', 'B')], [num('distance', 'Distance')], (n) => {
    const a = n.entity('a');
    const b = n.entity('b');
    return { distance: a && b ? a.distanceTo(b) : 0 };
  }),
  pure('data.hasTag', 'Has Tag', 'Entity', 'Does the entity have a tag?', [ent(), str('tag', 'Tag', 'enemy')], [bool('result', 'Result')], (n) => ({
    result: !!n.entity('target')?.hasTag(n.in<string>('tag')),
  })),
  pure('data.grounded', 'Is On Ground', 'Entity', 'Standing on something?', [ent()], [bool('grounded', 'Grounded')], (n) => ({ grounded: !!n.entity('target')?.isGrounded() })),
  pure('data.nearest', 'Nearest With Tag', 'Entity', 'Closest entity with a tag.', [ent('from', 'From'), str('tag', 'Tag', 'enemy')], [ent('entity', 'Entity'), bool('found', 'Found'), num('distance', 'Distance')], (n) => {
    const from = n.entity('from');
    const e = from ? n.api.findNearest(n.in<string>('tag'), from.worldPosition()) : undefined;
    return { entity: e, found: !!e, distance: e && from ? e.distanceTo(from) : 0 };
  }),
  pure('data.count', 'Count With Tag', 'Entity', 'How many entities have a tag.', [str('tag', 'Tag', 'enemy')], [num('count', 'Count')], (n) => ({ count: n.api.findAll(n.in<string>('tag')).length })),

  // ───────────── Values & math
  pure('data.number', 'Number', 'Math', 'A constant number.', [], [num('value', 'Value')], (n) => ({ value: Number(n.field('value')) || 0 }), [num('value', 'Value', 1)]),
  pure('data.string', 'Text', 'Math', 'A constant text.', [], [str('value', 'Value')], (n) => ({ value: String(n.field('value') ?? '') }), [str('value', 'Value', 'Hello')]),
  pure('data.time', 'Time', 'Math', 'Elapsed game time.', [], [num('elapsed', 'Elapsed'), num('dt', 'Delta')], (n) => ({ elapsed: n.api.time.elapsed, dt: n.api.time.dt })),
  pure('math.op', 'Math', 'Math', 'Arithmetic between two numbers.', [num('a', 'A'), num('b', 'B', 1)], [num('result', 'Result')], (n) => ({
    result: (MATH_OPS[n.field<string>('op')] ?? MATH_OPS['+'])(n.in<number>('a'), n.in<number>('b')),
  }), [sel('op', 'Operator', Object.keys(MATH_OPS))]),
  pure('math.func', 'Math Function', 'Math', 'abs, floor, round, sin...', [num('value', 'Value')], [num('result', 'Result')], (n) => ({
    result: (FUNCS[n.field<string>('fn')] ?? FUNCS.abs)(n.in<number>('value')),
  }), [sel('fn', 'Function', Object.keys(FUNCS))]),
  pure('math.random', 'Random Number', 'Math', 'Random number between min and max.', [num('min', 'Min', 0), num('max', 'Max', 10)], [num('value', 'Value')], (n) => {
    const min = n.in<number>('min');
    const max = n.in<number>('max');
    const v = min + Math.random() * (max - min);
    return { value: n.field<boolean>('integer') ? Math.floor(v) : v };
  }, [bool('integer', 'Whole numbers', true)]),
  pure('math.compare', 'Compare', 'Logic', 'Compare two values.', [any('a', 'A', 0), any('b', 'B', 0)], [bool('result', 'Result')], (n) => ({
    result: (COMPARE_OPS[n.field<string>('op')] ?? COMPARE_OPS['=='])(n.in('a'), n.in('b')),
  }), [sel('op', 'Operator', Object.keys(COMPARE_OPS))]),
  pure('logic.and', 'And', 'Logic', 'True if both are true.', [bool('a', 'A'), bool('b', 'B')], [bool('result', 'Result')], (n) => ({ result: !!n.in('a') && !!n.in('b') })),
  pure('logic.or', 'Or', 'Logic', 'True if either is true.', [bool('a', 'A'), bool('b', 'B')], [bool('result', 'Result')], (n) => ({ result: !!n.in('a') || !!n.in('b') })),
  pure('logic.not', 'Not', 'Logic', 'Flip true/false.', [bool('value', 'Value')], [bool('result', 'Result')], (n) => ({ result: !n.in('value') })),
  pure('data.join', 'Join Text', 'Math', 'Join two values into text.', [any('a', 'A', 'Score: '), any('b', 'B', '')], [str('text', 'Text')], (n) => ({ text: `${n.in('a')}${n.in('b')}` })),

  // ───────────── Input
  pure('input.axis', 'Movement Input', 'Input', 'Arrows/WASD/stick/joystick as -1..1.', [], [num('x', 'Horizontal'), num('y', 'Vertical')], (n) => ({
    x: n.api.input.axis('horizontal'),
    y: n.api.input.axis('vertical'),
  })),
  pure('input.isDown', 'Is Input Held', 'Input', 'Is an action held?', [], [bool('down', 'Down')], (n) => ({ down: n.api.input.isDown(n.field<string>('action')) }), [
    sel('action', 'Action', ACTIONS),
  ]),
  pure('input.pointer', 'Pointer Position', 'Input', 'Mouse/touch position in the world.', [], [num('x', 'X'), num('y', 'Y'), num('z', 'Z')], (n) => {
    const p = n.api.pointerWorld();
    return { x: p.x, y: p.y, z: p.z };
  }),
];

const BY_TYPE = new Map(NODES.map((n) => [n.type, n]));

export function getNodeDef(type: string): NodeDef | undefined {
  return BY_TYPE.get(type);
}

export const NODE_CATEGORIES: NodeCategory[] = ['Events', 'Flow', 'Actions', 'Entity', 'Variables', 'Math', 'Logic', 'Input', 'Scene', 'Network'];

/** Duck-typed so this module stays free of three.js (used by lightweight pages). */
export function isEntity(v: unknown): v is GameObject {
  return typeof v === 'object' && v !== null && 'object3d' in v && 'invoke' in v && 'tags' in v;
}
