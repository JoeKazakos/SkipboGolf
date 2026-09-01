import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  /**
   * GitHub Pages serves a project site from /<repo>/, so a production build has
   * to be told that prefix or every asset resolves against the domain root and
   * the page loads blank. The dev server still runs at / - basing it would only
   * make the local URL awkward for no gain.
   */
  base: command === 'build' ? '/SkipboGolf/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // Only this app's tests; the legacy Angular app is not run by vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
