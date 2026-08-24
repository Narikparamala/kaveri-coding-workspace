import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const logEl = document.querySelector('#log');

function log(message, kind = '') {
  const stamp = new Date().toLocaleTimeString();
  const line = `[${stamp}] ${message}`;
  console.log('[Kaveri Batch Debug]', message);
  const span = document.createElement('div');
  span.textContent = line;
  if (kind) span.className = kind;
  logEl.appendChild(span);
}

function timeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms))
  ]);
}

async function runQueries(client, session) {
  log(`Session found for: ${session.user.email}`, 'ok');

  log('STEP 2 — Loading teacher profile…');
  const profileRes = await timeout(
    client.from('profiles').select('id,email,full_name,role,is_active').eq('id', session.user.id).maybeSingle(),
    6000,
    'Profile query'
  );
  if (profileRes.error) throw profileRes.error;
  log(`Profile: ${profileRes.data?.full_name || profileRes.data?.email || 'unknown'} | role=${profileRes.data?.role}`, 'ok');

  const checks = [
    ['batches', () => client.from('batches').select('id,name,status').limit(5)],
    ['students', () => client.from('profiles').select('id,email,full_name').eq('role', 'student').limit(5)],
    ['batch_students', () => client.from('batch_students').select('id,batch_id,student_id,status').limit(5)],
    ['assignments', () => client.from('coding_vscode_assignments').select('id,title,is_published').limit(5)],
    ['assignment targets', () => client.from('coding_vscode_assignment_batches').select('id,assignment_id,batch_id').limit(5)]
  ];

  for (const [name, query] of checks) {
    log(`STEP — Loading ${name}…`);
    const res = await timeout(query(), 6000, `${name} query`);
    if (res.error) throw res.error;
    log(`${name}: OK (${res.data?.length ?? 0} rows sampled)`, 'ok');
  }

  log('ALL CHECKS PASSED — Supabase data is healthy.', 'ok');
}

async function normalClientTest() {
  logEl.textContent = '';
  log('Kaveri Batch Manager diagnostic started.');
  log(`URL: ${location.href}`);
  log(`navigator.locks available: ${Boolean(navigator.locks)}`);
  log(`localStorage keys: ${Object.keys(localStorage).join(', ') || '(none)'}`);

  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  log('STEP 1 — Calling Supabase getSession() using normal browser lock…');

  try {
    const result = await timeout(client.auth.getSession(), 5000, 'getSession');
    if (result.error) throw result.error;
    if (!result.data.session) {
      log('No session found. Open Batch Manager and sign in again.', 'warn');
      return;
    }
    log('Normal getSession() returned successfully.', 'ok');
    await runQueries(client, result.data.session);
  } catch (error) {
    log(`NORMAL CLIENT FAILED: ${error.message || error}`, 'bad');
    log('Trying a diagnostic client that bypasses navigator.locks…', 'warn');
    await noLockClientTest();
  }
}

async function noLockClientTest() {
  const noLock = async (_name, _acquireTimeout, fn) => fn();
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { lock: noLock }
  });

  try {
    log('STEP 1B — Calling getSession() with no-lock client…');
    const result = await timeout(client.auth.getSession(), 5000, 'no-lock getSession');
    if (result.error) throw result.error;
    if (!result.data.session) {
      log('No session found with no-lock client.', 'warn');
      return;
    }
    log('NO-LOCK getSession() returned successfully.', 'ok');
    await runQueries(client, result.data.session);
    log('DIAGNOSIS: Browser auth lock is the problem. We can safely patch the local teacher dashboard client.', 'warn');
  } catch (error) {
    log(`NO-LOCK CLIENT ALSO FAILED: ${error.message || error}`, 'bad');
    log('Copy/screenshot these logs and send them to ChatGPT.', 'warn');
  }
}

window.addEventListener('error', (event) => log(`WINDOW ERROR: ${event.message}`, 'bad'));
window.addEventListener('unhandledrejection', (event) => log(`UNHANDLED PROMISE: ${event.reason?.message || event.reason}`, 'bad'));

normalClientTest();
