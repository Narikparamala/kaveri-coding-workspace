const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';

const endpoint = `${SUPABASE_URL}/rest/v1/rpc/kaveri_connection_health`;

console.log('===== KAVERI SUPABASE TERMINAL TEST =====');
console.log('Node:', process.version);
console.log('Target:', SUPABASE_URL);
console.log('Testing Supabase health RPC...');

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: '{}',
    signal: AbortSignal.timeout(8000)
  });

  const text = await response.text();
  console.log('HTTP:', response.status, response.statusText);

  if (!response.ok) {
    console.error('FAIL — Supabase was reached, but the health RPC failed.');
    console.error(text);
    process.exitCode = 1;
  } else {
    const data = JSON.parse(text || '{}');
    console.log('PASS — Supabase connected.');
    console.log('Published assignments:', data.published_assignments ?? 'unknown');
    console.log('Checked at:', data.checked_at ?? 'unknown');
  }
} catch (error) {
  console.error('FAIL — Could not complete Supabase request.');
  console.error(error?.message || error);
  process.exitCode = 1;
}
