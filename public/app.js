/* The Deck - focus-first task manager.
   The deck shows one card at a time; the spread is the management view.
   All motion uses spring physics or spring-like curves; gestures are direct manipulation. */

const state = {
  tasks: [],
  view: 'deck',        // 'deck' | 'spread'
  filter: 'all',
  editingCard: false,
};

const pendingTasks = new Map();
let deckAnimating = false;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- API ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
const getTasks = () => api('/api/tasks');
const createTask = (title, description) => api('/api/tasks', { method: 'POST', body: JSON.stringify({ title, description }) });
const updateTask = (id, fields) => api(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(fields) });
const deleteTask = (id) => api(`/api/tasks/${id}`, { method: 'DELETE' });

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const activeTasks = () => state.tasks.filter((t) => !t.completed);
const completedTasks = () => state.tasks.filter((t) => t.completed);

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ---------- toast (with optional Undo) ---------- */
let toastTimer = null;
function showToast(message, { error = false, action = null, onAction = null } = {}) {
  const toast = $('#toast');
  const actionBtn = $('#toast-action');
  toast.classList.toggle('error', error);
  $('#toast-message').textContent = message;
  actionBtn.hidden = !action;
  actionBtn.textContent = action || '';
  actionBtn.onclick = onAction;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, action ? 5000 : 2600);
}

