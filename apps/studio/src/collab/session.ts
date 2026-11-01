import { CollabClient, diffToOps, type ProjectData, type SequencedOps } from '@bazi/engine/core';

/** What the session needs from the editor and the network — injected so it can be tested without either. */
export interface CollabHost {
  getProject(): ProjectData | null;
  /** Replace the project with a merged copy. `resetHistory` when undo patches could now point at the wrong places. */
  setProject(project: ProjectData, resetHistory: boolean): void;
}

export interface CollabTransport {
  send(data: string): void;
}

export interface CollabPeer {
  id: string;
  name: string;
}

interface ServerMessage {
  t: string;
  clientId?: string;
  snapshot?: { rev: number; doc: Record<string, unknown> };
  peers?: CollabPeer[];
  peer?: CollabPeer;
  id?: string;
  entry?: SequencedOps;
  entries?: SequencedOps[];
  message?: string;
}

/**
 * Connects the editor's project to a CollabHub: local edits become id-addressed ops, remote ones are merged
 * into the project without entering the undo history (undo only ever reverts your own work).
 */
export class CollabSession {
  private client: CollabClient | null = null;
  private lastSeen: ProjectData | null = null;
  peers = new Map<string, CollabPeer>();

  constructor(
    private readonly host: CollabHost,
    private readonly transport: CollabTransport,
    private readonly onChange: () => void = () => undefined,
  ) {}

  get connected(): boolean {
    return this.client !== null;
  }

  get pendingCount(): number {
    return this.client?.pendingCount ?? 0;
  }

  /** Feed one raw message from the socket. */
  handle(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        if (!msg.clientId || !msg.snapshot) return;
        this.client = new CollabClient(msg.clientId, msg.snapshot);
        this.peers = new Map((msg.peers ?? []).map((p) => [p.id, p]));
        this.adopt(true);
        break;
      case 'ops':
        if (msg.entry) this.receive([msg.entry]);
        break;
      case 'catchup':
        this.receive(msg.entries ?? []);
        break;
      case 'snapshot':
        if (this.client && msg.snapshot) {
          this.client.resync(msg.snapshot);
          this.adopt(true);
        }
        break;
      case 'join':
        if (msg.peer) this.peers.set(msg.peer.id, msg.peer);
        break;
      case 'leave':
        if (msg.id) this.peers.delete(msg.id);
        break;
    }
    this.onChange();
  }

  /** Call whenever the editor's project changed. Sends the difference to the server. */
  localChanged(): void {
    const project = this.host.getProject();
    if (!this.client || !project || project === this.lastSeen || !this.lastSeen) return;
    const ops = diffToOps(this.lastSeen, project);
    this.lastSeen = project;
    if (!ops.length) return;
    const { batch } = this.client.edit(ops);
    this.transport.send(JSON.stringify({ t: 'ops', batch, ops }));
    this.onChange();
  }

  /** Make the editor show the merged document. */
  private adopt(resetHistory: boolean): void {
    if (!this.client) return;
    const merged = JSON.parse(JSON.stringify(this.client.view)) as ProjectData;
    this.lastSeen = merged;
    this.host.setProject(merged, resetHistory);
  }

  private receive(entries: SequencedOps[]): void {
    const client = this.client;
    if (!client) return;
    let remote = false;
    let structural = false;
    for (const entry of entries) {
      if (!client.receive(entry)) {
        this.transport.send(JSON.stringify({ t: 'sync', rev: client.rev }));
        return;
      }
      if (entry.client !== client.clientId) {
        remote = true;
        structural ||= entry.ops.some((op) => op.kind === 'insert' || op.kind === 'remove');
      }
    }
    if (remote) this.adopt(structural);
  }
}
