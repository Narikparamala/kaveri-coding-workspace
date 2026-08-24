const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';

const statusEl = document.querySelector('#status');
const logEl = document.querySelector('#log');
const runButton = document.querySelector('#run');

function log(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  console.log(`[Kaveri Supabase Test] ${message}`);
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

async function runTest() {
  logEl.textContent = '';
  runButton.disabled = true;
  setStatus('Testing Supabase connection…', 'wait');

  const endpoint = `${SUPABASE_URL}/rest/v1/rpc/kaveri_connection_health`;
  log('Browser JavaScript is running.');
  log('Calling Supabase health RPC…');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: '{}',
      signal: controller.signal
    });

    log(`HTTP status: ${response.status} ${response.statusText}`);
    const bodyText = await response.text();

    if (!response.ok) {
      log(`Response body: ${bodyText}`);
      setStatus(`Supabase reachable, but health RPC failed with HTTP ${response.status}.`, 'fail');
      return;
    }

    const data = JSON.parse(bodyText || '{}');
    log('Supabase health RPC returned successfully.');
    log(`Published assignments: ${data.published_assignments ?? 'unknown'}`);
    log(`Checked at: ${data.checked_at ?? 'unknown'}`);

    setStatus(`PASS — Supabase connected. ${data.published_assignments ?? 0} published assignment(s) in database.`, 'pass');
  } catch (error) {
    if (error.name === 'AbortError') {
      log('ERROR: Request timed out after 8 seconds.');
      setStatus('FAIL — Supabase request timed out.', 'fail');
    } else {
      log(`ERROR: ${error.message || error}`);
      setStatus(`FAIL — ${error.message || error}`, 'fail');
    }
  } finally {
    clearTimeout(timer);
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', runTest);
runTest();
