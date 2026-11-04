/* The Deck - focus-first task manager.
   The deck shows one card at a time; the spread is the management view.
   All motion uses spring physics or spring-like curves; gestures are direct manipulation. */

const state = {
  tasks: [],
  view: 'deck',        // 'deck' | 'spread'
  filter: 'all',
  editingCard: false,
};
try {  // Loop 5: remember which desk the user was working at
  if (localStorage.getItem('the-deck:view') === 'spread') state.view = 'spread';
} catch {}

const pendingTasks = new Map();
let deckAnimating = false;
let spreadDealIn = false;   // deal the spread in only when the view or filter changes
let lastAddedId = null;      // a freshly dealt card animates on its own
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

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

/* ---------- toasts (stacked, each with its own timer and optional Undo) ----------
   Loop 14: a second action no longer kills the first one's undo window -
   complete one card and delete another right after, and both can be undone. */
function syncToastPad() {
  const stack = $('#toast-stack');
  // the page grows by the stack's height so primary actions stay reachable
  document.body.style.paddingBottom = stack.children.length ? `calc(56px + ${stack.offsetHeight}px)` : '';
}
function showToast(message, { error = false, action = null, onAction = null } = {}) {
  const stack = $('#toast-stack');
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  const dot = document.createElement('span');
  dot.className = 'toast-dot';
  dot.setAttribute('aria-hidden', 'true');
  const msg = document.createElement('span');
  msg.className = 'toast-message';
  msg.textContent = message;
  el.append(dot, msg);
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    if (reduceMotion) { el.remove(); syncToastPad(); return; }
    el.classList.add('toast-out');
    setTimeout(() => { el.remove(); syncToastPad(); }, 180);
  };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action;
    btn.onclick = () => { dismiss(); onAction && onAction(); };
    el.appendChild(btn);
  }
  if (!action) {
    // plain notices coalesce: only the newest matters
    stack.querySelectorAll('.toast:not(.toast-undo)').forEach((t) => t.remove());
  } else {
    el.classList.add('toast-undo');
  }
  stack.appendChild(el);
  // actionable toasts are never dropped before their own timer - instead,
  // when the stack runs long the older ones go compact
  const toasts = [...stack.children];
  toasts.forEach((t, i) => t.classList.toggle('toast-compact', toasts.length > 3 && i < toasts.length - 2));
  requestAnimationFrame(syncToastPad);
  timer = setTimeout(dismiss, action ? 5000 : 2600);
  return dismiss;
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
        <span class="card-meta">${cardMeta(task)}</span>
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
      const snapshot = { ...task }; // Loop 15: deck deletes get the same undo window as spread deletes
      await deleteTask(task.id);
      showToast(`Deleted "${task.title}"`, { action: 'Undo', onAction: () => restoreTask(snapshot) });
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


// Meta line: when a card joined, when it was done, and true content edits.
function cardMeta(task) {
  const parts = [`Added ${formatDate(task.createdAt)}`];
  if (task.completed && task.completedAt) {
    // Legacy stamps (before completion tracking) are estimates; say so.
    parts.push(task.completedAtEstimated ? `Done around ${formatDate(task.completedAt)}` : `Done ${formatDate(task.completedAt)}`);
  }
  // An update within a minute of creation is the card settling in (or a
  // restore), not an edit worth stamping.
  const editedMs = Date.parse(task.updatedAt) - Date.parse(task.createdAt);
  if (editedMs > 60000 && task.updatedAt !== task.completedAt) parts.push(`edited ${formatDate(task.updatedAt)}`);
  return parts.join(' · ');
}

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
  const task = state.tasks.find(t => t.id === id);
  if (!task) { showToast('That card is already gone - nothing to undo.'); return; }
  pendingTasks.set(id, { completed: false }); updateDeckControls();
  try {
    const saved = await updateTask(id, { completed: false, sort_order: Math.min(Date.now(), ...state.tasks.map(t => t.sortOrder)) - 1 });
    Object.assign(task, saved); pendingTasks.delete(id); sortTasks(); paintState();
    showToast('Card returned to the front');
  } catch (err) { pendingTasks.delete(id); updateDeckControls(); showToast(err.message, { error: true }); }
}

