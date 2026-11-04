// Entry point: starts the Express server, serves the frontend and mounts the API.
const path = require('path');
const express = require('express');
const tasksRouter = require('./src/routes/tasks');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
