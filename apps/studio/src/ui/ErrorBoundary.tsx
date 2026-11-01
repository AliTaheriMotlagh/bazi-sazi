import { Component, type ErrorInfo, type ReactNode } from 'react';

const RELOAD_KEY = 'bz.reloaded-for-chunk';

/** True when a lazy-loaded script failed to download (usually a new deploy replaced the old file names). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(message);
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence against a blank (black) screen: any error while rendering shows a message with a way
 * out instead of unmounting the whole app. A failed script download (stale tab after an update, flaky
 * network) reloads the page once automatically.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI crashed:', error, info.componentStack);
    if (!isChunkLoadError(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY) !== location.href) {
        sessionStorage.setItem(RELOAD_KEY, location.href);
        location.reload();
      }
    } catch {
      /* storage blocked: the message below still offers a reload button */
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <div className="crash" role="alert">
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <h1>{chunk ? 'A new version is ready' : 'Something went wrong'}</h1>
        <p>{chunk ? 'The page needs to reload to get the latest files. Your project is saved.' : 'The editor hit an unexpected problem. Your last saved work is safe.'}</p>
        {!chunk && <pre>{error.message.slice(0, 300)}</pre>}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary lg" onClick={() => location.reload()}>Reload</button>
          <a className="btn lg" href="/">All projects</a>
        </div>
      </div>
    );
  }
}
