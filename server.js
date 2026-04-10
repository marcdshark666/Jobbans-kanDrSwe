const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'data', 'jobs-cache.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// GET /api/jobs - return cached jobs
app.get('/api/jobs', (req, res) => {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      res.json(data);
    } else {
      res.json({ jobs: [], lastUpdated: null, sources: [] });
    }
  } catch (e) {
    res.status(500).json({ error: 'Could not read cache', jobs: [], lastUpdated: null });
  }
});

// POST /api/refresh - trigger a cache rebuild
app.post('/api/refresh', async (req, res) => {
  try {
    const { buildCache } = require('./scripts/build-cache');
    const result = await buildCache();
    res.json({ success: true, count: result.jobs.length, lastUpdated: result.lastUpdated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/status - health check
app.get('/api/status', (req, res) => {
  let lastUpdated = null;
  let count = 0;
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      lastUpdated = d.lastUpdated;
      count = d.jobs ? d.jobs.length : 0;
    } catch (e) {}
  }
  res.json({ status: 'ok', lastUpdated, jobCount: count });
});

// Fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Läkarjobb Portal körs på http://localhost:${PORT}`);
  // Auto-refresh every 30 minutes
  setInterval(async () => {
    try {
      console.log('[Auto-refresh] Hämtar jobb...');
      const { buildCache } = require('./scripts/build-cache');
      await buildCache();
      console.log('[Auto-refresh] Klar.');
    } catch (e) {
      console.error('[Auto-refresh] Fel:', e.message);
    }
  }, 30 * 60 * 1000);
});
