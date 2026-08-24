const vscode = require('vscode');
const crypto = require('crypto');

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const SESSION_SECRET = 'kaveri.supabaseSession.v1';
const OAUTH_STATE_KEY = 'kaveri.googleOAuthState.v1';

let pendingOAuth;

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

async function fetchAuthUser(accessToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
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

function finishPendingOAuth(error, session) {
  if (!pendingOAuth) return;
  clearTimeout(pendingOAuth.timer);
  const { resolve, reject } = pendingOAuth;
  pendingOAuth = undefined;
  if (error) reject(error);
  else resolve(session);
}

async function cancelPendingOAuth(context) {
  if (pendingOAuth) {
    clearTimeout(pendingOAuth.timer);
    const { resolve } = pendingOAuth;
    pendingOAuth = undefined;
    resolve(undefined);
  }
  await context.globalState.update(OAUTH_STATE_KEY, undefined);
}

async function handleAuthUri(context, uri) {
  if (uri.path !== '/auth-callback') return;

  const query = new URLSearchParams(uri.query || '');
  const fragment = new URLSearchParams(uri.fragment || '');
  const expectedState = context.globalState.get(OAUTH_STATE_KEY);
  const receivedState = query.get('state');

  const oauthError = fragment.get('error_description')
    || query.get('error_description')
    || fragment.get('error')
    || query.get('error');

  if (oauthError) {
    await context.globalState.update(OAUTH_STATE_KEY, undefined);
    finishPendingOAuth(new Error(oauthError));
    vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${oauthError}`);
    return;
  }

  if (!expectedState || receivedState !== expectedState) {
    const error = new Error('The Google sign-in response could not be verified. Please try again.');
    finishPendingOAuth(error);
    vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${error.message}`);
    return;
  }

  const accessToken = fragment.get('access_token') || query.get('access_token');
  const refreshToken = fragment.get('refresh_token') || query.get('refresh_token');
  const expiresIn = fragment.get('expires_in') || query.get('expires_in') || '3600';

  if (!accessToken) {
    const error = new Error('Google sign-in returned without a Supabase access token.');
    finishPendingOAuth(error);
    vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${error.message}`);
    return;
  }

  try {
    const user = await fetchAuthUser(accessToken);
    const profile = await fetchProfile(accessToken, user.id);
    const session = normalizeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(expiresIn),
      user
    }, profile);

    await saveSession(context, session);
    await context.globalState.update(OAUTH_STATE_KEY, undefined);

    const displayName = profile?.full_name
      || user?.user_metadata?.full_name
      || user?.user_metadata?.name
      || user?.email
      || 'Kaveri user';

    vscode.window.showInformationMessage(`Kaveri: Signed in with Google as ${displayName}.`);
    finishPendingOAuth(undefined, session);
  } catch (error) {
    await context.globalState.update(OAUTH_STATE_KEY, undefined);
    finishPendingOAuth(error);
    vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${error.message}`);
  }
}

async function signIn(context) {
  const existing = await loadSession(context);
  if (existing?.access_token && existing.expires_at > Date.now()) {
    const displayName = existing.profile?.full_name
      || existing.user?.user_metadata?.full_name
      || existing.user?.email
      || 'Kaveri user';
    vscode.window.showInformationMessage(`Kaveri: Already signed in as ${displayName}.`);
    return existing;
  }

  if (pendingOAuth) {
    const choice = await vscode.window.showWarningMessage(
      'Kaveri: A previous Google sign-in is still waiting. Restart it?',
      'Restart Sign-In',
      'Cancel'
    );

    if (choice !== 'Restart Sign-In') return undefined;
    await cancelPendingOAuth(context);
  }

  const state = crypto.randomBytes(24).toString('hex');
  await context.globalState.update(OAUTH_STATE_KEY, state);

  const callbackUri = `${vscode.env.uriScheme}://kaveritechnologies.kaveri-coding/auth-callback?state=${encodeURIComponent(state)}`;
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUri)}`;

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const timer = setTimeout(async () => {
    if (!pendingOAuth) return;
    pendingOAuth = undefined;
    await context.globalState.update(OAUTH_STATE_KEY, undefined);
    rejectPromise(new Error('Google sign-in timed out. Please try again.'));
  }, 5 * 60 * 1000);

  pendingOAuth = {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    timer
  };

  const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
  if (!opened) {
    clearTimeout(timer);
    pendingOAuth = undefined;
    await context.globalState.update(OAUTH_STATE_KEY, undefined);
    vscode.window.showErrorMessage('Kaveri could not open the Google sign-in page in your browser.');
    return undefined;
  }

  vscode.window.showInformationMessage('Kaveri: Complete Google sign-in in your browser. VS Code will continue automatically.');

  try {
    return await promise;
  } catch (error) {
    vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${error.message}`);
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
  await cancelPendingOAuth(context);
  vscode.window.showInformationMessage('Kaveri: Signed out from this VS Code installation.');
}

async function uploadSubmission(context, localSubmission) {
  const session = await ensureSession(context);
  if (!session) return undefined;

  const studentName = session.profile?.full_name
    || session.user?.user_metadata?.full_name
    || session.user?.user_metadata?.name
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
        const rows = await doUpload(refreshed);
        return Array.isArray(rows) ? rows[0] : rows;
      }
    }
    throw error;
  }
}

module.exports = {
  signIn,
  signOut,
  ensureSession,
  uploadSubmission,
  handleAuthUri
};
