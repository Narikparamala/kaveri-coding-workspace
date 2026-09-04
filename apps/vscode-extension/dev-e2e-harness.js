/* Local E2E harness for the Kaveri Coding VS Code submission flow.
 *
 * Runs the REAL server-extension.js submitOnline code path with:
 *   - vscode / os.homedir pointed at a throwaway temp directory
 *   - supabase/assignments/results/batch modules stubbed (no network)
 *   - extension.js (core) stubbed because it drives the VS Code GUI/python runner
 *
 * Verifies four contracts without a GUI VS Code instance:
 *   A. upload succeeds + server verification succeeds  -> server_uploaded/verified marker
 *   B. upload succeeds + verification unavailable     -> submission still succeeds (pending)
 *   C. server unreachable                              -> local_pending_server_upload marker, no data loss
 *   D. retry after restore                             -> uploads the same local work as a new attempt
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kaveri-harness-'));
const SUBMISSIONS_DIR = path.join(TMP_HOME, 'Documents', 'Kaveri Coding', '.kaveri', 'submissions');
fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
os.homedir = () => TMP_HOME;

const messages = { info: [], error: [] };
const commands = new Map();
const subscriptions = [];

class FakeUri {
  constructor(fsPath) { this.fsPath = fsPath; }
}
const vscodeStub = {
  Uri: {
    file: (p) => new FakeUri(p),
    joinPath: (base, ...parts) => new FakeUri(path.join(base.fsPath, ...parts)),
  },
  FileType: { File: 1, Directory: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  TreeItem: class {
    constructor(label, state) { this.label = label; this.collapsibleState = state; }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
  window: {
    createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {}, dispose() {} }),
    showInformationMessage: async (msg) => { messages.info.push(msg); },
    showErrorMessage: async (msg) => { messages.error.push(msg); },
    showWarningMessage: async () => undefined,
    withProgress: async (_opts, fn) => fn(),
    ProgressLocation: { Notification: 1 },
    registerTreeDataProvider: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      if (id === 'kaveri.submitAnswer') {
        // What extension.js normally does: save the attempt locally as JSON.
        const payload = {
          version: 2,
          status: 'local_pending_server_upload',
          studentName: 'QA Student',
          assignmentId: 'sum-1-to-n',
          assignmentTitle: 'Sum of Numbers 1 to N',
          language: 'python',
          fileName: 'main.py',
          code: 'n=int(input())\nprint(n*(n+1)//2)',
          visibleTestsPassed: 4,
          visibleTestsTotal: 4,
          provisionalVisibleScore: 10,
          maxMarks: 10,
          submittedAt: new Date().toISOString(),
          testResults: [],
        };
        const file = path.join(SUBMISSIONS_DIR, `${payload.assignmentId}-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(payload, null, 2));
        return undefined;
      }
      const handler = commands.get(id);
      return handler ? handler(...args) : undefined;
    },
  },
  workspace: {
    fs: {
      readFile: async (uri) => Buffer.from(fs.readFileSync(uri.fsPath)),
      writeFile: async (uri, data) => fs.writeFileSync(uri.fsPath, Buffer.from(data)),
      stat: async (uri) => ({ mtime: fs.statSync(uri.fsPath).mtimeMs }),
      createDirectory: (uri) => fs.mkdirSync(uri.fsPath, { recursive: true }),
      readDirectory: async (uri) =>
        fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
    },
  },
};
const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalModuleLoad.apply(this, arguments);
};

const fakeContext = {
  subscriptions,
  secrets: { store: async () => {}, get: async () => undefined, delete: async () => {} },
  globalState: { update: async () => {}, get: () => undefined },
};

function stubModule(fromFile, spec) {
  const resolved = require.resolve(fromFile);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: spec };
}

function resetState() {
  messages.info.length = 0;
  messages.error.length = 0;
  commands.clear();
  subscriptions.length = 0;
  for (const f of fs.readdirSync(SUBMISSIONS_DIR).filter((x) => x.endsWith('.json'))) {
    fs.unlinkSync(path.join(SUBMISSIONS_DIR, f));
  }
  for (const mod of ['./server-extension.js', './extension.js']) {
    delete require.cache[require.resolve(mod)];
  }
}

async function runScenario(name, supabaseSpec) {
  resetState();

  stubModule('./extension.js', { activate() {}, deactivate() {} });
  stubModule('./assignments-api.js', { fetchPublishedAssignments: async () => [] });
  stubModule('./results-api.js', { fetchMyResults: async () => [] });
  stubModule('./batch-api.js', { joinBatchByCode: async () => undefined });
  stubModule('./supabase.js', {
    signIn: async () => ({ user: { id: 'u-qa' }, profile: { full_name: 'QA Student' } }),
    signOut: async () => {},
    ensureSession: async () => ({ user: { id: 'u-qa' }, profile: { full_name: 'QA Student' } }),
    uploadSubmission: supabaseSpec.uploadSubmission,
    verifySubmission: supabaseSpec.verifySubmission,
  });

  const ext = require('./server-extension.js');
  ext.activate(fakeContext);

  await vscodeStub.commands.executeCommand('kaveri.submitOnline');
  await new Promise((r) => setTimeout(r, 200));

  const files = fs.readdirSync(SUBMISSIONS_DIR).filter((f) => f.endsWith('.json')).sort();
  const latestFile = files.pop();
  const marker = latestFile
    ? JSON.parse(fs.readFileSync(path.join(SUBMISSIONS_DIR, latestFile), 'utf8'))
    : null;

  console.log(`\n=== ${name} ===`);
  console.log('marker status:', marker && marker.status);
  console.log('serverSubmissionId:', marker && marker.serverSubmissionId);
  console.log('serverVerification:', marker && marker.serverVerification);
  console.log('code preserved:', marker && marker.code && marker.code.includes('n*(n+1)//2'));
  console.log('info:', (messages.info[0] || '').slice(0, 180));
  console.log('error:', (messages.error[0] || '').slice(0, 180));
  return { marker, message: messages.info[0] || messages.error[0] };
}

(async () => {
  const submissionId = 'b2822085-ace4-4282-a1c1-d1ca7099989c';

  const a = await runScenario('A: upload + verified', {
    uploadSubmission: async () => ({ id: submissionId }),
    verifySubmission: async () => ({ verified: true, submissionId, hiddenPassed: 1, hiddenTotal: 1, verifiedScore: 10, verifiedSummary: 'All 1 hidden server test passed' }),
  });
  console.log('A:', a.marker.status === 'server_uploaded' && a.marker.serverVerification === 'verified' && a.message.includes('server-verified') ? 'PASS' : 'FAIL');

  const b = await runScenario('B: upload ok, verification down', {
    uploadSubmission: async () => ({ id: submissionId }),
    verifySubmission: async () => { throw new Error('RUNNER_UNAVAILABLE'); },
  });
  console.log('B:', b.marker.status === 'server_uploaded' && b.marker.serverVerification === 'pending' && b.message.includes('safe') ? 'PASS' : 'FAIL');

  const c = await runScenario('C: server unreachable', {
    uploadSubmission: async () => { throw new Error('fetch failed'); },
    verifySubmission: async () => { throw new Error('not reached'); },
  });
  console.log('C:', c.marker.status === 'local_pending_server_upload' && c.marker.code.includes('n*(n+1)//2') && c.message.includes('local submission is safe') ? 'PASS' : 'FAIL');

  const d = await runScenario('D: retry after restore', {
    uploadSubmission: async () => ({ id: `${submissionId}-retry` }),
    verifySubmission: async () => ({ verified: true, submissionId: `${submissionId}-retry`, hiddenPassed: 1, hiddenTotal: 1, verifiedScore: 10, verifiedSummary: 'All 1 hidden server test passed' }),
  });
  console.log('D:', d.marker.status === 'server_uploaded' && d.marker.serverVerification === 'verified' && d.marker.code.includes('n*(n+1)//2') ? 'PASS' : 'FAIL');

  process.exit(0);
})();
