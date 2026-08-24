const vscode = require('vscode');
const path = require('path');
const os = require('os');

const assignments = [
  {
    id: 'sum-1-to-n',
    title: 'Sum of Numbers 1 to N',
    topic: 'Loops',
    marks: 10,
    question: 'Write a Python program to find the sum of all numbers from 1 to N.',
    examples: [['5', '15'], ['10', '55']]
  },
  {
    id: 'even-or-odd',
    title: 'Even or Odd',
    topic: 'Conditions',
    marks: 10,
    question: 'Read an integer and print Even if it is even, otherwise print Odd.',
    examples: [['8', 'Even'], ['7', 'Odd']]
  },
  {
    id: 'reverse-number',
    title: 'Reverse a Number',
    topic: 'Loops',
    marks: 10,
    question: 'Write a Python program to reverse the digits of a positive integer.',
    examples: [['1234', '4321'], ['500', '5']]
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

function questionText(a) {
  const examples = a.examples.map((e, i) =>
    `## Example ${i + 1}\n\nInput:\n\`\`\`text\n${e[0]}\n\`\`\`\n\nExpected Output:\n\`\`\`text\n${e[1]}\n\`\`\``
  ).join('\n\n');
  return `# ${a.title}\n\n**Topic:** ${a.topic}  \n**Marks:** ${a.marks}\n\n## Question\n\n${a.question}\n\n${examples}\n\nWrite your solution in \`main.py\`.\n`;
}

async function writeText(uri, text) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
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
      await writeText(mainUri, `# ${a.title}\n# ${a.marks} marks\n\n# Write your solution below\n\n`);
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

function activate(context) {
  const provider = new AssignmentsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kaveri.assignments', provider),
    vscode.commands.registerCommand('kaveri.refreshAssignments', () => provider.refresh()),
    vscode.commands.registerCommand('kaveri.openAssignment', openAssignment),
    vscode.commands.registerCommand('kaveri.openWorkspaceFolder', openCodingFolder)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
