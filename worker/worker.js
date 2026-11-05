// Cloudflare Worker entry: same REST API as server.js, backed by D1 (SQLite).
// Validation rules intentionally mirror src/validate.js - keep them in sync.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function fail(message, status) {
  return json({ error: message }, status);
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isIsoDateString(v) {
  // Strict ISO 8601 shape; Date.parse alone also accepts "Nov 1 2026" etc. (loop 21)
  return typeof v === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(v)
    && !Number.isNaN(Date.parse(v));
}

function validateTaskInput(body, partial) {
  const errors = [];
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      errors.push('title is required');
    } else if (body.title.trim().length > 200) {
      errors.push('title must be at most 200 characters');
    }
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      errors.push('description must be a string');
    } else if (body.description.length > 1000) {
      errors.push('description must be at most 1000 characters');
    }
  }
  if (body.completed !== undefined && typeof body.completed !== 'boolean') {
    errors.push('completed must be true or false');
  }
  if (body.sort_order !== undefined && (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order))) {
    errors.push('sort_order must be a number');
  }
  if (body.completed_at !== undefined && !isIsoDateString(body.completed_at)) {
    errors.push('completed_at must be an ISO 8601 date string');
  }
  if (body.completed_at_estimated !== undefined && typeof body.completed_at_estimated !== 'boolean') {
    errors.push('completed_at_estimated must be true or false');
  }

  // Undo-delete restore may reattach a card's original stamps (loop 20).
  if (body.created_at !== undefined) {
    if (!isIsoDateString(body.created_at) || Date.parse(body.created_at) > Date.now()) {
      errors.push('created_at must be an ISO 8601 date string not in the future');
    }
  }
  if (body.updated_at !== undefined) {
    if (!isIsoDateString(body.updated_at) || Date.parse(body.updated_at) > Date.now()) {
      errors.push('updated_at must be an ISO 8601 date string not in the future');
    }
  }
  if (body.updated_at !== undefined && !partial && body.created_at === undefined) {
    errors.push('updated_at requires created_at when creating a task');
  }
  if (partial && body.created_at !== undefined) {
    errors.push('created_at can only be set when creating a task');
  }
  if (!partial && body.created_at !== undefined && body.updated_at !== undefined
      && !Number.isNaN(Date.parse(body.created_at)) && !Number.isNaN(Date.parse(body.updated_at))
      && Date.parse(body.updated_at) < Date.parse(body.created_at)) {
    errors.push('updated_at must not be before created_at');
  }
  return errors;
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

async function getTask(db, id) {
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return row ? rowToTask(row) : null;
}

async function handleApi(request, env, url) {
  const db = env.DB;
  const parts = url.pathname.split('/').filter(Boolean); // ['api','tasks',':id'?]
  const idRaw = parts.length === 3 ? parts[2] : null;

  if (parts.length > 3 || parts[1] !== 'tasks') return fail('Not found', 404);

  if (request.method === 'GET' && idRaw === null) {
    const status = url.searchParams.get('status') || 'all';
    if (!['all', 'active', 'completed'].includes(status)) {
      return fail("status must be 'all', 'active' or 'completed'", 400);
    }
    let sql = 'SELECT * FROM tasks';
    if (status === 'active') sql += ' WHERE completed = 0';
    if (status === 'completed') sql += ' WHERE completed = 1';
    sql += ' ORDER BY completed ASC, sort_order ASC';
    const { results } = await db.prepare(sql).all();
    return json(results.map(rowToTask));
  }

  if (request.method === 'POST' && idRaw === null) {
    let body;
    try { body = await request.json(); } catch { return fail('request body must be valid JSON', 400); }
    const errors = validateTaskInput(body || {}, false);
    if (errors.length > 0) return fail(errors.join('; '), 400);
    const now = new Date().toISOString();
    const result = await db
      .prepare('INSERT INTO tasks (title, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(body.title.trim(), (body.description || '').trim(), Date.now(), body.created_at || now, body.updated_at || body.created_at || now)
      .run();
    return json(await getTask(db, result.meta.last_row_id), 201);
  }

  if (idRaw !== null) {
    const id = parseId(idRaw);
    if (id === null) return fail('id must be a positive integer', 400);

    if (request.method === 'GET') {
      const task = await getTask(db, id);
      if (!task) return fail(`Task ${id} not found`, 404);
      return json(task);
    }

    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return fail('request body must be valid JSON', 400); }
      body = body || {};
      const errors = validateTaskInput(body, true);
      if (errors.length > 0) return fail(errors.join('; '), 400);
      if (body.title === undefined && body.description === undefined && body.completed === undefined
          && body.sort_order === undefined && body.completed_at === undefined && body.completed_at_estimated === undefined
          && body.updated_at === undefined) {
        return fail('provide at least one of: title, description, completed, sort_order, completed_at, completed_at_estimated, updated_at', 400);
      }
      const existing = await getTask(db, id);
      if (!existing) return fail(`Task ${id} not found`, 404);
      const now = new Date().toISOString();
      const completedNow = body.completed !== undefined ? body.completed : existing.completed;
      // Stamp the moment a card is finished; clear it if it is reopened.
      // A stamp written here is exact (estimated = 0); a kept legacy stamp
      // keeps its estimated flag.
      // completed_at/_estimated may be supplied to reattach an original stamp
      // faithfully (undo-delete restore); they only apply to a completed card.
      const completedNow2 = body.completed !== undefined ? body.completed : existing.completed;
      if ((body.completed_at !== undefined || body.completed_at_estimated !== undefined) && !completedNow2) {
        return fail('completed_at and completed_at_estimated require the task to be completed', 400);
      }
      const completedAt = body.completed === undefined && body.completed_at === undefined ? existing.completedAt
        : (!completedNow2 ? null
          : (body.completed_at !== undefined ? body.completed_at
          : (existing.completed ? existing.completedAt : now)));
      const completedAtEstimated = body.completed === undefined && body.completed_at_estimated === undefined ? existing.completedAtEstimated
        : (!completedNow2 ? false
          : (body.completed_at_estimated !== undefined ? body.completed_at_estimated
          : (existing.completed ? existing.completedAtEstimated : false)));
      await db
        .prepare('UPDATE tasks SET title = ?, description = ?, completed = ?, sort_order = ?, updated_at = ?, completed_at = ?, completed_at_estimated = ? WHERE id = ?')
        .bind(
          body.title !== undefined ? body.title.trim() : existing.title,
          body.description !== undefined ? body.description.trim() : existing.description,
          completedNow ? 1 : 0,
          body.sort_order !== undefined ? body.sort_order : existing.sortOrder,
          body.updated_at !== undefined ? body.updated_at : now,
          completedAt,
          completedAtEstimated ? 1 : 0,
          id,
        )
        .run();
      return json(await getTask(db, id));
    }

    if (request.method === 'DELETE') {
      const result = await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
      if (result.meta.changes === 0) return fail(`Task ${id} not found`, 404);
      return new Response(null, { status: 204 });
    }
  }

  return fail('Not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env, url);
      }
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return fail('Internal server error', 500);
    }
  },
};
