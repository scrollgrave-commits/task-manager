// Entry point: starts the Express server, serves the frontend and mounts the API.
const path = require('path');
const express = require('express');
const tasksRouter = require('./src/routes/tasks');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Loop 22: optional passphrase lock with expiring cookie sessions (parity
// with the Worker gate). Set DECK_PASSPHRASE to require a session cookie on
// every /api/*; unset means open. POST /api/unlock trades the passphrase for
// a 30-day HttpOnly/SameSite=Lax cookie; only token hashes are stored.
const crypto = require('crypto');
const db = require('./src/db');
const DECK_KEY = process.env.DECK_PASSPHRASE;
const SESSION_MAX_AGE = 30 * 24 * 3600;
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();

app.post('/api/unlock', (req, res) => {
  if (!DECK_KEY) return res.status(400).json({ error: 'The deck is not locked' });
  const p = req.body && req.body.passphrase;
  if (typeof p !== 'string' || !crypto.timingSafeEqual(hash(p), hash(DECK_KEY))) {
    return res.status(401).json({ error: 'The deck is locked' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(hash(token).toString('hex'));
  res.set('Set-Cookie', `deck_session=${token}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Path=/`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (!DECK_KEY) return next();
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.get('Origin');
    if (origin && new URL(origin).host !== req.get('Host')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  const m = /(?:^|;\s*)deck_session=([a-f0-9]{64})/.exec(req.get('Cookie') || '');
  if (!m || !db.sessionValid(hash(m[1]).toString('hex'))) {
    return res.status(401).json({ error: 'The deck is locked' });
  }
  next();
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// REST API
app.use('/api/tasks', tasksRouter);

// Unknown API routes return a JSON 404 (not the HTML page)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler: anything thrown in a route lands here
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Malformed JSON bodies are client errors, not server faults
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(PORT, () => {
  console.log(`Task Manager running at http://localhost:${PORT}`);
});
