// REST CRUD routes for tasks.
const express = require('express');
const db = require('../db');
const { parseId, validateTaskInput } = require('../validate');

const router = express.Router();

// GET /api/tasks?status=all|active|completed - list tasks
router.get('/', (req, res) => {
  const status = req.query.status || 'all';
  if (!['all', 'active', 'completed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'all', 'active' or 'completed'" });
  }
  res.json(db.listTasks(status));
});

// POST /api/tasks - create a task
router.post('/', (req, res) => {
  const { errors } = validateTaskInput(req.body || {}, { partial: false });
  if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

  const task = db.createTask({
    title: req.body.title.trim(),
    description: (req.body.description || '').trim(),
  });
  res.status(201).json(task);
});

// GET /api/tasks/:id - fetch one task
router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });

  const task = db.getTask(id);
  if (!task) return res.status(404).json({ error: `Task ${id} not found` });
  res.json(task);
});

// PUT /api/tasks/:id - edit title/description and/or mark complete-incomplete
router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });

  const body = req.body || {};
  const { errors } = validateTaskInput(body, { partial: true });
  if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });
  if (body.title === undefined && body.description === undefined && body.completed === undefined) {
    return res.status(400).json({ error: 'provide at least one of: title, description, completed' });
  }

  const updates = {};
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.description !== undefined) updates.description = body.description.trim();
  if (body.completed !== undefined) updates.completed = body.completed;

  const task = db.updateTask(id, updates);
  if (!task) return res.status(404).json({ error: `Task ${id} not found` });
  res.json(task);
});

// DELETE /api/tasks/:id - remove a task
router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });

  const removed = db.deleteTask(id);
  if (!removed) return res.status(404).json({ error: `Task ${id} not found` });
  res.status(204).end();
});

module.exports = router;