/* Loop 11: a deleted card can be brought back within the toast window.
   The restore re-deals the content and reattaches the original completion
   stamp with its provenance flag, so an estimated stamp stays estimated.
   The restored card is a new row: its Added stamp starts fresh. */
async function restoreTask(snapshot) {
  try {
    const created = await createTask(snapshot.title, snapshot.description);
    const fields = { sort_order: snapshot.sortOrder };
    if (snapshot.completed) {
      fields.completed = true;
      if (snapshot.completedAt) fields.completed_at = snapshot.completedAt;
      fields.completed_at_estimated = !!snapshot.completedAtEstimated;
    }
    await updateTask(created.id, fields);
    await refresh();
    showToast(`Restored "${snapshot.title}"`);
  } catch (err) {
    showToast(`Could not restore "${snapshot.title}": ${err.message}`, { error: true });
    try { await refresh(); } catch {}
  }
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
  // Loop 12: FLIP - remember where each visible card sits before the re-render,
  // so surviving cards can glide to their new spot instead of jumping
  // (reference: motion-flip-expand, webdevpuneet.com/ui-snippets/motion-flip-expand).
  const prevRects = new Map();
  if (!reduceMotion && !spreadDealIn) {
    list.querySelectorAll('.task').forEach((li) => prevRects.set(li.dataset.id, li.getBoundingClientRect()));
  }
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
  // Loop 5: the empty desk says which filter left it empty
  const emptyEl = $('#list-empty');
  emptyEl.hidden = filtered.length > 0;
  if (!filtered.length) {
    emptyEl.textContent =
      state.tasks.length === 0 ? 'No cards yet. Deal your first one below.' :
      state.filter === 'active' ? 'The deck is clear - every card is done.' :
      state.filter === 'completed' ? 'Nothing done yet. Finished cards land here.' :
      'No tasks here yet.';
  }

  const actives = state.tasks.filter((t) => !t.completed);
  filtered.forEach((task, index) => {
    const li = document.createElement('li');
    li.className = 'task' + (task.completed ? ' completed' : '');
    // Loop 8: an active card on the desk can be picked up - pulled to the top of the deck
    if (!task.completed) li.title = 'Pick up this card';
    li.dataset.id = task.id;
    li.style.setProperty('--i', Math.min(index, 14));
    if (spreadDealIn || task.id === lastAddedId) li.classList.add('deal-in');
    li.innerHTML = `
      <button type="button" class="task-check" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}" aria-pressed="${task.completed}">
        <svg viewBox="0 0 16 16"><path d="M2.5 8.5l3.5 3.5 7-8"/></svg>
      </button>
      <div class="task-body">
        <p class="task-title">${esc(task.title)}</p>
        ${task.description ? `<p class="task-desc">${esc(task.description)}</p>` : ''}
        <div class="task-foot">
          <p class="task-meta">${cardMeta(task)}</p>
          <div class="task-actions">
            ${task.completed ? '' : `<button type="button" class="drag-task" title="Drag to reshuffle the deck, or focus and use arrow keys" aria-label="Reshuffle ${esc(task.title)}: card ${actives.findIndex((t) => t.id === task.id) + 1} of ${actives.length}. Drag it, or press arrow keys to move it"><svg viewBox="0 0 10 14" aria-hidden="true"><circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/></svg></button><button type="button" class="pickup-task" title="Bring this card to the top of the deck">Pick up</button>`}
            <button type="button" class="edit-task">Edit</button>
            <button type="button" class="delete-task">Delete</button>
          </div>
        </div>
      </div>
      ${task.completed ? '<span class="spread-stamp" aria-hidden="true">done</span>' : ''}`;
    if (pendingTasks.has(task.id)) li.querySelectorAll('button').forEach(b => b.disabled = true);
    list.appendChild(li);
  });
  // Loop 12 (play): shift each surviving card back to its old spot, then release
  // it to the stylesheet transition so it settles into place.
  if (prevRects.size) {
    list.querySelectorAll('.task').forEach((li) => {
      const old = prevRects.get(li.dataset.id);
      if (!old || li.classList.contains('deal-in')) return;
      const now = li.getBoundingClientRect();
      const dx = old.left - now.left, dy = old.top - now.top;
      if (!dx && !dy) return;
      li.style.transition = 'none';
      li.style.transform = `translate(${dx}px, ${dy}px)`;
      li.getBoundingClientRect(); // commit the offset before releasing it
      li.classList.add('flip-moving');
      li.style.transition = '';
      li.style.transform = '';
      li.addEventListener('transitionend', () => li.classList.remove('flip-moving'), { once: true });
    });
  }
  spreadDealIn = false;
  lastAddedId = null;
}

