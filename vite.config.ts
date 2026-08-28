import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // Only this app's tests; the legacy Angular app is not run by vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
