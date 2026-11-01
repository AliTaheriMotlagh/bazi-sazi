import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './pages/Home';
import { ExplorePage } from './pages/Explore';
import { LearnPage } from './pages/Learn';
import { PlayPage } from './pages/Play';
import { ResourcesPage } from './pages/Resources';
import { useAuth } from './store/auth';
import { editor } from './store/editor';
import { startOfflineSync } from './store/offline';
import { editorHost } from './editor/session';
import { useUi } from './store/ui';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Spinner, Toasts } from './ui/primitives';
import { registerServiceWorker } from './pwa';
import './styles.css';

// The editor (three.js, Monaco, React Flow) is code-split from the public pages.
const EditorPage = lazy(() => import('./editor/EditorPage'));

function Loading() {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }} className="muted">
      <div className="row">
        <Spinner /> Loading studio…
      </div>
    </div>
  );
}

function App() {
  const init = useAuth((s) => s.init);
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  // Flush changes made offline as soon as the server is reachable again.
  useEffect(
    () =>
      startOfflineSync((ids) => {
        if (editor().saveState === 'offline' && ids.includes(editor().projectId ?? '')) void editorHost.save();
      }),
    [],
  );
  const { pathname } = useLocation();
  return (
    <>
      <ErrorBoundary key={pathname}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/play/:slug" element={<PlayPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/edit/:id" element={<EditorPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

registerServiceWorker();

// Handy for browser tests and debugging in the console (development only).
if (import.meta.env.DEV) (window as unknown as { __bazi: unknown }).__bazi = { editor };
