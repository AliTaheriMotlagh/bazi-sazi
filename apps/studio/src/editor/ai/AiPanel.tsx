import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { api, type AiMessage, type AiModel } from '../../api/client';
import { editor, useEditor } from '../../store/editor';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/primitives';
import { runAgent, type AgentEvent } from './agent';

interface ChatItem {
  kind: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  ok?: boolean;
}

interface AiState {
  items: ChatItem[];
  history: AiMessage[];
  busy: boolean;
  model: string;
  apiKey: string;
  pending: string | null;
  set(p: Partial<AiState>): void;
}

const read = (k: string, d = '') => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export const useAi = create<AiState>((set) => ({
  items: [],
  history: [],
  busy: false,
  model: read('bz.ai.model'),
  apiKey: read('bz.ai.key'),
  pending: null,
  set: (p) => set(p),
}));

/** Send a prompt to the assistant from anywhere (e.g. the code editor's "Fix" button). */
export function askAi(prompt: string): void {
  useAi.getState().set({ pending: prompt });
  editor().set({ rightTab: 'ai' });
}

const SUGGESTIONS_2D = ['Make a platformer level with coins, spikes and a goal', 'Add an enemy that walks back and forth', 'Add a double jump and a health bar', 'Turn this into a top-down space shooter'];
const SUGGESTIONS_3D = ['Build a small obstacle course with a finish line', 'Add a third-person player that can jump', 'Make a physics tower I can knock down', 'Make this an online multiplayer game'];

function pickDefault(models: AiModel[]): string {
  const ids = models.map((m) => m.id);
  return ids.find((id) => /^anthropic\/claude.*sonnet/.test(id)) ?? ids.find((id) => id.startsWith('anthropic/')) ?? ids[0] ?? '';
}

function SettingsDialog({ models, serverKey, onClose }: { models: AiModel[]; serverKey: boolean; onClose(): void }) {
  const { model, apiKey, set } = useAi();
  const [m, setM] = useState(model);
  const [k, setK] = useState(apiKey);
  return (
    <Modal
      title="AI assistant settings"
      icon="Bot"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={() => {
              write('bz.ai.model', m);
              write('bz.ai.key', k);
              set({ model: m, apiKey: k });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        The assistant uses <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a>, so you can choose from hundreds of AI models.
      </p>
      <label>
        <span className="field-label">Model</span>
        <input className="input lg" list="bz-models" value={m} onChange={(e) => setM(e.target.value)} placeholder="anthropic/claude-…" />
        <datalist id="bz-models">
          {models.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </datalist>
        <span className="faint" style={{ fontSize: 12 }}>Only models that support tool use are listed ({models.length}).</span>
      </label>
      <label>
        <span className="field-label">OpenRouter API key {serverKey && '(optional — the server provides one)'}</span>
        <input className="input lg" type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-or-…" autoComplete="off" />
        <span className="faint" style={{ fontSize: 12 }}>Stored only in this browser and sent with each request. Get one at openrouter.ai/keys.</span>
      </label>
    </Modal>
  );
}

export function AiPanel() {
  const { items, history, busy, model, apiKey, pending, set } = useAi();
  const mode = useEditor((s) => s.project?.settings.mode ?? '3d');
  const [text, setText] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [serverKey, setServerKey] = useState(false);
  const [settings, setSettings] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api.aiStatus().then((s) => setServerKey(s.serverKey)).catch(() => undefined);
    api
      .aiModels()
      .then(({ models }) => {
        setModels(models);
        if (!useAi.getState().model) {
          const def = pickDefault(models);
          write('bz.ai.model', def);
          set({ model: def });
        }
      })
      .catch(() => undefined);
  }, [set]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [items.length, busy]);

  const send = async (prompt: string) => {
    const content = prompt.trim();
    if (!content || busy) return;
    if (!model) return setSettings(true);
    if (!apiKey && !serverKey) return setSettings(true);
    setText('');
    const userMsg: AiMessage = { role: 'user', content };
    set({ busy: true, items: [...useAi.getState().items, { kind: 'user', text: content }] });
    abort.current = new AbortController();
    const push = (e: AgentEvent) => set({ items: [...useAi.getState().items, { kind: e.kind === 'text' ? 'assistant' : e.kind, text: e.text, ok: e.ok }] });
    try {
      const next = await runAgent([...history, userMsg], { model, apiKey: apiKey || undefined, onEvent: push, signal: abort.current.signal });
      // Keep the context bounded: last ~40 messages, never starting on a tool result.
      let trimmed = next.slice(-40);
      while (trimmed.length && trimmed[0].role === 'tool') trimmed = trimmed.slice(1);
      set({ history: trimmed });
    } catch (err) {
      push({ kind: 'error', text: (err as Error).message });
    } finally {
      set({ busy: false });
    }
  };

  useEffect(() => {
    if (pending && !busy) {
      set({ pending: null });
      void send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, busy]);

  const suggestions = mode === '2d' ? SUGGESTIONS_2D : SUGGESTIONS_3D;

  return (
    <div className="chat">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="Bot" size={15} />
        <span className="truncate faint grow" style={{ fontSize: 12 }} title={model}>{model || 'No model selected'}</span>
        <button className="btn sm ghost icon" onClick={() => set({ items: [], history: [] })} title="New chat" aria-label="New chat"><Icon name="Plus" size={14} /></button>
        <button className="btn sm ghost icon" onClick={() => setSettings(true)} title="AI settings" aria-label="AI settings"><Icon name="Settings" size={14} /></button>
      </div>
      <div className="chat-log" ref={log}>
        {items.length === 0 && (
          <div className="col" style={{ gap: 12 }}>
            <div className="msg assistant">
              Hi! I can build and change your game for you — objects, levels, physics, scripts, visual logic, multiplayer… Every change I make can be undone with Ctrl+Z. What should we make?
            </div>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} className="suggestion" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
            {!apiKey && !serverKey && (
              <button className="btn" onClick={() => setSettings(true)}>
                <Icon name="Settings" size={14} /> Connect an OpenRouter API key
              </button>
            )}
          </div>
        )}
        {items.map((m, i) =>
          m.kind === 'tool' ? (
            <div key={i} className={`msg tool ${m.ok === false ? 'error' : ''}`}>
              <Icon name={m.ok === false ? 'CircleAlert' : 'Check'} size={12} /> {m.text}
            </div>
          ) : (
            <div key={i} className={`msg ${m.kind}`}>{m.text}</div>
          ),
        )}
        {busy && (
          <div className="msg assistant typing" aria-label="Thinking">
            <span /><span /><span />
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          className="textarea"
          placeholder="Describe what you want… (Enter to send, Shift+Enter for a new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
            e.stopPropagation();
          }}
        />
        <div className="row">
          <span className="faint" style={{ fontSize: 11.5 }}>AI can make mistakes — test with ▶ Play.</span>
          <span className="spacer" />
          {busy ? (
            <button type="button" className="btn sm" onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <button className="btn primary sm" disabled={!text.trim()}><Icon name="Send" size={13} /> Send</button>
          )}
        </div>
      </form>
      {settings && <SettingsDialog models={models} serverKey={serverKey} onClose={() => setSettings(false)} />}
    </div>
  );
}
