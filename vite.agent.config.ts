import { defineConfig } from 'vite';

/*
 * Bundles the receipt assistant's command-line device for Node.
 *
 * Kept apart from vite.config.ts on purpose: none of the app's plugins
 * belong here, and a service worker generated for a command-line tool would
 * be nonsense. Dependencies stay external and are loaded from node_modules,
 * because this only ever runs from a checkout of the repository.
 */
export default defineConfig({
  // The app's public folder holds the OCR engine; none of it belongs here.
  publicDir: false,
  /*
   * Everything bundled into the one file, dependencies included. The
   * receipt watcher runs it from a directory of its own on the server, not
   * from a checkout whose node_modules an `npm ci` can pull from under it.
   */
  ssr: { noExternal: true },
  build: {
    ssr: 'src/agent/main.ts',
    outDir: 'dist-agent',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      output: { entryFileNames: 'kontera-agent.mjs' },
    },
  },
});
