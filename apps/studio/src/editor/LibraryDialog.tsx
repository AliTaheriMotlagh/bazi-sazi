import { useCallback, useEffect, useState } from 'react';
import { api, type SharedPrefabInfo } from '../api/client';
import { bundlePrefab, importPrefabBundle } from '../store/commands';
import { useEditor } from '../store/editor';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Modal, Spinner } from '../ui/primitives';

/** Community prefab library: browse and import prefabs, or share one of your own. */
export function LibraryDialog({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project)!;
  const me = useAuth((s) => s.user);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SharedPrefabInfo[] | null>(null);
  const [tab, setTab] = useState<'browse' | 'share'>('browse');
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await api.prefabs(q, project.settings.mode)).prefabs);
    } catch (err) {
      toast((err as Error).message, 'error');
      setItems([]);
    }
  }, [q, project.settings.mode]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const add = async (info: SharedPrefabInfo) => {
    setBusy(true);
    try {
      const shared = await api.sharedPrefab(info.id);
      importPrefabBundle(shared);
      toast(`Added prefab “${info.name}” to Prefabs`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setBusy(false);
  };

  const share = async (prefabId: string) => {
    const bundle = bundlePrefab(prefabId);
    if (!bundle) return;
    setBusy(true);
    try {
      await api.sharePrefab({ name: bundle.prefab.name, description: desc, mode: project.settings.mode, data: bundle });
      toast(`Shared “${bundle.prefab.name}”`, 'success');
      setDesc('');
      setTab('browse');
      void load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setBusy(false);
  };

  return (
    <Modal title="Prefab library" icon="Package" wide onClose={onClose}>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <button className={`btn sm ${tab === 'browse' ? 'primary' : ''}`} onClick={() => setTab('browse')}>Browse</button>
        <button className={`btn sm ${tab === 'share' ? 'primary' : ''}`} onClick={() => setTab('share')}>Share yours</button>
        {tab === 'browse' && <input className="input grow" placeholder={`Search ${project.settings.mode.toUpperCase()} prefabs…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prefabs" />}
      </div>
      {tab === 'browse' &&
        (!items ? (
          <div className="empty"><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="empty">Nothing here yet. Be the first to share a prefab.</div>
        ) : (
          <ul className="version-list">
            {items.map((p) => (
              <li key={p.id} className="row">
                <div className="grow">
                  <div>{p.name} <span className="faint">by {p.author}</span></div>
                  <div className="faint" style={{ fontSize: 12 }}>{p.description || 'No description'} · {p.downloads} downloads</div>
                </div>
                {me?.username === p.author && (
                  <button className="btn sm ghost icon" aria-label={`Unshare ${p.name}`} onClick={() => void api.deleteSharedPrefab(p.id).then(load)}><Icon name="Trash" size={13} /></button>
                )}
                <button className="btn sm primary" disabled={busy} onClick={() => void add(p)}><Icon name="Plus" size={13} /> Add to project</button>
              </li>
            ))}
          </ul>
        ))}
      {tab === 'share' &&
        (!me || me.guest ? (
          <div className="empty">Create an account (Home → your name → Save my work) to share prefabs.</div>
        ) : project.prefabs.length === 0 ? (
          <div className="empty">Make a prefab first: right-click an object → “Save as prefab”.</div>
        ) : (
          <>
            <input className="input" placeholder="Short description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" style={{ marginBottom: 8 }} />
            <ul className="version-list">
              {project.prefabs.map((p) => (
                <li key={p.id} className="row">
                  <div className="grow">{p.name} <span className="faint">{p.entities.length} entities</span></div>
                  <button className="btn sm" disabled={busy} onClick={() => void share(p.id)}><Icon name="Upload" size={13} /> Share</button>
                </li>
              ))}
            </ul>
            <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Shared prefabs are public. Only share things you made or have the right to share.</div>
          </>
        ))}
    </Modal>
  );
}
