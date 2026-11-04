// Frontend logic: talks to the REST API and re-renders the task list.
const taskList = document.getElementById('task-list');
const emptyState = document.getElementById('empty-state');
const toast = document.getElementById('toast');
const addForm = document.getElementById('add-form');
const addButton = document.getElementById('add-button');
const formError = document.getElementById('form-error');

let currentStatus = 'all';
let toastTimer = null;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

async function refresh() {
  try {
    const [all, active, completed] = await Promise.all([
      api('/api/tasks'),
      api('/api/tasks?status=active'),
      api('/api/tasks?status=completed'),
    ]);
    document.getElementById('count-all').textContent = all.length;
    document.getElementById('count-active').textContent = active.length;
    document.getElementById('count-completed').textContent = completed.length;
    render(currentStatus === 'active' ? active : currentStatus === 'completed' ? completed : all);
  } catch (err) {
    showToast(`Could not load tasks: ${err.message}`, true);
  }
}

function render(tasks) {
  taskList.innerHTML = '';
  emptyState.hidden = tasks.length > 0;
  tasks.forEach((task) => taskList.appendChild(buildTaskElement(task)));
}

function buildTaskElement(task) {
  const li = document.createElement('article');
  li.className = `task${task.completed ? ' completed' : ''}`;
  li.dataset.id = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-check';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`);
  checkbox.addEventListener('change', async () => {
    li.classList.add('busy');
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ completed: checkbox.checked }),
      });
      showToast(checkbox.checked ? `Completed "${task.title}"` : `Reopened "${task.title}"`);
      await refresh();
    } catch (err) {
      showToast(err.message, true);
      li.classList.remove('busy');
    }
  });

  const body = document.createElement('div');
  body.className = 'task-body';

  const title = document.createElement('p');
  title.className = 'task-title';
  title.textContent = task.title;
  body.appendChild(title);

  if (task.description) {
    const desc = document.createElement('p');
    desc.className = 'task-desc';
    desc.textContent = task.description;
    body.appendChild(desc);
  }

  const meta = document.createElement('p');
  meta.className = 'task-meta';
  meta.textContent = `Added ${formatDate(task.createdAt)}${task.updatedAt !== task.createdAt ? ` · edited ${formatDate(task.updatedAt)}` : ''}`;
  body.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => startEdit(li, task));

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'delete-btn';
  let armed = false;
  deleteBtn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      deleteBtn.textContent = 'Sure?';
      deleteBtn.classList.add('arm');
      setTimeout(() => { armed = false; deleteBtn.textContent = 'Delete'; deleteBtn.classList.remove('arm'); }, 3000);
      return;
    }
    li.classList.add('busy');
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      showToast(`Deleted "${task.title}"`);
      await refresh();
    } catch (err) {
      showToast(err.message, true);
      li.classList.remove('busy');
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(checkbox);
  li.appendChild(body);
  li.appendChild(actions);
  return li;
}

function startEdit(li, task) {
  const body = li.querySelector('.task-body');
  const actions = li.querySelector('.task-actions');
  body.hidden = true;
  actions.hidden = true;

  const form = document.createElement('div');
  form.className = 'edit-form';
  const titleInput = document.createElement('input');
  titleInput.value = task.title;
  titleInput.maxLength = 200;
  const descInput = document.createElement('input');
  descInput.value = task.description;
  descInput.maxLength = 1000;
  descInput.placeholder = 'Description (optional)';

  const editActions = document.createElement('div');
  editActions.className = 'edit-actions';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'save-btn';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'cancel-btn';
  editActions.appendChild(saveBtn);
  editActions.appendChild(cancelBtn);

  form.appendChild(titleInput);
  form.appendChild(descInput);
  form.appendChild(editActions);
  li.appendChild(form);
  titleInput.focus();

  function stopEdit() {
    form.remove();
    body.hidden = false;
    actions.hidden = false;
  }

  cancelBtn.addEventListener('click', stopEdit);
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { showToast('Title cannot be empty', true); return; }
    li.classList.add('busy');
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, description: descInput.value.trim() }),
      });
      showToast(`Updated "${title}"`);
      await refresh();
    } catch (err) {
      showToast(err.message, true);
      li.classList.remove('busy');
    }
  });
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const title = document.getElementById('new-title').value.trim();
  const description = document.getElementById('new-description').value.trim();
  if (!title) {
    formError.textContent = 'Please enter a task title.';
    formError.hidden = false;
    return;
  }
  addButton.disabled = true;
  try {
    const task = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title, description }) });
    showToast(`Added "${task.title}"`);
    addForm.reset();
    await refresh();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    addButton.disabled = false;
  }
});

document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentStatus = btn.dataset.status;
    refresh();
  });
});

refresh();
