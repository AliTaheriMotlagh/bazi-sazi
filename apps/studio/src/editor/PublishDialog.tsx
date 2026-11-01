import { validateProject } from '@bazi/engine';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, gameUrl } from '../api/client';
import { editor, useEditor } from '../store/editor';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Modal, Spinner } from '../ui/primitives';
import { viewportBridge } from './session';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'my-game';

export function PublishDialog({ published, onPublished, onClose, save }: { published: { slug: string; title: string; description: string } | null; onPublished(info: { slug: string; title: string; description: string } | null): void; onClose(): void; save(): Promise<boolean> }) {
  const project = useEditor((s) => s.project)!;
  const projectId = useEditor((s) => s.projectId)!;
  const [slug, setSlug] = useState(published?.slug ?? slugify(project.name));
  const [title, setTitle] = useState(published?.title ?? project.name);
  const [description, setDescription] = useState(published?.description ?? project.description);
  const [available, setAvailable] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const problems = useMemo(() => validateProject(project), [project]);
  const errors = problems.filter((p) => p.severity === 'error');
  const [thumb] = useState(() => viewportBridge.capture());

  useEffect(() => {
    setAvailable(null);
    const t = setTimeout(() => {
      api
        .slugAvailable(slug, projectId)
        .then((r) => setAvailable({ ok: r.available, reason: r.reason ?? (r.available ? undefined : 'Already taken') }))
        .catch(() => setAvailable(null));
    }, 300);
    return () => clearTimeout(t);
  }, [slug, projectId]);

  const publish = async () => {
    setBusy(true);
    try {
      if (!(await save())) throw new Error('Could not save the project first.');
      const res = await api.publish(projectId, { slug, title, description, thumbnail: thumb ?? undefined });
      onPublished({ slug: res.slug, title, description });
      setDone(res.slug);
      toast('Your game is live! 🎉', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (!confirm('Take this game offline? Its link will stop working.')) return;
    await api.unpublish(projectId);
    onPublished(null);
    toast('Game unpublished');
    onClose();
  };

  if (done) {
    const url = gameUrl(done);
    return (
      <Modal title="Published!" icon="Rocket" onClose={onClose}>
        <p style={{ margin: 0 }}>Anyone can play your game now — on phones, tablets, computers and VR headsets.</p>
        <div className="row">
          <input className="input lg mono" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className="btn lg" onClick={() => navigator.clipboard.writeText(url).then(() => toast('Link copied', 'success'))}><Icon name="Copy" /></button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <a className="btn primary" href={url} target="_blank" rel="noopener"><Icon name="ExternalLink" size={15} /> Open game</a>
          <Link className="btn" to={`/play/${done}`} onClick={() => editor().set({})}><Icon name="Globe" size={15} /> Game page</Link>
        </div>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>Publish again any time to update it. Players always get the latest version.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={published ? 'Update published game' : 'Publish your game'}
      icon="Rocket"
      onClose={onClose}
      footer={
        <>
          {published && <button className="btn danger" onClick={unpublish} style={{ marginRight: 'auto' }}>Unpublish</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || errors.length > 0 || !available?.ok || !title.trim()} onClick={publish}>
            {busy ? <Spinner size={14} /> : <Icon name="Rocket" size={14} />} {published ? 'Update' : 'Publish'}
          </button>
        </>
      }
    >
      {thumb && <img src={thumb} alt="Thumbnail preview" style={{ width: '100%', borderRadius: 10, aspectRatio: '16/9', objectFit: 'cover', background: '#000' }} />}
      <label>
        <span className="field-label">Title</span>
        <input className="input lg" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </label>
      <label>
        <span className="field-label">Web address</span>
        <div className="row" style={{ gap: 6 }}>
          <input className="input lg mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40))} />
        </div>
        <span className="faint mono" style={{ fontSize: 12 }}>{gameUrl(slug || 'my-game')}</span>
        {available && !available.ok && <div className="badge error" style={{ marginTop: 4 }}>{available.reason}</div>}
        {available?.ok && <div className="badge" style={{ marginTop: 4, color: 'var(--success)' }}><Icon name="Check" size={11} /> Available</div>}
      </label>
      <label>
        <span className="field-label">Description (optional)</span>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="How to play, controls, credits…" />
      </label>
      {errors.length > 0 && (
        <div className="col" style={{ gap: 4, padding: 10, borderRadius: 10, background: 'rgba(248,113,113,.08)' }}>
          <b style={{ color: 'var(--danger)' }}>Fix these before publishing:</b>
          {errors.slice(0, 5).map((p, i) => <span key={i} style={{ fontSize: 13 }}>• {p.message}</span>)}
        </div>
      )}
      {errors.length === 0 && problems.length > 0 && <span className="faint" style={{ fontSize: 12 }}>{problems.length} warning(s) — see the Problems tab. You can still publish.</span>}
    </Modal>
  );
}
