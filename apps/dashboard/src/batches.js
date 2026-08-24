import { createClient } from '@supabase/supabase-js';
import './styles.css';
import './batches.css';

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: 'kaveri-coding-batch-manager-auth-v1',
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
  error: ''
};

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderLoading(message = 'Loading…', detail = '') {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card loading-card">
        <div class="spinner"></div>
        <h2>${esc(message)}</h2>
        <p class="fineprint">${esc(detail)}</p>
      </section>
    </main>`;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">K</div>
        <p class="eyebrow">Kaveri Technologies</p>
        <h1>Coding Batch Manager</h1>
        <p class="muted">Create batches, enroll students and control which coding questions appear in each student's VS Code.</p>
        <button id="google-login" class="primary wide">Continue with Google</button>
        <p class="fineprint">Use a Kaveri faculty or super-admin account.</p>
      </section>
    </main>`;

  document.querySelector('#google-login').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/batches.html` }
    });
    if (error) alert(error.message);
  });
}

function renderDenied() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">!</div>
        <h1>Teacher access required</h1>
        <p class="muted">Batch management is available only to Kaveri faculty and super-admin accounts.</p>
        <button id="logout" class="secondary wide">Sign out</button>
      </section>
    </main>`;
  document.querySelector('#logout').addEventListener('click', logout);
}

function renderError() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">!</div>
        <h1>Could not load Batch Manager</h1>
        <p class="muted">${esc(state.error)}</p>
        <button id="retry" class="primary wide">Retry</button>
      </section>
    </main>`;
  document.querySelector('#retry').addEventListener('click', loadPage);
}

function withTimeout(promiseLike, label, milliseconds = 8000) {
  let timer;
  return Promise.race([
    promiseLike,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${milliseconds / 1000} seconds.`)),
        milliseconds
      );
    })
  ]).finally(() => clearTimeout(timer));
}

function activeMemberships(batchId) {
  return state.memberships.filter(
    (membership) => membership.batch_id === batchId && membership.status === 'active'
  );
}

function studentById(id) {
  return state.students.find((student) => student.id === id);
}

function targetBatchIds(assignmentId) {
  return state.targets
    .filter((target) => target.assignment_id === assignmentId)
    .map((target) => target.batch_id);
}

function generateJoinCodeValue() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return `KAV-${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')}`;
}

function batchCard(batch) {
  const members = activeMemberships(batch.id);
  const memberIds = new Set(members.map((membership) => membership.student_id));
  const available = state.students.filter((student) => !memberIds.has(student.id));
  const canDelete = state.profile?.role === 'super_admin';
  const joinCode = batch.join_code || '';

  return `
    <article class="batch-card" data-batch-id="${batch.id}">
      <div class="batch-card-head">
        <div>
          <div class="batch-title-row">
            <h3>${esc(batch.name)}</h3>
            <span class="batch-status">${esc(batch.status)}</span>
          </div>
          <p class="muted">${esc(batch.description || 'No description')}</p>
        </div>
        <div class="batch-card-actions">
          <span class="member-count">${members.length} student${members.length === 1 ? '' : 's'}</span>
          ${canDelete ? `<button class="delete-batch" data-batch="${batch.id}">Delete batch</button>` : ''}
        </div>
      </div>

      <div class="join-code-box">
        <div>
          <small>STUDENT JOIN CODE</small>
          <strong>${joinCode ? esc(joinCode) : 'No join code generated yet'}</strong>
        </div>
        <div class="join-code-actions">
          ${joinCode ? `<button class="secondary small copy-code" data-code="${esc(joinCode)}">Copy code</button>` : ''}
          <button class="secondary small generate-code" data-batch="${batch.id}">${joinCode ? 'New code' : 'Generate code'}</button>
        </div>
      </div>

      <div class="member-list">
        ${members.length ? members.map((membership) => {
          const student = studentById(membership.student_id);
          return `
            <div class="member-row">
              <div>
                <strong>${esc(student?.full_name || student?.email || 'Student')}</strong>
                <small>${esc(student?.email || '')}</small>
              </div>
              <button class="secondary small remove-student" data-batch="${batch.id}" data-student="${membership.student_id}">Remove</button>
            </div>`;
        }).join('') : `<p class="empty-inline">No students enrolled yet.</p>`}
      </div>

      <div class="add-student-row">
        <select class="student-select" data-batch="${batch.id}">
          <option value="">Select student…</option>
          ${available.map((student) => `<option value="${student.id}">${esc(student.full_name || student.email)}${student.email ? ` — ${esc(student.email)}` : ''}</option>`).join('')}
        </select>
        <button class="primary add-student" data-batch="${batch.id}" ${available.length ? '' : 'disabled'}>Add student</button>
      </div>
    </article>`;
}

