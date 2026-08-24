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

async function getRows(path, accessToken) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  return parseResponse(response);
}

async function fetchPublishedAssignments(context) {
  const session = await ensureSession(context);
  if (!session) return [];

  const assignmentQuery = '/rest/v1/coding_vscode_assignments?is_published=eq.true&language=eq.python&select=id,assignment_key,title,topic,question,language,file_name,starter_code,marks,updated_at&order=created_at.asc';
  const testQuery = '/rest/v1/coding_vscode_test_cases?is_hidden=eq.false&select=assignment_id,input_text,expected_output,position&order=position.asc';

  const [assignmentRows, testRows] = await Promise.all([
    getRows(assignmentQuery, session.access_token),
    getRows(testQuery, session.access_token)
  ]);

  const testsByAssignment = new Map();
  for (const test of testRows || []) {
    const list = testsByAssignment.get(test.assignment_id) || [];
    list.push([test.input_text ?? '', test.expected_output ?? '']);
    testsByAssignment.set(test.assignment_id, list);
  }

  return (assignmentRows || []).map((row) => {
    const tests = testsByAssignment.get(row.id) || [];
    return {
      id: row.assignment_key,
      databaseId: row.id,
      title: row.title,
      topic: row.topic || 'Python',
      marks: Number(row.marks || 0),
      question: row.question || '',
      language: row.language || 'python',
      fileName: row.file_name || 'main.py',
      starterCode: row.starter_code || '',
      examples: tests.slice(0, 2),
      tests,
      updatedAt: row.updated_at
    };
  });
}

module.exports = { fetchPublishedAssignments };
