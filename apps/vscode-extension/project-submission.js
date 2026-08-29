const vscode = require('vscode');

async function readProjectManifest() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  try {
    const uri = vscode.Uri.joinPath(folder.uri, '.kaveri', 'project.json');
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return undefined;
  }
}

function safeOrigin(value) {
  try {
    const parsed = new URL(value || 'http://localhost:5173');
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      return parsed.origin;
    }
  } catch {
    // Fall through to the safe development origin.
  }
  return 'http://localhost:5173';
}

async function submitProject() {
  const manifest = await readProjectManifest();
  if (!manifest?.projectId) {
    vscode.window.showWarningMessage('Open a Kaveri project workspace before submitting.');
    return;
  }
  const query = new URLSearchParams({ projectId: manifest.projectId, submit: '1', developerRole: 'student' });
  if (manifest.githubUrl) query.set('githubUrl', manifest.githubUrl);
  if (manifest.liveDemoUrl) query.set('liveUrl', manifest.liveDemoUrl);
  const target = `${safeOrigin(manifest.lmsOrigin)}/student/projects?${query.toString()}`;
  await vscode.env.openExternal(vscode.Uri.parse(target));
}

async function registerProjectSubmission(context) {
  context.subscriptions.push(vscode.commands.registerCommand('kaveri.submitProject', submitProject));
  const manifest = await readProjectManifest();
  if (!manifest?.projectId) return;

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.name = 'Kaveri Submit Project';
  item.text = '$(cloud-upload) Submit Project';
  item.tooltip = 'Open this project submission and evidence form in Kaveri LMS';
  item.command = 'kaveri.submitProject';
  item.show();
  context.subscriptions.push(item);
}

module.exports = { registerProjectSubmission };
