import { createClient } from '@supabase/supabase-js';
import './styles.css';

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const app = document.querySelector('#app');

const state = {
  session: null,
  profile: null,
  submissions: [],
  search: '',
  status: 'all',
  assignment: 'all',
  selectedId: null,
  loading: true,
  error: ''
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function scoreLabel(row) {
  const score = row.teacher_score ?? row.provisional_visible_score ?? 0;
  return `${Number(score).toFixed(Number(score) % 1 ? 1 : 0)}/${Number(row.max_marks || 0).toFixed(0)}`;
}

function statusLabel(row) {
  if (row.review_status === 'needs_changes') return 'Needs changes';
  if (row.review_status === 'reviewed') return 'Reviewed';
  if (row.visible_tests_passed === row.visible_tests_total) return 'Tests passed';
  return 'Partial';
}

function computeAttempts(rows) {
  const counts = new Map();
  const ascending = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const row of ascending) {
    const key = `${row.student_id}:${row.assignment_key}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    row.attempt_number = count;
  }
  return rows;
}

function filteredRows() {
  const query = state.search.trim().toLowerCase();
  return state.submissions.filter((row) => {
    const matchesSearch = !query || [
      row.student_name_snapshot,
      row.assignment_title,
      row.assignment_key,
      row.language
    ].some((value) => String(value || '').toLowerCase().includes(query));

    const matchesAssignment = state.assignment === 'all' || row.assignment_key === state.assignment;
    const label = statusLabel(row).toLowerCase().replaceAll(' ', '_');
    const matchesStatus = state.status === 'all' || label === state.status;

    return matchesSearch && matchesAssignment && matchesStatus;
  });
}

function assignmentOptions() {
  const map = new Map();
  for (const row of state.submissions) {
    map.set(row.assignment_key, row.assignment_title);
  }
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function dashboardMetrics() {
  const rows = state.submissions;
  const students = new Set(rows.map((row) => row.student_id));
  const passed = rows.filter((row) => row.visible_tests_total > 0 && row.visible_tests_passed === row.visible_tests_total).length;
  const reviewed = rows.filter((row) => row.review_status === 'reviewed').length;
  return {
    attempts: rows.length,
    students: students.size,
    passRate: rows.length ? Math.round((passed / rows.length) * 100) : 0,
    reviewed
  };
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">K</div>
        <p class="eyebrow">Kaveri Technologies</p>
        <h1>Coding Teacher Dashboard</h1>
        <p class="muted">Review VS Code submissions, test results, marks and feedback from one place.</p>
        <button id="google-login" class="primary wide">Continue with Google</button>
        <p class="fineprint">Use your Kaveri faculty or super-admin Google account.</p>
      </section>
    </main>
  `;

  document.querySelector('#google-login').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) alert(error.message);
  });
}

function renderAccessDenied() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">!</div>
        <p class="eyebrow">Kaveri Coding</p>
        <h1>Teacher access required</h1>
        <p class="muted">This dashboard is available only to faculty and super-admin accounts.</p>
        <button id="logout" class="secondary wide">Sign out</button>
      </section>
    </main>
  `;
  document.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
}

function renderError() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">!</div>
        <h1>Could not load dashboard</h1>
        <p class="muted">${escapeHtml(state.error)}</p>
        <button id="retry" class="primary wide">Retry</button>
      </section>
    </main>
  `;
  document.querySelector('#retry').addEventListener('click', loadDashboard);
}