function assignmentRow(assignment) {
  const selected = new Set(targetBatchIds(assignment.id));
  const everyone = selected.size === 0;

  return `
    <article class="delivery-card" data-assignment-id="${assignment.id}">
      <div class="delivery-head">
        <div>
          <h3>${esc(assignment.title)}</h3>
          <p class="muted">${esc(assignment.assignment_key)}</p>
        </div>
        <span class="delivery-mode ${everyone ? 'everyone' : 'targeted'}">${everyone ? 'Everyone' : `${selected.size} batch${selected.size === 1 ? '' : 'es'}`}</span>
      </div>

      <div class="batch-check-grid">
        ${state.batches.length ? state.batches.map((batch) => `
          <label class="batch-check">
            <input type="checkbox" class="target-checkbox" data-assignment="${assignment.id}" data-batch="${batch.id}" ${selected.has(batch.id) ? 'checked' : ''} />
            <span>${esc(batch.name)}</span>
          </label>`).join('') : `<p class="empty-inline">Create a batch first. Until then this published question is visible to everyone.</p>`}
      </div>

      <p class="delivery-help">${everyone
        ? 'No batch selected → every authenticated student can receive this published question.'
        : 'Only students enrolled in the selected batches can receive this question.'}</p>
    </article>`;
}

function renderPage() {
  const canCreateBatch = state.profile?.role === 'super_admin';
  const profileName = state.profile?.full_name || state.profile?.email || 'Teacher';

  app.innerHTML = `
    <div class="dashboard-shell batch-shell">
      <header class="topbar batch-topbar">
        <div>
          <p class="eyebrow">Kaveri Technologies</p>
          <h1>Batch Manager</h1>
          <div class="batch-nav">
            <a href="/" class="secondary small nav-link">← Submissions & Questions</a>
          </div>
        </div>
        <div class="teacher-block">
          <div class="teacher-copy">
            <strong>${esc(profileName)}</strong>
            <span>${esc(state.profile?.role || '')}</span>
          </div>
          <button id="refresh" class="icon-button" title="Refresh">↻</button>
          <button id="logout" class="secondary small">Sign out</button>
        </div>
      </header>

      <section class="batch-metrics">
        <article class="metric-card"><span>Batches</span><strong>${state.batches.length}</strong></article>
        <article class="metric-card"><span>Student accounts</span><strong>${state.students.length}</strong></article>
        <article class="metric-card"><span>Published questions</span><strong>${state.assignments.filter((assignment) => assignment.is_published).length}</strong></article>
        <article class="metric-card"><span>Targeted questions</span><strong>${new Set(state.targets.map((target) => target.assignment_id)).size}</strong></article>
      </section>

      ${canCreateBatch ? `
        <section class="panel batch-create-panel">
          <div class="section-heading">
            <div><p class="eyebrow">Setup</p><h2>Create batch</h2></div>
          </div>
          <form id="create-batch-form" class="create-batch-form">
            <label>Batch name<input id="batch-name" required placeholder="Example: Python Batch 1" /></label>
            <label>Maximum students<input id="batch-max" type="number" min="1" value="50" /></label>
            <label class="wide-field">Description<input id="batch-description" placeholder="Example: Morning Python beginner batch" /></label>
            <button class="primary" type="submit">+ Create Batch</button>
          </form>
          <p id="batch-message" class="fineprint"></p>
        </section>` : `
        <section class="panel faculty-note">
          <strong>Batch creation is controlled by a super-admin.</strong>
          <span>You can manage batches assigned to your faculty account.</span>
        </section>`}

      <section class="batch-section">
        <div class="section-heading">
          <div><p class="eyebrow">Students</p><h2>Batch membership</h2></div>
          <p class="muted">Students can be added here manually or join themselves with the batch code.</p>
        </div>
        <div class="batch-grid">
          ${state.batches.length ? state.batches.map(batchCard).join('') : `<section class="panel empty-batches"><h3>No batches yet</h3><p class="muted">Create your first batch above, then add students.</p></section>`}
        </div>
      </section>

      <section class="batch-section">
        <div class="section-heading">
          <div><p class="eyebrow">Delivery</p><h2>Assign questions to batches</h2></div>
          <p class="muted">No selection means everyone. Selecting batches restricts the question to those students.</p>
        </div>
        <div class="delivery-grid">
          ${state.assignments.filter((assignment) => assignment.is_published).length
            ? state.assignments.filter((assignment) => assignment.is_published).map(assignmentRow).join('')
            : `<section class="panel empty-batches"><h3>No published questions</h3><p class="muted">Publish a question from the Question Bank first.</p></section>`}
        </div>
      </section>
    </div>`;

  document.querySelector('#logout').addEventListener('click', logout);
  document.querySelector('#refresh').addEventListener('click', loadData);
  document.querySelector('#create-batch-form')?.addEventListener('submit', createBatch);
  document.querySelectorAll('.add-student').forEach((button) => button.addEventListener('click', addStudent));
  document.querySelectorAll('.remove-student').forEach((button) => button.addEventListener('click', removeStudent));
  document.querySelectorAll('.delete-batch').forEach((button) => button.addEventListener('click', deleteBatch));
  document.querySelectorAll('.generate-code').forEach((button) => button.addEventListener('click', generateCode));
  document.querySelectorAll('.copy-code').forEach((button) => button.addEventListener('click', copyCode));
  document.querySelectorAll('.target-checkbox').forEach((checkbox) => checkbox.addEventListener('change', toggleTarget));
}

