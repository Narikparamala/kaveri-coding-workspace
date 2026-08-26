const vscode = require('vscode');
const path = require('path');
const { getStoredSession } = require('./supabase');
const { fetchClassroomAssignments, joinLiveClass, requestAssignmentAccess } = require('./assignments-api');
const { fetchMyResults } = require('./results-api');
const { fetchMyBatches } = require('./batch-api');

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

function permanentLabel(source) {
  if (source === 'live_attendance') return '✓ Attended live • Yours forever';
  if (source === 'teacher_grant') return '✓ Teacher granted • Yours forever';
  if (source === 'recorded_release') return '▶ Recorded / self-paced • Permanent';
  return '✓ Permanently available';
}

class ClassroomProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.assignments = [];
    this.results = [];
    this.batches = [];
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
          this.assignments = [];
          this.results = [];
          this.batches = [];
          await this.render();
          break;
        case 'joinBatch':
          await vscode.commands.executeCommand('kaveri.joinBatch');
          await this.refresh({ silent: true });
          break;
        case 'joinLiveClass': {
          const result = await joinLiveClass(this.context, message.batchId);
          const count = Number(result?.unlocked_count || 0);
          vscode.window.showInformationMessage(
            count > 0
              ? `Kaveri: Live class joined. ${count} question${count === 1 ? '' : 's'} unlocked permanently.`
              : 'Kaveri: You already joined this live class. Your questions remain permanently available.'
          );
          await this.refresh({ silent: true });
          break;
        }
        case 'refresh':
          await this.refresh();
          break;
        case 'autoRefresh':
          await this.refresh({ silent: true });
          break;
        case 'requestAccess': {
          const assignment = this.assignments.find((item) => item.id === message.assignmentId);
          if (!assignment || !assignment.isLocked || assignment.liveAvailable) break;
          if (assignment.requestStatus === 'pending') {
            vscode.window.showInformationMessage('Your access request is already waiting for your teacher.');
            break;
          }
          const choice = await vscode.window.showInformationMessage(
            `Request permanent access to “${assignment.title}”?`,
            { modal: true },
            'Request Access'
          );
          if (choice !== 'Request Access') break;
          await requestAssignmentAccess(this.context, assignment);
          vscode.window.showInformationMessage('Kaveri: Request sent to your teacher.');
          await this.refresh({ silent: true });
          break;
        }
        case 'openAssignment': {
          const assignment = this.assignments.find((item) => item.id === message.assignmentId);
          if (!assignment) break;
          if (assignment.isLocked) {
            vscode.window.showInformationMessage(
              assignment.liveAvailable
                ? 'Your live class is active. Click Join Live Class first.'
                : 'This question is locked because you missed that class. Request access from your teacher.'
            );
            break;
          }
          await vscode.commands.executeCommand('kaveri.openAssignment', assignment);
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
    await this.render();

    try {
      const session = await getStoredSession(this.context);
      if (!session) {
        this.assignments = [];
        this.results = [];
        this.batches = [];
        return;
      }

      const isStudent = session.profile?.role === 'student';
      const [assignmentsResult, resultsResult, batchesResult] = await Promise.allSettled([
        fetchClassroomAssignments(this.context, session),
        isStudent ? fetchMyResults(this.context) : Promise.resolve([]),
        isStudent ? fetchMyBatches(this.context, session) : Promise.resolve([])
      ]);

      this.assignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : [];
      this.results = resultsResult.status === 'fulfilled' ? resultsResult.value : [];
      this.batches = batchesResult.status === 'fulfilled' ? batchesResult.value : [];

      if (assignmentsResult.status === 'rejected') {
        this.error = assignmentsResult.reason?.message || 'Could not load coding classroom.';
      }

      if (!silent && !this.error) {
        const permanent = this.assignments.filter((a) => !a.isLocked).length;
        const live = this.assignments.filter((a) => a.liveAvailable && a.isLocked).length;
        vscode.window.showInformationMessage(`Kaveri: ${permanent} permanent • ${live} live now.`);
      }
    } catch (error) {
      this.error = error.message || String(error);
    } finally {
      this.loading = false;
      await this.render();
    }
  }

  async render() {
    if (!this.view) return;
    const session = await getStoredSession(this.context);
    const role = session?.profile?.role || '';
    const isStudent = role === 'student';
    const isStaff = ['faculty', 'super_admin'].includes(role);
    const batchName = this.batches.map((b) => b.batch_name).filter(Boolean).join(', ');
    const currentFolder = currentFolderName();
    const currentAssignment = this.assignments.find((item) => folderName(item.title) === currentFolder);
    const resultMap = latestResultByAssignment(this.results);

    this.view.webview.html = this.html({ session, role, isStudent, isStaff, batchName, currentAssignment, resultMap });
  }

  html({ session, role, isStudent, isStaff, batchName, currentAssignment, resultMap }) {
    const nonce = Math.random().toString(36).slice(2);
    const csp = this.view.webview.cspSource;
    const signedIn = Boolean(session);
    const name = displayName(session);
    const email = session?.user?.email || '';
    const permanent = this.assignments.filter((a) => !a.isLocked);
    const liveWaiting = this.assignments.filter((a) => a.isLocked && a.liveAvailable);
    const missed = this.assignments.filter((a) => a.isLocked && !a.liveAvailable);
    const reviewed = this.results.filter((row) => row.review_status === 'reviewed').length;
    const submittedKeys = new Set(this.results.map((row) => row.assignment_key || row.assignment_title));
    const canShowCurrent = Boolean(currentAssignment && !currentAssignment.isLocked && (isStaff || batchName));
    const liveBatch = liveWaiting[0]?.batchId || null;

    const liveBanner = isStudent && liveWaiting.length
      ? `<section class="live-banner">
          <div class="live-dot">●</div>
          <div><strong>Live coding class is active</strong><span>${liveWaiting.length} question${liveWaiting.length === 1 ? '' : 's'} waiting for you. Join now and they stay unlocked forever.</span></div>
          <button class="primary" data-action="joinLiveClass" data-batch="${escapeHtml(liveBatch)}">Join Live Class</button>
        </section>`
      : '';

    const cards = this.assignments.length
      ? [...liveWaiting, ...permanent, ...missed].map((assignment) => {
          if (assignment.isLocked && assignment.liveAvailable) {
            return `<article class="assignment-card live-waiting-card">
              <div class="card-top"><span class="topic">${escapeHtml(assignment.topic)}</span><span class="marks">${assignment.marks} marks</span></div>
              <div class="live-row">● LIVE NOW</div>
              <h3>${escapeHtml(assignment.title)}</h3>
              <p class="question-preview">Your teacher is teaching this now. Join the live class to unlock it permanently.</p>
              <button class="primary full" data-action="joinLiveClass" data-batch="${escapeHtml(assignment.batchId)}">Join Live Class</button>
            </article>`;
          }

          if (assignment.isLocked) {
            const pending = assignment.requestStatus === 'pending';
            return `<article class="assignment-card locked-card">
              <div class="card-top"><span class="topic">${escapeHtml(assignment.topic)}</span><span class="marks">${assignment.marks} marks</span></div>
              <div class="lock-row">🔒 Missed live class</div>
              <h3>${escapeHtml(assignment.title)}</h3>
              <p class="question-preview">This class has already happened. Ask your teacher to unlock it permanently for you.</p>
              ${isStudent
                ? `<button class="${pending ? 'pending-button' : 'secondary'} full" ${pending ? 'disabled' : ''} data-action="requestAccess" data-id="${escapeHtml(assignment.id)}">${pending ? '⏳ Request sent' : '🙋 Request Access'}</button>`
                : '<button class="locked-button" disabled>Locked</button>'}
            </article>`;
          }

          const latest = resultMap.get(assignment.id) || resultMap.get(assignment.title);
          const status = resultStatus(latest);
          const isCurrent = canShowCurrent && currentAssignment?.id === assignment.id;
          return `<article class="assignment-card ${isCurrent ? 'current' : ''}">
            <div class="card-top"><span class="topic">${escapeHtml(assignment.topic)}</span><span class="marks">${assignment.marks} marks</span></div>
            <div class="permanent-row">${escapeHtml(permanentLabel(assignment.accessSource))}</div>
            <h3>${escapeHtml(assignment.title)}</h3>
            <p class="question-preview">${escapeHtml(assignment.question || '').slice(0, 150)}${String(assignment.question || '').length > 150 ? '…' : ''}</p>
            ${isStudent ? `<div class="status ${status.className}"><span>${status.icon}</span>${escapeHtml(status.label)}</div>` : ''}
            <button class="primary full" data-action="openAssignment" data-id="${escapeHtml(assignment.id)}">${isCurrent ? 'Continue Coding' : 'Start Coding'}</button>
          </article>`;
        }).join('')
      : `<div class="empty-state"><div class="empty-icon">🎓</div><strong>No coding activities yet</strong><span>${isStudent && batchName ? 'Attend your next live class or wait for a recorded/self-paced release.' : 'Join your class to receive coding activities.'}</span></div>`;

    const currentSection = canShowCurrent
      ? `<section class="current-work">
          <div class="section-label">CURRENT WORK</div>
          <h2>${escapeHtml(currentAssignment.title)}</h2>
          <p>This question is permanently yours. Practice it anytime.</p>
          <div class="steps">
            <div class="step done"><span>1</span><div><strong>Read the question</strong><small>Open question.md</small></div><b>✓</b></div>
            <div class="step active"><span>2</span><div><strong>Write your Python code</strong><small>Use ${escapeHtml(currentAssignment.fileName || 'main.py')}</small></div></div>
            <div class="step"><span>3</span><div><strong>Run visible tests</strong><small>Check your answer</small></div></div>
            <div class="step"><span>4</span><div><strong>Submit to teacher</strong><small>Your attempt is saved online</small></div></div>
          </div>
          <div class="action-grid">
            <button class="secondary" data-action="openCode">📝 Open Code</button>
            <button class="secondary" data-action="runTests">🧪 Run Tests</button>
            <button class="primary full" data-action="submit">☁ Submit Answer</button>
          </div>
        </section>`
      : '';

    const header = `<header class="student-header"><div><div class="eyebrow">KAVERI CODING</div><h1>Hi, ${escapeHtml(name.split(' ')[0] || name)} 👋</h1><p>${isStaff ? 'Preview the student coding experience.' : batchName ? `<strong>${escapeHtml(batchName)}</strong>` : 'Join your batch to begin.'}</p></div><div class="avatar">${escapeHtml((name[0] || 'S').toUpperCase())}</div></header>`;

    const accountCallout = isStaff
      ? `<section class="staff-strip"><span>👨‍🏫</span><div><strong>Staff Preview Mode</strong><small>Student attendance and access requests are disabled for staff accounts.</small></div></section>`
      : !batchName
        ? `<section class="setup-callout"><div class="callout-icon">🔑</div><div><strong>Join your batch</strong><p>Enter the batch code from your teacher.</p></div><button class="primary" data-action="joinBatch">Join Batch</button></section>`
        : `<section class="ready-strip"><span>✓</span><div><strong>Connected to your class</strong><small>Kaveri checks for live activities automatically.</small></div></section>`;

    const body = !signedIn
      ? `<section class="welcome-card"><div class="hero-icon">👋</div><div class="eyebrow">KAVERI TECHNOLOGIES</div><h1>Welcome to Coding Classroom</h1><p>Attend live coding classes and keep every question you unlock forever.</p><div class="setup-list"><div class="setup-row active"><span>1</span><div><strong>Sign in with Google</strong><small>Use your own Gmail</small></div></div><div class="setup-row"><span>2</span><div><strong>Join your batch</strong><small>Enter your teacher's batch code</small></div></div><div class="setup-row"><span>3</span><div><strong>Join live class</strong><small>Attended questions stay permanently available</small></div></div></div><button class="primary large" data-action="signIn">Continue with Google</button></section>`
      : `${header}${accountCallout}${liveBanner}${currentSection}
        <section><div class="section-heading"><div><div class="section-label">${isStaff ? 'STUDENT PREVIEW' : 'MY CODING LIBRARY'}</div><h2>Coding Activities</h2></div><button class="text-button" data-action="refresh">↻ Refresh</button></div>${this.loading ? '<div class="loading-line">Checking classroom…</div>' : ''}${this.error ? `<div class="error-box">${escapeHtml(this.error)}</div>` : ''}<div class="assignment-list">${cards}</div></section>
        ${isStudent ? `<section class="progress-card"><div class="section-label">MY PROGRESS</div><div class="progress-stats four"><div><strong>${permanent.length}</strong><span>Permanent</span></div><div><strong>${liveWaiting.length}</strong><span>Live now</span></div><div><strong>${submittedKeys.size}</strong><span>Submitted</span></div><div><strong>${reviewed}</strong><span>Reviewed</span></div></div><button class="secondary full" data-action="refreshResults">↻ Refresh marks & feedback</button></section>` : ''}
        <details class="help-card"><summary>❓ How does access work?</summary><ol><li>When your teacher starts a live coding class, click <strong>Join Live Class</strong>.</li><li>Today's questions become <strong>permanently yours</strong>.</li><li>You can practice them later at night, tomorrow, or anytime.</li><li>If you missed the live class, use <strong>Request Access</strong>.</li><li>Recorded/self-paced questions may also be permanently released by your faculty.</li></ol></details>
        <footer><span>${escapeHtml(email)}</span><button class="link-button" data-action="signOut">Sign out</button></footer>`;

    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';"/><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:14px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}button{font:inherit}h1,h2,h3,p{margin-top:0}h1{font-size:22px;line-height:1.15;margin-bottom:8px}h2{font-size:17px;margin-bottom:8px}h3{font-size:15px;margin:8px 0}p{line-height:1.45;color:var(--vscode-descriptionForeground)}.eyebrow,.section-label{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--vscode-textLink-foreground)}.welcome-card,.current-work,.progress-card,.help-card,.assignment-card,.setup-callout,.ready-strip,.staff-strip,.live-banner{border:1px solid var(--vscode-widget-border);background:var(--vscode-editor-background);border-radius:10px}.welcome-card{padding:22px 16px}.hero-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:12px;background:var(--vscode-textBlockQuote-background);font-size:24px;margin-bottom:16px}.setup-list{display:grid;gap:10px;margin:18px 0}.setup-row{display:flex;gap:10px;align-items:center;opacity:.62}.setup-row.active{opacity:1}.setup-row>span,.step>span{width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--vscode-widget-border);font-weight:800}.setup-row.active>span{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.setup-row strong,.setup-row small,.step strong,.step small{display:block}.setup-row small,.step small{margin-top:2px;color:var(--vscode-descriptionForeground)}.primary,.secondary,.text-button,.link-button,.locked-button,.pending-button{border:0;cursor:pointer;border-radius:6px;padding:9px 11px;font-weight:700}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.primary:hover{background:var(--vscode-button-hoverBackground)}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-widget-border)}.large,.full{width:100%}.text-button,.link-button{background:transparent;color:var(--vscode-textLink-foreground);padding:5px}.student-header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:14px}.student-header p{margin-bottom:0}.avatar{width:46px;height:46px;flex:0 0 46px;border-radius:50%;display:grid;place-items:center;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-size:18px;font-weight:800}.setup-callout,.ready-strip,.staff-strip{padding:13px;margin-bottom:14px}.setup-callout{display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center}.setup-callout button{grid-column:1/-1;width:100%}.callout-icon{font-size:20px}.setup-callout p{margin:3px 0 0;font-size:12px}.ready-strip,.staff-strip{display:flex;align-items:center;gap:10px}.ready-strip>span{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#2ea043;color:#fff;font-weight:900}.ready-strip strong,.ready-strip small,.staff-strip strong,.staff-strip small{display:block}.ready-strip small,.staff-strip small{color:var(--vscode-descriptionForeground);margin-top:2px}.staff-strip{border-left:3px solid var(--vscode-textLink-foreground)}.live-banner{display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;padding:13px;margin-bottom:14px;border-color:#f0883e;background:var(--vscode-textBlockQuote-background)}.live-banner button{grid-column:1/-1;width:100%}.live-dot,.live-row{color:#f85149;font-weight:900}.live-banner span{display:block;margin-top:3px;color:var(--vscode-descriptionForeground);font-size:11px}.current-work{border-left:3px solid var(--vscode-textLink-foreground);padding:14px;margin-bottom:16px}.steps{display:grid;gap:7px;margin:12px 0}.step{min-height:54px;display:flex;gap:9px;align-items:center;padding:8px;background:var(--vscode-textCodeBlock-background);border-radius:7px}.step>div{flex:1}.step.done>span{background:#3fb950;color:white;border-color:transparent}.step.active>span{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.step b{color:#3fb950}.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.action-grid .full{grid-column:1/-1}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:8px;margin:18px 0 9px}.section-heading h2{margin:2px 0 0}.assignment-list{display:grid;gap:9px}.assignment-card{padding:13px}.assignment-card.current{border-left:3px solid var(--vscode-textLink-foreground)}.live-waiting-card{border-left:3px solid #f85149}.locked-card{opacity:.88;border-style:dashed}.card-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.topic,.marks{font-size:10px;font-weight:800;color:var(--vscode-descriptionForeground)}.topic{color:var(--vscode-textLink-foreground);text-transform:uppercase;letter-spacing:.08em}.question-preview{font-size:12px;margin:7px 0 10px}.status,.permanent-row,.lock-row,.live-row{display:inline-flex;gap:5px;align-items:center;font-size:11px;font-weight:700;margin-bottom:9px}.permanent-row,.status.success{color:#3fb950}.status.warning{color:#d29922}.status.info{color:var(--vscode-textLink-foreground)}.status.neutral,.lock-row{color:var(--vscode-descriptionForeground)}.locked-button,.pending-button{cursor:not-allowed;background:var(--vscode-disabledForeground);color:var(--vscode-editor-background);opacity:.55}.progress-card{padding:13px;margin-top:16px}.progress-stats.four{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:10px 0}.progress-stats div{text-align:center;padding:7px 3px;background:var(--vscode-textCodeBlock-background);border-radius:6px}.progress-stats strong,.progress-stats span{display:block}.progress-stats strong{font-size:18px}.progress-stats span{font-size:9px;color:var(--vscode-descriptionForeground);margin-top:2px}.help-card{margin-top:12px;padding:12px}.help-card summary{cursor:pointer;font-weight:700}.help-card ol{padding-left:21px;line-height:1.55;color:var(--vscode-descriptionForeground)}.empty-state{text-align:center;padding:20px 12px;border:1px dashed var(--vscode-widget-border);border-radius:9px;color:var(--vscode-descriptionForeground)}.empty-state strong,.empty-state span{display:block}.empty-state strong{color:var(--vscode-foreground);margin:7px 0 3px}.empty-icon{font-size:25px}.loading-line,.error-box{padding:9px;border-radius:6px;margin-bottom:9px;font-size:11px}.loading-line{background:var(--vscode-textBlockQuote-background)}.error-box{background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder)}footer{margin-top:14px;padding:10px 2px 2px;display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--vscode-descriptionForeground);font-size:10px;overflow:hidden}footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:270px){body{padding:10px}.action-grid{grid-template-columns:1fr}.action-grid .full{grid-column:auto}.student-header{display:block}.avatar{margin-top:8px}}
    </style></head><body>${body}<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-action]').forEach((button)=>{button.addEventListener('click',()=>{const action=button.dataset.action;if(action==='openAssignment'||action==='requestAccess'){vscode.postMessage({type:action,assignmentId:button.dataset.id});}else if(action==='joinLiveClass'){vscode.postMessage({type:action,batchId:button.dataset.batch});}else{vscode.postMessage({type:action});}});});setInterval(()=>vscode.postMessage({type:'autoRefresh'}),30000);</script></body></html>`;
  }
}

module.exports = { ClassroomProvider };