function renderLoading() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card loading-card">
        <div class="spinner"></div>
        <h2>Loading Kaveri Coding…</h2>
      </section>
    </main>
  `;
}

function renderDashboard() {
  const rows = filteredRows();
  const metrics = dashboardMetrics();
  const assignments = assignmentOptions();
  const profileName = state.profile?.full_name || state.profile?.email || 'Teacher';

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Kaveri Technologies</p>
          <h1>Coding Submissions</h1>
        </div>
        <div class="teacher-block">
          <div class="teacher-copy">
            <strong>${escapeHtml(profileName)}</strong>
            <span>${escapeHtml(state.profile?.role || '')}</span>
          </div>
          <button id="refresh" class="icon-button" title="Refresh">↻</button>
          <button id="logout" class="secondary small">Sign out</button>
        </div>
      </header>

      <section class="metrics-grid">
        <article class="metric-card"><span>Total attempts</span><strong>${metrics.attempts}</strong></article>
        <article class="metric-card"><span>Students</span><strong>${metrics.students}</strong></article>
        <article class="metric-card"><span>Visible test pass rate</span><strong>${metrics.passRate}%</strong></article>
        <article class="metric-card"><span>Reviewed</span><strong>${metrics.reviewed}</strong></article>
      </section>

      <section class="panel">
        <div class="filters">
          <input id="search" class="search" type="search" placeholder="Search student or assignment…" value="${escapeHtml(state.search)}" />
          <select id="assignment-filter">
            <option value="all">All assignments</option>
            ${assignments.map(([key, title]) => `<option value="${escapeHtml(key)}" ${state.assignment === key ? 'selected' : ''}>${escapeHtml(title)}</option>`).join('')}
          </select>
          <select id="status-filter">
            <option value="all" ${state.status === 'all' ? 'selected' : ''}>All statuses</option>
            <option value="tests_passed" ${state.status === 'tests_passed' ? 'selected' : ''}>Tests passed</option>
            <option value="partial" ${state.status === 'partial' ? 'selected' : ''}>Partial</option>
            <option value="reviewed" ${state.status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
            <option value="needs_changes" ${state.status === 'needs_changes' ? 'selected' : ''}>Needs changes</option>
          </select>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Assignment</th>
                <th>Attempt</th>
                <th>Tests</th>
                <th>Mark</th>
                <th>Status</th>
                <th>Submitted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.student_name_snapshot)}</strong></td>
                  <td>${escapeHtml(row.assignment_title)}</td>
                  <td>#${row.attempt_number || 1}</td>
                  <td><span class="tests ${row.visible_tests_passed === row.visible_tests_total ? 'success' : 'warning'}">${row.visible_tests_passed}/${row.visible_tests_total}</span></td>
                  <td>${scoreLabel(row)}</td>
                  <td><span class="status-pill status-${escapeHtml(row.review_status || 'unreviewed')}">${escapeHtml(statusLabel(row))}</span></td>
                  <td>${escapeHtml(formatDate(row.submitted_at || row.created_at))}</td>
                  <td><button class="secondary small view-submission" data-id="${row.id}">Review</button></td>
                </tr>
              `).join('') : `<tr><td colspan="8" class="empty">No submissions match these filters.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div id="drawer-root"></div>
  `;

  document.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
  document.querySelector('#refresh').addEventListener('click', loadSubmissions);
  document.querySelector('#search').addEventListener('input', (event) => {
    state.search = event.target.value;
    renderDashboard();
    const input = document.querySelector('#search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  document.querySelector('#assignment-filter').addEventListener('change', (event) => {
    state.assignment = event.target.value;
    renderDashboard();
  });
  document.querySelector('#status-filter').addEventListener('change', (event) => {
    state.status = event.target.value;
    renderDashboard();
  });
  document.querySelectorAll('.view-submission').forEach((button) => {
    button.addEventListener('click', () => openSubmission(button.dataset.id));
  });
}

function testResultsHtml(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return '<p class="muted">No test details were stored.</p>';
  return list.map((result) => `
    <article class="test-card ${result.passed ? 'test-pass' : 'test-fail'}">
      <div class="test-title"><strong>Test ${result.testNumber}</strong><span>${result.passed ? 'PASS' : 'FAIL'}</span></div>
      <dl>
        <div><dt>Input</dt><dd>${escapeHtml(result.input ?? '')}</dd></div>
        <div><dt>Expected</dt><dd>${escapeHtml(result.expected ?? '')}</dd></div>
        <div><dt>Received</dt><dd>${escapeHtml(result.received ?? '(no output)')}</dd></div>
      </dl>
    </article>
  `).join('');
}

