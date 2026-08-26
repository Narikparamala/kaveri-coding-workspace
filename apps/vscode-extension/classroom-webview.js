const vscode = require('vscode');
const path = require('path');
const { getStoredSession } = require('./supabase');
const { fetchPublishedAssignments } = require('./assignments-api');
const { fetchMyResults } = require('./results-api');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function folderName(title) {
  return String(title || '').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function displayName(session) {
  return session?.profile?.full_name
    || session?.user?.user_metadata?.full_name
    || session?.user?.user_metadata?.name
    || session?.user?.email
    || 'Student';
}

function currentFolderName() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.basename(folder.uri.fsPath) : '';
}

function latestResultByAssignment(rows = []) {
  const map = new Map();
  const sorted = [...rows].sort((a, b) => new Date(a.created_at || a.submitted_at || 0) - new Date(b.created_at || b.submitted_at || 0));
  for (const row of sorted) map.set(row.assignment_key || row.assignment_title, row);
  return map;
}

function resultStatus(row) {
  if (!row) return { label: 'Not submitted', className: 'neutral', icon: '○' };
  if (row.review_status === 'reviewed') return { label: 'Reviewed', className: 'success', icon: '✓' };
  if (row.review_status === 'needs_changes') return { label: 'Changes requested', className: 'warning', icon: '↻' };
  if (Number(row.visible_tests_total || 0) > 0 && Number(row.visible_tests_passed || 0) === Number(row.visible_tests_total || 0)) {
    return { label: 'Tests passed', className: 'success', icon: '✓' };
  }
  return { label: 'Submitted', className: 'info', icon: '↑' };
}

class ClassroomProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.assignments = [];
    this.results = [];
    this.loading = false;
    this.error = '';
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.context.subscriptions);
    this.render();
    this.refresh({ silent: true });
  }

  async handleMessage(message) {
    try {
      switch (message?.type) {
        case 'signIn':
          await vscode.commands.executeCommand('kaveri.signIn');
          await this.refresh({ silent: true });
          break;
        case 'signOut':
          await vscode.commands.executeCommand('kaveri.signOut');
          await this.refresh({ silent: true });
          break;
        case 'joinBatch':
          await vscode.commands.executeCommand('kaveri.joinBatch');
          await this.refresh({ silent: true });
          break;
        case 'refresh':
          await this.refresh();
          break;
        case 'openAssignment': {
          const assignment = this.assignments.find((item) => item.id === message.assignmentId);
          if (assignment) await vscode.commands.executeCommand('kaveri.openAssignment', assignment);
          break;
        }
        case 'openCode':
          await vscode.commands.executeCommand('kaveri.openSolutionFile');
          break;
        case 'runTests':
          await vscode.commands.executeCommand('kaveri.runTests');
          break;
        case 'submit':
          await vscode.commands.executeCommand('kaveri.submitOnline');
          await this.refresh({ silent: true });
          break;
        case 'refreshResults':
          await this.refresh();
          break;
        default:
          break;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Kaveri Classroom: ${error.message || error}`);
    }
  }

  async refresh({ silent = false } = {}) {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.render();

    try {
      const session = await getStoredSession(this.context);
      if (!session) {
        this.assignments = [];
        this.results = [];
        return;
      }

      const [assignmentsResult, resultsResult] = await Promise.allSettled([
        fetchPublishedAssignments(this.context),
        fetchMyResults(this.context)
      ]);

      this.assignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : [];
      this.results = resultsResult.status === 'fulfilled' ? resultsResult.value : [];

      if (assignmentsResult.status === 'rejected') {
        this.error = assignmentsResult.reason?.message || 'Could not load assignments.';
      }

      if (!silent && !this.error) {
        vscode.window.showInformationMessage(`Kaveri: Classroom refreshed — ${this.assignments.length} assignment${this.assignments.length === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      this.error = error.message || String(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async render() {
    if (!this.view) return;
    const session = await getStoredSession(this.context);
    const batchName = this.context.globalState.get('kaveri.batchName', '');
    const currentFolder = currentFolderName();
    const currentAssignment = this.assignments.find((item) => folderName(item.title) === currentFolder);
    const resultMap = latestResultByAssignment(this.results);
    this.view.webview.html = this.html({ session, batchName, currentAssignment, resultMap });
  }

  html({ session, batchName, currentAssignment, resultMap }) {
    const nonce = Math.random().toString(36).slice(2);
    const csp = this.view.webview.cspSource;
    const signedIn = Boolean(session);
    const name = displayName(session);
    const email = session?.user?.email || '';
    const reviewed = this.results.filter((row) => row.review_status === 'reviewed').length;
    const submittedKeys = new Set(this.results.map((row) => row.assignment_key || row.assignment_title));

    const assignmentCards = this.assignments.length
      ? this.assignments.map((assignment) => {
          const latest = resultMap.get(assignment.id) || resultMap.get(assignment.title);
          const status = resultStatus(latest);
          const isCurrent = currentAssignment?.id === assignment.id;
          return `
            <article class="assignment-card ${isCurrent ? 'current' : ''}">
              <div class="card-top">
                <span class="topic">${escapeHtml(assignment.topic || 'Python')}</span>
                <span class="marks">${Number(assignment.marks || 0)} marks</span>
              </div>
              <h3>${escapeHtml(assignment.title)}</h3>
              <p class="question-preview">${escapeHtml(assignment.question || '').slice(0, 150)}${String(assignment.question || '').length > 150 ? '…' : ''}</p>
              <div class="status ${status.className}"><span>${status.icon}</span>${escapeHtml(status.label)}</div>
              <button class="primary" data-action="openAssignment" data-id="${escapeHtml(assignment.id)}">${isCurrent ? 'Continue Coding' : 'Start Assignment'}</button>
            </article>`;
        }).join('')
      : `<div class="empty-state"><div class="empty-icon">📘</div><strong>No assignments available yet</strong><span>Your teacher will unlock class questions when they are ready.</span></div>`;

    const currentSection = currentAssignment
      ? `
        <section class="current-work">
          <div class="section-label">CURRENT WORK</div>
          <h2>${escapeHtml(currentAssignment.title)}</h2>
          <p>Follow these steps in order. Kaveri will handle the rest.</p>
          <div class="steps">
            <div class="step done"><span>1</span><div><strong>Question opened</strong><small>Read question.md</small></div><b>✓</b></div>
            <div class="step active"><span>2</span><div><strong>Write your Python code</strong><small>Use ${escapeHtml(currentAssignment.fileName || 'main.py')}</small></div></div>
            <div class="step"><span>3</span><div><strong>Run visible tests</strong><small>Check your solution before submitting</small></div></div>
            <div class="step"><span>4</span><div><strong>Submit to teacher</strong><small>Your attempt is saved online</small></div></div>
          </div>
          <div class="action-grid">
            <button class="secondary" data-action="openCode">📝 Open Code</button>
            <button class="secondary" data-action="runTests">🧪 Run Tests</button>
            <button class="primary full" data-action="submit">☁ Submit Answer</button>
          </div>
        </section>`
      : '';

    const body = !signedIn
      ? `
        <section class="welcome-card">
          <div class="hero-icon">👋</div>
          <div class="eyebrow">KAVERI TECHNOLOGIES</div>
          <h1>Welcome to Coding Classroom</h1>
          <p>You don't need to learn VS Code first. Kaveri will guide you step by step.</p>
          <div class="setup-list">
            <div class="setup-row active"><span>1</span><div><strong>Sign in with Google</strong><small>Use your own Gmail account</small></div></div>
            <div class="setup-row"><span>2</span><div><strong>Join your class</strong><small>Enter the batch code from your teacher</small></div></div>
            <div class="setup-row"><span>3</span><div><strong>Start coding</strong><small>Your class questions appear here</small></div></div>
          </div>
          <button class="primary large" data-action="signIn">Continue with Google</button>
          <p class="privacy-note">Kaveri uses your Google account only to identify your student account.</p>
        </section>`
      : `
        <header class="student-header">
          <div>
            <div class="eyebrow">KAVERI CODING</div>
            <h1>Hi, ${escapeHtml(name.split(' ')[0] || name)} 👋</h1>
            <p>${batchName ? `You're learning in <strong>${escapeHtml(batchName)}</strong>.` : 'Join your class to receive the correct live assignments.'}</p>
          </div>
          <div class="avatar">${escapeHtml((name[0] || 'S').toUpperCase())}</div>
        </header>

        ${!batchName ? `
          <section class="setup-callout">
            <div class="callout-icon">🔑</div>
            <div><strong>One step left — join your class</strong><p>Ask your teacher for the Kaveri batch code.</p></div>
            <button class="primary" data-action="joinBatch">Join Batch</button>
          </section>` : `
          <section class="ready-strip"><span>✓</span><div><strong>You're ready for class</strong><small>${escapeHtml(batchName)}</small></div></section>`}

        ${currentSection}

        <section>
          <div class="section-heading"><div><div class="section-label">YOUR CLASS</div><h2>Assignments</h2></div><button class="text-button" data-action="refresh">↻ Refresh</button></div>
          <div class="assignment-list">${assignmentCards}</div>
        </section>

        <section class="progress-card">
          <div class="section-label">MY PROGRESS</div>
          <div class="progress-stats">
            <div><strong>${this.assignments.length}</strong><span>Available</span></div>
            <div><strong>${submittedKeys.size}</strong><span>Submitted</span></div>
            <div><strong>${reviewed}</strong><span>Reviewed</span></div>
          </div>
          <button class="secondary full" data-action="refreshResults">↻ Refresh marks & feedback</button>
        </section>

        <details class="help-card">
          <summary>❓ New to Kaveri Coding? How to use it</summary>
          <ol>
            <li>Choose an assignment and click <strong>Start Assignment</strong>.</li>
            <li>Read <strong>question.md</strong>.</li>
            <li>Write your answer in <strong>main.py</strong>.</li>
            <li>Return here and click <strong>Run Tests</strong>.</li>
            <li>When ready, click <strong>Submit Answer</strong>.</li>
            <li>Your teacher's marks and feedback will appear in Kaveri after review.</li>
          </ol>
        </details>

        <footer><span>${escapeHtml(email)}</span><button class="link-button" data-action="signOut">Sign out</button></footer>`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin:0; padding:14px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-sideBar-background); }
    button { font:inherit; }
    h1,h2,h3,p { margin-top:0; }
    h1 { font-size:22px; line-height:1.15; margin-bottom:8px; }
    h2 { font-size:17px; margin-bottom:8px; }
    h3 { font-size:15px; margin:8px 0; }
    p { line-height:1.5; color:var(--vscode-descriptionForeground); }
    .eyebrow,.section-label { font-size:10px; font-weight:800; letter-spacing:.12em; color:var(--vscode-textLink-foreground); }
    .welcome-card,.current-work,.progress-card,.help-card,.assignment-card,.setup-callout,.ready-strip { border:1px solid var(--vscode-widget-border); background:var(--vscode-editor-background); border-radius:10px; }
    .welcome-card { padding:22px 16px; text-align:left; }
    .hero-icon { width:48px; height:48px; display:grid; place-items:center; border-radius:12px; background:var(--vscode-textBlockQuote-background); font-size:24px; margin-bottom:16px; }
    .setup-list { display:grid; gap:9px; margin:18px 0; }
    .setup-row { display:flex; gap:10px; align-items:center; opacity:.62; }
    .setup-row.active { opacity:1; }
    .setup-row > span,.step > span { width:28px; height:28px; flex:0 0 28px; display:grid; place-items:center; border-radius:50%; border:1px solid var(--vscode-widget-border); font-weight:800; }
    .setup-row.active > span { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:transparent; }
    .setup-row strong,.setup-row small,.step strong,.step small { display:block; }
    .setup-row small,.step small { margin-top:2px; color:var(--vscode-descriptionForeground); }
    .primary,.secondary,.text-button,.link-button { border:0; cursor:pointer; border-radius:6px; padding:9px 11px; font-weight:700; }
    .primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
    .primary:hover { background:var(--vscode-button-hoverBackground); }
    .secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:1px solid var(--vscode-widget-border); }
    .secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
    .large { width:100%; min-height:42px; }
    .full { width:100%; }
    .privacy-note { font-size:11px; margin:10px 0 0; text-align:center; }
    .student-header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px; }
    .student-header p { margin:0; }
    .avatar { width:42px; height:42px; flex:0 0 42px; border-radius:50%; display:grid; place-items:center; font-size:17px; font-weight:800; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
    .setup-callout { padding:12px; display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:center; margin-bottom:14px; }
    .setup-callout button { grid-column:1 / -1; }
    .setup-callout p { margin:3px 0 0; font-size:12px; }
    .callout-icon { font-size:22px; }
    .ready-strip { display:flex; gap:10px; align-items:center; padding:10px 12px; margin-bottom:14px; }
    .ready-strip > span { display:grid; place-items:center; width:26px; height:26px; border-radius:50%; background:var(--vscode-testing-iconPassed); color:#fff; font-weight:900; }
    .ready-strip strong,.ready-strip small { display:block; }
    .ready-strip small { color:var(--vscode-descriptionForeground); margin-top:2px; }
    .current-work { padding:14px; margin-bottom:16px; border-left:3px solid var(--vscode-textLink-foreground); }
    .steps { display:grid; gap:7px; margin:12px 0; }
    .step { display:flex; gap:9px; align-items:center; padding:8px; border-radius:7px; background:var(--vscode-textBlockQuote-background); }
    .step.active > span { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:transparent; }
    .step.done > span { background:var(--vscode-testing-iconPassed); color:#fff; border-color:transparent; }
    .step b { margin-left:auto; color:var(--vscode-testing-iconPassed); }
    .action-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
    .action-grid .full { grid-column:1 / -1; }
    .section-heading { display:flex; align-items:end; justify-content:space-between; gap:8px; margin:4px 0 10px; }
    .section-heading h2 { margin:3px 0 0; }
    .text-button,.link-button { background:transparent; color:var(--vscode-textLink-foreground); padding:5px; }
    .assignment-list { display:grid; gap:9px; }
    .assignment-card { padding:12px; }
    .assignment-card.current { border-color:var(--vscode-focusBorder); }
    .card-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .topic,.marks,.status { font-size:11px; }
    .topic { color:var(--vscode-textLink-foreground); font-weight:800; }
    .marks { color:var(--vscode-descriptionForeground); }
    .question-preview { font-size:12px; margin:0 0 9px; }
    .status { display:inline-flex; align-items:center; gap:5px; padding:4px 7px; border-radius:999px; margin-bottom:9px; background:var(--vscode-textBlockQuote-background); }
    .status.success { color:var(--vscode-testing-iconPassed); }
    .status.warning { color:var(--vscode-testing-iconQueued); }
    .status.info { color:var(--vscode-textLink-foreground); }
    .assignment-card .primary { width:100%; }
    .empty-state { display:grid; justify-items:center; gap:5px; padding:24px 12px; text-align:center; color:var(--vscode-descriptionForeground); border:1px dashed var(--vscode-widget-border); border-radius:10px; }
    .empty-state strong { color:var(--vscode-foreground); }
    .empty-icon { font-size:25px; }
    .progress-card { padding:13px; margin-top:16px; }
    .progress-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:10px 0; }
    .progress-stats div { text-align:center; padding:8px 3px; background:var(--vscode-textBlockQuote-background); border-radius:7px; }
    .progress-stats strong,.progress-stats span { display:block; }
    .progress-stats strong { font-size:18px; }
    .progress-stats span { font-size:10px; color:var(--vscode-descriptionForeground); margin-top:2px; }
    .help-card { margin-top:12px; padding:10px 12px; }
    .help-card summary { cursor:pointer; font-weight:700; }
    .help-card ol { padding-left:18px; color:var(--vscode-descriptionForeground); line-height:1.55; font-size:12px; }
    footer { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:14px; padding-top:10px; border-top:1px solid var(--vscode-widget-border); color:var(--vscode-descriptionForeground); font-size:10px; }
    footer span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .loading { display:flex; gap:8px; align-items:center; padding:8px 0; color:var(--vscode-descriptionForeground); }
    .error { margin:0 0 12px; padding:9px; border:1px solid var(--vscode-inputValidation-errorBorder); border-radius:7px; color:var(--vscode-errorForeground); }
  </style>
</head>
<body>
  ${this.loading ? '<div class="loading">↻ Loading Kaveri Classroom…</div>' : ''}
  ${this.error ? `<div class="error">${escapeHtml(this.error)}</div>` : ''}
  ${body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'openAssignment') {
        vscode.postMessage({ type: action, assignmentId: button.dataset.id });
      } else {
        vscode.postMessage({ type: action });
      }
    });
  </script>
</body>
</html>`;
  }
}

module.exports = { ClassroomProvider };
