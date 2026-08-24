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
  questions: [],
  view: 'submissions',
  search: '',
  questionSearch: '',
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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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

function filteredQuestions() {
  const query = state.questionSearch.trim().toLowerCase();
  if (!query) return state.questions;
  return state.questions.filter((question) => [
    question.title,
    question.assignment_key,
    question.topic,
    question.question
  ].some((value) => String(value || '').toLowerCase().includes(query)));
}

function assignmentOptions() {
  const map = new Map();
  for (const row of state.submissions) map.set(row.assignment_key, row.assignment_title);
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

function questionMetrics() {
  return {
    total: state.questions.length,
    published: state.questions.filter((q) => q.is_published).length,
    drafts: state.questions.filter((q) => !q.is_published).length,
    hiddenTests: state.questions.reduce((sum, q) => sum + q.tests.filter((t) => t.is_hidden).length, 0)
  };
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">K</div>
        <p class="eyebrow">Kaveri Technologies</p>
        <h1>Coding Teacher Dashboard</h1>
        <p class="muted">Create coding questions, review VS Code submissions, test results, marks and feedback from one place.</p>
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

function headerHtml(title) {
  const profileName = state.profile?.full_name || state.profile?.email || 'Teacher';
  return `
    <header class="topbar">
      <div class="topbar-left">
        <div>
          <p class="eyebrow">Kaveri Technologies</p>
          <h1>${escapeHtml(title)}</h1>
        </div>
        <nav class="section-tabs" aria-label="Coding dashboard sections">
          <button class="nav-tab ${state.view === 'submissions' ? 'active' : ''}" data-view="submissions">Submissions</button>
          <button class="nav-tab ${state.view === 'questions' ? 'active' : ''}" data-view="questions">Questions</button>
        </nav>
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
  `;
}

function bindCommonHeader() {
  document.querySelector('#logout')?.addEventListener('click', () => supabase.auth.signOut());
  document.querySelector('#refresh')?.addEventListener('click', async () => {
    try {
      if (state.view === 'questions') await loadQuestions();
      else await loadSubmissions();
    } catch (error) {
      alert(error.message || String(error));
    }
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderCurrentView();
    });
  });
}

function renderCurrentView() {
  if (state.view === 'questions') renderQuestions();
  else renderSubmissions();
}

