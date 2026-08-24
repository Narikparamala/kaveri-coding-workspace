# Kaveri Coding — Tomorrow Rollout Checklist

## Freeze
- Do not change UI/theme/navbar during rollout.
- Use the current working dashboard and Batch Manager V2.

## Teacher/admin
- Deploy `apps/dashboard` publicly on Vercel.
- Add the production Vercel URL to Supabase Auth redirect URLs.
- Verify `/` and `/batches-v2.html` from a normal browser outside the development machine.

## Student extension
- Package `apps/vscode-extension` version 0.10.0 as `kaveri-coding.vsix`.
- Verify package contains `batch-api.js` and Join Batch.
- Install on one clean VS Code profile/device before mass rollout.

## Student flow
1. Install Python and VS Code if missing.
2. Install `kaveri-coding.vsix`.
3. Restart VS Code.
4. Open Kaveri Coding icon.
5. Sign in with the student's own Google account.
6. Join Batch using teacher-provided code.
7. Refresh Assignments.
8. Open assignment, write code, Run Tests, Submit Answer.

## Teacher flow
1. Create/confirm batches.
2. Generate one join code per batch.
3. Target published questions to the correct batch.
4. Review submissions and save mark/feedback.
5. Students refresh My Results.

## Rollout rule
If a student has an installation/login issue, move them aside for individual support instead of blocking the whole batch setup.
