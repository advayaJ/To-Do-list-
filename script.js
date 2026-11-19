/* =====================================================================
   TO-DO LIST — script.js

   The whole app is one idea:

       tasks  (an array of objects)  ->  renderTasks()  ->  the screen

   Nothing on screen is edited directly for data. We change the array,
   save it, and redraw. That keeps the UI and the data from drifting apart.

   Sections:
   1. Element references + app state
   2. Small helpers (uid, escapeHTML, dates, time)
   3. Persistence (loadTasks / saveTasks)
   4. Rendering (renderTasks + the chip template)
   5. Creating, toggling, editing, deleting
   6. Filters + search
   7. Grouping + ordering
   8. Theme
   9. Toasts
  10. Confetti (hand-written canvas particles)
  11. Wire everything up
   ===================================================================== */

'use strict';

/* =====================================================================
   1. ELEMENT REFERENCES + APP STATE
   ===================================================================== */

/* --- Parts of the page we touch from JavaScript --- */
const listEl = document.getElementById('task-list');
const formEl = document.getElementById('task-form');
const inputEl = document.getElementById('task-input');
const dueEl = document.getElementById('due-input');
const priorityEl = document.getElementById('priority-input');
const inputCard = document.getElementById('input-card');
const filtersEl = document.querySelector('.filters');
const searchEl = document.getElementById('search-input');
const statDoneEl = document.getElementById('stat-done');
const statPercentEl = document.getElementById('stat-percent');
const progressEl = document.getElementById('progress');
const progressFill = document.getElementById('progress-fill');
const emptyStateEl = document.getElementById('empty-state');
const noMatchEl = document.getElementById('no-match');
const footerCountEl = document.getElementById('footer-count');
const clearBtn = document.getElementById('clear-completed');
const themeBtn = document.getElementById('theme-toggle');
const todayEl = document.getElementById('today');
const toastStack = document.getElementById('toast-stack');
const canvas = document.getElementById('confetti');
const ctx = canvas.getContext('2d');

/* --- Storage keys (one place, so they can never drift) --- */
const STORAGE_TASKS = 'glass-todo.tasks';
const STORAGE_THEME = 'glass-todo.theme';

/* --- Human labels for the three priorities --- */
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

/* --- The single source of truth --- */
let tasks = [];

/* --- View state (never saved: it is just "how we are looking right now") --- */
let filter = 'all';     // 'all' | 'active' | 'done'
let searchTerm = '';    // live search text
let editingId = null;   // id of the task currently being edited, or null

/* New tasks get one entrance animation; this set marks them for one render. */
const freshTaskIds = new Set();

/* The very first render staggers every chip in, later renders do not. */
let firstRender = true;

/* Respect the user's motion preference for the canvas confetti too. */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* =====================================================================
   2. SMALL HELPERS
   ===================================================================== */

/* A short, effectively unique id: timestamp + random characters. */
function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/*
 * THE SECURITY HELPER.
 * Task text is typed by a human and later inserted with innerHTML, so it
 * must be escaped first. Without this, a task named
 *   <img src=x onerror="alert(1)">
 * would run code. After escaping it is just harmless visible text.
 */
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* "14:05" from the ISO timestamp saved when the task was created. */
function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

/* "Nov 19" from a stored "YYYY-MM-DD" date string. */
function formatDate(dateString) {
  /* Adding T00:00:00 makes the browser read it as LOCAL midnight.
     Without it, "2026-11-19" is parsed as UTC and can become Nov 18
     for anyone west of Greenwich. */
  const date = new Date(dateString + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* True when the due date is before today AND the task is still open. */
function isOverdue(task) {
  if (task.done || !task.due) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0); // compare whole days, not hours

  const due = new Date(task.due + 'T00:00:00');
  if (Number.isNaN(due.getTime())) return false;

  return due < today;
}

/* Fill the header date line, e.g. "Tuesday, November 18". */
function renderTodayLine() {
  todayEl.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}


/* =====================================================================
   3. PERSISTENCE
   localStorage can throw (private mode, full disk), so every access is
   wrapped in try/catch and the app keeps working without it.
   ===================================================================== */

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_TASKS);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    /* Rebuild each task field by field. Old or hand-edited data can never
       break the app, because every value is checked here first. */
    return parsed
      .filter(function (item) {
        return item && typeof item.id === 'string' && typeof item.text === 'string';
      })
      .map(function (item) {
        return {
          id: item.id,
          text: item.text,
          done: Boolean(item.done),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          due: typeof item.due === 'string' ? item.due : '',
          priority: ['low', 'medium', 'high'].indexOf(item.priority) !== -1 ? item.priority : ''
        };
      });
  } catch (error) {
    console.warn('To-do list: could not read saved tasks.', error);
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_TASKS, JSON.stringify(tasks));
  } catch (error) {
    /* The list still works for this visit; it just will not persist. */
    console.warn('To-do list: could not save tasks.', error);
  }
}

