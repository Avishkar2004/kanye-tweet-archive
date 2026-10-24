// Vite config: a single-page app (index.html + src/main.js, hash routes), styled with Tailwind CSS.
//   npm run dev       start the dev server at http://localhost:8000
//   npm run build     build the site into dist/
//   npm run preview   serve dist/ at http://localhost:4173
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative URLs, so dist/ works from any sub-path (a GitHub Pages project site, say).
  base: './',
  plugins: [tailwindcss()],
  server: { port: 8000 },
  // The page scripts use top-level await.
  build: { target: 'es2022' },
});
