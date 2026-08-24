const vscode = require('vscode');
const path = require('path');
const os = require('os');
const core = require('./extension');
const { signIn, signOut, ensureSession, uploadSubmission } = require('./supabase');
const { fetchPublishedAssignments } = require('./assignments-api');
const { fetchMyResults } = require('./results-api');

let resultsProvider;
let resultsOutput;

function submissionsRootUri() {
  return vscode.Uri.file(path.join(os.homedir(), 'Documents', 'Kaveri Coding', '.kaveri', 'submissions'));
}

async function readJson(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

async function writeJson(uri, value) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
}

async function latestSubmission() {
  const root = submissionsRootUri();

  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    const files = entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
      .map(([name]) => vscode.Uri.joinPath(root, name));

    let latest;
    let latestMtime = -1;

    for (const uri of files) {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.mtime > latestMtime) {
        latestMtime = stat.mtime;
        latest = { uri, mtime: stat.mtime };
      }
    }

    return latest;
  } catch {
    return undefined;
  }
}

function reviewStatus(row) {
  if (row.review_status === 'reviewed') return 'Reviewed';
  if (row.review_status === 'needs_changes') return 'Needs changes';
  if (row.visible_tests_total > 0 && row.visible_tests_passed === row.visible_tests_total) return 'Tests passed';
  return 'Awaiting review';
}

function resultScore(row) {
  const value = row.teacher_score ?? row.provisional_visible_score ?? 0;
  const max = row.max_marks ?? 0;
  return `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}/${Number(max).toFixed(Number(max) % 1 ? 1 : 0)}`;
}

function resultIcon(row) {
  if (row.review_status === 'reviewed') return 'pass-filled';
  if (row.review_status === 'needs_changes') return 'warning';
  if (row.visible_tests_total > 0 && row.visible_tests_passed === row.visible_tests_total) return 'check';
  return 'history';
}

class ResultInfoItem extends vscode.TreeItem {
  constructor(label, description = '', icon = 'info', command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    if (command) this.command = { command, title: label };
  }
}

class ResultAssignmentItem extends vscode.TreeItem {
  constructor(group) {
    super(group.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.group = group;
    const latest = group.attempts[0];
    this.description = `${resultScore(latest)} • ${reviewStatus(latest)}`;
    this.tooltip = `${group.title}\n${group.attempts.length} attempt${group.attempts.length === 1 ? '' : 's'}\nLatest: ${this.description}`;
    this.iconPath = new vscode.ThemeIcon(resultIcon(latest));
    this.contextValue = 'kaveriResultAssignment';
  }
}

class ResultAttemptItem extends vscode.TreeItem {
  constructor(row) {
    super(`Attempt #${row.attempt_number}`, vscode.TreeItemCollapsibleState.None);
    this.row = row;
    this.description = `${resultScore(row)} • ${reviewStatus(row)}`;
    this.tooltip = row.teacher_feedback
      ? `Teacher feedback: ${row.teacher_feedback}`
      : `${row.visible_tests_passed}/${row.visible_tests_total} visible tests`;
    this.iconPath = new vscode.ThemeIcon(resultIcon(row));
    this.command = {
      command: 'kaveri.openResult',
      title: 'Open Result',
      arguments: [row]
    };
    this.contextValue = 'kaveriResultAttempt';
  }
}

class ResultsProvider {
  constructor(context) {
    this.context = context;
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
    this.rows = [];
    this.groups = [];
    this.loading = false;
    this.loaded = false;
    this.error = '';
  }

  refresh() {
    this.changeEmitter.fire();
  }

  clear() {
    this.rows = [];
    this.groups = [];
    this.loading = false;
    this.loaded = false;
    this.error = '';
    this.refresh();
  }

  buildGroups(rows) {
    const map = new Map();
    const ascending = [...rows].sort((a, b) => new Date(a.created_at || a.submitted_at) - new Date(b.created_at || b.submitted_at));

    for (const row of ascending) {
      const key = row.assignment_key || row.assignment_title;
      const group = map.get(key) || { key, title: row.assignment_title || key, attempts: [] };
      row.attempt_number = group.attempts.length + 1;
      group.attempts.push(row);
      map.set(key, group);
    }

    return [...map.values()]
      .map((group) => ({ ...group, attempts: [...group.attempts].reverse() }))
      .sort((a, b) => {
        const aDate = new Date(a.attempts[0]?.created_at || a.attempts[0]?.submitted_at || 0);
        const bDate = new Date(b.attempts[0]?.created_at || b.attempts[0]?.submitted_at || 0);
        return bDate - aDate;
      });
  }

