import { EMPTY_STATS, formatBytes, formatCount, rateObject, textureBytes, type RenderStats } from '@bazi/engine/core';
import { useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { session } from '../session';
import { modelPreview } from '../thumbnails';

const LABEL = { light: 'Light', ok: 'Moderate', heavy: 'Heavy' } as const;

/** Triangles / draw calls / texture memory with a traffic-light verdict and plain-language tips. */
export function StatsCard({ stats, title = 'Performance' }: { stats: RenderStats; title?: string }) {
  const [open, setOpen] = useState(false);
  const verdict = rateObject(stats);
  return (
    <div className={`perf perf-${verdict.rating}`}>
      <button className="perf-head" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${title}: ${LABEL[verdict.rating]}. ${open ? 'Hide' : 'Show'} details`}>
        <span className="perf-dot" aria-hidden />
        <span className="perf-title">{title}</span>
        <span className="perf-level">{LABEL[verdict.rating]}</span>
        <span className="spacer" />
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>
      <div className="perf-stats">
        <span title="Triangles drawn"><b>{formatCount(stats.triangles)}</b> triangles</span>
        <span title="Draw calls: separate steps the GPU performs for this object"><b>{stats.drawCalls}</b> draw call{stats.drawCalls === 1 ? '' : 's'}</span>
        <span title="Video memory used by textures"><b>{formatBytes(stats.textureBytes)}</b> textures</span>
      </div>
      {open && (
        <ul className="perf-tips">
          {verdict.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Live cost of one object in the scene, measured from what is actually drawn. */
export function ObjectPerformance({ entityId, signature }: { entityId: string; signature: string }) {
  const [stats, setStats] = useState<RenderStats | null>(null);
  useEffect(() => {
    const measure = async () => {
      const rt = session().editRuntime;
      const go = rt?.getObject(entityId);
      if (!go) return setStats(null);
      const { measureObject } = await import('@bazi/engine');
      setStats(measureObject(go.object3d));
    };
    void measure();
    // Models and textures arrive asynchronously, so measure again once they had time to load.
    const timers = [setTimeout(measure, 700), setTimeout(measure, 2500)];
    return () => timers.forEach(clearTimeout);
  }, [entityId, signature]);
  if (!stats || (stats.triangles === 0 && stats.drawCalls === 0)) return null;
  return <StatsCard stats={stats} />;
}

/** Cost of an image asset: decoded size and the GPU memory it will take. */
export function ImageCost({ url }: { url: string }) {
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    setSize(null);
    const img = new Image();
    img.onload = () => setSize([img.naturalWidth, img.naturalHeight]);
    img.src = url;
  }, [url]);
  if (!size) return null;
  const bytes = textureBytes(size[0], size[1]);
  return (
    <>
      <StatsCard title={`${size[0]}×${size[1]} image`} stats={{ ...EMPTY_STATS, textures: 1, textureBytes: bytes }} />
    </>
  );
}

/** A big, cached preview of a 3D model with its cost. */
export function ModelPreviewCard({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState<{ image: string; stats: RenderStats } | 'error' | null>(null);
  useEffect(() => {
    let live = true;
    setState(null);
    modelPreview(url).then(
      (p) => live && setState(p),
      () => live && setState('error'),
    );
    return () => {
      live = false;
    };
  }, [url]);
  if (state === 'error') return <div className="muted" style={{ fontSize: 12 }}>This model could not be previewed.</div>;
  if (!state) return <div className="model-preview skeleton" aria-busy="true" />;
  return (
    <>
      <img className="model-preview" src={state.image} alt={`Preview of ${name}`} />
      <StatsCard title="Model cost" stats={state.stats} />
    </>
  );
}
