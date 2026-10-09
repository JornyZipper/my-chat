/* BurmalpticajopaChat v3 — responsive navigation, mobile keyboard and browser Back support.
   Uses existing chat/profile event handlers, does not replace API behavior. */
(() => {
  'use strict';
  const app = document.getElementById('app-screen');
  const btnChats = document.getElementById('mobile-nav-chats');
  const btnPeople = document.getElementById('mobile-nav-people');
  const btnProfile = document.getElementById('mobile-nav-profile');
  const desktopChats = document.getElementById('tab-chats');
  const desktopPeople = document.getElementById('tab-people');
  const search = document.getElementById('search-users');
  const messageList = document.getElementById('message-list');
  if (!app || !btnChats || !btnPeople || !desktopChats || !desktopPeople) return;

  const mobile = () => window.matchMedia('(max-width: 700px)').matches;
  function syncNavigation() {
    const peopleSelected = desktopPeople.classList.contains('active');
    btnChats.classList.toggle('active', !peopleSelected);
    btnPeople.classList.toggle('active', peopleSelected);
    if (!peopleSelected) btnChats.setAttribute('aria-current', 'page'); else btnChats.removeAttribute('aria-current');
    if (peopleSelected) btnPeople.setAttribute('aria-current', 'page'); else btnPeople.removeAttribute('aria-current');
  }
  btnChats.addEventListener('click', () => { desktopChats.click(); if (search) search.value = ''; syncNavigation(); });
  btnPeople.addEventListener('click', () => { desktopPeople.click(); if (search) search.value = ''; syncNavigation(); });
  btnProfile?.addEventListener('click', () => document.getElementById('profile-button')?.click());
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
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    }, 140);
  });
})();
