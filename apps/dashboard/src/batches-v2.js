import { createClient } from '@supabase/supabase-js';
import './styles.css';
import './batches.css';

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
  health: null,
  batches: [],
  students: [],
  memberships: [],
  assignments: [],
  targets: []
};

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
        <h1>Batch Manager V2 error</h1>
        <p class="muted">${esc(error?.message || error || 'Unknown error')}</p>
        <button id="retry" class="primary wide">Retry</button>
      </section>
    </main>`;
  document.querySelector('#retry').addEventListener('click', start);
}

function withTimeout(promise, label, ms = 8000) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000} seconds`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function rest(path, options = {}) {
  const {
    method = 'GET',
    body,
    token = state.session?.access_token,
    prefer,
    timeout = 8000
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
      const message = data?.message || data?.hint || text || `${response.status} ${response.statusText}`;
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

async function checkHealth() {
  renderStatus('Connecting to Supabase…', 'Independent health check');
  const health = await rest('/rest/v1/rpc/kaveri_connection_health', {
    method: 'POST',
    body: {},
    token: null
  });
  state.health = Array.isArray(health) ? health[0] : health;
}

function renderLogin() {
  const published = state.health?.published_assignments ?? '?';
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">K</div>
        <p class="eyebrow">Kaveri Technologies</p>
        <h1>Batch Manager V2</h1>
        <p class="muted">Fresh batch manager using direct Supabase REST requests.</p>
        <div class="panel" style="margin:16px 0;padding:14px;text-align:left">
          <strong>✓ Supabase connected</strong><br />
          <span class="fineprint">${esc(published)} published coding assignment(s) detected.</span>
        </div>
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
        <p class="muted">This page is available only to active faculty and super-admin accounts.</p>
        <button id="logout" class="secondary wide">Sign out</button>
      </section>
    </main>`;
  document.querySelector('#logout').addEventListener('click', logout);
}

function activeMemberships(batchId) {
  return state.memberships.filter((m) => m.batch_id === batchId && m.status === 'active');
}

function targetBatchIds(assignmentId) {
  return state.targets.filter((t) => t.assignment_id === assignmentId).map((t) => t.batch_id);
}

function studentById(id) {
  return state.students.find((s) => s.id === id);
}

function generateJoinCodeValue() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  return `KAV-${suffix}`;
}

function batchCard(batch) {
  const members = activeMemberships(batch.id);
  const memberIds = new Set(members.map((m) => m.student_id));
  const available = state.students.filter((s) => !memberIds.has(s.id));
  const joinCode = batch.join_code || '';
  const canDelete = state.profile?.role === 'super_admin';

  return `
    <article class="batch-card">
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
        ${members.length ? members.map((m) => {
          const student = studentById(m.student_id);
          return `
            <div class="member-row">
              <div>
                <strong>${esc(student?.full_name || student?.email || 'Student')}</strong>
                <small>${esc(student?.email || '')}</small>
              </div>
              <button class="secondary small remove-student" data-membership="${m.id}">Remove</button>
            </div>`;
        }).join('') : '<p class="empty-inline">No students enrolled yet.</p>'}
      </div>

      <div class="add-student-row">
        <select class="student-select" data-batch="${batch.id}">
          <option value="">Select student…</option>
          ${available.map((s) => `<option value="${s.id}">${esc(s.full_name || s.email)}${s.email ? ` — ${esc(s.email)}` : ''}</option>`).join('')}
        </select>
        <button class="primary add-student" data-batch="${batch.id}" ${available.length ? '' : 'disabled'}>Add student</button>
      </div>
    </article>`;
}

function assignmentCard(assignment) {
  const selected = new Set(targetBatchIds(assignment.id));
  const everyone = selected.size === 0;

  return `
    <article class="delivery-card">
      <div class="delivery-head">
        <div>
          <h3>${esc(assignment.title)}</h3>
          <p class="muted">${esc(assignment.assignment_key)}</p>
        </div>
        <span class="delivery-mode ${everyone ? 'everyone' : 'targeted'}">${everyone ? 'Everyone' : `${selected.size} batch${selected.size === 1 ? '' : 'es'}`}</span>
      </div>
      <div class="batch-check-grid">
        ${state.batches.map((batch) => `
          <label class="batch-check">
            <input type="checkbox" class="target-checkbox" data-assignment="${assignment.id}" data-batch="${batch.id}" ${selected.has(batch.id) ? 'checked' : ''} />
            <span>${esc(batch.name)}</span>
          </label>`).join('') || '<p class="empty-inline">Create a batch first.</p>'}
      </div>
      <p class="delivery-help">${everyone ? 'No batch selected → every authenticated student can receive this published question.' : 'Only students enrolled in the selected batches can receive this question.'}</p>
    </article>`;
}

function renderPage() {
  const published = state.assignments.filter((a) => a.is_published);
  const profileName = state.profile?.full_name || state.profile?.email || 'Teacher';

  app.innerHTML = `
    <div class="dashboard-shell batch-shell">
      <header class="topbar batch-topbar">
        <div>
          <p class="eyebrow">Kaveri Technologies</p>
          <h1>Batch Manager V2</h1>
          <div class="batch-nav"><a href="/" class="secondary small nav-link">← Submissions & Questions</a></div>
        </div>
        <div class="teacher-block">
          <div class="teacher-copy"><strong>${esc(profileName)}</strong><span>${esc(state.profile?.role || '')}</span></div>
          <button id="refresh" class="icon-button" title="Refresh">↻</button>
          <button id="logout" class="secondary small">Sign out</button>
        </div>
      </header>

      <section class="panel" style="margin-bottom:18px">
        <strong>✓ Supabase REST connection healthy</strong>
        <span class="fineprint" style="display:block;margin-top:4px">Fresh V2 page loaded ${state.batches.length} batch(es), ${state.students.length} student account(s), ${state.targets.length} assignment target(s).</span>
      </section>

      <section class="batch-metrics">
        <article class="metric-card"><span>Batches</span><strong>${state.batches.length}</strong></article>
        <article class="metric-card"><span>Student accounts</span><strong>${state.students.length}</strong></article>
        <article class="metric-card"><span>Published questions</span><strong>${published.length}</strong></article>
        <article class="metric-card"><span>Targeted questions</span><strong>${new Set(state.targets.map((t) => t.assignment_id)).size}</strong></article>
      </section>

      ${state.profile?.role === 'super_admin' ? `
        <section class="panel batch-create-panel">
          <div class="section-heading"><div><p class="eyebrow">Setup</p><h2>Create batch</h2></div></div>
          <form id="create-batch-form" class="create-batch-form">
            <label>Batch name<input id="batch-name" required placeholder="Example: Python Madanapalle" /></label>
            <label>Maximum students<input id="batch-max" type="number" min="1" value="50" /></label>
            <label class="wide-field">Description<input id="batch-description" placeholder="Example: Madanapalle Python batch" /></label>
            <button class="primary" type="submit">+ Create Batch</button>
          </form>
          <p id="batch-message" class="fineprint"></p>
        </section>` : ''}

      <section class="batch-section">
        <div class="section-heading"><div><p class="eyebrow">Students</p><h2>Batch membership</h2></div><p class="muted">Add students manually or share a join code.</p></div>
        <div class="batch-grid">${state.batches.map(batchCard).join('') || '<section class="panel"><h3>No batches yet</h3></section>'}</div>
      </section>

      <section class="batch-section">
        <div class="section-heading"><div><p class="eyebrow">Delivery</p><h2>Assign questions to batches</h2></div><p class="muted">No selection means everyone.</p></div>
        <div class="delivery-grid">${published.map(assignmentCard).join('') || '<section class="panel"><h3>No published questions</h3></section>'}</div>
      </section>
    </div>`;

  document.querySelector('#refresh').addEventListener('click', loadData);
  document.querySelector('#logout').addEventListener('click', logout);
  document.querySelector('#create-batch-form')?.addEventListener('submit', createBatch);
  document.querySelectorAll('.generate-code').forEach((el) => el.addEventListener('click', generateCode));
  document.querySelectorAll('.copy-code').forEach((el) => el.addEventListener('click', copyCode));
  document.querySelectorAll('.add-student').forEach((el) => el.addEventListener('click', addStudent));
  document.querySelectorAll('.remove-student').forEach((el) => el.addEventListener('click', removeStudent));
  document.querySelectorAll('.delete-batch').forEach((el) => el.addEventListener('click', deleteBatch));
  document.querySelectorAll('.target-checkbox').forEach((el) => el.addEventListener('change', toggleTarget));
}

async function loadData() {
  renderStatus('1/5 Loading batches…', 'V2 direct REST');
  state.batches = await rest('/rest/v1/batches?select=id,name,description,status,max_students,join_code,created_at,updated_at&order=created_at.asc');

  renderStatus('2/5 Loading students…', 'V2 direct REST');
  state.students = await rest('/rest/v1/profiles?select=id,email,full_name,role,is_active&role=eq.student&is_active=eq.true&order=full_name.asc');

  renderStatus('3/5 Loading memberships…', 'V2 direct REST');
  state.memberships = await rest('/rest/v1/batch_students?select=id,batch_id,student_id,status,enrolled_at');

  renderStatus('4/5 Loading assignments…', 'V2 direct REST');
  state.assignments = await rest('/rest/v1/coding_vscode_assignments?select=id,assignment_key,title,is_published,updated_at&order=title.asc');

  renderStatus('5/5 Loading assignment targets…', 'V2 staff RPC via plain fetch');
  state.targets = await rest('/rest/v1/rpc/get_coding_vscode_assignment_targets', { method: 'POST', body: {} });

  renderPage();
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
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        name,
        description: description || null,
        max_students: maxStudents,
        status: 'active',
        created_by: state.session.user.id,
        updated_at: new Date().toISOString()
      }
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
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { join_code: code, updated_at: new Date().toISOString() }
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

  const existing = state.memberships.find((m) => m.batch_id === batchId && m.student_id === studentId);
  try {
    if (existing) {
      await rest(`/rest/v1/batch_students?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'active' }
      });
    } else {
      await rest('/rest/v1/batch_students', {
        method: 'POST', prefer: 'return=minimal', body: { batch_id: batchId, student_id: studentId, status: 'active' }
      });
    }
    await loadData();
  } catch (error) { alert(error.message); }
}

