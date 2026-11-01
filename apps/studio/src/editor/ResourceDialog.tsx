import { addAsset } from '../store/commands';
import { toast } from '../store/ui';
import { Modal } from '../ui/primitives';
import { ResourceExplorer, type ImportedResource } from './ResourceExplorer';

/** Free resource browser inside the editor: "Add to project" lands in the Content Browser. */
export function ResourceDialog({ onClose }: { onClose(): void }) {
  const onImport = (r: ImportedResource) => {
    addAsset({ name: r.name, type: r.type, url: r.url, size: r.size, credit: r.credit });
    toast(`Added “${r.name}” to your project.`, 'success');
  };
  return (
    <Modal title="Free resources" icon="Library" wide full onClose={onClose}>
      <ResourceExplorer onImport={onImport} autoFocus />
    </Modal>
  );
}
