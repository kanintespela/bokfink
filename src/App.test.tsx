import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

// A smoke test for the toolchain rather than for the markup: it fails if TSX,
// React or the test runner are wired up wrong, which is all stage 0 promises.
describe('App', () => {
  it('renders the application name', () => {
    expect(renderToStaticMarkup(<App />)).toContain('Kontera');
  });
});
