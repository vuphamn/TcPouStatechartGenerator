import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Each edition's version and release notes (scripts/release-plan.cjs: the versions in its files, its releases from the
// git tags): the status bar's version, the Release notes dialog. Without git history: the versions only
function releaseNotes(): Plugin {
  const id = 'virtual:kss-release-notes';
  return {
    name: 'kss-release-notes',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null;
      let history: unknown;
      try {
        history = require('./scripts/release-plan.cjs').history();
      } catch (e) {
        history = { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
      }
      return `export default ${JSON.stringify(history)};`;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), releaseNotes()],
  define: {
    __KSS_VERSIONS__: JSON.stringify(require('./scripts/release-plan.cjs').versions()),
    // Link's code stamp for this build: a Link reporting another one is from another version
    __KSS_LINK_STAMP__: JSON.stringify(require('./scripts/link-code-stamp.cjs').linkCodeStamp()),
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: {
      // Build output: watching it locks packaged files (electron-builder rename fails)
      // and crashes the dev server with EBUSY while a built .exe is running
      // (tests/.output: logs and screenshots written while the tests run against this server)
      ignored: ['**/release/**', '**/dist/**', '**/xae-extension/**', '**/tests/**'],
    },
  },
});
