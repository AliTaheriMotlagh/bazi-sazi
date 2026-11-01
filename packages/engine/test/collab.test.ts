import { describe, expect, it } from 'vitest';
import { enablePatches, produceWithPatches } from 'immer';
import { CollabClient, CollabHub, applyOp, diffToOps, patchesToOps, type CollabOp } from '../src/core';

enablePatches();

const doc = () => ({ name: 'Game', entities: [{ id: 'a', name: 'A', pos: [0, 0, 0] }, { id: 'b', name: 'B', pos: [1, 0, 0] }] });

function session(n = 2) {
  const hub = new CollabHub(doc());
  const clients = Array.from({ length: n }, (_, i) => new CollabClient(`c${i}`, hub.snapshot()));
  /** Deliver all submitted batches to the hub in the given order, broadcasting to everyone. */
  const flush = (sent: { from: number; batch: { batch: string; ops: CollabOp[] } }[]) => {
    for (const s of sent) {
      const entry = hub.submit(clients[s.from].clientId, s.batch.batch, s.batch.ops);
      for (const c of clients) c.receive(entry);
    }
  };
  return { hub, clients, flush };
}

describe('collab ops', () => {
  it('sets, deletes, inserts and removes by id', () => {
    const d = doc() as Record<string, unknown>;
    expect(applyOp(d, { kind: 'set', path: ['entities', { id: 'a' }, 'name'], value: 'Z' })).toBe(true);
    expect(applyOp(d, { kind: 'insert', path: ['entities'], value: { id: 'c' }, after: 'a' })).toBe(true);
    expect((d.entities as { id: string }[]).map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(applyOp(d, { kind: 'remove', path: ['entities'], id: 'b' })).toBe(true);
    expect(applyOp(d, { kind: 'delete', path: ['entities', { id: 'a' }, 'pos'] })).toBe(true);
    expect((d.entities as Record<string, unknown>[])[0]).toEqual({ id: 'a', name: 'Z' });
  });

  it('drops ops whose target was deleted and refuses prototype pollution', () => {
    const d = doc() as Record<string, unknown>;
    expect(applyOp(d, { kind: 'set', path: ['entities', { id: 'gone' }, 'name'], value: 'x' })).toBe(false);
    expect(applyOp(d, { kind: 'set', path: ['__proto__', 'polluted'], value: true })).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(applyOp(d, { kind: 'insert', path: ['entities'], value: { id: 'a' } })).toBe(false); // duplicate id
  });
});

describe('collab convergence', () => {
  it('concurrent edits to different things both survive and all replicas agree', () => {
    const { hub, clients, flush } = session(3);
    const e0 = clients[0].edit([{ kind: 'set', path: ['entities', { id: 'a' }, 'name'], value: 'Alpha' }]);
    const e1 = clients[1].edit([{ kind: 'set', path: ['entities', { id: 'b' }, 'name'], value: 'Beta' }]);
    const e2 = clients[2].edit([{ kind: 'insert', path: ['entities'], value: { id: 'c', name: 'C' } }]);
    // Optimistic: each sees its own edit immediately.
    expect((clients[0].view.entities as { name: string }[])[0].name).toBe('Alpha');
    flush([{ from: 1, batch: e1 }, { from: 2, batch: e2 }, { from: 0, batch: e0 }]);
    const names = (d: Record<string, unknown>) => (d.entities as { name: string }[]).map((e) => e.name);
    expect(names(hub.document)).toEqual(['Alpha', 'Beta', 'C']);
    for (const c of clients) {
      expect(c.view).toEqual(hub.document);
      expect(c.pendingCount).toBe(0);
    }
  });

  it('conflicting writes resolve to the last sequenced one everywhere', () => {
    const { hub, clients, flush } = session(2);
    const a = clients[0].edit([{ kind: 'set', path: ['name'], value: 'one' }]);
    const b = clients[1].edit([{ kind: 'set', path: ['name'], value: 'two' }]);
    flush([{ from: 0, batch: a }, { from: 1, batch: b }]);
    expect(hub.document.name).toBe('two');
    expect(clients[0].view.name).toBe('two');
  });

  it('keeps unconfirmed local edits on top of remote ones while waiting', () => {
    const { clients, hub } = session(2);
    clients[0].edit([{ kind: 'set', path: ['entities', { id: 'a' }, 'name'], value: 'mine' }]);
    const remote = clients[1].edit([{ kind: 'set', path: ['entities', { id: 'b' }, 'name'], value: 'theirs' }]);
    const entry = hub.submit('c1', remote.batch, remote.ops);
    clients[0].receive(entry);
    const names = (clients[0].view.entities as { name: string }[]).map((e) => e.name);
    expect(names).toEqual(['mine', 'theirs']);
    expect(clients[0].pendingCount).toBe(1);
  });

  it('editing an entity someone else deleted is a harmless no-op', () => {
    const { hub, clients, flush } = session(2);
    const del = clients[0].edit([{ kind: 'remove', path: ['entities'], id: 'a' }]);
    const edit = clients[1].edit([{ kind: 'set', path: ['entities', { id: 'a' }, 'name'], value: 'ghost' }]);
    flush([{ from: 0, batch: del }, { from: 1, batch: edit }]);
    expect((hub.document.entities as { id: string }[]).map((e) => e.id)).toEqual(['b']);
    expect(clients[1].view).toEqual(hub.document);
  });

  it('detects gaps and late joiners can catch up from history or snapshot', () => {
    const hub = new CollabHub(doc(), 2);
    const e1 = hub.submit('x', 'x:1', [{ kind: 'set', path: ['name'], value: 'v1' }]);
    hub.submit('x', 'x:2', [{ kind: 'set', path: ['name'], value: 'v2' }]);
    hub.submit('x', 'x:3', [{ kind: 'set', path: ['name'], value: 'v3' }]);
    const late = new CollabClient('late', { rev: 0, doc: doc() });
    expect(late.receive(hub.since(0) ? hub.since(0)![0] : e1)).toBe(true); // either path is safe
    expect(hub.since(0)).toBeNull(); // history trimmed → snapshot needed
    late.resync(hub.snapshot());
    expect(late.view.name).toBe('v3');
    expect(hub.since(2)!.map((e) => e.rev)).toEqual([3]);
    expect(hub.since(99)).toBeNull();
  });
});

describe('patchesToOps (immer integration)', () => {
  const run = (recipe: (d: ReturnType<typeof doc>) => void) => {
    const base = doc();
    const [next, patches] = produceWithPatches(base, recipe);
    return { base, next, ops: patchesToOps(base, patches) };
  };
  const replay = (base: ReturnType<typeof doc>, ops: CollabOp[]) => {
    const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    for (const op of ops) applyOp(copy, op);
    return copy;
  };

  it('property edits, nested edits and vector edits reproduce the result', () => {
    const { base, next, ops } = run((d) => {
      d.name = 'Renamed';
      d.entities[1].name = 'Bee';
      d.entities[0].pos[1] = 5;
    });
    expect(replay(base, ops)).toEqual(next);
    expect(ops.some((o) => o.kind === 'set' && o.path.some((s) => typeof s === 'object'))).toBe(true);
  });

  it('inserts and removes entities by id regardless of index', () => {
    const ins = run((d) => void d.entities.splice(1, 0, { id: 'mid', name: 'M', pos: [2, 0, 0] }));
    expect(ins.ops).toEqual([{ kind: 'insert', path: ['entities'], value: { id: 'mid', name: 'M', pos: [2, 0, 0] }, after: 'a' }]);
    expect(replay(ins.base, ins.ops)).toEqual(ins.next);
    const del = run((d) => void d.entities.shift());
    expect(del.ops).toEqual([{ kind: 'remove', path: ['entities'], id: 'a' }]);
    expect(replay(del.base, del.ops)).toEqual(del.next);
  });

  it('combined insert+remove becomes one insert and one remove (not a clobbering replace)', () => {
    const { base, next, ops } = run((d) => {
      d.entities.splice(1, 0, { id: 'mid', name: 'M', pos: [2, 0, 0] });
      d.entities.shift();
    });
    expect(ops.map((o) => o.kind).sort()).toEqual(['insert', 'remove']);
    expect(replay(base, ops)).toEqual(next);
  });

  it('reordering replaces the list; diffToOps on identical docs is empty', () => {
    const { base, next, ops } = run((d) => void d.entities.reverse());
    expect(ops).toHaveLength(1);
    expect(replay(base, ops)).toEqual(next);
    expect(diffToOps(base, base)).toEqual([]);
  });

  it('remote edits do not break a translated local insert', () => {
    const { base, ops } = run((d) => void d.entities.push({ id: 'z', name: 'Z', pos: [0, 0, 0] }));
    const remote = JSON.parse(JSON.stringify(base)) as ReturnType<typeof doc>;
    remote.entities.unshift({ id: 'new', name: 'N', pos: [0, 0, 0] });
    const merged = replay(remote, ops);
    expect((merged.entities as { id: string }[]).map((e) => e.id)).toEqual(['new', 'a', 'b', 'z']);
  });
});
