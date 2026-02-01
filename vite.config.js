// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import env from 'vite-plugin-env-compatible';

const root = resolve(__dirname, 'src');
const base = './';
const outDir = resolve(__dirname, 'dist');

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
        omap_geojson: resolve(root, 'index.html'),
        // omap_pbf: resolve(root, 'omap_pbf.html'),
      }
    }
  }
});
// __END__