/**
 * The tasks for the current filter + search, in array order.
 * renderTasks() needs exactly this, so it lives in one function instead of
 * being copied around.
 */
function getVisibleTasks() {
  const query = searchTerm.trim().toLowerCase();

  return tasks.filter(function (task) {
    if (filter === 'active' && task.done) return false;
    if (filter === 'done' && !task.done) return false;
    if (query && task.text.toLowerCase().indexOf(query) === -1) return false;
    return true;
  });
}


/* =====================================================================
   4. RENDERING
   ===================================================================== */

/* Build the HTML for ONE task chip. */
function taskHTML(task, index, animate) {
  const isEditing = editingId === task.id;
  const classes = ['task-chip'];
  if (task.done) classes.push('done');
  if (animate) classes.push('enter');
  /* The block gets its priority colour wash from this class. */
  if (task.priority) classes.push('chip-' + task.priority);

  /* --- the small meta chips --- */
  const meta = [];

  meta.push('<span class="meta-chip meta-time">added ' + escapeHTML(formatTime(task.createdAt)) + '</span>');

  if (task.due) {
    const overdue = isOverdue(task);
    meta.push(
      '<span class="meta-chip due-chip' + (overdue ? ' is-overdue' : '') + '">' +
        (overdue ? 'Overdue ' : 'Due ') + escapeHTML(formatDate(task.due)) +
      '</span>'
    );
  }

  if (task.priority) {
    meta.push(
      '<span class="meta-chip priority-chip priority-' + escapeHTML(task.priority) + '">' +
        '<span class="dot"></span>' + escapeHTML(PRIORITY_LABELS[task.priority]) +
      '</span>'
    );
  }

  /* --- text, or the inline edit field while this task is being edited --- */
  const body = isEditing
    ? '<input class="edit-input" type="text" maxlength="140" aria-label="Edit task text" value="' +
        escapeHTML(task.text) + '" />'
    : '<span class="task-text" title="Double-click to edit"><span class="task-label">' +
        escapeHTML(task.text) + '</span></span>';

  return (
    '<li class="' + classes.join(' ') + '" data-id="' + escapeHTML(task.id) + '"' +
        ' style="--i:' + index + '">' +

      '<button class="checkbox" type="button" role="checkbox" data-action="toggle"' +
        ' aria-checked="' + (task.done ? 'true' : 'false') + '"' +
        ' aria-label="' + (task.done ? 'Mark as not done' : 'Mark as done') + '">' +
        '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>' +
      '</button>' +

      '<div class="task-body">' +
        body +
        '<div class="task-meta">' + meta.join('') + '</div>' +
      '</div>' +

      '<div class="task-actions">' +
        '<button class="act act-edit" type="button" data-action="edit" aria-label="Edit task" title="Edit">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />' +
          '</svg>' +
        '</button>' +
        '<button class="act act-delete" type="button" data-action="delete" aria-label="Delete task" title="Delete">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />' +
            '<path d="M10 11v6M14 11v6" />' +
          '</svg>' +
        '</button>' +
      '</div>' +

    '</li>'
  );
}

/* ---------------------------------------------------------------------
   GROUPING
   The list is not one long column any more. It is split into priority
   sections (high -> medium -> low -> none) and every section is split
   again by due date. Both orders come straight from the data, so the list
   never disagrees with the saved tasks.
   --------------------------------------------------------------------- */