/* ---------- springs (stiffness/damping integration, interruptible) ---------- */
function springTo({ from, to, stiffness = 260, damping = 24, velocity = 0, onUpdate, onRest }) {
  if (reduceMotion) { onUpdate(to); onRest && onRest(); return { cancel() {} }; }
  let x = from, v = velocity, raf = null, last = null;
  function step(ts) {
    if (last === null) last = ts;
    const dt = Math.min((ts - last) / 1000, 0.064);
    last = ts;
    const F = -stiffness * (x - to) - damping * v;
    v += F * dt;
    x += v * dt;
    onUpdate(x);
    if (Math.abs(v) < 0.5 && Math.abs(x - to) < 0.5) { onUpdate(to); onRest && onRest(); return; }
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
  return { cancel() { cancelAnimationFrame(raf); } };
}

/* ---------- deck ---------- */
const VISIBLE = 4;

function deckTransform(i) {
  return `translateY(${-i * 13}px) scale(${1 - i * 0.045}) rotate(${i === 0 ? 0 : (i % 2 ? 1.6 : -1.3)}deg)`;
}

function renderDeck() {
  const deck = $('#deck');
  const active = activeTasks();
  $('#active-count').textContent = `${active.length} active`;
  const existing = new Map([...deck.children].filter(c => !c.classList.contains('is-leaving')).map(c => [Number(c.dataset.id), c]));
  const keep = new Set(active.slice(0, VISIBLE).map(t => t.id));
  for (const [id, card] of existing) if (!keep.has(id)) card.remove();

  $('#deck-empty').hidden = active.length > 0;
  $('#deck-controls').hidden = active.length === 0;
  if (active.length === 0) {
    const hasCompleted = completedTasks().length > 0;
    $('#deck-empty-title').textContent = hasCompleted ? 'Deck cleared' : 'Your deck is empty';
    $('#deck-empty-sub').textContent = hasCompleted
      ? 'Every card is done. Deal a new one below.'
      : 'Write your first card below to get started.';
    updateDeckControls();
    return;
  }

  active.slice(0, VISIBLE).forEach((task, i) => {
    const reused = existing.get(task.id);
    const card = reused || document.createElement('article');
    card.className = 'card' + (i === 0 ? ' is-top' : ' is-under');
    card.dataset.id = task.id;
    card.style.zIndex = VISIBLE - i;
    card.style.transform = deckTransform(i);
    card.style.setProperty('--depth', i);
    if (!reused) card.innerHTML = `
      <div class="card-index"><span>card ${i + 1} of ${active.length}</span></div>
      <h2 class="card-title">${esc(task.title)}</h2>
      ${task.description ? `<p class="card-note">${esc(task.description)}</p>` : ''}
      <span class="card-stamp" aria-hidden="true">done</span>
      <span class="card-stamp stamp-later" aria-hidden="true">later</span>
      <div class="card-foot">
        <span class="card-meta">Added ${formatDate(task.createdAt)}${task.updatedAt !== task.createdAt ? ` · edited ${formatDate(task.updatedAt)}` : ''}</span>
        <span class="card-tools">
          <button type="button" class="edit-card" ${i === 0 ? '' : 'tabindex="-1"'}>Edit</button>
          <button type="button" class="delete-card" ${i === 0 ? '' : 'tabindex="-1"'}>Delete</button>
        </span>
      </div>`;
    card.querySelector('.card-index span').textContent = `card ${i + 1} of ${active.length}`;
    card.querySelectorAll('button').forEach(b => { b.tabIndex = i === 0 ? 0 : -1; b.disabled = pendingTasks.has(task.id); });
    card.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
    if (!reused) deck.appendChild(card);
  });

  const top = deck.querySelector('.card.is-top');
  if (top && !top.dataset.wired) { wireTopCard(top, active[0]); top.dataset.wired = 'true'; }
  updateDeckControls();
}

/* Top card: drag to decide (direct manipulation, velocity carried into the fling) */
function wireTopCard(card, task) {
  if (!card) return;

  card.querySelector('.edit-card').addEventListener('click', () => openCardEdit(card, task));
  const delBtn = card.querySelector('.delete-card');
  delBtn.addEventListener('click', async () => {
    if (!delBtn.classList.contains('armed')) {
      delBtn.classList.add('armed');
      delBtn.textContent = 'Sure?';
      setTimeout(() => { delBtn.classList.remove('armed'); delBtn.textContent = 'Delete'; }, 2600);
      return;
    }
    try {
      await deleteTask(task.id);
      showToast(`Deleted "${task.title}"`);
      await refresh();
    } catch (err) { showToast(err.message, { error: true }); }
  });

  const stampDone = card.querySelector('.card-stamp:not(.stamp-later)');
  const stampLater = card.querySelector('.stamp-later');

  let drag = null;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input,form') || state.editingCard || deckAnimating || pendingTasks.has(task.id)) return;
    card._spring?.cancel();
    card.setPointerCapture(e.pointerId);
    drag = { x0: e.clientX, y0: e.clientY, x: 0, y: 0, vx: 0, lastT: performance.now(), lastX: e.clientX };
    card.classList.add('is-dragging');
  });

  card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now();
    const dt = Math.max(now - drag.lastT, 1);
    drag.vx = 0.75 * drag.vx + 0.25 * ((e.clientX - drag.lastX) / dt); // smoothed px/ms
    drag.lastT = now; drag.lastX = e.clientX;
    drag.x = e.clientX - drag.x0;
    drag.y = e.clientY - drag.y0;
    if (!reduceMotion) {
      const reveal = Math.min(Math.abs(drag.x) / 150, 1);
      document.querySelectorAll('.card.is-under').forEach((under, index) => {
        const i = index + 1; under.style.transition = 'none';
        under.style.transform = `translateY(${-i * 13 + reveal * 13}px) scale(${1 - i * .045 + reveal * .045}) rotate(${(i % 2 ? 1.6 : -1.3) * (1 - reveal)}deg)`;
      });
      card.style.transform = `translate(${drag.x}px, ${drag.y * 0.4}px) rotate(${drag.x / 18}deg)`;
      stampDone.style.opacity = Math.max(0, Math.min(drag.x / 90, 1));
      stampLater.style.opacity = Math.max(0, Math.min(-drag.x / 90, 1));
    }
  });

  card.addEventListener('pointerup', () => {
    if (!drag) return;
    const { x, y, vx } = drag;
    drag = null;
    card.classList.remove('is-dragging');
    document.querySelectorAll('.card.is-under').forEach((under, index) => { under.style.transition = ''; under.style.transform = deckTransform(index + 1); });
    stampDone.style.opacity = 0;
    stampLater.style.opacity = 0;

    if (x > 110 || vx > 0.55) return flingOut(card, task, x, y, vx, 'done');
    if (x < -110 || vx < -0.55) return flingOut(card, task, x, y, vx, 'later');
    // snap back with a spring from the current offset
    card.classList.add('is-settling');
    card._spring = springTo({
      from: x, to: 0, velocity: vx * 1000, stiffness: 300, damping: 22,
      onUpdate: (cx) => {
        const cy = y * (1 - Math.min(Math.abs(x - cx) / (Math.abs(x) || 1), 1));
        card.style.transform = `translate(${cx}px, ${reduceMotion ? 0 : cy}px) rotate(${cx / 18}deg)`;
      },
      onRest: () => { card.style.transform = deckTransform(0); card.classList.remove('is-settling'); },
    });
  });

  card.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag = null;
    card.classList.remove('is-dragging');
    card.style.transform = deckTransform(0);
    document.querySelectorAll('.card.is-under').forEach((under, index) => { under.style.transition = ''; under.style.transform = deckTransform(index + 1); });
    stampDone.style.opacity = 0; stampLater.style.opacity = 0;
  });
}

