// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import env from 'vite-plugin-env-compatible';

const root = resolve(import.meta.dirname, 'src');
const base = './';
const outDir = resolve(import.meta.dirname, 'dist');

export default defineConfig({
  root,
  base,
  plugins: [
    env({prefix: 'VITE', mountedPath: 'process.env'})
  ],
  build: {
    outDir,
    rollupOptions: {
      input: {
        mountain: resolve(root, 'mountain.html')
      }
    }
  }
});
// __END__
