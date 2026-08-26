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

async function postRpc(name, accessToken, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

function mapAssignment(row, { locked = false } = {}) {
  const tests = Array.isArray(row.visible_tests) ? row.visible_tests : [];
  return {
    id: row.assignment_key,
    databaseId: row.database_id || row.id,
    title: row.title,
    topic: row.topic || 'Python',
    marks: Number(row.marks || 0),
    question: locked ? '' : (row.question || ''),
    language: row.language || 'python',
    fileName: row.file_name || 'main.py',
    starterCode: locked ? '' : (row.starter_code || ''),
    examples: locked ? [] : tests.slice(0, 2),
    tests: locked ? [] : tests,
    updatedAt: row.updated_at,
    isLocked: locked,
    isUnlocked: !locked,
    liveAvailable: Boolean(row.live_available),
    batchId: row.batch_id || null,
    batchName: row.batch_name || '',
    accessSource: row.access_source || (locked ? 'locked' : 'staff_preview'),
    accessUntil: row.access_until || null,
    requestStatus: row.request_status || null
  };
}

async function fetchStaffPublishedAssignments(session) {
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

  return (assignmentRows || []).map((row) => mapAssignment({
    ...row,
    database_id: row.id,
    visible_tests: testsByAssignment.get(row.id) || []
  }));
}

async function fetchClassroomAssignments(context, existingSession) {
  const session = existingSession || await ensureSession(context);
  if (!session) return [];

  const role = session.profile?.role;
  if (role && role !== 'student') {
    return fetchStaffPublishedAssignments(session);
  }

  const rows = await postRpc('get_my_coding_classroom_assignments', session.access_token);
  return (rows || []).map((row) => mapAssignment(row, { locked: !row.is_unlocked }));
}

async function fetchPublishedAssignments(context) {
  const session = await ensureSession(context);
  if (!session) return [];

  const role = session.profile?.role;
  if (role && role !== 'student') {
    return fetchStaffPublishedAssignments(session);
  }

  const classroom = await fetchClassroomAssignments(context, session);
  return classroom.filter((assignment) => !assignment.isLocked);
}

async function joinLiveClass(context, batchId) {
  const session = await ensureSession(context);
  if (!session) return undefined;
  if (!batchId) throw new Error('Your active batch could not be identified.');

  const rows = await postRpc('join_coding_live_class', session.access_token, {
    p_batch_id: batchId
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function requestAssignmentAccess(context, assignment, reason = '') {
  const session = await ensureSession(context);
  if (!session) return undefined;
  if (!assignment?.databaseId || !assignment?.batchId) {
    throw new Error('This question is not linked to your active class.');
  }

  const rows = await postRpc('request_coding_assignment_access', session.access_token, {
    p_assignment_id: assignment.databaseId,
    p_batch_id: assignment.batchId,
    p_reason: reason || null
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

module.exports = {
  fetchPublishedAssignments,
  fetchClassroomAssignments,
  joinLiveClass,
  requestAssignmentAccess
};
