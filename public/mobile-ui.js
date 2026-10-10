/* BurmalpticajopaChat v3 — responsive navigation, mobile keyboard and browser Back support.
   Uses existing chat/profile event handlers, does not replace API behavior. */
(() => {
  'use strict';
  const app = document.getElementById('app-screen');
  const btnChats = document.getElementById('mobile-nav-chats');
  const btnContacts = document.getElementById('mobile-nav-contacts');
  const btnCalls = document.getElementById('mobile-nav-calls');
  const btnSettings = document.getElementById('mobile-nav-settings');
  const desktopChats = document.getElementById('tab-chats');
  const desktopPeople = document.getElementById('tab-people');
  const search = document.getElementById('search-users');
  const messageList = document.getElementById('message-list');
  if (!app || !btnChats || !btnContacts || !desktopChats || !desktopPeople) return;

  const mobile = () => window.matchMedia('(max-width: 700px)').matches;
  function setActiveNav(target) {
    [btnContacts, btnCalls, btnChats, btnSettings].filter(Boolean).forEach(btn => {
      const active = btn === target;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
  }
  function syncNavigation() {
    const peopleSelected = desktopPeople.classList.contains('active');
    setActiveNav(peopleSelected ? btnContacts : btnChats);
  }
  btnChats.addEventListener('click', () => { desktopChats.click(); if (search) search.value = ''; syncNavigation(); });
  btnContacts.addEventListener('click', () => {
    // 'Люди' is an owner-only directory. Regular users get their own contacts
    // plus exact @username search, never a hidden full-user listing.
    const ownerDirectoryVisible = !desktopPeople.hidden && !desktopPeople.classList.contains('hidden');
    if (ownerDirectoryVisible) desktopPeople.click();
    else desktopChats.click();
    if (search) { search.placeholder = 'Контакты или @username'; search.focus(); }
    setTimeout(() => setActiveNav(btnContacts), 0);
  });
  btnCalls?.addEventListener('click', () => {
    // Server does not expose call history: show the existing conversations
    // instead of claiming a call-history feature that does not exist.
    desktopChats.click();
    if (search) search.placeholder = 'Выбери собеседника для звонка';
    const title = document.getElementById('list-heading-label');
    if (title) title.textContent = 'Открой чат и нажми 📞';
    setTimeout(() => setActiveNav(btnCalls), 0);
  });
  btnSettings?.addEventListener('click', () => {
    setActiveNav(btnSettings);
    document.getElementById('settings-button')?.click();
    // Keep Settings selected while the modal is opening.
    setTimeout(() => setActiveNav(btnSettings), 0);
  });
  new MutationObserver(syncNavigation).observe(desktopPeople, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncNavigation).observe(desktopChats, { attributes: true, attributeFilter: ['class'] });
  syncNavigation();

  // Visual viewport shrinks when Android/iOS software keyboard opens.
  const updateHeight = () => {
    if (!mobile()) {
      app.style.removeProperty('--v3-app-height');
      return;
    }
    const height = window.visualViewport?.height || window.innerHeight;
    if (height > 200) app.style.setProperty('--v3-app-height', `${Math.floor(height)}px`);
  };
  window.visualViewport?.addEventListener('resize', updateHeight);
  window.addEventListener('resize', updateHeight);
  window.addEventListener('orientationchange', updateHeight);
  updateHeight();

  // Preserve Android/browser Back when switching from list to a conversation.
  let handlingPop = false;
  const closeChat = () => app.classList.remove('mobile-chat-open');
  const onChatChanged = () => {
    if (!mobile() || handlingPop || app.classList.contains('hidden')) return;
    if (app.classList.contains('mobile-chat-open') && !history.state?.burmalMobileChat) {
      history.pushState({ ...history.state, burmalMobileChat: true }, '', '#chat');
    }
  };
  new MutationObserver(onChatChanged).observe(app, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', () => {
    handlingPop = true;
    if (!history.state?.burmalMobileChat) closeChat();
    handlingPop = false;
  });
  document.getElementById('mobile-chat-back')?.addEventListener('click', () => {
    if (mobile() && history.state?.burmalMobileChat) history.back();
  });

  document.getElementById('message-input')?.addEventListener('focus', () => {
    if (!mobile()) return;
    window.setTimeout(() => {
      updateHeight();
      // Do not move the reader from older messages to bottom just because keyboard opened.
      if (messageList && messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 100) {
        messageList.scrollTop = messageList.scrollHeight;
      }
    }, 140);
  });
})();
