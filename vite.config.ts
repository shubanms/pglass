import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Static hosting on GitHub Pages (project subpath) requires a relative base
// so all asset URLs resolve regardless of the deploy path. See PRD §1.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
