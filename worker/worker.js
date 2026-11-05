// Cloudflare Worker entry: same REST API as server.js, backed by D1 (SQLite).
// Validation rules intentionally mirror src/validate.js - keep them in sync.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
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

// Loop 22: optional passphrase lock with expiring cookie sessions. POST
// /api/unlock {passphrase} validates against the DECK_PASSPHRASE secret and
// sets a 30-day Secure/HttpOnly/SameSite=Lax session cookie (random token,
// only its hash is stored in D1). Every other /api/* call needs that cookie.
// The raw passphrase never touches storage, URLs, logs or responses; JS never
// sees the session cookie. Unset secret = open (local dev parity). Static
// assets stay public - the app's code is open source; the cards behind the
// API are what the lock protects.
const SESSION_MAX_AGE = 30 * 24 * 3600; // 30 days, matching the approved device unlock

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deckKeyOk(key, expected) {
  if (!key || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(key), sha256Hex(expected)]);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0 && a.length === b.length;
}

// Bounded backoff for online guessing: 10 failed unlocks per 15 minutes per
// client-IP hash, then 429 with Retry-After. Only hashes of IPs are stored.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

async function handleUnlock(request, env) {
  if (!env.DECK_PASSPHRASE) return fail('The deck is not locked', 400);
  let body;
  try { body = await request.json(); } catch { return fail('request body must be valid JSON', 400); }
  const db = env.DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS unlock_attempts (ip_hash TEXT NOT NULL, ts TEXT NOT NULL)').run();
  const now = new Date();
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
  const ipHash = await sha256Hex(request.headers.get('CF-Connecting-IP') || 'unknown');
  await db.prepare('DELETE FROM unlock_attempts WHERE ts < ?').bind(windowStart).run();
  const attempts = await db.prepare('SELECT COUNT(*) AS n FROM unlock_attempts WHERE ip_hash = ?').bind(ipHash).first();
  if ((attempts?.n || 0) >= MAX_ATTEMPTS) {
    return json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' });
  }
  if (typeof body?.passphrase !== 'string' || !(await deckKeyOk(body.passphrase, env.DECK_PASSPHRASE))) {
    await db.prepare('INSERT INTO unlock_attempts (ip_hash, ts) VALUES (?, ?)').bind(ipHash, now.toISOString()).run();
    return json({ error: 'The deck is locked' }, 401);
  }
  await db.prepare('DELETE FROM unlock_attempts WHERE ip_hash = ?').bind(ipHash).run();
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now.toISOString()).run();
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const exp = new Date(now.getTime() + SESSION_MAX_AGE * 1000);
  await db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), now.toISOString(), exp.toISOString()).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `deck_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Path=/`,
    },
  });
}

async function deckSessionOk(request, env, url) {
  // CSRF guard for cookie-authenticated mutations: our own origin only.
  // Exact origin comparison: scheme + host + port must all match the request's
  // own origin. A malformed Origin is forbidden, not silently skipped.
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin) {
      let o;
      try { o = new URL(origin).origin; } catch { return 'forbidden'; }
      if (o !== url.origin) return 'forbidden';
    }
  }
  const m = /(?:^|;\s*)deck_session=([a-f0-9]{64})/.exec(request.headers.get('Cookie') || '');
  if (!m) return false;
  const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256Hex(m[1])).first().catch(() => null);
  return !!(row && row.expires_at > new Date().toISOString());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/unlock') {
        if (request.method !== 'POST') return fail('Method not allowed', 405);
        return await handleUnlock(request, env);
      }
      if (url.pathname.startsWith('/api/')) {
        if (env.DECK_PASSPHRASE) {
          const ok = await deckSessionOk(request, env, url);
          if (ok === 'forbidden') return json({ error: 'Forbidden' }, 403);
          if (!ok) return json({ error: 'The deck is locked' }, 401);
        }
        return await handleApi(request, env, url);
      }
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return fail('Internal server error', 500);
    }
  },
};
