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

  const endpoint = `${SUPABASE_URL}/rest/v1/coding_vscode_assignments?select=id,assignment_key,title,is_published&is_published=eq.true&order=title.asc&limit=10`;
  log(`Browser JavaScript is running.`);
  log(`Requesting published assignments from Supabase…`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      },
      signal: controller.signal
    });

    log(`HTTP status: ${response.status} ${response.statusText}`);
    const bodyText = await response.text();

    if (!response.ok) {
      log(`Response body: ${bodyText}`);
      setStatus(`Supabase reachable, but request failed with HTTP ${response.status}.`, 'fail');
      return;
    }

    const rows = JSON.parse(bodyText || '[]');
    log(`Supabase returned ${rows.length} published assignment(s).`);
    for (const row of rows) {
      log(`✓ ${row.title} (${row.assignment_key})`);
    }

    setStatus(`PASS — Supabase connected. ${rows.length} published assignment(s) returned.`, 'pass');
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