function renderSubmissions() {
  const rows = filteredRows();
  const metrics = dashboardMetrics();
  const assignments = assignmentOptions();

  app.innerHTML = `
    <div class="dashboard-shell">
      ${headerHtml('Coding Submissions')}

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
            <thead><tr><th>Student</th><th>Assignment</th><th>Attempt</th><th>Tests</th><th>Mark</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
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

  bindCommonHeader();
  document.querySelector('#search').addEventListener('input', (event) => {
    state.search = event.target.value;
    renderSubmissions();
    const input = document.querySelector('#search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  document.querySelector('#assignment-filter').addEventListener('change', (event) => {
    state.assignment = event.target.value;
    renderSubmissions();
  });
  document.querySelector('#status-filter').addEventListener('change', (event) => {
    state.status = event.target.value;
    renderSubmissions();
  });
  document.querySelectorAll('.view-submission').forEach((button) => {
    button.addEventListener('click', () => openSubmission(button.dataset.id));
  });
}

function renderQuestions() {
  const questions = filteredQuestions();
  const metrics = questionMetrics();

  app.innerHTML = `
    <div class="dashboard-shell">
      ${headerHtml('Coding Question Bank')}

      <section class="metrics-grid">
        <article class="metric-card"><span>Total questions</span><strong>${metrics.total}</strong></article>
        <article class="metric-card"><span>Published</span><strong>${metrics.published}</strong></article>
        <article class="metric-card"><span>Drafts</span><strong>${metrics.drafts}</strong></article>
        <article class="metric-card"><span>Hidden tests</span><strong>${metrics.hiddenTests}</strong></article>
      </section>

      <section class="panel">
        <div class="question-toolbar">
          <input id="question-search" type="search" placeholder="Search question, topic or key…" value="${escapeHtml(state.questionSearch)}" />
          <button id="create-question" class="primary">+ Create Question</button>
        </div>
        <div class="question-note">Published questions appear in students’ VS Code after they click <strong>Refresh Assignments</strong>. Hidden tests are never sent to the extension.</div>

        <div class="table-wrap">
          <table class="question-table">
            <thead><tr><th>Question</th><th>Topic</th><th>Visible</th><th>Hidden</th><th>Marks</th><th>Status</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              ${questions.length ? questions.map((question) => {
                const visible = question.tests.filter((test) => !test.is_hidden).length;
                const hidden = question.tests.filter((test) => test.is_hidden).length;
                return `
                  <tr>
                    <td><strong>${escapeHtml(question.title)}</strong><div class="table-subtext">${escapeHtml(question.assignment_key)}</div></td>
                    <td>${escapeHtml(question.topic || 'Python')}</td>
                    <td>${visible}</td>
                    <td>${hidden}</td>
                    <td>${Number(question.marks || 0).toFixed(0)}</td>
                    <td><span class="publish-pill ${question.is_published ? 'published' : 'draft'}">${question.is_published ? 'Published' : 'Draft'}</span></td>
                    <td>${escapeHtml(formatDate(question.updated_at || question.created_at))}</td>
                    <td>
                      <div class="row-actions">
                        <button class="secondary small edit-question" data-id="${question.id}">Edit</button>
                        <button class="secondary small duplicate-question" data-id="${question.id}">Duplicate</button>
                        <button class="secondary small toggle-question" data-id="${question.id}">${question.is_published ? 'Unpublish' : 'Publish'}</button>
                        <button class="secondary small danger delete-question" data-id="${question.id}">Delete</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `<tr><td colspan="8" class="empty">No questions found. Create your first coding question.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div id="drawer-root"></div>
  `;

  bindCommonHeader();
  document.querySelector('#question-search').addEventListener('input', (event) => {
    state.questionSearch = event.target.value;
    renderQuestions();
    const input = document.querySelector('#question-search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  document.querySelector('#create-question').addEventListener('click', () => openQuestionEditor());
  document.querySelectorAll('.edit-question').forEach((button) => button.addEventListener('click', () => {
    openQuestionEditor(state.questions.find((q) => q.id === button.dataset.id));
  }));
  document.querySelectorAll('.duplicate-question').forEach((button) => button.addEventListener('click', () => {
    const original = state.questions.find((q) => q.id === button.dataset.id);
    openQuestionEditor(original, { duplicate: true });
  }));
  document.querySelectorAll('.toggle-question').forEach((button) => button.addEventListener('click', () => toggleQuestion(button.dataset.id)));
  document.querySelectorAll('.delete-question').forEach((button) => button.addEventListener('click', () => deleteQuestion(button.dataset.id)));
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

function addQuestionTestRow(container, test = {}) {
  const row = document.createElement('div');
  row.className = 'question-test-row';
  row.innerHTML = `
    <div class="test-kind ${test.is_hidden ? 'hidden' : 'visible'}">${test.is_hidden ? 'Hidden' : 'Visible'}</div>
    <label>Input
      <textarea class="test-input" rows="2" placeholder="Example: 5">${escapeHtml(test.input_text ?? '')}</textarea>
    </label>
    <label>Expected output
      <textarea class="test-expected" rows="2" placeholder="Example: 15">${escapeHtml(test.expected_output ?? '')}</textarea>
    </label>
    <label>Type
      <select class="test-visibility">
        <option value="visible" ${test.is_hidden ? '' : 'selected'}>Visible</option>
        <option value="hidden" ${test.is_hidden ? 'selected' : ''}>Hidden</option>
      </select>
    </label>
    <button type="button" class="icon-button remove-test" title="Remove test">×</button>
  `;

  const select = row.querySelector('.test-visibility');
  const badge = row.querySelector('.test-kind');
  select.addEventListener('change', () => {
    const hidden = select.value === 'hidden';
    badge.textContent = hidden ? 'Hidden' : 'Visible';
    badge.className = `test-kind ${hidden ? 'hidden' : 'visible'}`;
  });
  row.querySelector('.remove-test').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function openQuestionEditor(question, { duplicate = false } = {}) {
  const source = question || {};
  const editing = Boolean(source.id && !duplicate);
  const title = duplicate ? `${source.title} Copy` : (source.title || '');
  const tests = (source.tests || []).map((test) => ({ ...test }));

  const root = document.querySelector('#drawer-root');
  root.innerHTML = `
    <div class="drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="drawer question-drawer" aria-label="Question editor">
      <div class="drawer-head">
        <div>
          <p class="eyebrow">${editing ? 'Edit coding question' : 'New coding question'}</p>
          <h2>${editing ? escapeHtml(source.title) : 'Create Question'}</h2>
          <p class="muted">Students receive only published questions and visible test cases.</p>
        </div>
        <button id="close-drawer" class="icon-button">×</button>
      </div>

      <section class="drawer-section question-form">
        <div class="question-form-grid">
          <label>Title
            <input id="question-title" value="${escapeHtml(title)}" placeholder="Sum of Numbers 1 to N" />
          </label>
          <label>Assignment key
            <input id="question-key" value="${editing ? escapeHtml(source.assignment_key || '') : ''}" placeholder="Auto-generated from title" ${editing ? 'readonly' : ''} />
          </label>
          <label>Topic
            <input id="question-topic" value="${escapeHtml(source.topic || '')}" placeholder="Loops" />
          </label>
          <label>Marks
            <input id="question-marks" type="number" min="1" step="0.5" value="${Number(source.marks || 10)}" />
          </label>
          <label>File name
            <input id="question-file" value="${escapeHtml(source.file_name || 'main.py')}" />
          </label>
          <label>Language
            <select id="question-language"><option value="python">Python</option></select>
          </label>
        </div>

        <label>Question
          <textarea id="question-body" rows="6" placeholder="Write a Python program…">${escapeHtml(source.question || '')}</textarea>
        </label>

        <label>Starter code <span class="muted">(optional)</span>
          <textarea id="question-starter" rows="5" placeholder="# Write your solution below">${escapeHtml(source.starter_code || '')}</textarea>
        </label>

        <label class="publish-toggle">
          <input id="question-published" type="checkbox" ${source.is_published && !duplicate ? 'checked' : ''} />
          <span><strong>Publish now</strong><small>Published questions appear in student VS Code.</small></span>
        </label>
      </section>

      <section class="drawer-section">
        <div class="section-title">
          <div><h3>Test cases</h3><p class="muted compact">Visible tests are downloaded to VS Code. Hidden tests stay in Supabase.</p></div>
          <div class="button-row">
            <button id="add-visible-test" class="secondary small">+ Visible Test</button>
            <button id="add-hidden-test" class="secondary small">+ Hidden Test</button>
          </div>
        </div>
        <div id="question-tests" class="test-editor"></div>
      </section>

      <section class="drawer-section save-question-bar">
        <button id="save-question" class="primary">${editing ? 'Save Changes' : 'Create Question'}</button>
        <p id="question-message" class="fineprint"></p>
      </section>
    </aside>
  `;

  const container = document.querySelector('#question-tests');
  if (tests.length) tests.forEach((test) => addQuestionTestRow(container, test));
  else addQuestionTestRow(container, { is_hidden: false });

  const close = () => { root.innerHTML = ''; };
  document.querySelector('#close-drawer').addEventListener('click', close);
  document.querySelector('#drawer-backdrop').addEventListener('click', close);
  document.querySelector('#add-visible-test').addEventListener('click', () => addQuestionTestRow(container, { is_hidden: false }));
  document.querySelector('#add-hidden-test').addEventListener('click', () => addQuestionTestRow(container, { is_hidden: true }));
  document.querySelector('#save-question').addEventListener('click', () => saveQuestion(editing ? source.id : null));
}

async function saveQuestion(existingId) {
  const button = document.querySelector('#save-question');
  const message = document.querySelector('#question-message');
  const title = document.querySelector('#question-title').value.trim();
  const rawKey = document.querySelector('#question-key').value.trim();
  const assignmentKey = existingId ? rawKey : (rawKey || slugify(title));
  const topic = document.querySelector('#question-topic').value.trim() || 'Python';
  const marks = Number(document.querySelector('#question-marks').value);
  const fileName = document.querySelector('#question-file').value.trim() || 'main.py';
  const questionBody = document.querySelector('#question-body').value.trim();
  const starterCode = document.querySelector('#question-starter').value;
  const isPublished = document.querySelector('#question-published').checked;

  const tests = [...document.querySelectorAll('.question-test-row')].map((row, index) => ({
    input_text: row.querySelector('.test-input').value,
    expected_output: row.querySelector('.test-expected').value,
    is_hidden: row.querySelector('.test-visibility').value === 'hidden',
    position: index + 1
  }));

  if (!title || !assignmentKey || !questionBody) {
    message.textContent = 'Title, assignment key and question are required.';
    return;
  }
  if (!Number.isFinite(marks) || marks <= 0) {
    message.textContent = 'Marks must be greater than 0.';
    return;
  }
  if (!tests.length || !tests.some((test) => !test.is_hidden)) {
    message.textContent = 'Add at least one visible test case.';
    return;
  }
  if (tests.some((test) => !String(test.expected_output).trim())) {
    message.textContent = 'Every test needs an expected output.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving…';
  message.textContent = '';

  const payload = {
    assignment_key: assignmentKey,
    title,
    topic,
    question: questionBody,
    language: 'python',
    file_name: fileName,
    starter_code: starterCode || null,
    marks,
    is_published: isPublished,
    created_by: state.session.user.id,
    updated_at: new Date().toISOString()
  };

  try {
    let assignmentId = existingId;
    if (existingId) {
      const { error } = await supabase.from('coding_vscode_assignments').update(payload).eq('id', existingId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('coding_vscode_assignments').insert(payload).select('id').single();
      if (error) throw error;
      assignmentId = data.id;
    }

    const { error: deleteError } = await supabase.from('coding_vscode_test_cases').delete().eq('assignment_id', assignmentId);
    if (deleteError) throw deleteError;

    const testPayload = tests.map((test) => ({ ...test, assignment_id: assignmentId }));
    const { error: testError } = await supabase.from('coding_vscode_test_cases').insert(testPayload);
    if (testError) throw testError;

    message.textContent = isPublished ? 'Saved and published.' : 'Saved as draft.';
    await loadQuestions(false);
    setTimeout(() => {
      document.querySelector('#drawer-root').innerHTML = '';
      renderQuestions();
    }, 350);
  } catch (error) {
    message.textContent = error.message || String(error);
    button.disabled = false;
    button.textContent = existingId ? 'Save Changes' : 'Create Question';
  }
}

async function toggleQuestion(id) {
  const question = state.questions.find((item) => item.id === id);
  if (!question) return;
  const { error } = await supabase
    .from('coding_vscode_assignments')
    .update({ is_published: !question.is_published, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return alert(error.message);
  await loadQuestions();
}

async function deleteQuestion(id) {
  const question = state.questions.find((item) => item.id === id);
  if (!question) return;
  if (!window.confirm(`Delete "${question.title}"? Existing student submissions will remain, but the question and its test cases will be removed.`)) return;

  const { error: testsError } = await supabase.from('coding_vscode_test_cases').delete().eq('assignment_id', id);
  if (testsError) return alert(testsError.message);
  const { error } = await supabase.from('coding_vscode_assignments').delete().eq('id', id);
  if (error) return alert(error.message);
  await loadQuestions();
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
  if (rerender) renderSubmissions();
}

async function loadQuestions(rerender = true) {
  const { data: questions, error } = await supabase
    .from('coding_vscode_assignments')
    .select('id,assignment_key,title,topic,question,language,file_name,starter_code,marks,is_published,created_by,created_at,updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  let tests = [];
  const ids = (questions || []).map((question) => question.id);
  if (ids.length) {
    const { data: testRows, error: testError } = await supabase
      .from('coding_vscode_test_cases')
      .select('id,assignment_id,input_text,expected_output,is_hidden,position,created_at')
      .in('assignment_id', ids)
      .order('position', { ascending: true });
    if (testError) throw testError;
    tests = testRows || [];
  }

  state.questions = (questions || []).map((question) => ({
    ...question,
    tests: tests.filter((test) => test.assignment_id === question.id)
  }));

  if (rerender) renderQuestions();
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

    await Promise.all([loadSubmissions(false), loadQuestions(false)]);
    state.loading = false;
    renderCurrentView();
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