async function logout() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  renderLogin();
}

async function createBatch(event) {
  event.preventDefault();
  const message = document.querySelector('#batch-message');
  const name = document.querySelector('#batch-name').value.trim();
  const description = document.querySelector('#batch-description').value.trim();
  const maxStudents = Number(document.querySelector('#batch-max').value || 50);
  if (!name) return;

  message.textContent = 'Creating…';
  const { error } = await supabase.from('batches').insert({
    name,
    description: description || null,
    max_students: maxStudents,
    status: 'active',
    created_by: state.session.user.id,
    updated_at: new Date().toISOString()
  });

  if (error) {
    message.textContent = error.message;
    return;
  }

  message.textContent = 'Batch created.';
  await loadData();
}

async function generateCode(event) {
  const button = event.currentTarget;
  const batchId = button.dataset.batch;
  const code = generateJoinCodeValue();
  button.disabled = true;
  button.textContent = 'Generating…';

  const { error } = await supabase
    .from('batches')
    .update({ join_code: code, updated_at: new Date().toISOString() })
    .eq('id', batchId);

  if (error) {
    button.disabled = false;
    button.textContent = 'Generate code';
    return alert(error.message);
  }

  await loadData();
}

async function copyCode(event) {
  const code = event.currentTarget.dataset.code;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    window.prompt('Copy this batch code:', code);
  }
}

async function addStudent(event) {
  const batchId = event.currentTarget.dataset.batch;
  const studentId = document.querySelector(`.student-select[data-batch="${batchId}"]`)?.value;
  if (!studentId) return;

  const existing = state.memberships.find(
    (membership) => membership.batch_id === batchId && membership.student_id === studentId
  );

  const response = existing
    ? await supabase.from('batch_students').update({ status: 'active' }).eq('id', existing.id)
    : await supabase.from('batch_students').insert({ batch_id: batchId, student_id: studentId, status: 'active' });

  if (response.error) return alert(response.error.message);
  await loadData();
}

