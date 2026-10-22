import { defineConfig, devices } from '@playwright/test';

const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;

/**
 * Some sandboxes ship a Chromium build that does not match the pinned
 * Playwright version. Point this at that binary instead of downloading one.
 */
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },

  projects: [
    {
      // Kontera is a phone app first. Testing it at desktop width would pass
      // while the real target is broken.
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: {
    // The service worker only exists in a production build, and offline
    // behaviour is exactly what these tests are for.
    //
    // --host is not optional: without it Vite binds to whatever "localhost"
    // resolves to, which is IPv4 on some machines and IPv6 on others, while
    // Playwright polls 127.0.0.1 literally. Binding to the same literal
    // address removes the ambiguity instead of relying on the resolver.
    command: `npm run build && npx vite preview --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    // Surface the server's own output, so a future failure to start says why
    // rather than only that it timed out.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
