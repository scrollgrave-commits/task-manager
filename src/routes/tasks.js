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
  if (body.title === undefined && body.description === undefined && body.completed === undefined
      && body.sort_order === undefined && body.completed_at === undefined && body.completed_at_estimated === undefined) {
    return res.status(400).json({ error: 'provide at least one of: title, description, completed, sort_order, completed_at, completed_at_estimated' });
  }

  const updates = {};
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.description !== undefined) updates.description = body.description.trim();
  if (body.completed !== undefined) updates.completed = body.completed;
  if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
  if (body.completed_at !== undefined) updates.completedAt = body.completed_at;
  if (body.completed_at_estimated !== undefined) updates.completedAtEstimated = body.completed_at_estimated;

  const existing = db.getTask(id);
  if (!existing) return res.status(404).json({ error: `Task ${id} not found` });
  const resultingCompleted = body.completed !== undefined ? body.completed : existing.completed;
  if ((body.completed_at !== undefined || body.completed_at_estimated !== undefined) && !resultingCompleted) {
    return res.status(400).json({ error: 'completed_at and completed_at_estimated require the task to be completed' });
  }

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
