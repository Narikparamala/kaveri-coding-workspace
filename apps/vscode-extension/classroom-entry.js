const vscode = require('vscode');
const supabase = require('./supabase');

// Classroom UI needs to inspect the existing stored login without forcing a
// browser sign-in. Keep this adapter here so the proven v0.10 auth engine stays
// unchanged.
supabase.getStoredSession = async function getStoredSession(context) {
  const raw = await context.secrets.get('kaveri.supabaseSession.v1');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const legacy = require('./server-extension');
const { ClassroomProvider } = require('./classroom-webview');

async function openSolutionFile() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showInformationMessage('Start a Kaveri assignment first.');
    return;
  }

  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '*.py'),
    '**/.kaveri/**',
    20
  );

  if (!files.length) {
    vscode.window.showWarningMessage('No Python solution file was found in this assignment.');
    return;
  }

  const preferred = files.find((uri) => uri.path.toLowerCase().endsWith('/main.py')) || files[0];
  const document = await vscode.workspace.openTextDocument(preferred);
  await vscode.window.showTextDocument(document, { preview: false });
}

function activate(context) {
  // All proven v0.10 functionality remains active underneath the new UI.
  legacy.activate(context);

  const classroom = new ClassroomProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('kaveri.classroom', classroom, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('kaveri.openSolutionFile', openSolutionFile)
  );
}

function deactivate() {
  if (typeof legacy.deactivate === 'function') legacy.deactivate();
}

module.exports = { activate, deactivate };
