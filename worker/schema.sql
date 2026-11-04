CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  completed   INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
