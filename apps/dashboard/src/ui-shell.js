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

function decorateShell() {
  document.querySelector('.batch-manager-shortcut')?.remove();

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
