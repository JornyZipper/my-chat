/* v4 mobile profile page — shared by website and Android WebView.
   All profile information comes from the existing authenticated application state/API.
   No fabricated phone number, birthday, or publications. */
(() => {
  'use strict';
  if (window.__burmalMobileProfileV4) return;
  window.__burmalMobileProfileV4 = true;
  if (!document.getElementById('app-screen')) return;

  const isMobile = () => window.matchMedia('(max-width: 700px)').matches;
  const page = document.createElement('section');
  page.id = 'burmal-profile-page';
  page.className = 'bp4-page';
  page.hidden = true;
  page.setAttribute('aria-label', 'Мой профиль');
  page.innerHTML = `
    <header class="bp4-header">
      <button class="bp4-round" id="bp4-back" aria-label="Вернуться к чатам" type="button">‹</button>
      <strong>Мой профиль</strong>
      <button class="bp4-round" id="bp4-menu" aria-label="Редактировать профиль" type="button">⋮</button>
    </header>
    <div class="bp4-scroll">
      <div class="bp4-hero">
        <div class="bp4-avatar" id="bp4-avatar" aria-label="Фото профиля">B</div>
        <div class="bp4-name-line"><h1 id="bp4-name">Пользователь</h1><span id="bp4-verified" class="bp4-verified" hidden title="Подтверждённый профиль">✓</span></div>
        <p class="bp4-status" id="bp4-status">В сети</p>
      </div>
      <div class="bp4-actions">
        <button id="bp4-photo" type="button"><span class="bp4-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h5l2-3h5l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/></svg></span>Фото</button>
        <button id="bp4-edit" type="button"><span class="bp4-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l5-1 11-11-4-4L5 15zM14 6l4 4"/></svg></span>Изменить</button>
        <button id="bp4-settings" type="button"><span class="bp4-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19 14 2 1-2 4-3-1-2 2H9l-1-2-3 1-2-4 2-2-1-3 2-3 3 1 2-2h4l2 2 3-1 2 3-2 3z"/></svg></span>Настройки</button>
      </div>
      <h2 class="bp4-section-title">Обо мне</h2>
      <div class="bp4-info">
        <div class="bp4-info-row"><span class="bp4-info-icon">@</span><div><strong id="bp4-username">@username</strong><small>Имя пользователя</small></div></div>
        <div class="bp4-info-row"><span class="bp4-info-icon">≡</span><div><strong id="bp4-bio">Описание не указано</strong><small>О себе</small></div></div>
        <div class="bp4-info-row"><span class="bp4-info-icon">◌</span><div><strong id="bp4-privacy">Показывать статус</strong><small>Видимость онлайна</small></div></div>
      </div>
      <div class="bp4-info bp4-extra-info"><button id="bp4-my-phone" class="bp4-phone-button" type="button"><span>☎</span><strong id="bp4-phone-label">Номер не привязан</strong><small id="bp4-phone-visibility">Привязать и настроить приватность</small></button></div>
      <p class="bp4-note">Номер скрыт от других по умолчанию. Настройки приватности находятся в разделе «Настройки».</p>
    </div>
    <nav class="bp4-nav" aria-label="Основная навигация">
      <button id="bp4-chats" type="button"><span>☰</span>Чаты</button>
      <button id="bp4-people" type="button" hidden><span>♙</span>Люди</button>
      <button class="bp4-selected" id="bp4-profile" type="button" aria-current="page"><span>◉</span>Профиль</button>
    </nav>`;
  document.body.appendChild(page);
  const $ = (id) => document.getElementById(id);

  function render() {
    const profile = window.myChatGetProfile?.();
    if (!profile) return;
    $('bp4-name').textContent = String(profile.displayName || profile.username || 'Пользователь');
    $('bp4-username').textContent = '@' + String(profile.username || 'username');
    $('bp4-bio').textContent = String(profile.bio || 'Описание не указано');
    $('bp4-privacy').textContent = profile.privacyOnline === 'nobody' ? 'Скрывать онлайн' : 'Статус виден всем';
    const statuses = { online: 'В сети', away: 'Нет на месте', dnd: 'Не беспокоить' };
    $('bp4-status').textContent = statuses[profile.presenceStatus] || 'В сети';
    $('bp4-verified').hidden = !profile.verified;
    $('bp4-people').hidden = String(profile.username || '').toLowerCase() !== 'z1pperj';
    $('bp4-phone-label').textContent = profile.phone || 'Номер не привязан';
    $('bp4-phone-visibility').textContent = profile.phoneVerified ? (profile.phoneVisible ? 'Виден другим пользователям' : 'Скрыт от других') : 'Привязать и настроить приватность';
    const avatar = $('bp4-avatar');
    avatar.replaceChildren();
    avatar.style.background = /^#[0-9a-f]{6}$/i.test(profile.avatarColor || '') ? profile.avatarColor : '#2389d7';
    if (profile.avatarUrl) {
      const raw = window.myChatResolveAssetUrl?.(profile.avatarUrl) || profile.avatarUrl;
      try {
        const url = new URL(raw, location.origin);
        if (url.origin === location.origin && url.protocol === 'https:') {
          // Avoid stale avatars after editing profile.
          url.searchParams.set('bp4v', String(Date.now()));
          const img = document.createElement('img');
          img.alt = '';
          img.src = url.href;
          img.onerror = () => { img.remove(); avatar.textContent = $('bp4-name').textContent.slice(0,1).toUpperCase(); };
          avatar.appendChild(img);
          return;
        }
      } catch {}
    }
    avatar.textContent = $('bp4-name').textContent.slice(0,1).toUpperCase();
  }

  function show() {
    if (!isMobile() || $('app-screen').classList.contains('hidden')) return;
    page.hidden = false;
    render();
    if (!history.state?.burmalProfileV4) history.pushState({ ...(history.state || {}), burmalProfileV4: true }, '', '#profile');
  }
  function hide() { page.hidden = true; }
  function back() {
    if (history.state?.burmalProfileV4) history.back();
    else hide();
  }
  let allowOriginalEditor = false;
  function editor(buttonId) {
    hide();
    // The existing profile editor saves to /api/profile and /api/profile/avatar.
    allowOriginalEditor = true;
    try { $('profile-button')?.click(); } finally { allowOriginalEditor = false; }
    if (buttonId === 'photo') window.setTimeout(() => $('choose-avatar')?.click(), 120);
  }
  function bindMobileButton(id) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', (event) => {
      if (!isMobile() || allowOriginalEditor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      show();
    }, true);
  }
  ['mobile-nav-profile', 'mobile-profile-button', 'profile-button'].forEach(bindMobileButton);
  $('bp4-back').addEventListener('click', back);
  $('bp4-menu').addEventListener('click', () => editor('edit'));
  $('bp4-photo').addEventListener('click', () => editor('photo'));
  $('bp4-edit').addEventListener('click', () => editor('edit'));
  $('bp4-my-phone').addEventListener('click', () => $('bp4-settings').click());
  $('bp4-settings').addEventListener('click', () => {
    hide();
    $('settings-button')?.click();
  });
  $('bp4-chats').addEventListener('click', () => { back(); $('mobile-nav-chats')?.click(); });
  $('bp4-people').addEventListener('click', () => { back(); $('mobile-nav-people')?.click(); });
  window.addEventListener('popstate', () => {
    if (!history.state?.burmalProfileV4) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !page.hidden) back();
  });
  window.addEventListener('resize', () => { if (!isMobile()) hide(); });
})();