/* Optimistic handoff: save and motion begin together, not in series.
   Each task has one in-flight write. Responses never rebuild an unrelated card. */
function updateDeckControls() {
  const top = activeTasks()[0];
  const blocked = deckAnimating || state.editingCard || !top || pendingTasks.has(top.id);
  document.querySelectorAll('.card.is-top button').forEach(b => b.disabled = state.editingCard ? false : !!(top && pendingTasks.has(top.id)));
  $('#done-button').disabled = blocked;
  $('#later-button').disabled = blocked;
  $('#sync-status').textContent = pendingTasks.size ? 'Saving changes...' : 'All changes saved';
  $('#sync-status').classList.toggle('is-saving', pendingTasks.size > 0);
}

function paintState() { renderDeck(); renderSpread(); renderProgress(); updateDeckControls(); }
function sortTasks() { state.tasks.sort((a, b) => Number(a.completed) - Number(b.completed) || a.sortOrder - b.sortOrder); }

function flingOut(card, task, x, y, vx, outcome) {
  if (!card || deckAnimating || state.editingCard || pendingTasks.has(task.id)) return;
  card._spring?.cancel();
  deckAnimating = true;
  card.classList.add('is-leaving');
  card.classList.remove('is-top', 'is-dragging', 'is-settling');
  card.style.zIndex = VISIBLE + 1;
  card.querySelectorAll('button').forEach(b => { b.disabled = true; b.tabIndex = -1; });
  // The next card becomes available without waiting for the network.
  commitFling(task, outcome);
  const dir = outcome === 'done' ? 1 : -1;
  const finish = () => { card.remove(); deckAnimating = false; updateDeckControls(); };
  if (reduceMotion) { finish(); return; }
  const animation = card.animate([
    { transform: `translate(${x}px, ${y * .4}px) rotate(${x / 18}deg)`, opacity: 1 },
    { transform: `translate(${dir * Math.max(innerWidth * .7, 580)}px, 32px) rotate(${dir * 22}deg)`, opacity: 0 }
  ], { duration: 230, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  animation.finished.then(finish, finish);
}

async function commitFling(task, outcome) {
  const previous = { completed: task.completed, sortOrder: task.sortOrder };
  const fields = outcome === 'done' ? { completed: true } :
    { sort_order: Math.max(Date.now(), ...state.tasks.map(t => t.sortOrder + 1)) };
  pendingTasks.set(task.id, fields);
  Object.assign(task, outcome === 'done' ? { completed: true } : { sortOrder: fields.sort_order });
  sortTasks(); paintState();
  try {
    const saved = await updateTask(task.id, fields);
    const current = state.tasks.find(t => t.id === task.id);
    if (current) Object.assign(current, saved);
    pendingTasks.delete(task.id);
    // No refresh GET here: the API returns the committed record.
    renderSpread(); renderProgress(); updateDeckControls();
    if (outcome === 'done') showToast(`Completed "${task.title}"`, {
      action: 'Undo', onAction: () => undoDone(task.id),
    });
    else showToast(`Sent "${task.title}" to the back`);
  } catch (err) {
    pendingTasks.delete(task.id);
    const current = state.tasks.find(t => t.id === task.id);
    if (current) Object.assign(current, previous);
    sortTasks();
    // An HTTP failure is rolled back. Network failures may have committed;
    // a read reconciles that ambiguity without retrying the write.
    $('#deck').querySelectorAll(`[data-id="${task.id}"]:not(.is-leaving)`).forEach(c => c.remove());
    paintState();
    showToast('Could not confirm the change. Card restored; checking the server.', { error: true });
    try { await refresh(); } catch { showToast('Connection lost. Change not confirmed. Reconnect and reload before trying again.', { error: true }); }
  }
}

async function undoDone(id) {
  if (pendingTasks.has(id)) return;
  $('#toast').hidden = true;
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  pendingTasks.set(id, { completed: false }); updateDeckControls();
  try {
    const saved = await updateTask(id, { completed: false, sort_order: Math.min(Date.now(), ...state.tasks.map(t => t.sortOrder)) - 1 });
    Object.assign(task, saved); pendingTasks.delete(id); sortTasks(); paintState();
    showToast('Card returned to the front');
  } catch (err) { pendingTasks.delete(id); updateDeckControls(); showToast(err.message, { error: true }); }
}

$('#done-button').addEventListener('click', () => {
  const top = activeTasks()[0];
  if (top) flingOut(document.querySelector('.card.is-top'), top, 0, 0, .9, 'done');
});
$('#later-button').addEventListener('click', () => {
  const top = activeTasks()[0];
  if (top) flingOut(document.querySelector('.card.is-top'), top, 0, 0, -.9, 'later');
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,button,form') || state.view !== 'deck' || e.repeat) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault(); $(e.key === 'ArrowRight' ? '#done-button' : '#later-button').click();
  }
});

/* ---------- card edit ---------- */
function openCardEdit(card, task) {
  state.editingCard = true; updateDeckControls();
  card.innerHTML = `
    <form class="card-edit" novalidate>
      <input type="text" class="edit-title" value="${esc(task.title)}" maxlength="200" aria-label="Edit title" />
      <input type="text" class="edit-note" value="${esc(task.description)}" maxlength="500" placeholder="Note (optional)" aria-label="Edit note" />
      <div class="card-edit-actions">
        <button type="button" class="cancel-edit">Cancel</button>
        <button type="submit" class="save-edit">Save</button>
      </div>
    </form>`;
  const form = card.querySelector('form');
  form.querySelector('.edit-title').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.querySelector('.edit-title').value.trim();
    const description = form.querySelector('.edit-note').value.trim();
    if (!title) { showToast('Title cannot be empty', { error: true }); return; }
    try {
      await updateTask(task.id, { title, description });
      state.editingCard = false;
      showToast(`Updated "${title}"`);
      await refresh();
    } catch (err) { showToast(err.message, { error: true }); }
  });
  form.querySelector('.cancel-edit').addEventListener('click', async () => {
    state.editingCard = false;
    await refresh();
  });
}

