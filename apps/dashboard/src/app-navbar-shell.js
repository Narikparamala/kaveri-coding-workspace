const THEME_KEY = 'kaveri-admin-theme';
const LOGO_URL = 'https://raw.githubusercontent.com/Narikparamala/kaveritechnologies2.0/main/public/assets/images/WhatsApp_Image_2026-06-16_at_10.34.22.jpeg';

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_KEY, theme);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#07111f' : '#004b8d');

  document.querySelectorAll('[data-kav-theme]').forEach((button) => {
    const dark = theme === 'dark';
    button.textContent = dark ? '☀' : '☾';
    button.title = dark ? 'Use light mode' : 'Use dark mode';
    button.setAttribute('aria-label', button.title);
  });
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function legacyHeader() {
  return document.querySelector('.dashboard-shell > .topbar');
}

function currentSection() {
  if (location.pathname.endsWith('/batches-v2.html')) return 'batches';
  const active = legacyHeader()?.querySelector('.nav-tab.active[data-view]')?.dataset.view;
  return active === 'questions' ? 'questions' : 'submissions';
}

function pageTitle() {
  if (location.pathname.endsWith('/batches-v2.html')) return 'Batch Manager';
  return currentSection() === 'questions' ? 'Coding Questions' : 'Coding Submissions';
}

function profileInfo() {
  const old = legacyHeader();
  return {
    name: old?.querySelector('.teacher-copy strong')?.textContent?.trim() || 'Teacher',
    role: old?.querySelector('.teacher-copy span')?.textContent?.trim() || ''
  };
}

function clickLegacy(selector) {
  const target = legacyHeader()?.querySelector(selector);
  if (target) target.click();
}

function navigate(section) {
  if (section === 'batches') {
    if (!location.pathname.endsWith('/batches-v2.html')) location.href = '/batches-v2.html';
    return;
  }

  if (location.pathname.endsWith('/batches-v2.html')) {
    location.href = section === 'questions' ? '/?view=questions' : '/';
    return;
  }

  clickLegacy(`[data-view="${section}"]`);
}

function renderNavbar(shell) {
  const old = legacyHeader();
  if (!old) return;

  shell.querySelector('.kav-nav')?.remove();

  const active = currentSection();
  const profile = profileInfo();
  const nav = document.createElement('header');
  nav.className = 'kav-nav';
  nav.setAttribute('aria-label', 'Kaveri Coding navigation');

  nav.innerHTML = `
    <div class="kav-nav__brand">
      <img class="kav-nav__logo" src="${LOGO_URL}" alt="Kaveri Technologies" />
      <div class="kav-nav__brand-copy">
        <p class="kav-nav__eyebrow">Kaveri Technologies</p>
        <h1 class="kav-nav__title">${pageTitle()}</h1>
      </div>
    </div>

    <nav class="kav-nav__links" aria-label="Coding sections">
      <button type="button" class="kav-nav__link ${active === 'submissions' ? 'is-active' : ''}" data-kav-section="submissions">Submissions</button>
      <button type="button" class="kav-nav__link ${active === 'questions' ? 'is-active' : ''}" data-kav-section="questions">Questions</button>
      <button type="button" class="kav-nav__link ${active === 'batches' ? 'is-active' : ''}" data-kav-section="batches">Batches</button>
    </nav>

    <div class="kav-nav__actions">
      <div class="kav-nav__user">
        <strong>${profile.name}</strong>
        <span>${profile.role}</span>
      </div>
      <button type="button" class="kav-nav__icon" data-kav-theme aria-label="Toggle theme">☾</button>
      <button type="button" class="kav-nav__icon" data-kav-refresh title="Refresh" aria-label="Refresh">↻</button>
      <button type="button" class="kav-nav__signout" data-kav-signout>Sign out</button>
    </div>
  `;

  shell.insertBefore(nav, old);

  nav.querySelectorAll('[data-kav-section]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.kavSection));
  });
  nav.querySelector('[data-kav-theme]')?.addEventListener('click', toggleTheme);
  nav.querySelector('[data-kav-refresh]')?.addEventListener('click', () => clickLegacy('#refresh'));
  nav.querySelector('[data-kav-signout]')?.addEventListener('click', () => clickLegacy('#logout'));

  applyTheme(document.documentElement.dataset.theme || preferredTheme());
}

function honorRequestedView() {
  if (location.pathname !== '/' && location.pathname !== '/index.html') return;
  const requested = new URLSearchParams(location.search).get('view');
  if (requested !== 'questions') return;

  const button = legacyHeader()?.querySelector('[data-view="questions"]');
  if (button && !button.classList.contains('active')) {
    button.click();
    history.replaceState({}, '', '/');
  }
}

function sync() {
  const shell = document.querySelector('.dashboard-shell');
  if (!shell || !legacyHeader()) return;
  honorRequestedView();
  renderNavbar(shell);
}

applyTheme(preferredTheme());

document.addEventListener('DOMContentLoaded', sync);

const root = document.querySelector('#app');
if (root) {
  const observer = new MutationObserver(() => queueMicrotask(sync));
  observer.observe(root, { childList: true, subtree: true });
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(event.matches ? 'dark' : 'light');
});
