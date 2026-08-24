const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';

const endpoint = `${SUPABASE_URL}/rest/v1/coding_vscode_assignments?select=id,assignment_key,title,is_published&is_published=eq.true&order=title.asc&limit=10`;

console.log('===== KAVERI SUPABASE TERMINAL TEST =====');
console.log('Node:', process.version);
console.log('Target:', SUPABASE_URL);
console.log('Testing published coding assignments...');

try {
  const response = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
    },
    signal: AbortSignal.timeout(8000)
  });

  const text = await response.text();
  console.log('HTTP:', response.status, response.statusText);

  if (!response.ok) {
    console.error('FAIL — Supabase was reached, but the request failed.');
    console.error(text);
    process.exitCode = 1;
  } else {
    const rows = JSON.parse(text || '[]');
    console.log(`PASS — Supabase connected. Returned ${rows.length} published assignment(s).`);
    for (const row of rows) {
      console.log(`  ✓ ${row.title} [${row.assignment_key}]`);
    }
  }
} catch (error) {
  console.error('FAIL — Could not complete Supabase request.');
  console.error(error?.message || error);
  process.exitCode = 1;
}
