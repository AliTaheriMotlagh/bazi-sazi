import { create } from 'zustand';
import { getToken } from '../api/client';
import { editor, useEditor } from '../store/editor';
import { toast } from '../store/ui';
import { CollabSession, type CollabPeer } from './session';

interface CollabState {
  status: 'off' | 'connecting' | 'live';
  peers: CollabPeer[];
}

export const useCollab = create<CollabState>(() => ({ status: 'off', peers: [] }));

let socket: WebSocket | null = null;
let unsubscribe: (() => void) | null = null;

export function stopCollab(): void {
  unsubscribe?.();
  unsubscribe = null;
  socket?.close();
  socket = null;
  useCollab.setState({ status: 'off', peers: [] });
}

/** Start live co-editing of the open project. Needs a signed-in account and a server with WebSocket support. */
export function startCollab(): void {
  const projectId = editor().projectId;
  const token = getToken();
  if (!projectId || !token) {
    toast('Sign in and open a saved project to collaborate.', 'error');
    return;
  }
  stopCollab();
  useCollab.setState({ status: 'connecting', peers: [] });
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws/collab?project=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`);
  socket = ws;
  const session = new CollabSession(
    {
      getProject: () => editor().project,
      setProject: (project, resetHistory) =>
        useEditor.setState((s) => ({ project, ...(resetHistory ? { past: [], future: [] } : {}), saveState: s.saveState === 'saved' ? 'saved' : s.saveState })),
    },
    { send: (data) => ws.readyState === WebSocket.OPEN && ws.send(data) },
    () => useCollab.setState({ status: session.connected ? 'live' : 'connecting', peers: [...session.peers.values()] }),
  );
  ws.onmessage = (e) => {
    const msg = typeof e.data === 'string' ? e.data : '';
    if (msg.includes('"t":"error"')) {
      toast((JSON.parse(msg) as { message: string }).message, 'error');
      stopCollab();
      return;
    }
    session.handle(msg);
  };
  ws.onclose = () => {
    if (socket === ws) {
      toast('Live collaboration disconnected.', 'info');
      stopCollab();
    }
  };
  // The server persists collaborative edits itself; local autosave must not fight it.
  unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.project !== prev.project) session.localChanged();
  });
}
