import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function apiPlugin() {
  return {
    name: 'api-middleware',
    async configureServer(server) {
      console.log('Loading API...');
      const { createApp } = await import('../backend/api.js');
      console.log('createApp imported, initializing...');
      const apiApp = await createApp();
      console.log('API app created');

      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api')) {
          apiApp(req, res, () => {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'API endpoint not found' }));
          });
        } else {
          next();
        }
      });
      console.log('API middleware loaded');
    }
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    port: 5174
  },
  optimizeDeps: {
    exclude: ['express', 'cors', 'bcryptjs', 'jsonwebtoken', 'sql.js', 'openai', 'dotenv', '@anthropic-ai/sdk']
  }
});