/* Loop 9: spread cards lean toward the cursor - fine pointers only, never under
   reduced motion (reference: Tactile Card Stack, antjanus.com/page-designs/card-stack). */
/* Loop 13: reshuffle the deck by dragging an active card to a new slot.
   Pointer-driven (same direct-manipulation model as the deck fling, and
   testable end to end): the grip starts a drag, a lifted ghost follows the
   pointer clamped inside the viewport, an indicator marks the slot, and on
   release the card keeps its identity - only its sort_order moves (midpoint
   between its new neighbors, so one PUT per drop). The FLIP pass from loop 12
   glides the other cards around the gap. The grip is also a real button:
   focus it and use arrow keys to move the card one slot at a time. Handle-only
   dragging keeps title text selectable. */
function reorderTask(id, index) {
  const siblings = state.tasks.filter((t) => !t.completed && t.id !== id);
  index = Math.max(0, Math.min(index, siblings.length));
  const prev = siblings[index - 1], next = siblings[index];
  const newSort = !prev ? (next ? next.sortOrder - 1 : 1)
    : !next ? prev.sortOrder + 1
    : (prev.sortOrder + next.sortOrder) / 2;
  const moved = state.tasks.find((t) => t.id === id);
  if (!moved || moved.sortOrder === newSort) return Promise.resolve(false);
  moved.sortOrder = newSort;
  state.tasks.sort((a, b) => (a.completed - b.completed) || (a.sortOrder - b.sortOrder));
  renderSpread();
  return updateTask(id, { sort_order: newSort })
    .then(() => true)
    .catch(async (err) => {
      showToast(err.message, { error: true });
      await refresh(); // server is the truth: put the card back where it really is
      return false;
    });
}