async function removeStudent(event) {
  const membershipId = event.currentTarget.dataset.membership;
  try {
    await rest(`/rest/v1/batch_students?id=eq.${encodeURIComponent(membershipId)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'inactive' }
    });
    await loadData();
  } catch (error) { alert(error.message); }
}

async function deleteBatch(event) {
  if (state.profile?.role !== 'super_admin') return;
  const batchId = event.currentTarget.dataset.batch;
  const batch = state.batches.find((b) => b.id === batchId);
  if (!window.confirm(`Delete "${batch?.name || 'this batch'}"?\n\nStudent accounts, submissions and questions will NOT be deleted.`)) return;

  try {
    await rest(`/rest/v1/batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: 'DELETE', prefer: 'return=minimal'
    });
    await loadData();
  } catch (error) { alert(error.message); }
}

async function toggleTarget(event) {
  const checkbox = event.currentTarget;
  const assignmentId = checkbox.dataset.assignment;
  const batchId = checkbox.dataset.batch;

  try {
    await rest('/rest/v1/rpc/set_coding_vscode_assignment_target', {
      method: 'POST',
      body: {
        p_assignment_id: assignmentId,
        p_batch_id: batchId,
        p_enabled: checkbox.checked
      }
    });
    await loadData();
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    alert(error.message);
  }
}

async function logout() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  renderLogin();
}

async function start() {
  try {
    await checkHealth();

    renderStatus('Checking Batch Manager V2 session…', 'Supabase Auth');
    const sessionResult = await withTimeout(supabase.auth.getSession(), 'Reading V2 session');
    if (sessionResult.error) throw sessionResult.error;
    state.session = sessionResult.data?.session || null;
    if (!state.session) return renderLogin();

    renderStatus('Verifying teacher account…', state.session.user.email || '');
    const profiles = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(state.session.user.id)}&select=id,email,full_name,role,is_active`);
    state.profile = profiles?.[0] || null;

    if (!state.profile || state.profile.is_active === false || !['faculty', 'super_admin'].includes(state.profile.role)) {
      return renderDenied();
    }

    await loadData();
  } catch (error) {
    console.error('[Kaveri Batch Manager V2]', error);
    renderError(error);
  }
}

start();
