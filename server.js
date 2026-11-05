// Entry point: starts the Express server, serves the frontend and mounts the API.
const path = require('path');
const express = require('express');
const tasksRouter = require('./src/routes/tasks');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Loop 22: optional passphrase lock (parity with the Worker gate). Set
// DECK_PASSPHRASE in the environment to require x-deck-key on every /api/*.
const crypto = require('crypto');
const DECK_KEY = process.env.DECK_PASSPHRASE;
app.use('/api', (req, res, next) => {
  if (!DECK_KEY) return next();
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  const key = req.get('x-deck-key');
  if (!key || !crypto.timingSafeEqual(h(key), h(DECK_KEY))) {
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