(() => {
  const list = $('#task-list');
  let drag = null; // { id, li, ghost, mark: { li, before } | null }

  const clearMark = () => {
    if (drag && drag.mark) drag.mark.li.classList.remove('drop-before', 'drop-after');
    if (drag) drag.mark = null;
  };
  const setMark = (li, before) => {
    if (drag && drag.mark && drag.mark.li === li && drag.mark.before === before) return;
    clearMark();
    li.classList.add(before ? 'drop-before' : 'drop-after');
    drag.mark = { li, before };
  };
  const cleanup = () => {
    if (!drag) return;
    clearMark();
    drag.ghost && drag.ghost.remove();
    drag.li.classList.remove('dragging');
    drag = null;
  };
  // keep the ghost inside the visible viewport; when clamped, the card slides
  // along the edge instead of following the pointer off-screen
  const clampedGhostPos = (x, y, w, h) => ({
    x: Math.max(4, Math.min(x, window.innerWidth - w - 4)),
    y: Math.max(4, Math.min(y, window.innerHeight - Math.min(h, 80) - 4)),
  });

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-task');
    if (!handle || e.button > 0) return;
    e.preventDefault(); // keep the browser from hijacking the gesture (native drag/select -> pointercancel)
    const li = handle.closest('.task');
    const sx = e.clientX, sy = e.clientY;
    const id = Number(li.dataset.id);
    const startRect = li.getBoundingClientRect();

    const onMove = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        const ghost = li.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = Math.min(startRect.width, window.innerWidth - 8) + 'px';
        document.body.appendChild(ghost);
        li.classList.add('dragging');
        drag = { id, li, ghost, mark: null, dx: sx - startRect.left, dy: sy - startRect.top };
      }
      const gw = drag.ghost.offsetWidth, gh = drag.ghost.offsetHeight;
      const pos = clampedGhostPos(ev.clientX - drag.dx, ev.clientY - drag.dy, gw, gh);
      drag.ghost.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(1.5deg)`;
      // mark the slot: before the first active card whose center is below the
      // pointer, after the last active card when dragged past the pile
      const cards = [...list.querySelectorAll('.task:not(.completed)')].filter((el) => el !== drag.li);
      const target = cards.find((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (target) setMark(target, true);
      else if (cards.length) setMark(cards[cards.length - 1], false);
      else clearMark();
    };

    const onUp = async () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      if (!drag) return; // plain click on the grip
      const mark = drag.mark;
      const idAtDrop = drag.id;
      cleanup();
      const siblings = state.tasks.filter((t) => !t.completed && t.id !== idAtDrop);
      let index = siblings.length;
      if (mark) {
        const at = siblings.findIndex((t) => t.id === Number(mark.li.dataset.id));
        if (at >= 0) index = mark.before ? at : at + 1;
      }
      await reorderTask(idAtDrop, index);
    };
    const onCancel = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      cleanup();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });

  // keyboard reshuffle: focus a grip, arrows move the card one slot per press
  list.addEventListener('keydown', async (e) => {
    const handle = e.target.closest('.drag-task');
    if (!handle) return;
    const delta = (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1
      : (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const id = Number(handle.closest('.task').dataset.id);
    const actives = state.tasks.filter((t) => !t.completed);
    const at = actives.findIndex((t) => t.id === id);
    if (at < 0) return;
    const target = at + delta;
    if (target < 0 || target > actives.length - 1) return;
    await reorderTask(id, target);
    // renderSpread rebuilt the list: hand focus back to the moved card's grip
    const again = [...list.querySelectorAll('.task')].find((el) => Number(el.dataset.id) === id);
    again && again.querySelector('.drag-task').focus();
  });
})();

/* Loop 9: spread cards lean toward the cursor - fine pointers only, never under
   reduced motion (reference: Tactile Card Stack, antjanus.com/page-designs/card-stack). */
/* Loop 13: reshuffle the deck by dragging an active card to a new slot.
   Pointer-driven (same direct-manipulation model as the deck fling, and
   testable end to end): the grip starts a drag, a lifted ghost follows the
   pointer, an indicator marks the slot, and on release the card keeps its
   identity - only its sort_order moves (midpoint between its new neighbors,
   so one PUT per drop). The FLIP pass from loop 12 glides the other cards
   around the gap. Handle-only dragging keeps text selectable. */
(() => {
  const list = $('#task-list');
  let drag = null; // { id, li, ghost, mark: { li, before } | null }

  const clearMark = () => {
    if (drag && drag.mark) drag.mark.li.classList.remove('drop-before', 'drop-after');
    if (drag) drag.mark = null;
  };
  const setMark = (li, before) => {
    if (drag && drag.mark && drag.mark.li === li && drag.mark.before === before) return;
    clearMark();
    li.classList.add(before ? 'drop-before' : 'drop-after');
    drag.mark = { li, before };
  };
  const cleanup = () => {
    if (!drag) return;
    clearMark();
    drag.ghost && drag.ghost.remove();
    drag.li.classList.remove('dragging');
    drag = null;
  };

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-task');
    if (!handle || e.button > 0) return;
    e.preventDefault(); // keep the browser from hijacking the gesture (native drag/select -> pointercancel)
    const li = handle.closest('.task');
    const sx = e.clientX, sy = e.clientY;
    const id = Number(li.dataset.id);
    const startRect = li.getBoundingClientRect();

    const onMove = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        const ghost = li.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = startRect.width + 'px';
        document.body.appendChild(ghost);
        li.classList.add('dragging');
        drag = { id, li, ghost, mark: null, dx: sx - startRect.left, dy: sy - startRect.top };
      }
      drag.ghost.style.transform = `translate(${ev.clientX - drag.dx}px, ${ev.clientY - drag.dy}px) rotate(1.5deg)`;
      // mark the slot: before the first active card whose center is below the
      // pointer, after the last active card when dragged past the pile
      const cards = [...list.querySelectorAll('.task:not(.completed)')].filter((el) => el !== drag.li);
      const target = cards.find((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (target) setMark(target, true);
      else if (cards.length) setMark(cards[cards.length - 1], false);
      else clearMark();
    };

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      if (!drag) return; // plain click on the grip
      const mark = drag.mark;
      const idAtDrop = drag.id;
      cleanup();
      const siblings = state.tasks.filter((t) => !t.completed && t.id !== idAtDrop);
      let index = siblings.length;
      if (mark) {
        const at = siblings.findIndex((t) => t.id === Number(mark.li.dataset.id));
        if (at >= 0) index = mark.before ? at : at + 1;
      }
      const prev = siblings[index - 1], next = siblings[index];
      const newSort = !prev ? (next ? next.sortOrder - 1 : 1)
        : !next ? prev.sortOrder + 1
        : (prev.sortOrder + next.sortOrder) / 2;
      const moved = state.tasks.find((t) => t.id === idAtDrop);
      if (!moved || moved.sortOrder === newSort) return;
      moved.sortOrder = newSort;
      state.tasks.sort((a, b) => (a.completed - b.completed) || (a.sortOrder - b.sortOrder));
      renderSpread();
      try {
        await updateTask(idAtDrop, { sort_order: newSort });
      } catch (err) {
        showToast(err.message, { error: true });
        await refresh();
      }
    };
    const onCancel = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      cleanup();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
})();

/* Loop 9: spread cards lean toward the cursor - fine pointers only, never under
   reduced motion (reference: Tactile Card Stack, antjanus.com/page-designs/card-stack). */
/* Loop 13: reshuffle the deck by dragging an active card to a new slot.
   The card keeps its exact identity; only its sort_order moves (midpoint between
   its new neighbors, so one PUT per drop). The FLIP pass from loop 12 then glides
   the other cards around the gap. Handle-only dragging keeps text selectable. */
(() => {
  const list = $('#task-list');
  let dragId = null;
  let dropMark = null; // { li, before: bool }

  const clearMark = () => {
    if (dropMark) dropMark.li.classList.remove('drop-before', 'drop-after');
    dropMark = null;
  };
  const activeCards = () => state.tasks.filter((t) => !t.completed);

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-task');
    if (handle) handle.closest('.task').draggable = true;
  });
  list.addEventListener('pointerup', () => {
    list.querySelectorAll('.task[draggable="true"]').forEach((li) => { if (!dragId) li.draggable = false; });
  });

  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.task');
    if (!li) return;
    dragId = Number(li.dataset.id);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ''); } catch {}
  });

  list.addEventListener('dragover', (e) => {
    if (dragId === null) return;
    // Accept the drop anywhere over the list: a drop in a gap between cards
    // still lands at the last marked slot instead of being canceled.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const li = e.target.closest('.task');
    if (!li) return;                              // gap: keep the last mark
    if (Number(li.dataset.id) === dragId) return; // passing over itself: keep
    if (li.classList.contains('completed')) { clearMark(); return; } // past the pile: drop at the end
    const r = li.getBoundingClientRect();
    const before = (e.clientY - r.top) < r.height / 2;
    if (!dropMark || dropMark.li !== li || dropMark.before !== before) {
      clearMark();
      li.classList.add(before ? 'drop-before' : 'drop-after');
      dropMark = { li, before };
    }
  });

  list.addEventListener('drop', async (e) => {
    if (dragId === null) return;
    e.preventDefault();
    const id = dragId;
    const mark = dropMark;
    const siblings = activeCards().filter((t) => t.id !== id);
    let index = siblings.length; // default: drop past the last active card
    if (mark) {
      const at = siblings.findIndex((t) => t.id === Number(mark.li.dataset.id));
      if (at >= 0) index = mark.before ? at : at + 1;
    }
    const prev = siblings[index - 1], next = siblings[index];
    const newSort = !prev ? (next ? next.sortOrder - 1 : 1)
      : !next ? prev.sortOrder + 1
      : (prev.sortOrder + next.sortOrder) / 2;
    const moved = state.tasks.find((t) => t.id === id);
    if (!moved || moved.sortOrder === newSort) return;
    moved.sortOrder = newSort;
    state.tasks.sort((a, b) => (a.completed - b.completed) || (a.sortOrder - b.sortOrder));
    renderSpread();
    try {
      await updateTask(id, { sort_order: newSort });
    } catch (err) {
      showToast(err.message, { error: true });
      await refresh();
    }
  });

  list.addEventListener('dragend', () => {
    dragId = null;
    clearMark();
    list.querySelectorAll('.task').forEach((li) => { li.classList.remove('dragging'); li.draggable = false; });
  });
})();

if (finePointer && !reduceMotion) {
  const list = $('#task-list');
  list.addEventListener('pointermove', (e) => {
    const li = e.target.closest('.task');
    if (!li) return;
    const r = li.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    li.style.setProperty('--ry', (px * 6).toFixed(2) + 'deg');
    li.style.setProperty('--rx', (-py * 6).toFixed(2) + 'deg');
  });
  list.addEventListener('pointerout', (e) => {
    const li = e.target.closest('.task');
    if (li && !li.contains(e.relatedTarget)) {
      li.style.removeProperty('--rx');
      li.style.removeProperty('--ry');
    }
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
      const snapshot = { ...task };
      await deleteTask(task.id);
      showToast(`Deleted "${task.title}"`, { action: 'Undo', onAction: () => restoreTask(snapshot) });
      await refresh();
    } catch (err) { showToast(err.message, { error: true }); }
    return;
  }

  if (e.target.closest('.pickup-task')) { pullToTop(task); return; }

  // Loop 8: click anywhere else on an active card picks it up - top of the focus deck.
  // Completed cards stay put; an open edit form absorbs its own clicks; a click that
  // ends a text selection is reading, not picking up.
  if (task.completed || e.target.closest('.task-edit')) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  pullToTop(task);
});

/* Loop 8: pick a card up from the spread - it jumps to the top of the deck.
   Same optimistic + rollback discipline as a fling. */
async function pullToTop(task) {
  if (pendingTasks.has(task.id)) return;
  const previous = task.sortOrder;
  const fields = { sort_order: Math.min(Date.now(), ...state.tasks.map(t => t.sortOrder)) - 1 };
  pendingTasks.set(task.id, fields);
  task.sortOrder = fields.sort_order;
  sortTasks();
  state.view = 'deck';
  try { localStorage.setItem('the-deck:view', 'deck'); } catch {}
  const swap = () => { applyView(); paintState(); };
  if (!reduceMotion && document.startViewTransition) document.startViewTransition(swap);
  else swap();
  try {
    const saved = await updateTask(task.id, fields);
    const current = state.tasks.find(t => t.id === task.id);
    if (current) Object.assign(current, saved);
    pendingTasks.delete(task.id);
    sortTasks(); paintState();
    showToast(`Picked up "${task.title}"`);
  } catch (err) {
    pendingTasks.delete(task.id);
    const current = state.tasks.find(t => t.id === task.id);
    if (current) current.sortOrder = previous;
    sortTasks(); paintState();
    showToast('Could not confirm the change. Card restored; checking the server.', { error: true });
    try { await refresh(); } catch { showToast('Connection lost. Change not confirmed. Reconnect and reload before trying again.', { error: true }); }
  }
}

document.querySelectorAll('.filter').forEach((b) =>
  b.addEventListener('click', () => { state.filter = b.dataset.filter; spreadDealIn = true; renderSpread(); }));

/* ---------- view toggle ---------- */
$('#view-toggle').addEventListener('click', () => {
  state.view = state.view === 'deck' ? 'spread' : 'deck';
  try { localStorage.setItem('the-deck:view', state.view); } catch {}
  if (!reduceMotion && document.startViewTransition) document.startViewTransition(() => applyView());
  else applyView();
});
function applyView() {
  const spread = state.view === 'spread';
  $('#deck-view').hidden = spread;
  $('#spread-view').hidden = !spread;
  if (spread) { spreadDealIn = true; renderSpread(); }
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
    lastAddedId = task.id;
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