async function removeStudent(event) {
  const batchId = event.currentTarget.dataset.batch;
  const studentId = event.currentTarget.dataset.student;
  const membership = state.memberships.find(
    (item) => item.batch_id === batchId && item.student_id === studentId && item.status === 'active'
  );
  if (!membership) return;

  const { error } = await supabase
    .from('batch_students')
    .update({ status: 'inactive' })
    .eq('id', membership.id);

  if (error) return alert(error.message);
  await loadData();
}

async function deleteBatch(event) {
  if (state.profile?.role !== 'super_admin') return;

  const batchId = event.currentTarget.dataset.batch;
  const batchName = state.batches.find((batch) => batch.id === batchId)?.name || 'this batch';

  if (!window.confirm(`Delete "${batchName}"?\n\nStudent accounts, submissions and questions will NOT be deleted.`)) {
    return;
  }

  // batch_students and coding_vscode_assignment_batches both have ON DELETE CASCADE.
  const { error } = await supabase.from('batches').delete().eq('id', batchId);
  if (error) return alert(error.message);

  await loadData();
}

async function toggleTarget(event) {
  const checkbox = event.currentTarget;
  const assignmentId = checkbox.dataset.assignment;
  const batchId = checkbox.dataset.batch;

  checkbox.disabled = true;

  const { error } = await supabase.rpc('set_coding_vscode_assignment_target', {
    p_assignment_id: assignmentId,
    p_batch_id: batchId,
    p_enabled: checkbox.checked
  });

  if (error) {
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    return alert(error.message);
  }

  await loadData();
}

async function runQuery(label, query) {
  renderLoading(label, 'This step has an 8-second timeout.');
  const result = await withTimeout(query, label);
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadData() {
  try {
    state.batches = await runQuery(
      '1/5 Loading batches…',
      supabase.from('batches').select('id,name,description,status,max_students,join_code,created_at,updated_at').order('created_at')
    );

    state.students = await runQuery(
      '2/5 Loading student accounts…',
      supabase.from('profiles').select('id,email,full_name,role,is_active').eq('role', 'student').eq('is_active', true).order('full_name')
    );

    state.memberships = await runQuery(
      '3/5 Loading batch memberships…',
      supabase.from('batch_students').select('id,batch_id,student_id,status,enrolled_at')
    );

    state.assignments = await runQuery(
      '4/5 Loading assignments…',
      supabase.from('coding_vscode_assignments').select('id,assignment_key,title,is_published,updated_at').order('title')
    );

    // Do not query coding_vscode_assignment_batches through its table REST endpoint.
    // Staff use this SECURITY DEFINER RPC to avoid the problematic RLS endpoint path.
    state.targets = await runQuery(
      '5/5 Loading assignment targets…',
      supabase.rpc('get_coding_vscode_assignment_targets')
    );

    renderPage();
  } catch (error) {
    console.error('[Kaveri Batch Manager] load failed', error);
    state.error = error.message || String(error);
    renderError();
  }
}

async function loadPage() {
  renderLoading('Checking teacher session…', 'Batch Manager login');

  try {
    const sessionResult = await withTimeout(
      supabase.auth.getSession(),
      'Reading teacher session'
    );

    if (sessionResult.error) throw sessionResult.error;
    state.session = sessionResult.data?.session || null;
    if (!state.session) return renderLogin();

    renderLoading('Loading teacher profile…', 'Verifying teacher access');

    const profileResult = await withTimeout(
      supabase
        .from('profiles')
        .select('id,email,full_name,role,is_active')
        .eq('id', state.session.user.id)
        .maybeSingle(),
      'Loading teacher profile'
    );

    if (profileResult.error) throw profileResult.error;
    state.profile = profileResult.data;

    if (
      !state.profile ||
      state.profile.is_active === false ||
      !['faculty', 'super_admin'].includes(state.profile.role)
    ) {
      return renderDenied();
    }

    await loadData();
  } catch (error) {
    console.error('[Kaveri Batch Manager] startup failed', error);
    state.error = error.message || String(error);
    renderError();
  }
}

loadPage();
