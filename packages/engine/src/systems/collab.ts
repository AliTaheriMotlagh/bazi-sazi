/**
 * Real-time collaborative editing. A central sequencer (the server) puts every operation into one total
 * order; clients apply their own edits optimistically and replay the still-unconfirmed ones on top of the
 * confirmed document, so all replicas converge without per-op transformation.
 *
 * Operations address JSON by path. A path segment is a property name, or `{ id }` to pick the element with
 * that id out of an array (so concurrent inserts/removes in the entity list never shift each other's targets).
 * An op whose target no longer exists is dropped deterministically (e.g. editing an entity someone deleted).
 */

export type PathSegment = string | { id: string };
export type CollabPath = PathSegment[];

export type CollabOp =
  | { kind: 'set'; path: CollabPath; value: unknown }
  | { kind: 'delete'; path: CollabPath }
  /** Insert into the array at `path`, after the element with id `after` (null = at the start, undefined = at the end). */
  | { kind: 'insert'; path: CollabPath; value: { id: string } & Record<string, unknown>; after?: string | null }
  | { kind: 'remove'; path: CollabPath; id: string };

/** Structural subset of immer's `Patch`, so the engine needs no immer dependency. */
export interface JsonPatch {
  op: 'add' | 'remove' | 'replace';
  path: (string | number)[];
  value?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const hasId = (v: unknown): v is { id: string } => isObject(v) && typeof v.id === 'string';
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function step(container: unknown, seg: PathSegment): unknown {
  if (typeof seg === 'string') {
    if (FORBIDDEN.has(seg) || !isObject(container) || Array.isArray(container)) return undefined;
    return container[seg];
  }
  return Array.isArray(container) ? container.find((e) => hasId(e) && e.id === seg.id) : undefined;
}

function resolve(doc: unknown, path: CollabPath): unknown {
  let cur = doc;
  for (const seg of path) {
    cur = step(cur, seg);
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Apply one op in place. Returns false when its target is gone (the op is then a no-op). */
export function applyOp(doc: Record<string, unknown>, op: CollabOp): boolean {
  if (op.kind === 'insert' || op.kind === 'remove') {
    const arr = resolve(doc, op.path);
    if (!Array.isArray(arr)) return false;
    if (op.kind === 'remove') {
      const i = arr.findIndex((e) => hasId(e) && e.id === op.id);
      if (i < 0) return false;
      arr.splice(i, 1);
      return true;
    }
    if (arr.some((e) => hasId(e) && e.id === op.value.id)) return false; // duplicate insert
    if (op.after === undefined) arr.push(clone(op.value));
    else if (op.after === null) arr.unshift(clone(op.value));
    else {
      const i = arr.findIndex((e) => hasId(e) && e.id === op.after);
      arr.splice(i < 0 ? arr.length : i + 1, 0, clone(op.value));
    }
    return true;
  }
  if (op.path.length === 0) return false;
  const parent = resolve(doc, op.path.slice(0, -1));
  const last = op.path[op.path.length - 1];
  if (!isObject(parent)) return false;
  if (typeof last === 'string') {
    if (FORBIDDEN.has(last) || Array.isArray(parent)) return false;
    if (op.kind === 'set') parent[last] = clone(op.value);
    else delete parent[last];
    return true;
  }
  if (!Array.isArray(parent)) return false;
  const i = parent.findIndex((e) => hasId(e) && e.id === last.id);
  if (i < 0) return false;
  if (op.kind === 'set') parent[i] = clone(op.value);
  else parent.splice(i, 1);
  return true;
}

export function applyOps<T extends Record<string, unknown>>(doc: T, ops: CollabOp[]): T {
  for (const op of ops) applyOp(doc, op);
  return doc;
}

const allIds = (arr: unknown[]): arr is { id: string }[] => arr.length > 0 && arr.every(hasId) && new Set(arr.map((e) => (e as { id: string }).id)).size === arr.length;

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function diffInto(ops: CollabOp[], path: CollabPath, a: unknown, b: unknown): void {
  if (equal(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b) && allIds(a) && allIds(b)) {
    const inB = new Set(b.map((e) => e.id));
    const inA = new Map(a.map((e) => [e.id, e]));
    const kept = a.filter((e) => inB.has(e.id)).map((e) => e.id);
    if (kept.join() !== b.filter((e) => inA.has(e.id)).map((e) => e.id).join()) {
      ops.push({ kind: 'set', path, value: clone(b) }); // reordered: replace the list
      return;
    }
    for (const e of a) if (!inB.has(e.id)) ops.push({ kind: 'remove', path, id: e.id });
    b.forEach((e, i) => {
      const old = inA.get(e.id);
      if (old) diffInto(ops, [...path, { id: e.id }], old, e);
      else ops.push({ kind: 'insert', path, value: clone(e), after: i === b.length - 1 ? undefined : i === 0 ? null : b[i - 1].id });
    });
    return;
  }
  if (isObject(a) && isObject(b) && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) ops.push({ kind: 'delete', path: [...path, k] });
    for (const k of Object.keys(b)) diffInto(ops, [...path, k], k in a ? a[k] : undefined, b[k]);
    return;
  }
  if (path.length) ops.push({ kind: 'set', path, value: clone(b) });
}

/** Ops that turn `prev` into `next`. Arrays whose elements all have unique ids diff per element; others replace wholesale. */
export function diffToOps(prev: unknown, next: unknown): CollabOp[] {
  const ops: CollabOp[] = [];
  diffInto(ops, [], prev, next);
  return ops;
}

/** Translate immer patches into id-based ops (applies them to a copy of `prev`, then diffs by element id). */
export function patchesToOps(prev: unknown, patches: JsonPatch[]): CollabOp[] {
  const doc = clone(prev) as Record<string, unknown>;
  for (const patch of patches) {
    if (patch.path.length === 0) continue;
    let parent: unknown = doc;
    for (const seg of patch.path.slice(0, -1)) parent = isObject(parent) ? (parent as Record<string | number, unknown>)[seg] : undefined;
    const key = patch.path[patch.path.length - 1];
    if (!isObject(parent)) continue;
    if (Array.isArray(parent)) {
      if (patch.op === 'add') parent.splice(key as number, 0, clone(patch.value));
      else if (patch.op === 'remove') parent.splice(key as number, 1);
      else parent[key as number] = clone(patch.value);
    } else if (patch.op === 'remove') delete parent[String(key)];
    else parent[String(key)] = clone(patch.value);
  }
  return diffToOps(prev, doc);
}

export interface SequencedOps {
  rev: number;
  client: string;
  /** The submitting client's batch id, echoed back so it can drop the batch from its pending queue. */
  batch: string;
  ops: CollabOp[];
}

/** Authoritative side: orders batches, applies them, keeps a bounded history for late joiners. */
export class CollabHub {
  private doc: Record<string, unknown>;
  private log: SequencedOps[] = [];
  private readonly historyLimit: number;
  rev = 0;

  constructor(initial: Record<string, unknown>, historyLimit = 500) {
    this.doc = clone(initial);
    this.historyLimit = historyLimit;
  }

  get document(): Record<string, unknown> {
    return this.doc;
  }

  snapshot(): { rev: number; doc: Record<string, unknown> } {
    return { rev: this.rev, doc: clone(this.doc) };
  }

  /** Accept a batch from a client; returns the sequenced batch to broadcast (to everyone, including the sender). */
  submit(client: string, batch: string, ops: CollabOp[]): SequencedOps {
    for (const op of ops) applyOp(this.doc, op);
    const entry: SequencedOps = { rev: ++this.rev, client, batch, ops: clone(ops) };
    this.log.push(entry);
    if (this.log.length > this.historyLimit) this.log.shift();
    return entry;
  }

  /** Batches after `rev`, or null when that history was trimmed (the client must take a snapshot). */
  since(rev: number): SequencedOps[] | null {
    if (rev > this.rev) return null; // client claims a future we never had: resync fully
    if (rev === this.rev) return [];
    if (!this.log.length || this.log[0].rev > rev + 1) return null;
    return this.log.filter((e) => e.rev > rev);
  }
}

/** Client side: optimistic local edits over a confirmed document. */
export class CollabClient {
  private confirmed: Record<string, unknown>;
  private pending: { batch: string; ops: CollabOp[] }[] = [];
  private counter = 0;
  readonly clientId: string;
  rev: number;
  /** The document to render: confirmed state plus our unconfirmed edits. */
  view: Record<string, unknown>;

  constructor(clientId: string, snapshot: { rev: number; doc: Record<string, unknown> }) {
    this.clientId = clientId;
    this.confirmed = clone(snapshot.doc);
    this.rev = snapshot.rev;
    this.view = clone(this.confirmed);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Apply a local edit; returns the batch to send to the server. */
  edit(ops: CollabOp[]): { batch: string; ops: CollabOp[] } {
    const batch = { batch: `${this.clientId}:${++this.counter}`, ops: clone(ops) };
    this.pending.push(batch);
    applyOps(this.view, batch.ops);
    return batch;
  }

  /** Feed a sequenced batch from the server (ours or someone else's). Out-of-order revisions are ignored. */
  receive(entry: SequencedOps): boolean {
    if (entry.rev <= this.rev) return true; // duplicate
    if (entry.rev !== this.rev + 1) return false; // gap: caller should resync from a snapshot
    applyOps(this.confirmed, entry.ops);
    this.rev = entry.rev;
    if (entry.client === this.clientId) this.pending = this.pending.filter((p) => p.batch !== entry.batch);
    this.view = clone(this.confirmed);
    for (const p of this.pending) applyOps(this.view, p.ops);
    return true;
  }

  /** Replace everything from a fresh snapshot, keeping unconfirmed edits on top. */
  resync(snapshot: { rev: number; doc: Record<string, unknown> }): void {
    this.confirmed = clone(snapshot.doc);
    this.rev = snapshot.rev;
    this.view = clone(this.confirmed);
    for (const p of this.pending) applyOps(this.view, p.ops);
  }
}
