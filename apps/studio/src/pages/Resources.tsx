import { ResourceExplorer } from '../editor/ResourceExplorer';
import { SiteNav } from './SiteNav';

/** Public page: browse free resources from across the web without opening a project. */
export function ResourcesPage() {
  return (
    <div className="site">
      <SiteNav />
      <main className="container res-page">
        <h1>Free resources</h1>
        <p className="muted">Models, textures, sounds, sprites, fonts and more from open libraries — filter by type and licence, then add them to a project from the editor.</p>
        <ResourceExplorer autoFocus />
      </main>
    </div>
  );
}
