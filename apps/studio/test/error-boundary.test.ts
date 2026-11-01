import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '../src/ui/ErrorBoundary';

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/EditorPage-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
  ])('recognises a failed script download: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('does not treat ordinary errors as stale-deploy errors', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isChunkLoadError('boom')).toBe(false);
  });
});
