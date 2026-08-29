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

function headers(accessToken, prefer) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function getRows(path, accessToken) {
  return parseResponse(await fetch(`${SUPABASE_URL}${path}`, { headers: headers(accessToken) }));
}

async function createWorkspaceFiles(accessToken, rows) {
  return parseResponse(await fetch(
    `${SUPABASE_URL}/rest/v1/project_workspace_files?on_conflict=project_id,student_id,file_path`,
    {
      method: 'POST',
      headers: headers(accessToken, 'resolution=merge-duplicates,return=representation'),
      body: JSON.stringify(rows)
    }
  ));
}

async function loadProjectWorkspace(context, projectId) {
  const session = await ensureSession(context);
  if (!session) return undefined;
  if (session.profile?.role && !['student', 'super_admin'].includes(session.profile.role)) {
    throw new Error('Open in VS Code is available for students and Super Admin testing.');
  }

  const encodedId = encodeURIComponent(projectId);
  const [projects, starterFiles, existingFiles] = await Promise.all([
    getRows(`/rest/v1/projects?id=eq.${encodedId}&is_published=eq.true&select=id,title,project_type,course_id&limit=1`, session.access_token),
    getRows(`/rest/v1/project_starter_files?project_id=eq.${encodedId}&select=file_path,content,language,order_index&order=order_index.asc`, session.access_token),
    getRows(`/rest/v1/project_workspace_files?project_id=eq.${encodedId}&select=id,file_path,content,language,order_index,updated_at&order=order_index.asc`, session.access_token)
  ]);

  const project = projects?.[0];
  if (!project) throw new Error('This published project is unavailable or you are not enrolled in its course.');
  if (existingFiles?.length) return { project, files: existingFiles, session };

  const initial = (starterFiles || []).map((file, index) => ({
    project_id: project.id,
    student_id: session.user.id,
    file_path: file.file_path,
    content: file.content || '',
    language: file.language || 'text',
    order_index: file.order_index ?? index
  }));
  if (!initial.length) {
    initial.push({
      project_id: project.id,
      student_id: session.user.id,
      file_path: 'README.md',
      content: `# ${project.title}\n`,
      language: 'markdown',
      order_index: 0
    });
  }

  const created = await createWorkspaceFiles(session.access_token, initial);
  return { project, files: created || [], session };
}

async function saveProjectFile(context, projectId, filePath, content) {
  const session = await ensureSession(context);
  if (!session) return false;
  await parseResponse(await fetch(
    `${SUPABASE_URL}/rest/v1/project_workspace_files?on_conflict=project_id,student_id,file_path`,
    {
      method: 'POST',
      headers: headers(session.access_token, 'resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify({
        project_id: projectId,
        student_id: session.user.id,
        file_path: filePath,
        content,
        language: filePath.split('.').pop()?.toLowerCase() || 'text'
      })
    }
  ));
  return true;
}

module.exports = { loadProjectWorkspace, saveProjectFile };
