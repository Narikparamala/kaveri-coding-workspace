const { ensureSession } = require('./supabase');

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';

async function parseResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function joinBatchByCode(context, code) {
  const session = await ensureSession(context);
  if (!session) return undefined;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_batch_by_code`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_code: String(code || '').trim() })
  });

  const data = await parseResponse(response);
  return Array.isArray(data) ? data[0] : data;
}

module.exports = { joinBatchByCode };