/* ---------- spread view ---------- */
function renderSpread() {
  const list = $('#task-list');
  const filtered = state.tasks.filter((t) =>
    state.filter === 'all' ? true : state.filter === 'active' ? !t.completed : t.completed);

  $('#count-all').textContent = state.tasks.length;
  $('#count-active').textContent = activeTasks().length;
  $('#count-completed').textContent = completedTasks().length;

  document.querySelectorAll('.filter').forEach((b) => {
    const on = b.dataset.filter === state.filter;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on);
  });

  list.innerHTML = '';
  $('#list-empty').hidden = filtered.length > 0;

  filtered.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'task' + (task.completed ? ' completed' : '');
    li.dataset.id = task.id;
    li.innerHTML = `
      <button type="button" class="task-check" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}" aria-pressed="${task.completed}">
        <svg viewBox="0 0 16 16"><path d="M2.5 8.5l3.5 3.5 7-8"/></svg>
      </button>
      <div class="task-body">
        <p class="task-title">${esc(task.title)}</p>
        ${task.description ? `<p class="task-desc">${esc(task.description)}</p>` : ''}
        <p class="task-meta">Added ${formatDate(task.createdAt)}${task.updatedAt !== task.createdAt ? ` · edited ${formatDate(task.updatedAt)}` : ''}</p>
      </div>
      <div class="task-actions">
        <button type="button" class="edit-task">Edit</button>
        <button type="button" class="delete-task">Delete</button>
      </div>`;
    if (pendingTasks.has(task.id)) li.querySelectorAll('button').forEach(b => b.disabled = true);
    list.appendChild(li);
  });
}

