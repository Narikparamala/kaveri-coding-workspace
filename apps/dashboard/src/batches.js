import { createClient } from '@supabase/supabase-js';
import './styles.css';
import './batches.css';

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const app = document.querySelector('#app');

const state = {
  session: null,
  profile: null,
  batches: [],
  students: [],
  memberships: [],
  assignments: [],
  targets: [],
  loading: true,
  error: ''
};

let pageLoadInFlight = false;
let initialPageLoadComplete = false;

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
      options: { redirectTo: window.location.origin + '/batches.html' }
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
  document.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
}

function renderLoading() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card loading-card">
        <div class="spinner"></div>
        <h2>Loading batches…</h2>
      </section>
    </main>`;
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
  document.querySelector('#retry').addEventListener('click', () => loadPage({ force: true }));
}

function activeMemberships(batchId) {
  return state.memberships.filter((m) => m.batch_id === batchId && m.status === 'active');
}

function studentById(id) {
  return state.students.find((s) => s.id === id);
}

function targetBatchIds(assignmentId) {
  return state.targets.filter((t) => t.assignment_id === assignmentId).map((t) => t.batch_id);
}

function batchCard(batch) {
  const members = activeMemberships(batch.id);
  const memberIds = new Set(members.map((m) => m.student_id));
  const available = state.students.filter((s) => !memberIds.has(s.id));
  const canDelete = state.profile?.role === 'super_admin';

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
          ${canDelete ? `<button class="delete-batch" data-batch="${batch.id}" data-name="${esc(batch.name)}" title="Delete batch">Delete batch</button>` : ''}
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
      <p class="delivery-help">${everyone ? 'No batch selected → every authenticated student can receive this published question.' : 'Only students enrolled in the selected batches can receive this question.'}</p>
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
          <div class="teacher-copy"><strong>${esc(profileName)}</strong><span>${esc(state.profile?.role || '')}</span></div>
          <button id="refresh" class="icon-button" title="Refresh">↻</button>
          <button id="logout" class="secondary small">Sign out</button>
        </div>
      </header>

      <section class="batch-metrics">
        <article class="metric-card"><span>Batches</span><strong>${state.batches.length}</strong></article>
        <article class="metric-card"><span>Student accounts</span><strong>${state.students.length}</strong></article>
        <article class="metric-card"><span>Published questions</span><strong>${state.assignments.filter((a) => a.is_published).length}</strong></article>
        <article class="metric-card"><span>Targeted questions</span><strong>${new Set(state.targets.map((t) => t.assignment_id)).size}</strong></article>
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
        <section class="panel faculty-note"><strong>Batch creation is controlled by a super-admin.</strong><span>You can manage batches assigned to your faculty account.</span></section>`}

      <section class="batch-section">
        <div class="section-heading">
          <div><p class="eyebrow">Students</p><h2>Batch membership</h2></div>
          <p class="muted">Students must have a Kaveri account before you can enroll them.</p>
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
          ${state.assignments.filter((a) => a.is_published).length
            ? state.assignments.filter((a) => a.is_published).map(assignmentRow).join('')
            : `<section class="panel empty-batches"><h3>No published questions</h3><p class="muted">Publish a question from the Question Bank first.</p></section>`}
        </div>
      </section>
    </div>`;

  document.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
  document.querySelector('#refresh').addEventListener('click', loadData);

  document.querySelector('#create-batch-form')?.addEventListener('submit', createBatch);
  document.querySelectorAll('.add-student').forEach((button) => button.addEventListener('click', addStudent));
  document.querySelectorAll('.remove-student').forEach((button) => button.addEventListener('click', removeStudent));
  document.querySelectorAll('.delete-batch').forEach((button) => button.addEventListener('click', deleteBatch));
  document.querySelectorAll('.target-checkbox').forEach((checkbox) => checkbox.addEventListener('change', toggleTarget));
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

async function addStudent(event) {
  const batchId = event.currentTarget.dataset.batch;
  const select = document.querySelector(`.student-select[data-batch="${batchId}"]`);
  const studentId = select?.value;
  if (!studentId) return;

  const existing = state.memberships.find((m) => m.batch_id === batchId && m.student_id === studentId);
  let error;
  if (existing) {
    ({ error } = await supabase.from('batch_students').update({ status: 'active' }).eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('batch_students').insert({ batch_id: batchId, student_id: studentId, status: 'active' }));
  }

  if (error) return alert(error.message);
  await loadData();
}

async function removeStudent(event) {
  const batchId = event.currentTarget.dataset.batch;
  const studentId = event.currentTarget.dataset.student;
  const membership = state.memberships.find((m) => m.batch_id === batchId && m.student_id === studentId && m.status === 'active');
  if (!membership) return;

  const { error } = await supabase.from('batch_students').update({ status: 'inactive' }).eq('id', membership.id);
  if (error) return alert(error.message);
  await loadData();
}

async function deleteBatch(event) {
  if (state.profile?.role !== 'super_admin') return;

  const button = event.currentTarget;
  const batchId = button.dataset.batch;
  const batch = state.batches.find((item) => item.id === batchId);
  const batchName = batch?.name || button.dataset.name || 'this batch';
  const memberCount = activeMemberships(batchId).length;
  const targetCount = state.targets.filter((target) => target.batch_id === batchId).length;

  const confirmed = window.confirm(
    `Delete "${batchName}"?\n\n` +
    `${memberCount} active student membership${memberCount === 1 ? '' : 's'} and ${targetCount} question assignment${targetCount === 1 ? '' : 's'} will be removed from this batch.\n\n` +
    'Student accounts, submitted work and questions will NOT be deleted.'
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Deleting…';

  try {
    const targetDelete = await supabase.from('coding_vscode_assignment_batches').delete().eq('batch_id', batchId);
    if (targetDelete.error) throw targetDelete.error;

    const membershipDelete = await supabase.from('batch_students').delete().eq('batch_id', batchId);
    if (membershipDelete.error) throw membershipDelete.error;

    const batchDelete = await supabase.from('batches').delete().eq('id', batchId);
    if (batchDelete.error) throw batchDelete.error;

    await loadData();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Delete batch';
    alert(`Could not delete batch: ${error.message || error}`);
  }
}

async function toggleTarget(event) {
  const assignmentId = event.currentTarget.dataset.assignment;
  const batchId = event.currentTarget.dataset.batch;
  const checked = event.currentTarget.checked;

  if (checked) {
    const { error } = await supabase.from('coding_vscode_assignment_batches').insert({ assignment_id: assignmentId, batch_id: batchId });
    if (error) {
      event.currentTarget.checked = false;
      return alert(error.message);
    }
  } else {
    const { error } = await supabase
      .from('coding_vscode_assignment_batches')
      .delete()
      .eq('assignment_id', assignmentId)
      .eq('batch_id', batchId);
    if (error) {
      event.currentTarget.checked = true;
      return alert(error.message);
    }
  }

  await loadData();
}

async function loadData() {
  try {
    const [batchesRes, studentsRes, membershipsRes, assignmentsRes, targetsRes] = await Promise.all([
      supabase.from('batches').select('id,name,description,status,max_students,created_at,updated_at').order('created_at'),
      supabase.from('profiles').select('id,email,full_name,role,is_active').eq('role', 'student').eq('is_active', true).order('full_name'),
      supabase.from('batch_students').select('id,batch_id,student_id,status,enrolled_at'),
      supabase.from('coding_vscode_assignments').select('id,assignment_key,title,is_published,updated_at').order('title'),
      supabase.from('coding_vscode_assignment_batches').select('id,assignment_id,batch_id,created_at')
    ]);

    for (const response of [batchesRes, studentsRes, membershipsRes, assignmentsRes, targetsRes]) {
      if (response.error) throw response.error;
    }

    state.batches = batchesRes.data || [];
    state.students = studentsRes.data || [];
    state.memberships = membershipsRes.data || [];
    state.assignments = assignmentsRes.data || [];
    state.targets = targetsRes.data || [];
    renderPage();
  } catch (error) {
    state.error = error.message || String(error);
    renderError();
  }
}

async function loadPage({ force = false } = {}) {
  if (pageLoadInFlight && !force) return;
  pageLoadInFlight = true;
  state.loading = true;
  renderLoading();

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    state.session = session;

    if (!session) {
      state.profile = null;
      renderLogin();
      return;
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,role,is_active')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) throw error;

    state.profile = profile;
    if (!profile || profile.is_active === false || !['faculty', 'super_admin'].includes(profile.role)) {
      renderDenied();
      return;
    }

    await loadData();
  } catch (error) {
    state.error = error.message || String(error);
    renderError();
  } finally {
    pageLoadInFlight = false;
    initialPageLoadComplete = true;
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (!initialPageLoadComplete) return;

  if (event === 'SIGNED_OUT') {
    state.session = null;
    state.profile = null;
    renderLogin();
    return;
  }

  if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
    setTimeout(() => loadPage(), 0);
  }
});

loadPage();