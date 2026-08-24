const vscode = require('vscode');

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const SESSION_SECRET = 'kaveri.supabaseSession.v1';

async function parseResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function authRequest(path, body) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return parseResponse(response);
}

async function fetchProfile(accessToken, userId) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,full_name,role&limit=1`,
      {
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const rows = await parseResponse(response);
    return Array.isArray(rows) ? rows[0] : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSession(data, profile) {
  const expiresIn = Number(data.expires_in || 3600);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    user: data.user,
    profile
  };
}

async function saveSession(context, session) {
  await context.secrets.store(SESSION_SECRET, JSON.stringify(session));
}

async function loadSession(context) {
  const raw = await context.secrets.get(SESSION_SECRET);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    await context.secrets.delete(SESSION_SECRET);
    return undefined;
  }
}

async function refreshSession(context, session) {
  if (!session?.refresh_token) return undefined;

  try {
    const data = await authRequest('/auth/v1/token?grant_type=refresh_token', {
      refresh_token: session.refresh_token
    });
    const profile = await fetchProfile(data.access_token, data.user.id);
    const refreshed = normalizeSession(data, profile);
    await saveSession(context, refreshed);
    return refreshed;
  } catch {
    await context.secrets.delete(SESSION_SECRET);
    return undefined;
  }
}

async function signIn(context) {
  const email = await vscode.window.showInputBox({
    title: 'Kaveri Coding — Sign In',
    prompt: 'Enter the email used for your Kaveri account.',
    placeHolder: 'student@example.com',
    ignoreFocusOut: true,
    validateInput: (value) => value.includes('@') ? undefined : 'Enter a valid email address.'
  });

  if (!email) return undefined;

  const password = await vscode.window.showInputBox({
    title: 'Kaveri Coding — Sign In',
    prompt: 'Enter your Kaveri account password.',
    password: true,
    ignoreFocusOut: true
  });

  if (!password) return undefined;

  try {
    const data = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Kaveri: Signing in...',
        cancellable: false
      },
      () => authRequest('/auth/v1/token?grant_type=password', {
        email: email.trim(),
        password
      })
    );

    const profile = await fetchProfile(data.access_token, data.user.id);
    const session = normalizeSession(data, profile);
    await saveSession(context, session);

    const displayName = profile?.full_name || data.user?.email || 'Kaveri user';
    vscode.window.showInformationMessage(`Kaveri: Signed in as ${displayName}.`);
    return session;
  } catch (error) {
    vscode.window.showErrorMessage(`Kaveri sign-in failed: ${error.message}`);
    return undefined;
  }
}

async function ensureSession(context) {
  let session = await loadSession(context);

  if (session && session.access_token && session.expires_at > Date.now()) {
    return session;
  }

  if (session) {
    session = await refreshSession(context, session);
    if (session) return session;
  }

  return signIn(context);
}

async function signOut(context) {
  await context.secrets.delete(SESSION_SECRET);
  vscode.window.showInformationMessage('Kaveri: Signed out from this VS Code installation.');
}

async function uploadSubmission(context, localSubmission) {
  const session = await ensureSession(context);
  if (!session) return undefined;

  const studentName = session.profile?.full_name
    || session.user?.user_metadata?.full_name
    || localSubmission.studentName
    || session.user?.email
    || 'Student';

  const payload = {
    student_id: session.user.id,
    student_name_snapshot: studentName,
    assignment_key: localSubmission.assignmentId,
    assignment_title: localSubmission.assignmentTitle,
    language: localSubmission.language || 'python',
    file_name: localSubmission.fileName || 'main.py',
    code: localSubmission.code || '',
    visible_tests_passed: Number(localSubmission.visibleTestsPassed || 0),
    visible_tests_total: Number(localSubmission.visibleTestsTotal || 0),
    provisional_visible_score: Number(localSubmission.provisionalVisibleScore || 0),
    max_marks: Number(localSubmission.maxMarks || 0),
    test_results: localSubmission.testResults || [],
    submitted_at: localSubmission.submittedAt || new Date().toISOString()
  };

  const doUpload = async (activeSession) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/coding_vscode_submissions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${activeSession.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    });
    return parseResponse(response);
  };

  try {
    const rows = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Kaveri: Uploading submission...',
        cancellable: false
      },
      () => doUpload(session)
    );

    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (error.status === 401) {
      const refreshed = await refreshSession(context, session);
      if (refreshed) {
        try {
          const rows = await doUpload(refreshed);
          return Array.isArray(rows) ? rows[0] : rows;
        } catch (retryError) {
          throw retryError;
        }
      }
    }
    throw error;
  }
}

module.exports = {
  signIn,
  signOut,
  ensureSession,
  uploadSubmission
};
