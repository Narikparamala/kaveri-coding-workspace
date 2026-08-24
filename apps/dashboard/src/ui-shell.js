const THEME_KEY = 'kaveri-admin-theme';

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_KEY, theme);

  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (schemeMeta) schemeMeta.setAttribute('content', 'light dark');

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#07111f' : '#004b8d');

  const button = document.querySelector('#theme-toggle');
  if (button) {
    const isDark = theme === 'dark';
    button.textContent = isDark ? '☀' : '☾';
    button.title = isDark ? 'Use light mode' : 'Use dark mode';
    button.setAttribute('aria-label', button.title);
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function closeMobileMenu(topbar) {
  if (!topbar) return;
  topbar.classList.remove('mobile-open');
  const toggle = topbar.querySelector('.mobile-menu-toggle');
  if (toggle) {
    toggle.textContent = '☰';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
  }
}

function ensureMobileMenu(topbar) {
  if (!topbar || topbar.querySelector('.mobile-menu-toggle')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mobile-menu-toggle';
  button.textContent = '☰';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Open navigation menu');

  button.addEventListener('click', () => {
    const open = topbar.classList.toggle('mobile-open');
    button.textContent = open ? '✕' : '☰';
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  });

  topbar.appendChild(button);
}

function ensureBatchNavigation() {
  if (location.pathname !== '/batches-v2.html') return;

  const title = document.querySelector('.batch-topbar h1');
  if (title) title.textContent = 'Batch Manager';

  const batchNav = document.querySelector('.batch-nav');
  if (!batchNav || batchNav.querySelector('.section-tabs')) return;

  batchNav.innerHTML = `
    <nav class="section-tabs batch-section-tabs" aria-label="Coding dashboard sections">
      <a href="/" class="nav-tab batch-nav-link">Submissions</a>
      <a href="/?view=questions" class="nav-tab batch-nav-link">Questions</a>
      <span class="nav-tab active batch-nav-link" aria-current="page">Batches</span>
    </nav>
  `;
}

function honorQuestionView() {
  if (location.pathname !== '/' && location.pathname !== '/index.html') return;
  if (new URLSearchParams(location.search).get('view') !== 'questions') return;

  const questionButton = document.querySelector('[data-view="questions"]');
  if (questionButton && !questionButton.classList.contains('active')) {
    questionButton.click();
    history.replaceState({}, '', '/');
  }
}

function decorateShell() {
  document.querySelector('.batch-manager-shortcut')?.remove();

  ensureBatchNavigation();
  honorQuestionView();

  const topbar = document.querySelector('.topbar');
  ensureMobileMenu(topbar);

  const teacherBlock = document.querySelector('.teacher-block');
  if (teacherBlock && !document.querySelector('#theme-toggle')) {
    const button = document.createElement('button');
    button.id = 'theme-toggle';
    button.className = 'icon-button theme-toggle';
    button.type = 'button';
    button.addEventListener('click', toggleTheme);

    const refresh = teacherBlock.querySelector('#refresh');
    if (refresh) teacherBlock.insertBefore(button, refresh);
    else teacherBlock.prepend(button);

    applyTheme(document.documentElement.dataset.theme || preferredTheme());
  }

  const sectionTabs = document.querySelector('.section-tabs');
  if (sectionTabs && location.pathname !== '/batches-v2.html' && !sectionTabs.querySelector('.manage-batches-link')) {
    const link = document.createElement('a');
    link.href = '/batches-v2.html';
    link.className = 'nav-tab manage-batches-link';
    link.textContent = 'Batches';
    link.setAttribute('aria-label', 'Manage coding batches');
    sectionTabs.appendChild(link);
  }

  topbar?.querySelectorAll('.nav-tab, .manage-batches-link, .batch-nav-link').forEach((item) => {
    if (item.dataset.mobileCloseBound) return;
    item.dataset.mobileCloseBound = 'true';
    item.addEventListener('click', () => closeMobileMenu(topbar));
  });
}

applyTheme(preferredTheme());

document.addEventListener('DOMContentLoaded', decorateShell);

const root = document.querySelector('#app');
if (root) {
  const observer = new MutationObserver(() => decorateShell());
  observer.observe(root, { childList: true, subtree: true });
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(event.matches ? 'dark' : 'light');
});
