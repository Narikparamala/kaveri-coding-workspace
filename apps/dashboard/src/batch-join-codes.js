import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://atcncxckuokjarsxckwy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A5ARKVkEnJVtGV0mxrdtyw_3YmLQ4nu';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentRole = null;
let batchesById = new Map();
let enhancing = false;

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeJoinCode() {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  return `KAV-${suffix}`;
}

function injectStyles() {
  if (document.querySelector('#kaveri-join-code-styles')) return;
  const style = document.createElement('style');
  style.id = 'kaveri-join-code-styles';
  style.textContent = `
    .join-code-panel { margin-top: 14px; padding: 13px 14px; border: 1px dashed #315071; border-radius: 12px; background: rgba(15, 32, 54, .72); display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .join-code-copy { display: grid; gap: 4px; min-width: 0; }
    .join-code-copy small { color: #7890aa; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .join-code-value { font-family: "Cascadia Code", Consolas, monospace; font-weight: 800; letter-spacing: .08em; color: #ffe08a; font-size: 16px; }
    .join-code-value.empty { color: #7890aa; font-weight: 500; letter-spacing: 0; font-size: 13px; }
    .join-code-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .join-code-button { border: 1px solid #35506f; background: #142238; color: #cfe0f2; border-radius: 9px; padding: 7px 10px; cursor: pointer; font-weight: 700; }
    .join-code-button.primary-code { background: rgba(240, 180, 41, .14); border-color: #6b5422; color: #ffd266; }
    .join-code-button:disabled { opacity: .55; cursor: wait; }
    @media (max-width: 760px) { .join-code-panel { align-items: flex-start; flex-direction: column; } .join-code-actions { justify-content: flex-start; } }
  `;
  document.head.appendChild(style);
}

async function loadRoleAndCodes() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const [{ data: profile }, { data: batches, error }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle(),
    supabase.from('batches').select('id,name,join_code').order('created_at')
  ]);

  if (error) return;
  currentRole = profile?.role || null;
  batchesById = new Map((batches || []).map((batch) => [batch.id, batch]));
  enhanceCards();
}

function panelHtml(batch) {
  const code = batch?.join_code || '';
  const canGenerate = currentRole === 'super_admin';
  return `
    <div class="join-code-copy">
      <small>Student join code</small>
      <span class="join-code-value ${code ? '' : 'empty'}">${code || 'No join code generated yet'}</span>
    </div>
    <div class="join-code-actions">
      ${code ? '<button type="button" class="join-code-button copy-join-code">Copy code</button>' : ''}
      ${canGenerate ? `<button type="button" class="join-code-button primary-code generate-join-code">${code ? 'Regenerate' : 'Generate code'}</button>` : ''}
    </div>`;
}

function enhanceCards() {
  if (enhancing) return;
  enhancing = true;
  try {
    document.querySelectorAll('.batch-card[data-batch-id]').forEach((card) => {
      const batchId = card.dataset.batchId;
      const batch = batchesById.get(batchId);
      if (!batch) return;

      let panel = card.querySelector('.join-code-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'join-code-panel';
        panel.dataset.batchId = batchId;
        const memberList = card.querySelector('.member-list');
        if (memberList) card.insertBefore(panel, memberList);
        else card.appendChild(panel);
      }
      panel.innerHTML = panelHtml(batch);
    });
  } finally {
    enhancing = false;
  }
}

async function generateCode(button, batchId) {
  const batch = batchesById.get(batchId);
  if (!batch || currentRole !== 'super_admin') return;

  if (batch.join_code) {
    const ok = window.confirm(`Regenerate the join code for "${batch.name}"?\n\nThe old code will stop working immediately.`);
    if (!ok) return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Saving…';

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = makeJoinCode();
    const { error } = await supabase.from('batches').update({ join_code: code, updated_at: new Date().toISOString() }).eq('id', batchId);
    if (!error) {
      batch.join_code = code;
      enhanceCards();
      try { await navigator.clipboard.writeText(code); } catch { /* Clipboard permission is optional. */ }
      alert(`Join code ready for ${batch.name}:\n\n${code}\n\nStudents can enter this code in Kaveri Coding → Join Batch.`);
      return;
    }
    if (!String(error.message || '').toLowerCase().includes('duplicate')) {
      alert(`Could not generate join code: ${error.message}`);
      break;
    }
  }

  button.disabled = false;
  button.textContent = original;
}

async function copyCode(batchId) {
  const code = batchesById.get(batchId)?.join_code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    alert(`Copied: ${code}`);
  } catch {
    window.prompt('Copy this batch join code:', code);
  }
}

document.addEventListener('click', (event) => {
  const generate = event.target.closest('.generate-join-code');
  if (generate) {
    const panel = generate.closest('.join-code-panel');
    generateCode(generate, panel?.dataset.batchId);
    return;
  }

  const copy = event.target.closest('.copy-join-code');
  if (copy) {
    const panel = copy.closest('.join-code-panel');
    copyCode(panel?.dataset.batchId);
  }
});

injectStyles();
const observer = new MutationObserver(() => enhanceCards());
observer.observe(document.body, { childList: true, subtree: true });
supabase.auth.onAuthStateChange(() => setTimeout(loadRoleAndCodes, 0));
loadRoleAndCodes();
