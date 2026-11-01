import { normalizeProject } from '@bazi/engine';
import { useCallback, useEffect, useState } from 'react';
import { api, type VersionInfo } from '../api/client';
import { editor } from '../store/editor';
import { markSynced, saveLocal } from '../store/offline';
import { toast } from '../store/ui';
import { Icon } from '../ui/Icon';
import { Modal, Spinner } from '../ui/primitives';

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Project version history: named save points plus automatic ones, each restorable (restoring is undoable). */
export function HistoryDialog({ onClose, save }: { onClose(): void; save(): Promise<boolean> }) {
  const projectId = editor().projectId!;
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setVersions((await api.versions(projectId)).versions);
    } catch (err) {
      toast((err as Error).message, 'error');
      setVersions([]);
    }
  }, [projectId]);

  useEffect(() => {
    void save().then(load);
  }, [save, load]);

  const create = async () => {
    setBusy(true);
    try {
      await save();
      await api.saveVersion(projectId, label.trim() || 'Saved version');
      setLabel('');
      await load();
      toast('Version saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setBusy(false);
  };

  const restore = async (v: VersionInfo) => {
    if (!confirm(`Restore "${v.label || v.name}" from ${when(v.createdAt)}?\nYour current state is kept as a new version, so you can come back.`)) return;
    setBusy(true);
    try {
      const res = await api.restoreVersion(projectId, v.id);
      const data = normalizeProject(res.data);
      editor().open(projectId, data);
      const seq = await saveLocal(projectId, data, null);
      await markSynced(projectId, seq, res.updatedAt);
      toast('Version restored', 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal title="Version history" icon="Clock" onClose={onClose}>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <input className="input grow" placeholder="Name this version (e.g. “Before boss fight”)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} aria-label="Version name" />
        <button className="btn primary" disabled={busy} onClick={() => void create()}><Icon name="Save" size={14} /> Save version</button>
      </div>
      {!versions ? (
        <div className="empty"><Spinner /></div>
      ) : versions.length === 0 ? (
        <div className="empty">No versions yet. They are created automatically while you work (at most every 10 minutes), or save one yourself.</div>
      ) : (
        <ul className="version-list">
          {versions.map((v) => (
            <li key={v.id} className="row">
              <div className="grow">
                <div>{v.label || (v.auto ? 'Automatic' : 'Saved version')} <span className="faint">· {v.name}</span></div>
                <div className="faint" style={{ fontSize: 12 }}>{when(v.createdAt)} · {(v.size / 1024).toFixed(0)} KB</div>
              </div>
              <button className="btn sm" disabled={busy} onClick={() => void restore(v)}><Icon name="RotateCcw" size={13} /> Restore</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
