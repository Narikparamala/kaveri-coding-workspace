const vscode = require('vscode');
const path = require('path');
const os = require('os');
const { loadProjectWorkspace, saveProjectFile } = require('./project-workspace-api');

function safeSegment(value) {
  const cleaned = String(value || 'Project')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned || 'Project';
}

function safeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Unsafe project file path: ${value}`);
  }
  return parts.join('/');
}

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function writeProjectFiles(folderUri, workspace) {
  const conflicts = [];
  for (const file of workspace.files) {
    const relative = safeRelativePath(file.file_path);
    const uri = vscode.Uri.joinPath(folderUri, ...relative.split('/'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));

    if (await exists(uri)) {
      const local = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (local !== String(file.content || '')) conflicts.push({ uri, file });
      continue;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(String(file.content || ''), 'utf8'));
  }

  if (conflicts.length) {
    const choice = await vscode.window.showWarningMessage(
      `${conflicts.length} local file${conflicts.length === 1 ? '' : 's'} differ from the browser workspace.`,
      { modal: true, detail: 'Keep Local preserves your computer files. Use Browser Version replaces them with the latest files saved in the LMS.' },
      'Keep Local',
      'Use Browser Version'
    );
    if (choice === 'Use Browser Version') {
      for (const conflict of conflicts) {
        await vscode.workspace.fs.writeFile(conflict.uri, Buffer.from(String(conflict.file.content || ''), 'utf8'));
      }
    }
  }
}

async function openProjectFromUri(context, uri) {
  if (uri.path !== '/open-project') return;
  const projectId = new URLSearchParams(uri.query).get('projectId');
  const requestedOrigin = new URLSearchParams(uri.query).get('lmsOrigin');
  if (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    vscode.window.showErrorMessage('Kaveri: The project link is invalid.');
    return;
  }

  try {
    const workspace = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Kaveri: Opening project workspaceâ€¦', cancellable: false },
      () => loadProjectWorkspace(context, projectId)
    );
    if (!workspace) return;

    const root = path.join(os.homedir(), 'Documents', 'Kaveri Coding', 'Projects', `${safeSegment(workspace.project.title)}-${projectId.slice(0, 8)}`);
    const folderUri = vscode.Uri.file(root);
    await vscode.workspace.fs.createDirectory(folderUri);
    await writeProjectFiles(folderUri, workspace);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folderUri, '.kaveri'));
    let lmsOrigin = 'http://localhost:5173';
    if (requestedOrigin) {
      try {
        const parsed = new URL(requestedOrigin);
        if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
          lmsOrigin = parsed.origin;
        }
      } catch {
        // Keep the safe local default when the supplied origin is invalid.
      }
    }
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(folderUri, '.kaveri', 'project.json'),
      Buffer.from(JSON.stringify({ version: 1, projectId, title: workspace.project.title, lmsOrigin, openedAt: new Date().toISOString() }, null, 2), 'utf8')
    );
    await vscode.commands.executeCommand('vscode.openFolder', folderUri, true);
  } catch (error) {
    vscode.window.showErrorMessage(`Kaveri: Could not open project. ${error.message || error}`);
  }
}

async function syncSavedProjectFile(context, document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder || document.uri.scheme !== 'file') return;
  const relative = path.relative(folder.uri.fsPath, document.uri.fsPath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || relative === '.kaveri' || relative.startsWith('.kaveri/')) return;

  const manifestUri = vscode.Uri.joinPath(folder.uri, '.kaveri', 'project.json');
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(manifestUri)).toString('utf8'));
  } catch {
    return;
  }
  if (!manifest?.projectId) return;

  try {
    await saveProjectFile(context, manifest.projectId, safeRelativePath(relative), document.getText());
    vscode.window.setStatusBarMessage('$(cloud-upload) Kaveri project saved to cloud', 2200);
  } catch (error) {
    vscode.window.showErrorMessage(`Kaveri: Local file saved, but cloud sync failed. ${error.message || error}`);
  }
}

module.exports = { openProjectFromUri, syncSavedProjectFile };