$('#task-list').addEventListener('click', async (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  const task = state.tasks.find((t) => t.id === Number(li.dataset.id));
  if (!task || pendingTasks.has(task.id)) return;

  if (e.target.closest('.task-check')) {
    try {
      const done = !task.completed;
      await updateTask(task.id, { completed: done });
      if (done) {
        showToast(`Completed "${task.title}"`, {
          action: 'Undo',
          onAction: () => undoDone(task.id),
        });
      } else {
        showToast(`Reopened "${task.title}"`);
      }
      await refresh();
    } catch (err) { showToast(err.message, { error: true }); }
    return;
  }

  if (e.target.closest('.edit-task')) {
    const body = li.querySelector('.task-body');
    li.querySelector('.task-actions').hidden = true;
    body.innerHTML = `
      <form class="task-edit" novalidate>
        <input type="text" class="edit-title" value="${esc(task.title)}" maxlength="200" aria-label="Edit title" />
        <input type="text" class="edit-note" value="${esc(task.description)}" maxlength="500" placeholder="Note (optional)" aria-label="Edit note" />
        <div class="edit-actions">
          <button type="button" class="cancel-edit">Cancel</button>
          <button type="submit" class="save-edit">Save</button>
        </div>
      </form>`;
    const form = body.querySelector('form');
    form.querySelector('.edit-title').focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const title = form.querySelector('.edit-title').value.trim();
      const description = form.querySelector('.edit-note').value.trim();
      if (!title) { showToast('Title cannot be empty', { error: true }); return; }
      try {
        await updateTask(task.id, { title, description });
        showToast(`Updated "${title}"`);
        await refresh();
      } catch (err) { showToast(err.message, { error: true }); }
    });
    form.querySelector('.cancel-edit').addEventListener('click', () => refresh());
    return;
  }

  const delBtn = e.target.closest('.delete-task');
  if (delBtn) {
    if (!delBtn.classList.contains('armed')) {
      delBtn.classList.add('armed');
      delBtn.textContent = 'Sure?';
      setTimeout(() => { delBtn.classList.remove('armed'); delBtn.textContent = 'Delete'; }, 2600);
      return;
    }
    try {
      await deleteTask(task.id);
      showToast(`Deleted "${task.title}"`);
      await refresh();
    } catch (err) { showToast(err.message, { error: true }); }
  }
});

document.querySelectorAll('.filter').forEach((b) =>
  b.addEventListener('click', () => { state.filter = b.dataset.filter; renderSpread(); }));

/* ---------- view toggle ---------- */
$('#view-toggle').addEventListener('click', () => {
  state.view = state.view === 'deck' ? 'spread' : 'deck';
  if (!reduceMotion && document.startViewTransition) document.startViewTransition(() => applyView());
  else applyView();
});
function applyView() {
  const spread = state.view === 'spread';
  $('#deck-view').hidden = spread;
  $('#spread-view').hidden = !spread;
  $('#view-toggle-label').textContent = spread ? 'Focus deck' : 'Spread view';
  $('#workspace-label').textContent = spread ? 'All your cards' : 'Focus deck';
  $('#view-toggle').setAttribute('aria-pressed', spread);
}

/* ---------- add form ---------- */
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titleEl = $('#new-title');
  const noteEl = $('#new-note');
  const title = titleEl.value.trim();
  const errEl = $('#form-error');
  if (!title) {
    errEl.textContent = 'Please enter a task title.';
    errEl.hidden = false;
    titleEl.focus();
    return;
  }
  errEl.hidden = true;
  try {
    const task = await createTask(title, noteEl.value.trim());
    titleEl.value = ''; noteEl.value = '';
    showToast(`Dealt "${task.title}"`);
    await refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});
$('#new-title').addEventListener('input', () => { $('#form-error').hidden = true; });

/* ---------- progress ring ---------- */
function renderProgress() {
  const total = state.tasks.length;
  const done = completedTasks().length;
  $('#progress-label').textContent = `${done} of ${total} done`;
  const C = 2 * Math.PI * 19;
  $('#ring-fill').style.strokeDashoffset = total === 0 ? C : C * (1 - done / total);
}

/* ---------- boot ---------- */
async function refresh() {
  const tasks = await getTasks();
  // Preserve optimistic records if an independent CRUD refresh overlaps a save.
  state.tasks = tasks.map(t => pendingTasks.has(t.id) ? (state.tasks.find(local => local.id === t.id) || t) : t);
  sortTasks();
  $('#deck').querySelectorAll('.card:not(.is-leaving)').forEach(c => c.remove());
  renderDeck();
  renderSpread();
  renderProgress();
}

$('#today').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
applyView();
refresh().catch((err) => showToast(err.message, { error: true }));
