const vscode = require('vscode');
const crypto = require('crypto');
const http = require('http');

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const SESSION_SECRET = 'kaveri.supabaseSession.v1';
const OAUTH_STATE_KEY = 'kaveri.googleOAuthState.v1';
const LOCAL_AUTH_HOST = '127.0.0.1';
const LOCAL_AUTH_PORT = 54321;

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

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function closeServer(server) {
  if (!server) return;
  try {
    server.close();
  } catch {
    // Ignore shutdown errors.
  }
}

function finishPendingOAuth(error, session) {
  if (!pendingOAuth) return;
  clearTimeout(pendingOAuth.timer);
  closeServer(pendingOAuth.server);
  const { resolve, reject } = pendingOAuth;
  pendingOAuth = undefined;
  if (error) reject(error);
  else resolve(session);
}

async function cancelPendingOAuth(context) {
  if (pendingOAuth) {
    clearTimeout(pendingOAuth.timer);
    closeServer(pendingOAuth.server);
    const { resolve } = pendingOAuth;
    pendingOAuth = undefined;
    resolve(undefined);
  }
  await context.globalState.update(OAUTH_STATE_KEY, undefined);
}

function authPage(title, message, success) {
  const symbol = success ? '✅' : '❌';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#0f172a; color:#e2e8f0; display:grid; place-items:center; min-height:100vh; margin:0; }
    main { max-width:560px; padding:32px; background:#111827; border:1px solid #334155; border-radius:18px; text-align:center; }
    h1 { margin-top:0; }
    p { color:#cbd5e1; line-height:1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${symbol} ${title}</h1>
    <p>${message}</p>
    <p>You can close this browser tab and return to VS Code.</p>
  </main>
</body>
</html>`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(LOCAL_AUTH_PORT, LOCAL_AUTH_HOST);
  });
}

async function signIn(context) {
  const existing = await loadSession(context);
  if (existing?.access_token && existing.expires_at > Date.now()) {
    const displayName = existing.profile?.full_name
      || existing.user?.user_metadata?.full_name
      || existing.user?.user_metadata?.name
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
  const { verifier, challenge } = createPkcePair();
  const callbackPath = `/auth-callback/${state}`;
  const callbackUrl = `http://${LOCAL_AUTH_HOST}:${LOCAL_AUTH_PORT}${callbackPath}`;
  await context.globalState.update(OAUTH_STATE_KEY, state);

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${LOCAL_AUTH_HOST}:${LOCAL_AUTH_PORT}`);

    if (requestUrl.pathname !== callbackPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const oauthError = requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error');
    if (oauthError) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(authPage('Kaveri sign-in failed', oauthError, false));
      await context.globalState.update(OAUTH_STATE_KEY, undefined);
      finishPendingOAuth(new Error(oauthError));
      return;
    }

    const code = requestUrl.searchParams.get('code');
    if (!code) {
      const error = new Error('Google sign-in returned without an authorization code.');
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(authPage('Kaveri sign-in failed', error.message, false));
      await context.globalState.update(OAUTH_STATE_KEY, undefined);
      finishPendingOAuth(error);
      return;
    }

    try {
      const data = await authRequest('/auth/v1/token?grant_type=pkce', {
        auth_code: code,
        code_verifier: verifier
      });

      const profile = await fetchProfile(data.access_token, data.user.id);
      const session = normalizeSession(data, profile);
      await saveSession(context, session);
      await context.globalState.update(OAUTH_STATE_KEY, undefined);

      const displayName = profile?.full_name
        || data.user?.user_metadata?.full_name
        || data.user?.user_metadata?.name
        || data.user?.email
        || 'Kaveri user';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(authPage('Kaveri sign-in complete', `Signed in as ${displayName}.`, true));
      vscode.window.showInformationMessage(`Kaveri: Signed in with Google as ${displayName}.`);
      finishPendingOAuth(undefined, session);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(authPage('Kaveri sign-in failed', error.message, false));
      await context.globalState.update(OAUTH_STATE_KEY, undefined);
      finishPendingOAuth(error);
      vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${error.message}`);
    }
  });

  try {
    await listen(server);
  } catch (error) {
    closeServer(server);
    await context.globalState.update(OAUTH_STATE_KEY, undefined);
    const message = error.code === 'EADDRINUSE'
      ? `Port ${LOCAL_AUTH_PORT} is already in use. Close the other Kaveri sign-in attempt and try again.`
      : error.message;
    vscode.window.showErrorMessage(`Kaveri Google sign-in failed: ${message}`);
    return undefined;
  }

  const timer = setTimeout(async () => {
    if (!pendingOAuth) return;
    closeServer(server);
    pendingOAuth = undefined;
    await context.globalState.update(OAUTH_STATE_KEY, undefined);
    rejectPromise(new Error('Google sign-in timed out. Please try again.'));
  }, 5 * 60 * 1000);

  pendingOAuth = {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    timer,
    server
  };

  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=s256`;
  const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));

  if (!opened) {
    await cancelPendingOAuth(context);
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
  uploadSubmission
};
