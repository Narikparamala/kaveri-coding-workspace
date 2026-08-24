const vscode = require('vscode');
const path = require('path');
const os = require('os');
const core = require('./extension');
const { signIn, signOut, ensureSession, uploadSubmission } = require('./supabase');

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
  if (!after || (before && after.uri.toString() === before.uri.toString() && after.mtime === before.mtime)) {
    return;
  }

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
  core.activate(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('kaveri.signIn', () => signIn(context)),
    vscode.commands.registerCommand('kaveri.signOut', () => signOut(context)),
    vscode.commands.registerCommand('kaveri.submitOnline', () => submitOnline(context))
  );
}

function deactivate() {
  if (typeof core.deactivate === 'function') {
    core.deactivate();
  }
}

module.exports = { activate, deactivate };
