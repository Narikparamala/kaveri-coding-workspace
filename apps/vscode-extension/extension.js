const vscode = require('vscode');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const assignments = [
  {
    id: 'sum-1-to-n',
    title: 'Sum of Numbers 1 to N',
    topic: 'Loops',
    marks: 10,
    question: 'Write a Python program to find the sum of all numbers from 1 to N.',
    examples: [['5', '15'], ['10', '55']],
    tests: [['1', '1'], ['5', '15'], ['10', '55'], ['100', '5050']]
  },
  {
    id: 'even-or-odd',
    title: 'Even or Odd',
    topic: 'Conditions',
    marks: 10,
    question: 'Read an integer and print Even if it is even, otherwise print Odd.',
    examples: [['8', 'Even'], ['7', 'Odd']],
    tests: [['8', 'Even'], ['7', 'Odd'], ['0', 'Even'], ['-3', 'Odd']]
  },
  {
    id: 'reverse-number',
    title: 'Reverse a Number',
    topic: 'Loops',
    marks: 10,
    question: 'Write a Python program to reverse the digits of a positive integer.',
    examples: [['1234', '4321'], ['500', '5']],
    tests: [['1234', '4321'], ['500', '5'], ['7', '7'], ['1000', '1']]
  }
];

class AssignmentItem extends vscode.TreeItem {
  constructor(assignment) {
    super(assignment.title, vscode.TreeItemCollapsibleState.None);
    this.description = `${assignment.topic} • ${assignment.marks} marks`;
    this.tooltip = assignment.question;
    this.iconPath = new vscode.ThemeIcon('book');
    this.command = {
      command: 'kaveri.openAssignment',
      title: 'Open Assignment',
      arguments: [assignment]
    };
  }
}

class AssignmentsProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  refresh() {
    this.changeEmitter.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren() {
    return assignments.map((item) => new AssignmentItem(item));
  }
}

function folderName(title) {
  return title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function findCurrentAssignment() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  const currentFolderName = path.basename(folder.uri.fsPath);
  return assignments.find((assignment) => folderName(assignment.title) === currentFolderName);
}

function questionText(a) {
  const examples = a.examples.map((e, i) =>
    `## Example ${i + 1}\n\nInput:\n\`\`\`text\n${e[0]}\n\`\`\`\n\nExpected Output:\n\`\`\`text\n${e[1]}\n\`\`\``
  ).join('\n\n');

  return `# ${a.title}\n\n**Topic:** ${a.topic}  \n**Marks:** ${a.marks}\n\n## Question\n\n${a.question}\n\n${examples}\n\nWrite your solution in \`main.py\`.\n\n> Kaveri tests send input automatically. Use normal \`input()\`; avoid extra output unless the question asks for it.\n`;
}

async function writeText(uri, text) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function openAssignment(a) {
  try {
    const rootPath = path.join(os.homedir(), 'Documents', 'Kaveri Coding', 'Python', folderName(a.title));
    const folderUri = vscode.Uri.file(rootPath);
    const questionUri = vscode.Uri.joinPath(folderUri, 'question.md');
    const mainUri = vscode.Uri.joinPath(folderUri, 'main.py');

    await vscode.workspace.fs.createDirectory(folderUri);
    await writeText(questionUri, questionText(a));

    try {
      await vscode.workspace.fs.stat(mainUri);
    } catch {
      await writeText(
        mainUri,
        `# ${a.title}\n# ${a.marks} marks\n\n# Write your solution below\n# Kaveri supplies test input automatically.\n\n`
      );
    }

    await vscode.commands.executeCommand('vscode.openFolder', folderUri, false);
  } catch (error) {
    vscode.window.showErrorMessage(`Kaveri Coding: ${error.message}`);
  }
}

async function openCodingFolder() {
  const uri = vscode.Uri.file(path.join(os.homedir(), 'Documents', 'Kaveri Coding'));
  await vscode.workspace.fs.createDirectory(uri);
  await vscode.commands.executeCommand('vscode.openFolder', uri, false);
}

function runProcess(command, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        child.kill();
        finished = true;
        resolve({ stdout, stderr, timedOut: true, exitCode: null });
      }
    }, 3000);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!finished) {
        finished = true;
        reject(error);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!finished) {
        finished = true;
        resolve({ stdout, stderr, timedOut: false, exitCode: code });
      }
    });

    child.stdin.write(`${input}\n`);
    child.stdin.end();
  });
}