const PRIORITY_ORDER = ['high', 'medium', 'low', ''];

const PRIORITY_TITLES = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
  '': 'No priority'
};

/* Which due-date bucket a task falls into. `order` decides the position
   of the label, `label` is the text shown above that little group. */
function getDueBucket(task) {
  if (!task.due) return { key: 'none', label: 'No due date', order: 5 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(task.due + 'T00:00:00');
  if (Number.isNaN(due.getTime())) return { key: 'none', label: 'No due date', order: 5 };

  /* Whole days between the deadline and today. */
  const days = Math.round((due - today) / 86400000);

  if (days < 0) return { key: 'overdue', label: 'Overdue', order: 0 };
  if (days === 0) return { key: 'today', label: 'Today', order: 1 };
  if (days === 1) return { key: 'tomorrow', label: 'Tomorrow', order: 2 };
  if (days <= 7) return { key: 'week', label: 'This week', order: 3 };
  return { key: 'later', label: 'Later', order: 4 };
}

/* Soonest deadline first; tasks without a date sink to the bottom. */
function compareByDue(a, b) {
  const first = a.due || '9999-12-31';
  const second = b.due || '9999-12-31';
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

/* Build the whole <ul> content: one <li> per priority section. */
function buildListHTML(visible) {
  let index = 0; // used for the staggered entrance animation
  let html = '';

  PRIORITY_ORDER.forEach(function (priority) {
    const inPriority = visible.filter(function (task) {
      return (task.priority || '') === priority;
    });

    if (inPriority.length === 0) return;

    html +=
      '<li class="task-group group-' + (priority || 'none') + '">' +
        '<h2 class="group-head">' +
          '<span class="group-dot" aria-hidden="true"></span>' +
          '<span class="group-name">' + PRIORITY_TITLES[priority] + '</span>' +
          '<span class="group-count">' + inPriority.length + '</span>' +
        '</h2>' +
        '<div class="group-body">';

    /* Bucket the section by due date, keeping the buckets in time order. */
    const buckets = [];
    inPriority.forEach(function (task) {
      const bucket = getDueBucket(task);
      let entry = buckets.find(function (item) { return item.key === bucket.key; });
      if (!entry) {
        entry = { key: bucket.key, label: bucket.label, order: bucket.order, tasks: [] };
        buckets.push(entry);
      }
      entry.tasks.push(task);
    });

    buckets.sort(function (a, b) { return a.order - b.order; });

    buckets.forEach(function (bucket) {
      bucket.tasks.sort(compareByDue);

      html +=
        '<div class="due-block">' +
          '<p class="due-divider">' + bucket.label + '</p>' +
          '<ul class="group-items">';

      bucket.tasks.forEach(function (task) {
        html += taskHTML(task, index, firstRender || freshTaskIds.has(task.id));
        index += 1;
      });

      html += '</ul></div>';
    });

    html += '</div></li>';
  });

  return html;
}

/**
 * Redraw everything from the `tasks` array.
 * Called after every single change — this is the only place that touches
 * the list, the stats, the progress bar and the empty states.
 */
function renderTasks() {
  const visible = getVisibleTasks();

  listEl.innerHTML = buildListHTML(visible);

  /* Empty state vs "no match" state. */
  emptyStateEl.hidden = tasks.length !== 0;
  noMatchEl.hidden = !(tasks.length > 0 && visible.length === 0);

  /* --- stats + progress --- */
  const total = tasks.length;
  const done = tasks.filter(function (task) { return task.done; }).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  statDoneEl.textContent = done + ' of ' + total + ' done';
  statPercentEl.textContent = percent + '%';
  progressFill.style.width = percent + '%';
  progressEl.setAttribute('aria-valuenow', String(percent));

  footerCountEl.textContent =
    total + ' ' + (total === 1 ? 'task' : 'tasks') + ' \u00B7 ' + done + ' done';
  clearBtn.disabled = done === 0;

  /* If we are editing, put the cursor back in the edit field after a redraw. */
  if (editingId) {
    const field = listEl.querySelector('.edit-input');
    if (field) {
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  }

  freshTaskIds.clear();
  firstRender = false;
}


/* =====================================================================
   5. CREATE / UPDATE / DELETE
   ===================================================================== */

/* The chip element for an id, wherever the grouped list put it. */
function findChip(id) {
  return Array.prototype.find.call(listEl.querySelectorAll('.task-chip'), function (chip) {
    return chip.dataset.id === id;
  });
}

/* --- CREATE --- */
function addTask(event) {
  event.preventDefault(); // a form submit would otherwise reload the page

  const text = inputEl.value.trim();

  /* Empty input: no task, a shake and a toast. */
  if (!text) {
    inputCard.classList.remove('shake');
    void inputCard.offsetWidth; // forces the browser to restart the animation
    inputCard.classList.add('shake');
    window.setTimeout(function () { inputCard.classList.remove('shake'); }, 450);

    showToast('Type something first');
    inputEl.focus();
    return;
  }

  const task = {
    id: uid(),
    text: text,
    done: false,
    createdAt: new Date().toISOString(),
    due: dueEl.value || '',
    priority: priorityEl.value || ''
  };

  tasks.unshift(task);        // new tasks go to the TOP
  freshTaskIds.add(task.id);  // ...and get an entrance animation
  saveTasks();

  /* Reset the three fields for the next task. */
  inputEl.value = '';
  dueEl.value = '';
  priorityEl.value = '';

  renderTasks();
  showToast('Task added');
  inputEl.focus();
}

/* --- UPDATE: complete / un-complete --- */
function toggleTask(id, originRect) {
  const task = tasks.find(function (item) { return item.id === id; });
  if (!task) return;

  /* Was this the last open task? Ask BEFORE flipping it. */
  const openCount = tasks.filter(function (item) { return !item.done; }).length;
  const wasLastActive = !task.done && openCount === 1;

  task.done = !task.done;
  saveTasks();
  renderTasks();

  /* Give the checkbox its pop animation. */
  const chip = findChip(id);
  if (chip) chip.classList.add('pop');

  /* Confetti when something gets completed. */
  if (task.done) {
    if (wasLastActive) {
      launchConfetti({
        count: 170,
        x: window.innerWidth / 2,
        y: window.innerHeight * 0.42,
        power: 1.35
      });
      showToast('All tasks done \u2014 legendary!');
    } else {
      const box = originRect || { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
      launchConfetti({
        count: 70,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        power: 1
      });
    }
  }
}

/* --- UPDATE: start editing --- */
function startEdit(id) {
  const exists = tasks.some(function (task) { return task.id === id; });
  if (!exists) return;

  editingId = id;
  renderTasks(); // renderTasks() focuses the new input for us
}

/**
 * Save (or cancel) an inline edit.
 * `rawValue` is passed in so the caller decides where the text comes from.
 */
function saveEdit(id, rawValue, options) {
  const settings = options || {};

  /* Guard: only the task that is actually being edited may be saved. */
  if (editingId === null || editingId !== id) return;

  editingId = null;

  const text = settings.cancel ? '' : String(rawValue).trim();

  /* Empty input cancels, exactly like Escape. */
  if (text) {
    const task = tasks.find(function (item) { return item.id === id; });
    if (task && task.text !== text) {
      task.text = text;
      saveTasks();
      showToast('Task updated');
    }
  }

  renderTasks();
}

/* --- DELETE (with a short slide-out first) --- */
function deleteTask(id) {
  const chip = findChip(id);

  if (editingId === id) editingId = null;

  /* Show the animation, then remove from state 300ms later. */
  if (chip && !chip.classList.contains('leaving')) {
    chip.classList.add('leaving');

    window.setTimeout(function () {
      tasks = tasks.filter(function (task) { return task.id !== id; });
      saveTasks();
      renderTasks();
    }, 300);
  } else {
    tasks = tasks.filter(function (task) { return task.id !== id; });
    saveTasks();
    renderTasks();
  }

  showToast('Task deleted');
}

/* --- DELETE all completed --- */
function clearCompleted() {
  const finished = tasks.filter(function (task) { return task.done; }).length;
  if (finished === 0) return;

  tasks = tasks.filter(function (task) { return !task.done; });

  if (editingId && !tasks.some(function (task) { return task.id === editingId; })) {
    editingId = null;
  }

  saveTasks();
  renderTasks();
  showToast(finished === 1 ? '1 completed task cleared' : finished + ' completed tasks cleared');
}


/* =====================================================================
   6. FILTERS + SEARCH
   ===================================================================== */

filtersEl.addEventListener('click', function (event) {
  const button = event.target.closest('[data-filter]');
  if (!button) return;

  filter = button.dataset.filter;

  /* Keep the visual pill and the ARIA state in sync. */
  Array.prototype.forEach.call(filtersEl.querySelectorAll('[role="tab"]'), function (tab) {
    const isActive = tab === button;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  renderTasks();
});

searchEl.addEventListener('input', function () {
  searchTerm = searchEl.value; // filtering is case-insensitive inside getVisibleTasks
  renderTasks();
});


/* =====================================================================
   7. ORDERING

   Tasks used to be dragged into any order the user liked. Now the list
   sorts itself: priority sections first, then due-date buckets inside
   each section. A hand-made order would simply be overwritten by the next
   render, so the drag code is gone instead of half-working.
   ===================================================================== */


/* =====================================================================
   8. THEME
   CSS does all the work: we only toggle the `light` class on <body>.
   ===================================================================== */
function applyTheme(theme, options) {
  const settings = options || {};
  const isLight = theme === 'light';

  document.body.classList.toggle('light', isLight);

  themeBtn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
  themeBtn.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');

  try {
    localStorage.setItem(STORAGE_THEME, theme);
  } catch (error) {
    console.warn('To-do list: could not save the theme.', error);
  }

  if (settings.announce) {
    showToast(isLight ? 'Daylight mode on' : 'Midnight mode on');
  }
}

themeBtn.addEventListener('click', function () {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  applyTheme(next, { announce: true });
});


/* =====================================================================
   9. TOASTS
   ===================================================================== */
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message; // textContent is inherently safe
  toastStack.appendChild(toast);

  /* Never let toasts stack up forever. */
  while (toastStack.children.length > 3) {
    toastStack.removeChild(toastStack.firstElementChild);
  }

  /* Start fading after ~2.2 seconds, then remove the element. */
  window.setTimeout(function () {
    toast.classList.add('is-going');
    window.setTimeout(function () { toast.remove(); }, 320);
  }, 2200);
}


/* =====================================================================
   10. CONFETTI — a hand-written canvas particle system
   ===================================================================== */

const CONFETTI_COLORS = ['#8b5cf6', '#22d3ee', '#f472b6', '#fbbf24', '#a78bfa', '#67e8f9'];

let particles = [];
let confettiFrame = 0;

/* Match the canvas to the window, including high-DPI screens. */
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);

  /* Work in CSS pixels from here on, so positions are easy to reason about. */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* Fire a burst of particles from one point. */
function launchConfetti(options) {
  if (reduceMotion) return; // honour "prefers-reduced-motion"

  const settings = options || {};
  const count = settings.count || 80;
  const originX = settings.x !== undefined ? settings.x : window.innerWidth / 2;
  const originY = settings.y !== undefined ? settings.y : window.innerHeight / 2;
  const power = settings.power || 1;

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 8 + 3) * power;

    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4 * power,
      size: Math.random() * 7 + 4,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.35 ? 'rect' : 'dot',
      life: 1,                                  // 1 = fully visible, 0 = gone
      decay: Math.random() * 0.008 + 0.006,      // how fast it fades
      gravity: 0.16 + Math.random() * 0.08
    });
  }

  /* Only one animation loop at a time — extra bursts just add particles. */
  if (!confettiFrame) confettiFrame = window.requestAnimationFrame(animateConfetti);
}

