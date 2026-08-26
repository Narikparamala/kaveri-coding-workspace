import { createClient } from '@supabase/supabase-js';
import './styles.css';
import './batches.css';
import './live-class.css';
import './live-session-v2.css';

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: 'kaveri-coding-batch-manager-v2-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const app = document.querySelector('#app');

const state = {
  session: null,
  profile: null,
  batches: [],
  students: [],
  memberships: [],
  assignments: [],
  targets: [],
  requests: [],
  selectedBatchId: '',
  selectedAssignmentIds: new Set()
};

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function renderStatus(title, detail = '') {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card loading-card">
        <div class="spinner"></div>
        <h2>${esc(title)}</h2>
        <p class="fineprint">${esc(detail)}</p>
      </section>
    </main>`;
}

function renderError(error) {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">!</div>
        <h1>Live Class Manager error</h1>
        <p class="muted">${esc(error?.message || error || 'Unknown error')}</p>
        <button id="retry" class="primary wide">Retry</button>
      </section>
    </main>`;
  document.querySelector('#retry').addEventListener('click', start);
}

async function rest(path, options = {}) {
  const {
    method = 'GET',
    body,
    token = state.session?.access_token,
    prefer,
    timeout = 10000
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;

    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!response.ok) {
      const message = data?.message || data?.hint || data?.details || text || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Request timed out after ${timeout / 1000} seconds`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">K</div>
        <p class="eyebrow">Kaveri Technologies</p>
        <h1>Live Class Manager</h1>
        <p class="muted">Start live coding activities, end class access, and approve make-up requests.</p>
        <button id="google-login" class="primary wide">Continue with Google</button>
      </section>
    </main>`;

  document.querySelector('#google-login').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/batches-v2.html` }
    });
    if (error) renderError(error);
  });
}

function renderDenied() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">!</div>
        <h1>Teacher access required</h1>
        <p class="muted">Only active faculty and super-admin accounts can control live coding classes.</p>
        <button id="logout" class="secondary wide">Sign out</button>
      </section>
    </main>`;
  document.querySelector('#logout').addEventListener('click', logout);
}

function activeMemberships(batchId) {
  return state.memberships.filter((m) => m.batch_id === batchId && m.status === 'active');
}

function studentById(id) {
  return state.students.find((student) => student.id === id);
}

function assignmentById(id) {
  return state.assignments.find((assignment) => assignment.id === id);
}

function batchById(id) {
  return state.batches.find((batch) => batch.id === id);
}

function targetFor(assignmentId, batchId) {
  return state.targets.find((target) => target.assignment_id === assignmentId && target.batch_id === batchId);
}

function targetIsLive(target) {
  if (!target?.is_unlocked) return false;
  if (!target.live_until) return true;
  return new Date(target.live_until).getTime() > Date.now();
}

function currentBatch() {
  return batchById(state.selectedBatchId) || state.batches[0] || null;
}

function generateJoinCodeValue() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  return `KAV-${suffix}`;
}

function questionRow(assignment, batch) {
  const target = batch ? targetFor(assignment.id, batch.id) : null;
  const live = targetIsLive(target);
  const taught = Boolean(target);
  const checked = state.selectedAssignmentIds.has(assignment.id);
  const status = live
    ? `<span class="session-status live">● LIVE until ${esc(formatTime(target.live_until) || 'ended manually')}</span>`
    : taught
      ? '<span class="session-status history">🔒 Past class • locked</span>'
      : '<span class="session-status new">Not taught yet</span>';

  return `
    <label class="session-question ${live ? 'is-live' : ''}">
      <input type="checkbox" class="session-question-check" data-assignment="${assignment.id}" ${checked ? 'checked' : ''} ${batch ? '' : 'disabled'} />
      <span class="session-checkmark">${checked ? '✓' : ''}</span>
      <span class="session-question-copy">
        <strong>${esc(assignment.title)}</strong>
        <small>${esc(assignment.assignment_key)} • ${Number(assignment.marks || 0)} marks</small>
      </span>
      ${status}
    </label>`;
}

