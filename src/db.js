// Database layer: one SQLite file (tasks.db) created automatically on first run.
// Uses Node's built-in SQLite module, so no extra database server is needed.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, '..', 'tasks.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS unlock_attempts (
    ip_hash TEXT NOT NULL,
    ts      TEXT NOT NULL
  );
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

// Databases created before completion tracking get the columns too.
let addedCompletedAt = false;
try {
  db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT');
  addedCompletedAt = true;
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
let addedEstimated = false;
try {
  db.exec('ALTER TABLE tasks ADD COLUMN completed_at_estimated INTEGER NOT NULL DEFAULT 0');
  addedEstimated = true;
} catch (err) {
  if (!String(err.message).includes('duplicate column')) throw err;
}
// These run only in the moment a column is first added, never on later boots:
// a fresh exact stamp would otherwise be misread as legacy on every restart.
if (addedCompletedAt) {
  // Legacy rows: the card's last update time stands in as an ESTIMATE of
  // completion (exact only if finishing was the last change to the card).
  db.exec('UPDATE tasks SET completed_at = updated_at WHERE completed = 1 AND completed_at IS NULL');
}
if (addedEstimated) {
  // Every stamp existing at this moment predates exact tracking.
  db.exec('UPDATE tasks SET completed_at_estimated = 1 WHERE completed_at IS NOT NULL');
}

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
    completedAtEstimated: row.completed_at_estimated === 1,
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

function createTask({ title, description, createdAt, updatedAt }) {
  const now = new Date().toISOString();
  // Undo-delete restore reattaches the original stamps so an undone card is
  // indistinguishable from one that was never deleted (loop 20).
  const created = createdAt || now;
  const result = db
    .prepare('INSERT INTO tasks (title, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(title, description ?? '', Date.now(), created, updatedAt || created);
  return getTask(Number(result.lastInsertRowid));
}

function updateTask(id, { title, description, completed, sort_order, completedAt, completedAtEstimated, updatedAt }) {
  const existing = getTask(id);
  if (!existing) return null;
  const completedNow = completed !== undefined ? completed : existing.completed;
  const now = new Date().toISOString();
  const next = {
    title: title !== undefined ? title : existing.title,
    description: description !== undefined ? description : existing.description,
    completed: completed !== undefined ? (completed ? 1 : 0) : (existing.completed ? 1 : 0),
    sortOrder: sort_order !== undefined ? sort_order : existing.sortOrder,
    // Stamp the moment a card is finished; clear it if it is reopened.
    // A stamp written here is exact (estimated = 0); a kept legacy stamp keeps
    // its estimated flag.
    completedAt: completed === undefined && completedAt === undefined ? existing.completedAt
      : (!completedNow ? null
        : (completedAt !== undefined ? completedAt
        : (existing.completed ? existing.completedAt : now))),
    completedAtEstimated: completed === undefined && completedAtEstimated === undefined ? existing.completedAtEstimated
      : (!completedNow ? false
        : (completedAtEstimated !== undefined ? completedAtEstimated
        : (existing.completed ? existing.completedAtEstimated : false))),
  };
  db.prepare('UPDATE tasks SET title = ?, description = ?, completed = ?, sort_order = ?, updated_at = ?, completed_at = ?, completed_at_estimated = ? WHERE id = ?')
    .run(next.title, next.description, next.completed, next.sortOrder, updatedAt !== undefined ? updatedAt : now, next.completedAt, next.completedAtEstimated ? 1 : 0, id);
  return getTask(id);
}

function deleteTask(id) {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}


/* Loop 22: passphrase-lock sessions. Only token hashes are stored, with a
   30-day expiry; expired rows are cleaned up lazily on unlock. */
const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

function createSession(tokenHash) {
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, now.toISOString(), exp.toISOString());
  return exp.toISOString();
}

function sessionValid(tokenHash) {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash);
  return !!(row && row.expires_at > new Date().toISOString());
}

/* Loop 22: bounded backoff for online guessing - failed unlocks per client-IP
   hash inside a 15-minute window. Only IP hashes are stored. */
function pruneUnlockAttempts(sinceIso) {
  db.prepare('DELETE FROM unlock_attempts WHERE ts < ?').run(sinceIso);
}
function countUnlockAttempts(ipHash) {
  return db.prepare('SELECT COUNT(*) AS n FROM unlock_attempts WHERE ip_hash = ?').get(ipHash).n;
}
function recordUnlockAttempt(ipHash) {
  db.prepare('INSERT INTO unlock_attempts (ip_hash, ts) VALUES (?, ?)').run(ipHash, new Date().toISOString());
}
function clearUnlockAttempts(ipHash) {
  db.prepare('DELETE FROM unlock_attempts WHERE ip_hash = ?').run(ipHash);
}

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask, createSession, sessionValid, pruneUnlockAttempts, countUnlockAttempts, recordUnlockAttempt, clearUnlockAttempts };