/* Move, fade and draw every particle, once per frame. */
function animateConfetti() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  ctx.clearRect(0, 0, width, height);

  /* 1. Physics */
  particles.forEach(function (particle) {
    particle.vy += particle.gravity;  // gravity pulls it down
    particle.vx *= 0.99;              // a little air drag
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.rotation += particle.spin;
    particle.life -= particle.decay;
  });

  /* 2. Drop dead or off-screen particles */
  particles = particles.filter(function (particle) {
    return particle.life > 0 && particle.y < height + 60;
  });

  /* 3. Draw what is left */
  particles.forEach(function (particle) {
    ctx.save();
    ctx.globalAlpha = Math.max(particle.life, 0);
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);
    ctx.fillStyle = particle.color;

    if (particle.shape === 'rect') {
      /* A small paper rectangle. */
      ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
    } else {
      /* A round dot. */
      ctx.beginPath();
      ctx.arc(0, 0, particle.size / 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });

  /* 4. Keep going, or stop and clear the canvas */
  if (particles.length > 0) {
    confettiFrame = window.requestAnimationFrame(animateConfetti);
  } else {
    confettiFrame = 0;
    ctx.clearRect(0, 0, width, height);
  }
}


/* =====================================================================
   11. WIRE EVERYTHING UP
   ===================================================================== */

