import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fluDataHandler from './api/flu-data.js';

const createVercelResponse = (res) => ({
  setHeader(name, value) {
    res.setHeader(name, value);
  },
  status(code) {
    res.statusCode = code;
    return this;
  },
  json(payload) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(payload));
  },
  end(payload = '') {
    res.end(payload);
  }
});

const fluDataApiDevPlugin = () => ({
  name: 'fluglobe-api-dev-server',
  configureServer(server) {
    server.middlewares.use('/api/flu-data', async (req, res, next) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        await fluDataHandler(
          {
            method: req.method,
            query: Object.fromEntries(url.searchParams.entries())
          },
          createVercelResponse(res)
        );
      } catch (error) {
        next(error);
      }
    });
  }
});

export default defineConfig({
  plugins: [react(), fluDataApiDevPlugin()],
  base: './'
});
