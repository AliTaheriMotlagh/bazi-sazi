import { validateProject, type LogLevel, type Problem } from '@bazi/engine';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useConsole } from '../../store/console';
import { editor, useEditor } from '../../store/editor';
import { Icon } from '../../ui/Icon';
import { Switch } from '../../ui/primitives';
import { useSession } from '../session';

export function ConsolePanel() {
  const logs = useConsole((s) => s.logs);
  const clear = useConsole((s) => s.clear);
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({ log: true, info: true, warn: true, error: true });
  const [query, setQuery] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const shown = logs.filter((l) => levels[l.level] && (!query || l.message.toLowerCase().includes(query.toLowerCase())));
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scroll methods.
    end.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);
  return (
    <div className="col" style={{ height: '100%', gap: 0 }}>
      <div className="row" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {(['log', 'info', 'warn', 'error'] as LogLevel[]).map((l) => (
          <button key={l} className={`btn sm ${levels[l] ? 'active' : ''}`} onClick={() => setLevels({ ...levels, [l]: !levels[l] })}>{l}</button>
        ))}
        <input className="input" style={{ maxWidth: 220, height: 26 }} placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="spacer" />
        <button className="btn sm" onClick={clear}><Icon name="Trash" size={13} /> Clear</button>
      </div>
      <div className="panel-body console" role="log">
        {shown.length === 0 && <div className="empty" style={{ fontFamily: 'var(--font)' }}>Messages from your game (log(), errors, network) appear here while playing.</div>}
        {shown.map((l, i) => (
          <div key={i} className={`log ${l.level}`}>
            <span className="time">{new Date(l.time).toLocaleTimeString([], { hour12: false })}</span>
            {l.source && (
              <span className="src" onClick={() => {
                const script = editor().project?.scripts.find((s) => s.name === l.source);
                if (script) editor().openScript(script.id);
                else if (l.entityId) editor().select([l.entityId]);
              }}>[{l.source}]</span>
            )}
            <span className="grow">{l.message}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

export function useProblems(): Problem[] {
  const project = useEditor((s) => s.project);
  const deferred = useDeferredValue(project);
  return useMemo(() => (deferred ? validateProject(deferred) : []), [deferred]);
}

export function ProblemsPanel() {
  const problems = useProblems();
  const reveal = (p: Problem) => {
    const ed = editor();
    if (p.sceneId && p.sceneId !== ed.sceneId) ed.setScene(p.sceneId);
    if (p.entityId) ed.select([p.entityId]);
    if (p.scriptId) ed.openScript(p.scriptId);
    if (p.graphId) ed.openGraph(p.graphId);
  };
  if (!problems.length)
    return (
      <div className="empty">
        <Icon name="Check" size={22} style={{ color: 'var(--success)' }} />
        <p>No problems found — your project is ready to publish.</p>
      </div>
    );
  return (
    <div>
      {problems.map((p, i) => (
        <div key={i} className="problem" onClick={() => reveal(p)}>
          <Icon name={p.severity === 'error' ? 'CircleAlert' : p.severity === 'warning' ? 'TriangleAlert' : 'Info'} size={15} style={{ color: p.severity === 'error' ? 'var(--danger)' : p.severity === 'warning' ? 'var(--warning)' : 'var(--text-dim)', flex: 'none', marginTop: 2 }} />
          <span>{p.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ProfilerPanel() {
  const runtime = useSession((s) => s.playRuntime ?? s.editRuntime);
  const playing = useSession((s) => !!s.playRuntime);
  const { physicsDebug, timeScale, set } = useSession();
  const [history, setHistory] = useState<number[]>([]);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (!runtime) return;
      setHistory((h) => [...h.slice(-89), runtime.stats.frameMs]);
      force((n) => n + 1);
    }, 250);
    return () => clearInterval(t);
  }, [runtime]);
  if (!runtime) return <div className="empty">Start the game to profile it.</div>;
  const s = runtime.stats;
  const max = Math.max(16.7, ...history);
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const stats: [string, string][] = [
    ['FPS', String(s.fps)],
    ['Frame ms', s.frameMs.toFixed(2)],
    ['Logic ms', s.updateMs.toFixed(2)],
    ['Physics ms', s.physicsMs.toFixed(2)],
    ['Render ms', s.renderMs.toFixed(2)],
    ['Draw calls', String(s.drawCalls)],
    ['Triangles', s.triangles.toLocaleString()],
    ['Entities', String(s.entities)],
    ['Bodies', String(s.bodies)],
    ['Ping ms', s.ping ? String(s.ping) : '—'],
    ...(mem ? ([['JS heap MB', (mem.usedJSHeapSize / 1e6).toFixed(0)]] as [string, string][]) : []),
  ];
  return (
    <div>
      <div className="row" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span className="badge accent">{playing ? 'Game' : 'Editor'}</span>
        <label className="row" style={{ gap: 6 }}>
          <Switch checked={physicsDebug} onChange={(v) => set({ physicsDebug: v })} label="Show colliders" /> Show colliders
        </label>
        <label className="row" style={{ gap: 6 }}>
          Speed
          <select className="select" style={{ width: 80 }} value={timeScale} onChange={(e) => set({ timeScale: Number(e.target.value) })}>
            {[0.1, 0.25, 0.5, 1, 2].map((v) => (
              <option key={v} value={v}>{v}×</option>
            ))}
          </select>
        </label>
      </div>
      <div className="stats">
        {stats.map(([l, v]) => (
          <div key={l} className="stat">
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
      <div className="faint" style={{ padding: '0 10px', fontSize: 11.5 }}>Frame time (last ~20s, bar top = {max.toFixed(1)} ms)</div>
      <div className="spark">
        {history.map((v, i) => (
          <i key={i} style={{ height: `${(v / max) * 100}%`, background: v > 16.7 ? 'var(--warning)' : undefined }} />
        ))}
      </div>
    </div>
  );
}