async function runPython(mainPath, input) {
  const cwd = path.dirname(mainPath);
  const runners = [
    ['python', [mainPath]],
    ['py', ['-3', mainPath]],
    ['python3', [mainPath]]
  ];

  let lastError;
  for (const [command, args] of runners) {
    try {
      return await runProcess(command, args, input, cwd);
    } catch (error) {
      lastError = error;
      if (error.code !== 'ENOENT') throw error;
    }
  }

  throw lastError || new Error('Python was not found on this computer.');
}

function normalize(text) {
  return text.replace(/\r\n/g, '\n').trim();
}

function outputMatches(actual, expected) {
  const received = normalize(actual);
  const wanted = normalize(expected);

  if (received === wanted) return true;

  const lines = received.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) || '';
  if (lastLine === wanted) return true;

  if (lastLine.endsWith(wanted)) {
    const prefix = lastLine.slice(0, -wanted.length).trim();
    return /[:=>-]$/.test(prefix);
  }

  return false;
}

async function executeTests({ showOutput = true } = {}) {
  const assignment = findCurrentAssignment();
  if (!assignment) {
    vscode.window.showWarningMessage('Open a Kaveri assignment folder before running tests.');
    return undefined;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  const mainUri = vscode.Uri.joinPath(folder.uri, 'main.py');

  try {
    await vscode.workspace.fs.stat(mainUri);
  } catch {
    vscode.window.showErrorMessage('main.py was not found in this assignment.');
    return undefined;
  }

  await vscode.workspace.saveAll(false);

  const output = showOutput ? vscode.window.createOutputChannel('Kaveri Test Results') : undefined;
  if (output) {
    output.clear();
    output.show(true);
    output.appendLine('KAVERI CODING — TEST RESULTS');
    output.appendLine('================================');
    output.appendLine(`Assignment: ${assignment.title}`);
    output.appendLine(`Marks: ${assignment.marks}`);
    output.appendLine('');
  }

  let passed = 0;
  const results = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Kaveri: Running ${assignment.tests.length} tests...`,
      cancellable: false
    },
    async () => {
      for (let i = 0; i < assignment.tests.length; i += 1) {
        const [input, expected] = assignment.tests[i];
        let result;

        try {
          result = await runPython(mainUri.fsPath, input);
        } catch (error) {
          results.push({
            testNumber: i + 1,
            input,
            expected,
            passed: false,
            error: error.message
          });

          if (output) {
            output.appendLine(`❌ Test ${i + 1} — COULD NOT RUN`);
            output.appendLine(`   ${error.message}`);
            output.appendLine('');
          }
          continue;
        }

        const received = normalize(result.stdout);
        const ok = !result.timedOut && result.exitCode === 0 && outputMatches(result.stdout, expected);
        if (ok) passed += 1;

        results.push({
          testNumber: i + 1,
          input,
          expected,
          received,
          passed: ok,
          timedOut: result.timedOut,
          stderr: normalize(result.stderr)
        });

        if (output) {
          output.appendLine(`${ok ? '✅' : '❌'} Test ${i + 1} — ${ok ? 'PASS' : 'FAIL'}`);
          output.appendLine(`   Input: ${input}`);
          output.appendLine(`   Expected: ${expected}`);

          if (result.timedOut) {
            output.appendLine('   Received: TIME LIMIT EXCEEDED (3 seconds)');
          } else if (result.stderr.trim()) {
            output.appendLine('   Python error:');
            for (const line of normalize(result.stderr).split('\n')) {
              output.appendLine(`   ${line}`);
            }
          } else {
            output.appendLine(`   Received: ${received || '(no output)'}`);
          }

          output.appendLine('');
        }
      }
    }
  );

  if (output) {
    output.appendLine('================================');
    output.appendLine(`Result: ${passed}/${assignment.tests.length} tests passed`);

    if (passed === assignment.tests.length) {
      output.appendLine('🎉 ALL VISIBLE TESTS PASSED');
    } else {
      output.appendLine('Fix the failed tests and run again.');
    }
  }

  return {
    assignment,
    mainUri,
    passed,
    total: assignment.tests.length,
    allPassed: passed === assignment.tests.length,
    results
  };
}

async function runTests() {
  const testRun = await executeTests({ showOutput: true });
  if (!testRun) return;

  if (testRun.allPassed) {
    vscode.window.showInformationMessage(`Kaveri: All ${testRun.passed}/${testRun.total} tests passed!`);
  } else {
    vscode.window.showWarningMessage(`Kaveri: ${testRun.passed}/${testRun.total} tests passed.`);
  }
}

async function getStudentName(context) {
  const existing = context.globalState.get('kaveri.studentName');
  if (existing) return existing;

  const name = await vscode.window.showInputBox({
    title: 'Kaveri Coding — Student Name',
    prompt: 'Enter your full name. You only need to do this once on this computer.',
    placeHolder: 'Example: Tejaswini',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length < 2 ? 'Please enter your full name.' : undefined
  });

  if (!name) return undefined;
  const cleaned = name.trim();
  await context.globalState.update('kaveri.studentName', cleaned);
  return cleaned;
}

async function submitAnswer(context) {
  const testRun = await executeTests({ showOutput: true });
  if (!testRun) return;

  if (!testRun.allPassed) {
    const choice = await vscode.window.showWarningMessage(
      `Only ${testRun.passed}/${testRun.total} visible tests passed. Submit this attempt anyway?`,
      { modal: true },
      'Submit Anyway'
    );

    if (choice !== 'Submit Anyway') return;
  }

  const studentName = await getStudentName(context);
  if (!studentName) return;

  const code = await readText(testRun.mainUri);
  const submittedAt = new Date().toISOString();
  const provisionalScore = Math.round((testRun.passed / testRun.total) * testRun.assignment.marks * 100) / 100;

  const submission = {
    version: 1,
    status: 'local_pending_server_upload',
    studentName,
    assignmentId: testRun.assignment.id,
    assignmentTitle: testRun.assignment.title,
    language: 'python',
    fileName: 'main.py',
    code,
    visibleTestsPassed: testRun.passed,
    visibleTestsTotal: testRun.total,
    provisionalVisibleScore: provisionalScore,
    maxMarks: testRun.assignment.marks,
    submittedAt,
    testResults: testRun.results
  };

  const rootUri = vscode.Uri.file(path.join(os.homedir(), 'Documents', 'Kaveri Coding', '.kaveri', 'submissions'));
  await vscode.workspace.fs.createDirectory(rootUri);

  const timestamp = submittedAt.replace(/[:.]/g, '-');
  const fileUri = vscode.Uri.joinPath(rootUri, `${testRun.assignment.id}-${timestamp}.json`);
  await writeText(fileUri, JSON.stringify(submission, null, 2));

  const action = await vscode.window.showInformationMessage(
    `Kaveri: Attempt saved — ${testRun.passed}/${testRun.total} visible tests passed.`,
    'Open Submission Record'
  );

  if (action === 'Open Submission Record') {
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });
  }
}

function activate(context) {
  const provider = new AssignmentsProvider();
  const currentAssignment = findCurrentAssignment();

  const testStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  testStatus.text = '$(beaker) Kaveri Tests';
  testStatus.tooltip = 'Run Kaveri assignment tests';
  testStatus.command = 'kaveri.runTests';

  const submitStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  submitStatus.text = '$(cloud-upload) Kaveri Submit';
  submitStatus.tooltip = 'Submit this Kaveri assignment attempt';
  submitStatus.command = 'kaveri.submitAnswer';

  if (currentAssignment) {
    testStatus.show();
    submitStatus.show();
  }

  context.subscriptions.push(
    testStatus,
    submitStatus,
    vscode.window.registerTreeDataProvider('kaveri.assignments', provider),
    vscode.commands.registerCommand('kaveri.refreshAssignments', () => provider.refresh()),
    vscode.commands.registerCommand('kaveri.openAssignment', openAssignment),
    vscode.commands.registerCommand('kaveri.openWorkspaceFolder', openCodingFolder),
    vscode.commands.registerCommand('kaveri.runTests', runTests),
    vscode.commands.registerCommand('kaveri.submitAnswer', () => submitAnswer(context))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