function requestCard(request) {
  const student = studentById(request.student_id);
  const assignment = assignmentById(request.assignment_id);
  const batch = batchById(request.batch_id);

  return `
    <article class="makeup-request-card">
      <div class="makeup-request-main">
        <div class="request-avatar">${esc((student?.full_name || student?.email || 'S')[0].toUpperCase())}</div>
        <div>
          <strong>${esc(student?.full_name || student?.email || 'Student')}</strong>
          <span>${esc(assignment?.title || 'Question')} • ${esc(batch?.name || 'Batch')}</span>
          <small>Requested ${esc(formatDateTime(request.requested_at))}</small>
        </div>
      </div>
      <div class="makeup-actions">
        <button class="primary small decide-request" data-request="${request.id}" data-approve="true" data-minutes="30">Allow 30 min</button>
        <button class="secondary small decide-request" data-request="${request.id}" data-approve="true" data-minutes="60">Allow 1 hour</button>
        <button class="secondary small reject-access decide-request" data-request="${request.id}" data-approve="false" data-minutes="60">Reject</button>
      </div>
    </article>`;
}

function batchSetupCard(batch) {
  const members = activeMemberships(batch.id);
  const memberIds = new Set(members.map((m) => m.student_id));
  const available = state.students.filter((student) => !memberIds.has(student.id));
  const joinCode = batch.join_code || '';
  const canDelete = state.profile?.role === 'super_admin';

  return `
    <article class="batch-card compact-batch-card">
      <div class="batch-card-head">
        <div>
          <div class="batch-title-row"><h3>${esc(batch.name)}</h3><span class="batch-status">${esc(batch.status)}</span></div>
          <p class="muted">${members.length} student${members.length === 1 ? '' : 's'}</p>
        </div>
        ${canDelete ? `<button class="delete-batch" data-batch="${batch.id}">Delete</button>` : ''}
      </div>
      <div class="join-code-box compact-code-box">
        <div><small>JOIN CODE</small><strong>${joinCode ? esc(joinCode) : 'Not generated'}</strong></div>
        <div class="join-code-actions">
          ${joinCode ? `<button class="secondary small copy-code" data-code="${esc(joinCode)}">Copy</button>` : ''}
          <button class="secondary small generate-code" data-batch="${batch.id}">${joinCode ? 'New code' : 'Generate'}</button>
        </div>
      </div>
      <details class="member-details">
        <summary>Manage students (${members.length})</summary>
        <div class="member-list">
          ${members.length ? members.map((member) => {
            const student = studentById(member.student_id);
            return `<div class="member-row"><div><strong>${esc(student?.full_name || student?.email || 'Student')}</strong><small>${esc(student?.email || '')}</small></div><button class="secondary small remove-student" data-membership="${member.id}">Remove</button></div>`;
          }).join('') : '<p class="empty-inline">No students enrolled yet.</p>'}
        </div>
        <div class="add-student-row">
          <select class="student-select" data-batch="${batch.id}"><option value="">Select student…</option>${available.map((student) => `<option value="${student.id}">${esc(student.full_name || student.email)}</option>`).join('')}</select>
          <button class="primary add-student" data-batch="${batch.id}" ${available.length ? '' : 'disabled'}>Add</button>
        </div>
      </details>
    </article>`;
}

