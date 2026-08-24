import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const dashboardHtml = fileURLToPath(new URL('./index.html', import.meta.url));
const batchesHtml = fileURLToPath(new URL('./batches.html', import.meta.url));

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: dashboardHtml,
        batches: batchesHtml
      }
    }
  }
});
