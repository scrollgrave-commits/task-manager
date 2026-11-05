// Input validation shared by the task routes.
// Returns { errors: [...] } - an empty errors array means the input is valid.

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateTaskInput(body, { partial }) {
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
  if (body.completed_at !== undefined &&
      (typeof body.completed_at !== 'string' || Number.isNaN(Date.parse(body.completed_at)))) {
    errors.push('completed_at must be an ISO 8601 date string');
  }
  if (body.completed_at_estimated !== undefined && typeof body.completed_at_estimated !== 'boolean') {
    errors.push('completed_at_estimated must be true or false');
  }

  // Undo-delete restore may reattach a card's original stamps (loop 20).
  if (body.created_at !== undefined) {
    if (typeof body.created_at !== 'string' || Number.isNaN(Date.parse(body.created_at)) || Date.parse(body.created_at) > Date.now()) {
      errors.push('created_at must be an ISO 8601 date string not in the future');
    }
  }
  if (body.updated_at !== undefined) {
    if (typeof body.updated_at !== 'string' || Number.isNaN(Date.parse(body.updated_at)) || Date.parse(body.updated_at) > Date.now()) {
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

  if (body.sort_order !== undefined && (typeof body.sort_order !== 'number' || !Number.isFinite(body.sort_order))) {
    errors.push('sort_order must be a number');
  }

  return { errors };
}

module.exports = { parseId, validateTaskInput };