function renderPage() {
  const published = state.assignments.filter((assignment) => assignment.is_published);
  const batch = currentBatch();
  if (batch && !state.selectedBatchId) state.selectedBatchId = batch.id;
  const batchTargets = batch ? state.targets.filter((target) => target.batch_id === batch.id) : [];
  const liveTargets = batchTargets.filter(targetIsLive);
  const pendingRequests = state.requests.filter((request) => request.status === 'pending');
  const profileName = state.profile?.full_name || state.profile?.email || 'Teacher';

  app.innerHTML = `
    <div class="dashboard-shell batch-shell live-session-shell">
      <header class="topbar batch-topbar">
        <div>
          <p class="eyebrow">Kaveri Technologies</p>
          <h1>Live Coding Class</h1>
          <div class="batch-nav"><a href="/" class="secondary small nav-link">← Submissions & Questions</a></div>
        </div>
        <div class="teacher-block">
          <div class="teacher-copy"><strong>${esc(profileName)}</strong><span>${esc(state.profile?.role || '')}</span></div>
          <button id="refresh" class="icon-button" title="Refresh">↻</button>
          <button id="logout" class="secondary small">Sign out</button>
        </div>
      </header>

      <section class="batch-metrics">
        <article class="metric-card"><span>Batches</span><strong>${state.batches.length}</strong></article>
        <article class="metric-card"><span>Students</span><strong>${state.students.length}</strong></article>
        <article class="metric-card"><span>Live now</span><strong>${liveTargets.length}</strong></article>
        <article class="metric-card"><span>Access requests</span><strong>${pendingRequests.length}</strong></article>
      </section>

      <section class="live-control-panel">
        <div class="live-control-heading">
          <div><p class="eyebrow">TODAY'S LIVE CLASS</p><h2>Start coding activities for one batch</h2><p>Choose the batch, tick today's question(s), and start the class. No pre-assignment needed.</p></div>
          ${liveTargets.length ? '<span class="live-now-pill">● CLASS LIVE</span>' : '<span class="live-now-pill idle">Class idle</span>'}
        </div>

        <div class="session-toolbar">
          <label>Batch<select id="live-batch">${state.batches.map((item) => `<option value="${item.id}" ${item.id === batch?.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
          <label>Access window<select id="live-duration"><option value="60">60 minutes</option><option value="90" selected>90 minutes</option><option value="120">2 hours</option></select></label>
          <div class="session-toolbar-actions"><button id="select-all" class="secondary">Select all</button><button id="clear-selection" class="secondary">Clear</button></div>
        </div>

        <div class="session-question-list">
          ${published.map((assignment) => questionRow(assignment, batch)).join('') || '<p class="empty-inline">No published questions available.</p>'}
        </div>

        <div class="session-footer-actions">
          <div><strong>${state.selectedAssignmentIds.size}</strong> question${state.selectedAssignmentIds.size === 1 ? '' : 's'} selected</div>
          <div>
            <button id="end-live-class" class="secondary danger-soft" ${liveTargets.length ? '' : 'disabled'}>■ End Live Class</button>
            <button id="start-live-class" class="primary" ${batch && state.selectedAssignmentIds.size ? '' : 'disabled'}>▶ Start Live Class</button>
          </div>
        </div>
      </section>

      <section class="batch-section makeup-section">
        <div class="section-heading"><div><p class="eyebrow">MISSED CLASS</p><h2>Make-up Access Requests</h2></div><p class="muted">Temporary access is granted only to the student you approve.</p></div>
        <div class="makeup-request-list">
          ${pendingRequests.length ? pendingRequests.map(requestCard).join('') : '<div class="empty-request-state">✓ No students are waiting for make-up access.</div>'}
        </div>
      </section>

      ${state.profile?.role === 'super_admin' ? `
        <section class="panel batch-create-panel">
          <div class="section-heading"><div><p class="eyebrow">BATCH SETUP</p><h2>Create batch</h2></div></div>
          <form id="create-batch-form" class="create-batch-form">
            <label>Batch name<input id="batch-name" required placeholder="Example: Python Madanapalle" /></label>
            <label>Maximum students<input id="batch-max" type="number" min="1" value="50" /></label>
            <label class="wide-field">Description<input id="batch-description" placeholder="Example: Madanapalle Python batch" /></label>
            <button class="primary" type="submit">+ Create Batch</button>
          </form>
          <p id="batch-message" class="fineprint"></p>
        </section>` : ''}

      <section class="batch-section">
        <div class="section-heading"><div><p class="eyebrow">BATCHES</p><h2>Students & Join Codes</h2></div><p class="muted">This setup is separate from the daily live-class controls above.</p></div>
        <div class="batch-grid">${state.batches.map(batchSetupCard).join('') || '<section class="panel"><h3>No batches yet</h3></section>'}</div>
      </section>
    </div>`;

  bindEvents();
}

function bindEvents() {
  document.querySelector('#refresh')?.addEventListener('click', loadData);
  document.querySelector('#logout')?.addEventListener('click', logout);
  document.querySelector('#live-batch')?.addEventListener('change', (event) => {
    state.selectedBatchId = event.target.value;
    state.selectedAssignmentIds.clear();
    renderPage();
  });
  document.querySelector('#select-all')?.addEventListener('click', () => {
    state.selectedAssignmentIds = new Set(state.assignments.filter((assignment) => assignment.is_published).map((assignment) => assignment.id));
    renderPage();
  });
  document.querySelector('#clear-selection')?.addEventListener('click', () => {
    state.selectedAssignmentIds.clear();
    renderPage();
  });
  document.querySelectorAll('.session-question-check').forEach((checkbox) => checkbox.addEventListener('change', (event) => {
    const id = event.currentTarget.dataset.assignment;
    if (event.currentTarget.checked) state.selectedAssignmentIds.add(id);
    else state.selectedAssignmentIds.delete(id);
    renderPage();
  }));
  document.querySelector('#start-live-class')?.addEventListener('click', startLiveClass);
  document.querySelector('#end-live-class')?.addEventListener('click', endLiveClass);
  document.querySelectorAll('.decide-request').forEach((button) => button.addEventListener('click', decideRequest));
  document.querySelector('#create-batch-form')?.addEventListener('submit', createBatch);
  document.querySelectorAll('.generate-code').forEach((button) => button.addEventListener('click', generateCode));
  document.querySelectorAll('.copy-code').forEach((button) => button.addEventListener('click', copyCode));
  document.querySelectorAll('.add-student').forEach((button) => button.addEventListener('click', addStudent));
  document.querySelectorAll('.remove-student').forEach((button) => button.addEventListener('click', removeStudent));
  document.querySelectorAll('.delete-batch').forEach((button) => button.addEventListener('click', deleteBatch));
}

async function loadData() {
  renderStatus('Loading live classroom…', 'Reading batches, questions and requests');
  const [batches, students, memberships, assignments, targets, requests] = await Promise.all([
    rest('/rest/v1/batches?select=id,name,description,status,max_students,join_code,created_at,updated_at&order=created_at.asc'),
    rest('/rest/v1/profiles?select=id,email,full_name,role,is_active&role=eq.student&is_active=eq.true&order=full_name.asc'),
    rest('/rest/v1/batch_students?select=id,batch_id,student_id,status,enrolled_at'),
    rest('/rest/v1/coding_vscode_assignments?select=id,assignment_key,title,marks,is_published,updated_at&order=created_at.asc'),
    rest('/rest/v1/rpc/get_coding_vscode_assignment_targets', { method: 'POST', body: {} }),
    rest('/rest/v1/coding_vscode_access_requests?select=id,student_id,assignment_id,batch_id,status,reason,requested_at,access_until,updated_at&order=requested_at.desc')
  ]);

  state.batches = batches || [];
  state.students = students || [];
  state.memberships = memberships || [];
  state.assignments = assignments || [];
  state.targets = targets || [];
  state.requests = requests || [];

  if (!state.selectedBatchId || !state.batches.some((batch) => batch.id === state.selectedBatchId)) {
    state.selectedBatchId = state.batches[0]?.id || '';
  }

  renderPage();
}

async function startLiveClass() {
  const batch = currentBatch();
  const ids = [...state.selectedAssignmentIds];
  const minutes = Number(document.querySelector('#live-duration')?.value || 90);
  if (!batch || !ids.length) return;

  const button = document.querySelector('#start-live-class');
  button.disabled = true;
  button.textContent = 'Starting…';
  try {
    await rest('/rest/v1/rpc/start_coding_live_class', {
      method: 'POST',
      body: { p_batch_id: batch.id, p_assignment_ids: ids, p_minutes: minutes }
    });
    state.selectedAssignmentIds.clear();
    await loadData();
  } catch (error) {
    alert(error.message);
    await loadData();
  }
}

async function endLiveClass() {
  const batch = currentBatch();
  if (!batch) return;
  if (!window.confirm(`End the live coding access for ${batch.name}?`)) return;

  try {
    await rest('/rest/v1/rpc/end_coding_live_class', {
      method: 'POST',
      body: { p_batch_id: batch.id }
    });
    await loadData();
  } catch (error) {
    alert(error.message);
  }
}

async function decideRequest(event) {
  const button = event.currentTarget;
  const approve = button.dataset.approve === 'true';
  const minutes = Number(button.dataset.minutes || 60);
  button.disabled = true;

  try {
    await rest('/rest/v1/rpc/decide_coding_access_request', {
      method: 'POST',
      body: { p_request_id: button.dataset.request, p_approve: approve, p_minutes: minutes }
    });
    await loadData();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function createBatch(event) {
  event.preventDefault();
  const message = document.querySelector('#batch-message');
  const name = document.querySelector('#batch-name').value.trim();
  const description = document.querySelector('#batch-description').value.trim();
  const maxStudents = Number(document.querySelector('#batch-max').value || 50);
  if (!name) return;

  message.textContent = 'Creating…';
  try {
    await rest('/rest/v1/batches', {
      method: 'POST', prefer: 'return=minimal',
      body: { name, description: description || null, max_students: maxStudents, status: 'active', created_by: state.session.user.id, updated_at: new Date().toISOString() }
    });
    await loadData();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function generateCode(event) {
  const batchId = event.currentTarget.dataset.batch;
  const code = generateJoinCodeValue();
  try {
    await rest(`/rest/v1/batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { join_code: code, updated_at: new Date().toISOString() }
    });
    await loadData();
  } catch (error) { alert(error.message); }
}

