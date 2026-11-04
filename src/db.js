// Database layer: one SQLite file (tasks.db) created automatically on first run.
// Uses Node's built-in SQLite module, so no extra database server is needed.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, '..', 'tasks.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    completed   INTEGER NOT NULL DEFAULT 0,
    sort_order  REAL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  )
`);

// Databases created before the deck feature get the column too.
try {
  db.exec('ALTER TABLE tasks ADD COLUMN sort_order REAL');
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
// Backfill so existing cards keep their creation order in the deck.
db.exec("UPDATE tasks SET sort_order = CAST(strftime('%s', created_at) AS REAL) WHERE sort_order IS NULL");

// Databases created before completion tracking get the column too.
try {
  db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT');
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
// Cards already done were completed at their last update.
db.exec('UPDATE tasks SET completed_at = updated_at WHERE completed = 1 AND completed_at IS NULL');

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    completed: row.completed === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

function listTasks(status) {
  let sql = 'SELECT * FROM tasks';
  const params = [];
  if (status === 'active') sql += ' WHERE completed = 0';
  if (status === 'completed') sql += ' WHERE completed = 1';
  sql += ' ORDER BY completed ASC, sort_order ASC';
  return db.prepare(sql).all(...params).map(rowToTask);
}

function getTask(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? rowToTask(row) : null;
}

function createTask({ title, description }) {
  const now = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO tasks (title, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(title, description ?? '', Date.now(), now, now);
  return getTask(Number(result.lastInsertRowid));
}

function updateTask(id, { title, description, completed, sort_order }) {
  const existing = getTask(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next = {
    title: title !== undefined ? title : existing.title,
    description: description !== undefined ? description : existing.description,
    completed: completed !== undefined ? (completed ? 1 : 0) : (existing.completed ? 1 : 0),
    sortOrder: sort_order !== undefined ? sort_order : existing.sortOrder,
    // Stamp the moment a card is finished; clear it if it is reopened.
    completedAt: completed === undefined ? existing.completedAt
      : (completed ? (existing.completed ? existing.completedAt : now) : null),
  };
  db.prepare('UPDATE tasks SET title = ?, description = ?, completed = ?, sort_order = ?, updated_at = ?, completed_at = ? WHERE id = ?')
    .run(next.title, next.description, next.completed, next.sortOrder, now, next.completedAt, id);
  return getTask(id);
}

function deleteTask(id) {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask };
