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

  return { errors };
}

module.exports = { parseId, validateTaskInput };