async function copyCode(event) {
  const code = event.currentTarget.dataset.code;
  try { await navigator.clipboard.writeText(code); } catch { window.prompt('Copy this batch code:', code); }
}

async function addStudent(event) {
  const batchId = event.currentTarget.dataset.batch;
  const studentId = document.querySelector(`.student-select[data-batch="${batchId}"]`)?.value;
  if (!studentId) return;
  const existing = state.memberships.find((membership) => membership.batch_id === batchId && membership.student_id === studentId);

  try {
    if (existing) {
      await rest(`/rest/v1/batch_students?id=eq.${encodeURIComponent(existing.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'active' } });
    } else {
      await rest('/rest/v1/batch_students', { method: 'POST', prefer: 'return=minimal', body: { batch_id: batchId, student_id: studentId, status: 'active' } });
    }
    await loadData();
  } catch (error) { alert(error.message); }
}

async function removeStudent(event) {
  try {
    await rest(`/rest/v1/batch_students?id=eq.${encodeURIComponent(event.currentTarget.dataset.membership)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'inactive' } });
    await loadData();
  } catch (error) { alert(error.message); }
}

async function deleteBatch(event) {
  if (state.profile?.role !== 'super_admin') return;
  const batch = batchById(event.currentTarget.dataset.batch);
  if (!window.confirm(`Delete “${batch?.name || 'this batch'}”? Student accounts and submissions will not be deleted.`)) return;
  try {
    await rest(`/rest/v1/batches?id=eq.${encodeURIComponent(batch.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (state.selectedBatchId === batch.id) state.selectedBatchId = '';
    await loadData();
  } catch (error) { alert(error.message); }
}

async function logout() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  renderLogin();
}

async function start() {
  try {
    renderStatus('Checking teacher session…', 'Kaveri Live Coding');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    state.session = data?.session || null;
    if (!state.session) return renderLogin();

    const profiles = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(state.session.user.id)}&select=id,email,full_name,role,is_active`);
    state.profile = profiles?.[0] || null;
    if (!state.profile || state.profile.is_active === false || !['faculty', 'super_admin'].includes(state.profile.role)) return renderDenied();

    await loadData();
  } catch (error) {
    console.error('[Kaveri Live Class Manager]', error);
    renderError(error);
  }
}

start();
