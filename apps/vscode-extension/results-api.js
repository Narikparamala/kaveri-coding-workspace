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

async function fetchMyResults(context) {
  const session = await ensureSession(context);
  if (!session) return [];

  const fields = [
    'id',
    'assignment_key',
    'assignment_title',
    'visible_tests_passed',
    'visible_tests_total',
    'provisional_visible_score',
    'max_marks',
    'teacher_score',
    'teacher_feedback',
    'review_status',
    'reviewed_at',
    'submitted_at',
    'created_at'
  ].join(',');

  const query = `/rest/v1/coding_vscode_submissions?student_id=eq.${encodeURIComponent(session.user.id)}&select=${fields}&order=created_at.desc&limit=200`;
  const response = await fetch(`${SUPABASE_URL}${query}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`
    }
  });

  const rows = await parseResponse(response);
  return Array.isArray(rows) ? rows : [];
}

module.exports = { fetchMyResults };