function openSubmission(id) {
  const row = state.submissions.find((item) => item.id === id);
  if (!row) return;
  state.selectedId = id;

  const root = document.querySelector('#drawer-root');
  root.innerHTML = `
    <div class="drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="drawer" aria-label="Submission review">
      <div class="drawer-head">
        <div>
          <p class="eyebrow">Attempt #${row.attempt_number || 1}</p>
          <h2>${escapeHtml(row.student_name_snapshot)}</h2>
          <p class="muted">${escapeHtml(row.assignment_title)}</p>
        </div>
        <button id="close-drawer" class="icon-button">×</button>
      </div>

      <div class="drawer-meta">
        <span>${row.visible_tests_passed}/${row.visible_tests_total} visible tests</span>
        <span>${escapeHtml(formatDate(row.submitted_at || row.created_at))}</span>
      </div>

      <section class="drawer-section">
        <div class="section-title"><h3>Submitted code</h3><button id="copy-code" class="secondary small">Copy</button></div>
        <pre><code>${escapeHtml(row.code || '')}</code></pre>
      </section>

      <section class="drawer-section">
        <h3>Test results</h3>
        <div class="test-grid">${testResultsHtml(row.test_results)}</div>
      </section>

      <section class="drawer-section review-form">
        <h3>Teacher review</h3>
        <label>Mark <span class="muted">(max ${Number(row.max_marks || 0).toFixed(0)})</span>
          <input id="teacher-score" type="number" min="0" max="${Number(row.max_marks || 0)}" step="0.5" value="${row.teacher_score ?? row.provisional_visible_score ?? ''}" />
        </label>
        <label>Status
          <select id="review-status">
            <option value="reviewed" ${row.review_status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
            <option value="needs_changes" ${row.review_status === 'needs_changes' ? 'selected' : ''}>Needs changes</option>
            <option value="unreviewed" ${row.review_status === 'unreviewed' ? 'selected' : ''}>Unreviewed</option>
          </select>
        </label>
        <label>Feedback
          <textarea id="teacher-feedback" rows="5" placeholder="Example: Good solution. Try using a clearer variable name next time.">${escapeHtml(row.teacher_feedback || '')}</textarea>
        </label>
        <button id="save-review" class="primary">Save review</button>
        <p id="save-message" class="fineprint"></p>
      </section>
    </aside>
  `;

  const close = () => { root.innerHTML = ''; state.selectedId = null; };
  document.querySelector('#close-drawer').addEventListener('click', close);
  document.querySelector('#drawer-backdrop').addEventListener('click', close);
  document.querySelector('#copy-code').addEventListener('click', async () => {
    await navigator.clipboard.writeText(row.code || '');
    document.querySelector('#copy-code').textContent = 'Copied';
  });
  document.querySelector('#save-review').addEventListener('click', () => saveReview(row));
}

async function saveReview(row) {
  const button = document.querySelector('#save-review');
  const message = document.querySelector('#save-message');
  const score = Number(document.querySelector('#teacher-score').value);
  const max = Number(row.max_marks || 0);
  const feedback = document.querySelector('#teacher-feedback').value.trim();
  const reviewStatus = document.querySelector('#review-status').value;

  if (!Number.isFinite(score) || score < 0 || score > max) {
    message.textContent = `Mark must be between 0 and ${max}.`;
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving…';
  message.textContent = '';

  const { error } = await supabase
    .from('coding_vscode_submissions')
    .update({
      teacher_score: score,
      teacher_feedback: feedback || null,
      review_status: reviewStatus,
      reviewed_at: new Date().toISOString(),
      reviewed_by: state.session.user.id
    })
    .eq('id', row.id);

  if (error) {
    message.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Save review';
    return;
  }

  message.textContent = 'Review saved.';
  await loadSubmissions(false);
  const refreshed = state.submissions.find((item) => item.id === row.id);
  if (refreshed) openSubmission(refreshed.id);
}

async function loadSubmissions(rerender = true) {
  const { data, error } = await supabase
    .from('coding_vscode_submissions')
    .select('id,student_id,student_name_snapshot,assignment_key,assignment_title,language,file_name,code,visible_tests_passed,visible_tests_total,provisional_visible_score,max_marks,test_results,submitted_at,created_at,teacher_score,teacher_feedback,review_status,reviewed_at,reviewed_by')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  state.submissions = computeAttempts(data || []);
  if (rerender) renderDashboard();
}

async function loadDashboard() {
  state.loading = true;
  state.error = '';
  renderLoading();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    state.session = session;
    if (!session) {
      state.loading = false;
      renderLogin();
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id,email,full_name,role,is_active')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    state.profile = profile;

    if (!profile || profile.is_active === false || !['faculty', 'super_admin'].includes(profile.role)) {
      state.loading = false;
      renderAccessDenied();
      return;
    }

    await loadSubmissions(false);
    state.loading = false;
    renderDashboard();
  } catch (error) {
    state.loading = false;
    state.error = error.message || String(error);
    renderError();
  }
}

supabase.auth.onAuthStateChange(() => {
  setTimeout(loadDashboard, 0);
});

loadDashboard();
