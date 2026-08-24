# Kaveri Coding Workspace

Emergency coding-assignment system for Kaveri Technologies.

## Current milestone: VS Code extension v0.1

The extension currently provides:

- Kaveri Coding icon in the VS Code activity bar
- My Assignments sidebar
- Three sample Python assignments
- Click an assignment to create a real folder on the student's computer
- Creates `question.md` and `main.py`
- Keeps an existing `main.py` safe when reopening the assignment

Assignments are created under:

```text
C:\Users\<student>\Documents\Kaveri Coding\Python\<Assignment Name>\
```

## Run the extension locally

From the repository root:

```powershell
git pull
code .
```

Then open **Run and Debug** in VS Code and choose:

```text
Run Kaveri Coding Extension
```

Start debugging. A new **Extension Development Host** window opens. Click the Kaveri graduation-cap icon in its activity bar and open an assignment.

## Next milestones

1. Visible test runner
2. Submit button
3. Supabase authentication and assignments API
4. Hidden server-side tests and automatic marks
5. Teacher dashboard
6. Projects and question bank
