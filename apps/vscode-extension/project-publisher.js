const vscode = require('vscode');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || error).trim();
    throw new Error(detail || `${command} failed`);
  }
}

async function readManifest(root) {
  const manifestPath = path.join(root, '.kaveri', 'project.json');
  return { manifestPath, manifest: JSON.parse(await fs.readFile(manifestPath, 'utf8')) };
}

async function writeManifest(manifestPath, manifest) {
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function repositoryName(manifest) {
  const slug = String(manifest.title || 'kaveri-project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'kaveri-project';
  return `${slug}-${String(manifest.projectId || '').slice(0, 8)}`;
}

function githubUrlFromRemote(remote) {
  const value = String(remote || '').trim().replace(/\.git$/, '');
  const ssh = value.match(/^git@github\.com:(.+)$/i);
  return ssh ? `https://github.com/${ssh[1]}` : value;
}

async function ensureGitignore(root) {
  const target = path.join(root, '.gitignore');
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, [
      'node_modules/', '.next/', 'target/', 'dist/', '.vercel/',
      '.env', '.env.*', '!.env.example', '*.log', '.DS_Store', 'Thumbs.db', ''
    ].join('\n'), 'utf8');
  }
}

async function commitIfNeeded(root, message) {
  await run('git', ['add', '.'], root);
  const { stdout } = await run('git', ['status', '--porcelain'], root);
  if (stdout.trim()) await run('git', ['commit', '-m', message], root);
}

async function publishProject() {
  const root = workspaceRoot();
  if (!root) return vscode.window.showWarningMessage('Open a Kaveri project folder first.');

  let manifestPath;
  let manifest;
  try {
    ({ manifestPath, manifest } = await readManifest(root));
  } catch {
    return vscode.window.showWarningMessage('This folder is not a Kaveri project workspace.');
  }

  const approval = await vscode.window.showWarningMessage(
    'Publish this project to a private GitHub repository? No credentials or .env files will be committed.',
    { modal: true },
    'Publish'
  );
  if (approval !== 'Publish') return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Kaveri: Publishing project',
    cancellable: false
  }, async (progress) => {
    progress.report({ message: 'Preparing Git repositoryÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' });
    await ensureGitignore(root);
    try {
      await run('git', ['rev-parse', '--is-inside-work-tree'], root);
    } catch {
      await run('git', ['init'], root);
      await run('git', ['branch', '-M', 'main'], root);
    }
    await commitIfNeeded(root, 'Initialize Kaveri project workspace');
    const currentBranch = (await run('git', ['branch', '--show-current'], root)).stdout.trim() || 'main';

    let remote = '';
    try {
      remote = (await run('git', ['remote', 'get-url', 'origin'], root)).stdout.trim();
      progress.report({ message: 'Pushing updates to GitHubÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' });
      await run('git', ['push', '-u', 'origin', currentBranch], root);
    } catch {
      progress.report({ message: 'Creating private GitHub repositoryÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' });
      await run('gh', ['repo', 'create', repositoryName(manifest), '--private', '--source', root, '--remote', 'origin', '--push'], root);
      remote = (await run('git', ['remote', 'get-url', 'origin'], root)).stdout.trim();
    }

    manifest.githubUrl = githubUrlFromRemote(remote);
    manifest.publishedAt = new Date().toISOString();
    await writeManifest(manifestPath, manifest);

    const frontendPackage = path.join(root, 'frontend', 'package.json');
    let hasFrontend = true;
    try { await fs.access(frontendPackage); } catch { hasFrontend = false; }

    if (hasFrontend) {
      const deploy = await vscode.window.showInformationMessage(
        'GitHub publishing succeeded. Deploy the frontend to Vercel now?',
        { modal: true },
        'Deploy'
      );
      if (deploy === 'Deploy') {
        progress.report({ message: 'Deploying frontend to VercelÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' });
        const vercelArgs = currentBranch === 'main'
          ? ['vercel', '--prod', '--yes']
          : ['vercel', '--yes'];
        const frontendRoot = path.join(root, 'frontend');
        const result = process.platform === 'win32'
          ? await run(
              process.env.ComSpec || 'cmd.exe',
              ['/d', '/s', '/c', 'npx.cmd', ...vercelArgs],
              frontendRoot
            )
          : await run('npx', vercelArgs, frontendRoot);
        const urls = `${result.stdout}\n${result.stderr}`.match(/https:\/\/[^\s]+\.vercel\.app/gi) || [];
        if (!urls.length) throw new Error('Vercel completed without returning a deployment URL.');
        manifest.liveDemoUrl = urls[urls.length - 1].replace(/[\]\[(){}>,.;]+$/, '');
        manifest.deployedAt = new Date().toISOString();
        await writeManifest(manifestPath, manifest);
      }
    }

    await commitIfNeeded(root, 'Record Kaveri publishing details');
    await run('git', ['push', '-u', 'origin', currentBranch], root);
  });

  if (!manifest.liveDemoUrl) {
    vscode.window.showInformationMessage('Published to GitHub. Live deployment will become available after the frontend has a valid package.json.');
  } else {
    const action = await vscode.window.showInformationMessage('Project published and deployed successfully.', 'Submit Project');
    if (action === 'Submit Project') await vscode.commands.executeCommand('kaveri.submitProject');
  }
}

async function registerProjectPublishing(context) {
  context.subscriptions.push(vscode.commands.registerCommand('kaveri.publishProject', publishProject));
  const root = workspaceRoot();
  if (!root) return;
  try { await readManifest(root); } catch { return; }

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  item.name = 'Kaveri Publish Project';
  item.text = '$(repo-push) Publish Project';
  item.tooltip = 'Publish this project to GitHub and deploy it when build-ready';
  item.command = 'kaveri.publishProject';
  item.show();
  context.subscriptions.push(item);
}

module.exports = { registerProjectPublishing };