  async reload({ silent = false } = {}) {
    this.loading = true;
    this.error = '';
    this.refresh();

    try {
      this.rows = await fetchMyResults(this.context);
      this.groups = this.buildGroups(this.rows);
      this.loaded = true;
      if (!silent) {
        vscode.window.showInformationMessage(
          this.rows.length
            ? `Kaveri: ${this.rows.length} submission result${this.rows.length === 1 ? '' : 's'} loaded.`
            : 'Kaveri: You do not have any submitted results yet.'
        );
      }
    } catch (error) {
      this.error = error.message || String(error);
      if (!silent) vscode.window.showErrorMessage(`Kaveri: Could not load results. ${this.error}`);
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(element) {
    if (element instanceof ResultAssignmentItem) {
      return element.group.attempts.map((row) => new ResultAttemptItem(row));
    }

    if (this.loading) return [new ResultInfoItem('Loading results…', '', 'sync~spin')];
    if (this.error) return [new ResultInfoItem('Could not load results', 'Click to retry', 'warning', 'kaveri.refreshResults')];
    if (!this.loaded) return [new ResultInfoItem('Load my results', 'Click to check marks & feedback', 'refresh', 'kaveri.refreshResults')];
    if (!this.groups.length) return [new ResultInfoItem('No submissions yet', 'Submit an assignment to see results', 'inbox')];
    return this.groups.map((group) => new ResultAssignmentItem(group));
  }
}

function openResult(row) {
  if (!resultsOutput) resultsOutput = vscode.window.createOutputChannel('Kaveri Results');

  const submitted = row.submitted_at || row.created_at;
  const reviewed = row.reviewed_at;
  const finalLabel = row.teacher_score != null ? 'Teacher mark' : 'Current score';

  resultsOutput.clear();
  resultsOutput.appendLine('KAVERI CODING — MY RESULT');
  resultsOutput.appendLine('================================');
  resultsOutput.appendLine(`Assignment: ${row.assignment_title}`);
  resultsOutput.appendLine(`Attempt: #${row.attempt_number}`);
  resultsOutput.appendLine(`Visible tests: ${row.visible_tests_passed}/${row.visible_tests_total}`);
  resultsOutput.appendLine(`${finalLabel}: ${resultScore(row)}`);
  resultsOutput.appendLine(`Status: ${reviewStatus(row)}`);
  if (submitted) resultsOutput.appendLine(`Submitted: ${new Date(submitted).toLocaleString()}`);
  if (reviewed) resultsOutput.appendLine(`Reviewed: ${new Date(reviewed).toLocaleString()}`);
  resultsOutput.appendLine('');
  resultsOutput.appendLine('TEACHER FEEDBACK');
  resultsOutput.appendLine('--------------------------------');
  resultsOutput.appendLine(row.teacher_feedback || 'No teacher feedback yet.');
  resultsOutput.appendLine('');
  if (row.review_status === 'needs_changes') {
    resultsOutput.appendLine('⚠ Please review the teacher feedback, update your solution, and submit again if requested.');
  } else if (row.review_status === 'reviewed') {
    resultsOutput.appendLine('✅ This attempt has been reviewed by your teacher.');
  } else {
    resultsOutput.appendLine('Your teacher has not reviewed this attempt yet.');
  }
  resultsOutput.show(true);
}

async function submitOnline(context) {
  const session = await ensureSession(context);
  if (!session) return;

  const accountName = session.profile?.full_name
    || session.user?.user_metadata?.full_name
    || session.user?.user_metadata?.name
    || session.user?.email
    || 'Student';

  await context.globalState.update('kaveri.studentName', accountName);

  const before = await latestSubmission();
  await vscode.commands.executeCommand('kaveri.submitAnswer');

  const after = await latestSubmission();
  if (!after || (before && after.uri.toString() === before.uri.toString() && after.mtime === before.mtime)) return;

  let localSubmission;
  try {
    localSubmission = await readJson(after.uri);
  } catch (error) {
    vscode.window.showErrorMessage(`Kaveri: Could not read the local submission record: ${error.message}`);
    return;
  }

  try {
    const serverRow = await uploadSubmission(context, localSubmission);
    if (!serverRow) return;

    const uploaded = {
      ...localSubmission,
      studentName: accountName,
      status: 'server_uploaded',
      serverSubmissionId: serverRow.id,
      serverUploadedAt: new Date().toISOString()
    };

    await writeJson(after.uri, uploaded);

    const score = `${uploaded.visibleTestsPassed}/${uploaded.visibleTestsTotal}`;
    vscode.window.showInformationMessage(`Kaveri: Submitted successfully to server — ${score} visible tests passed.`);
    if (resultsProvider) await resultsProvider.reload({ silent: true });
  } catch (error) {
    const pending = {
      ...localSubmission,
      studentName: accountName,
      status: 'local_pending_server_upload',
      uploadError: error.message,
      lastUploadAttemptAt: new Date().toISOString()
    };

    try {
      await writeJson(after.uri, pending);
    } catch {
      // Keep the original local record if updating the backup fails.
    }

    vscode.window.showErrorMessage(`Kaveri upload failed. Your local submission is safe. ${error.message}`);
  }
}

function activate(context) {
  core.activate(context, {
    loadAssignments: () => fetchPublishedAssignments(context)
  });

  resultsProvider = new ResultsProvider(context);
  resultsOutput = vscode.window.createOutputChannel('Kaveri Results');

  context.subscriptions.push(
    resultsOutput,
    vscode.window.registerTreeDataProvider('kaveri.results', resultsProvider),
    vscode.commands.registerCommand('kaveri.refreshResults', () => resultsProvider.reload()),
    vscode.commands.registerCommand('kaveri.openResult', openResult),
    vscode.commands.registerCommand('kaveri.signIn', async () => {
      const session = await signIn(context);
      if (session) await resultsProvider.reload({ silent: true });
      return session;
    }),
    vscode.commands.registerCommand('kaveri.signOut', async () => {
      await signOut(context);
      resultsProvider.clear();
    }),
    vscode.commands.registerCommand('kaveri.submitOnline', () => submitOnline(context))
  );
}

function deactivate() {
  if (typeof core.deactivate === 'function') core.deactivate();
}

module.exports = { activate, deactivate };
