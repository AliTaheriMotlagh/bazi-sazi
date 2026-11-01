import { CollabHub, createEntity, createProject, type ProjectData } from '@bazi/engine/core';
import { describe, expect, it } from 'vitest';
import { CollabSession, type CollabHost } from '../src/collab/session';

/** Two editors wired to a real hub through an in-memory "network" with manual delivery. */
function pair() {
  const base = createProject('Shared', '3d');
  const hub = new CollabHub(base as unknown as Record<string, unknown>);
  const sessions: CollabSession[] = [];
  const hosts: { project: ProjectData | null; resets: number }[] = [];
  const outbox: { from: number; data: string }[] = [];
  const peerIds: string[] = [];

  for (let i = 0; i < 2; i++) {
    const state = { project: null as ProjectData | null, resets: 0 };
    const host: CollabHost = {
      getProject: () => state.project,
      setProject: (p, reset) => {
        state.project = p;
        if (reset) state.resets++;
      },
    };
    hosts.push(state);
    sessions.push(new CollabSession(host, { send: (data) => outbox.push({ from: i, data }) }));
    peerIds.push(`cl_${i}`);
  }
  hosts.forEach((_, i) => sessions[i].handle(JSON.stringify({ t: 'welcome', clientId: peerIds[i], snapshot: hub.snapshot(), peers: [] })));

  /** Deliver everything sent so far to the hub and broadcast the results. */
  const deliver = () => {
    while (outbox.length) {
      const { from, data } = outbox.shift()!;
      const msg = JSON.parse(data) as { t: string; batch: string; ops: never[] };
      if (msg.t !== 'ops') continue;
      const entry = hub.submit(peerIds[from], msg.batch, msg.ops);
      sessions.forEach((s) => s.handle(JSON.stringify({ t: 'ops', entry })));
    }
  };
  /** An edit as the editor store would produce it: a new project object. */
  const edit = (i: number, recipe: (p: ProjectData) => void) => {
    const next = structuredClone(hosts[i].project!);
    recipe(next);
    hosts[i].project = next;
    sessions[i].localChanged();
  };
  return { hub, sessions, hosts, deliver, edit };
}

describe('CollabSession', () => {
  it('adopts the server document on connect', () => {
    const { hosts } = pair();
    expect((hosts[0].project as ProjectData).name).toBe('Shared');
    expect(hosts[0].resets).toBe(1);
  });

  it('propagates an added entity and a rename to the other editor', () => {
    const { hosts, deliver, edit, hub } = pair();
    const scene = hosts[0].project!.scenes[0];
    edit(0, (p) => void p.scenes[0].entities.push(createEntity({ name: 'Rock' })));
    edit(0, (p) => void (p.name = 'Renamed'));
    deliver();
    expect(hosts[1].project!.name).toBe('Renamed');
    expect(hosts[1].project!.scenes[0].entities.map((e) => e.name)).toContain('Rock');
    expect(hosts[0].project).toEqual(hosts[1].project);
    expect(hub.document.name).toBe('Renamed');
    expect(scene.id).toBe(hosts[1].project!.scenes[0].id);
  });

  it('structural remote changes reset undo history, property edits do not', () => {
    const { hosts, deliver, edit } = pair();
    const before = hosts[1].resets;
    edit(0, (p) => void (p.name = 'Just a rename'));
    deliver();
    expect(hosts[1].resets).toBe(before);
    edit(0, (p) => void p.scenes[0].entities.push(createEntity({ name: 'New' })));
    deliver();
    expect(hosts[1].resets).toBe(before + 1);
  });

  it('merges simultaneous edits to different entities', () => {
    const { hosts, deliver, edit } = pair();
    edit(0, (p) => void p.scenes[0].entities.push(createEntity({ name: 'A' })));
    deliver();
    const id = hosts[1].project!.scenes[0].entities.find((e) => e.name === 'A')!.id;
    // Both edit before either hears the other.
    edit(0, (p) => void (p.scenes[0].entities.find((e) => e.id === id)!.transform.position = [5, 0, 0]));
    edit(1, (p) => void p.scenes[0].entities.push(createEntity({ name: 'B' })));
    deliver();
    for (const h of hosts) {
      expect(h.project!.scenes[0].entities.find((e) => e.id === id)!.transform.position).toEqual([5, 0, 0]);
      expect(h.project!.scenes[0].entities.map((e) => e.name)).toEqual(expect.arrayContaining(['A', 'B']));
    }
    expect(hosts[0].project).toEqual(hosts[1].project);
  });

  it('ignores garbage and does nothing before it is connected', () => {
    const state = { sent: 0 };
    const s = new CollabSession({ getProject: () => null, setProject: () => undefined }, { send: () => void state.sent++ });
    s.handle('not json');
    s.localChanged();
    expect(s.connected).toBe(false);
    expect(state.sent).toBe(0);
  });
});
