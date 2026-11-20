const path = require('node:path');
const express = require('express');
const { loadUser } = require('./src/auth');
const routes = require('./src/routes');
const { ensureSeed } = require('./src/seed');

function createApp() {
  ensureSeed();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // CORS sederhana agar API bisa dipakai aplikasi mobile / web lain
  app.use('/api', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api', loadUser, routes);
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  createApp().listen(PORT, () => {
    console.log(`Website  : http://localhost:${PORT}`);
    console.log(`Admin    : http://localhost:${PORT}/admin`);
    console.log(`Chatbot  : ${process.env.ANTHROPIC_API_KEY ? 'AI (Claude)' : 'otomatis (tanpa API key)'}`);
  });
}

module.exports = { createApp };