/* The form covers both Enter (from the text field) and the Add button. */
formEl.addEventListener('submit', addTask);

/* A <textarea> does not submit its form on Enter the way a one-line <input>
   does, so it gets its own shortcut. Shift+Enter is treated the same way:
   one task is always one line of text. */
inputEl.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  formEl.requestSubmit();
});

/* ONE click listener for the whole list: rows are handled by data-action. */
listEl.addEventListener('click', function (event) {
  const chip = event.target.closest('.task-chip');
  if (!chip) return;

  const control = event.target.closest('[data-action]');
  if (!control) return; // clicking plain text does nothing (double-click edits)

  const id = chip.dataset.id;

  if (control.dataset.action === 'toggle') {
    /* Measure the checkbox BEFORE the redraw, so the confetti starts there. */
    toggleTask(id, control.getBoundingClientRect());
  } else if (control.dataset.action === 'edit') {
    startEdit(id);
  } else if (control.dataset.action === 'delete') {
    deleteTask(id);
  }
});

/* Double-clicking the task text opens the editor. */
listEl.addEventListener('dblclick', function (event) {
  const text = event.target.closest('.task-text');
  if (!text) return;

  const chip = text.closest('.task-chip');
  if (chip) startEdit(chip.dataset.id);
});

/* Enter saves an edit, Escape cancels it. */
listEl.addEventListener('keydown', function (event) {
  const field = event.target.closest('.edit-input');
  if (!field) return;

  const chip = field.closest('.task-chip');
  if (!chip) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    saveEdit(chip.dataset.id, field.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    saveEdit(chip.dataset.id, field.value, { cancel: true });
  }
});

/* Clicking away also saves. A tiny delay lets a click on another button
   (delete, edit) run first, so it is not swallowed by a redraw. */
listEl.addEventListener('focusout', function (event) {
  const field = event.target;
  if (!field.classList || !field.classList.contains('edit-input')) return;

  const chip = field.closest('.task-chip');
  if (!chip) return;

  const id = chip.dataset.id;
  const value = field.value;

  window.setTimeout(function () {
    if (editingId !== id) return; // already handled, or the task is gone
    saveEdit(id, value);
  }, 150);
});

clearBtn.addEventListener('click', clearCompleted);

/* Keep the canvas crisp when the window changes size. */
window.addEventListener('resize', function () {
  sizeCanvas();
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
});

/* --- Start the app --- */
function init() {
  renderTodayLine();

  /* Restore the theme (the head script already did this pre-paint). */
  let savedTheme = 'dark';
  try {
    savedTheme = localStorage.getItem(STORAGE_THEME) === 'light' ? 'light' : 'dark';
  } catch (error) {
    console.warn('To-do list: could not read the saved theme.', error);
  }
  applyTheme(savedTheme);

  /* Restore the tasks, then draw for the first time. */
  tasks = loadTasks();

  sizeCanvas();
  renderTasks();
}

init();
