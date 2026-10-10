(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const IS_WEB = window.burmalDesktop?.platform === 'web';
  document.documentElement.dataset.client = IS_WEB ? 'web' : 'desktop';
  const state = {
    baseUrl: IS_WEB ? window.location.origin : 'https://my-chat-ucw4.onrender.com',
    token: localStorage.getItem('burmal.token') || '',
    profile: null,
    chats: [],
    directory: [],
    usersById: new Map(),
    directoryMode: 'chats',
    selectedUser: null,
    selectedConversationId: null,
    messages: [],
    socket: null,
    socketReady: false,
    reconnectTimer: null,
    toastTimer: null,
    searchTimer: null,
    isSending: false,
    pendingAttachment: null,
    pendingAvatarFile: null,
    pendingAvatarObjectUrl: null,
    avatarRevisionById: new Map()
  };

  const authScreen = $('auth-screen');
  const appScreen = $('app-screen');
  const chatList = $('chat-list');
  const searchResults = $('search-results');
  const searchInput = $('search-users');
  const messageList = $('message-list');
  const messageInput = $('message-input');
  const sendButton = $('send-button');

  function escapeText(value) {
    return String(value ?? '');
  }
  function initials(value) {
    const text = escapeText(value).trim().replace(/^@/, '');
    if (!text) return 'B';
    return text.split(/[\s._-]+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'B';
  }
  function timeLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }
  function showToast(message, type = '') {
    const toast = $('toast');
    toast.textContent = escapeText(message);
    toast.className = `toast show ${type}`.trim();
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3600);
  }
  async function api(path, method = 'GET', body = null) {
    if (!state.baseUrl) throw new Error('Не удалось определить адрес сервера Render. Проверь настройки подключения.');
    const result = await window.burmalDesktop.apiRequest({
      baseUrl: state.baseUrl,
      path,
      method,
      token: state.token,
      body
    });
    if (!result.ok) {
      const data = result.data || {};
      let message = data.error || `Ошибка запроса (HTTP ${result.status}).`;
      if (data.details) message += ` Ответ сервера: ${String(data.details).slice(0, 170)}`;
      if (result.status === 0) message = data.error || 'Не удалось подключиться. Проверь адрес сервера и интернет.';
      throw new Error(message);
    }
    return result.data || {};
  }

  async function uploadFile(path, fieldName, file) {
    const data = await file.arrayBuffer();
    const result = await window.burmalDesktop.apiUpload({
      baseUrl: state.baseUrl,
      path,
      token: state.token,
      fieldName,
      file: { name: file.name, type: file.type || 'application/octet-stream', data }
    });
    if (!result.ok) throw new Error(result.data?.error || `Не удалось загрузить файл (HTTP ${result.status}).`);
    return result.data || {};
  }

  async function loadAttachmentDataUrl(attachment) {
    const path = String(attachment?.url || '');
    const result = await window.burmalDesktop.mediaRequest({ baseUrl: state.baseUrl, path, token: state.token });
    if (!result.ok) throw new Error(result.error || `Не удалось открыть файл (HTTP ${result.status}).`);
    return `data:${result.mimeType || attachment?.mime || 'application/octet-stream'};base64,${result.base64}`;
  }

  function absoluteAssetUrl(value) {
    const valueString = String(value || '');
    if (!valueString) return '';
    if (/^(blob:|data:)/i.test(valueString)) return valueString;
    try {
      const url = new URL(valueString, state.baseUrl || undefined);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      return url.href;
    } catch { return ''; }
  }

  function paintAvatar(element, user) {
    if (!element) return;
    element.replaceChildren();
    element.classList.add('avatar-ready');
    let url = absoluteAssetUrl(user?.avatarUrl);
    const revision = state.avatarRevisionById.get(user?.id);
    if (url && revision && url.startsWith('http')) {
      const parsed = new URL(url); parsed.searchParams.set('avatar_v', String(revision)); url = parsed.href;
    }
    element.style.background = user?.avatarColor || '';
    if (url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.draggable = false;
      image.className = 'avatar-image';
      image.style.cssText = 'display:block;width:100%;height:100%;min-width:100%;min-height:100%;object-fit:cover;object-position:center;border-radius:inherit;';
      image.onerror = () => {
        image.remove();
        element.textContent = initials(user?.displayName || user?.username);
      };
      element.append(image);
    } else {
      element.textContent = initials(user?.displayName || user?.username);
    }
  }

  function readableFileSize(bytes) {
    const value = Number(bytes || 0);
    if (!value) return '';
    if (value < 1024) return `${value} Б`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} КБ`;
    return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
  }

  function downloadDataUrl(url, filename) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = String(filename || 'attachment').replace(/[\\/:*?"<>|]/g, '_');
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function openMediaViewer(url, mime, filename) {
    const viewer = $('media-viewer');
    const image = $('media-viewer-image');
    const video = $('media-viewer-video');
    image.classList.add('hidden');
    video.classList.add('hidden');
    video.pause();
    video.removeAttribute('src');
    if (String(mime || '').startsWith('video/')) {
      video.src = url;
      video.classList.remove('hidden');
    } else {
      image.src = url;
      image.classList.remove('hidden');
    }
    $('media-viewer-caption').textContent = filename || '';
    viewer.classList.remove('hidden');
  }

  function renderAttachment(attachment) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-attachment';
    if (!attachment?.id) return wrapper;
    const mime = String(attachment.mime || 'application/octet-stream').toLowerCase();
    const filename = String(attachment.filename || 'Вложение');
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');
    const loading = document.createElement('button');
    loading.type = 'button';
    loading.className = isImage || isVideo ? 'media-preview-loading' : 'file-attachment-card';
    loading.textContent = isImage ? 'Загрузка изображения…' : isVideo ? 'Загрузка видео…' : `${isAudio ? '♫' : '↧'}  ${filename}${attachment.size ? ` · ${readableFileSize(attachment.size)}` : ''}`;
    wrapper.append(loading);
    loadAttachmentDataUrl(attachment).then((url) => {
      if (!wrapper.isConnected) return;
      if (isImage) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'image-attachment-button';
        button.title = 'Открыть изображение';
        const img = document.createElement('img');
        img.className = 'message-image';
        img.src = url;
        img.alt = filename;
        img.loading = 'lazy';
        button.append(img);
        button.addEventListener('click', () => openMediaViewer(url, mime, filename));
        loading.replaceWith(button);
      } else if (isVideo) {
        const video = document.createElement('video');
        video.className = 'message-video';
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.addEventListener('dblclick', () => openMediaViewer(url, mime, filename));
        loading.replaceWith(video);
      } else if (isAudio) {
        const audio = document.createElement('audio');
        audio.className = 'message-audio';
        audio.src = url;
        audio.controls = true;
        loading.replaceWith(audio);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'file-attachment-card';
        button.textContent = `↓  ${filename}${attachment.size ? ` · ${readableFileSize(attachment.size)}` : ''}`;
        button.addEventListener('click', () => downloadDataUrl(url, filename));
        loading.replaceWith(button);
      }
    }).catch((error) => {
      if (!wrapper.isConnected) return;
      loading.textContent = `${filename} · ${error.message || 'Не удалось открыть файл'}`;
      loading.className = 'file-attachment-error';
    });
    return wrapper;
  }

  function setPendingAttachment(file) {
    state.pendingAttachment = file || null;
    const row = $('attachment-pending');
    if (!file) {
      row.classList.add('hidden');
      $('attachment-pending-name').textContent = '';
      return;
    }
    $('attachment-pending-name').textContent = `${file.name} · ${readableFileSize(file.size)}`;
    $('attachment-pending-icon').textContent = file.type.startsWith('image/') ? '▧' : file.type.startsWith('video/') ? '▶' : '↧';
    row.classList.remove('hidden');
    sendButton.disabled = !state.selectedUser || !state.socketReady;
  }

  // Shared bridge used by the WebRTC call module. No Node.js APIs are exposed.
  window.myChatGetCurrentUser = () => state.selectedUser;
  window.myChatGetProfile = () => state.profile;
  // Refresh the mobile profile immediately after the +888 claim is confirmed.
  window.addEventListener('burmal:official-number-linked', async () => {
    if (!state.token) return;
    try { const result = await api('/api/profile');
      if (result.profile) { state.profile = result.profile; updateSelfProfile(); }
    } catch (error) { console.warn('Unable to refresh official number profile', error); }
  });
  window.myChatResolveAssetUrl = (value) => {
    try { return new URL(String(value || ''), state.baseUrl || undefined).href; }
    catch { return String(value || ''); }
  };
  window.myChatSocketIsReady = () => state.socketReady && state.socket?.readyState === WebSocket.OPEN;
  window.myChatSocketSend = (payload) => {
    if (!window.myChatSocketIsReady()) {
      showToast('Нет подключения к серверу для звонка.', 'error');
      return false;
    }
    state.socket.send(JSON.stringify(payload));
    return true;
  };
  window.myChatToast = (message) => showToast(message, 'error');
  window.myChatGetRtcConfig = async () => api('/api/rtc-config');

  function setAuthTab(tab) {
    document.querySelectorAll('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
    $('login-form').classList.toggle('hidden', tab !== 'login');
    $('register-form').classList.toggle('hidden', tab !== 'register');
    $('phone-login-form').classList.toggle('hidden', tab !== 'phone');
  }
  function showAuth() {
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    appScreen.classList.remove('mobile-chat-open');
    setAuthTab('login');
  }
  function showApp() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    updateSelfProfile();
  }
  function isOwner() { return String(state.profile?.username || '').toLowerCase() === 'z1pperj'; }
  function updateSelfProfile() {
    if (!state.profile) return;
    const owner = isOwner();
    ['tab-people','mobile-nav-people','bp4-people'].forEach(id => { const el = $(id); if (el) el.hidden = !owner; });
    document.documentElement.classList.toggle('owner-directory', owner);
    if (!owner && state.directoryMode === 'people') { state.directoryMode = 'chats'; updateDirectoryTabs(); }
    paintAvatar($('my-avatar'), state.profile);
    $('my-name').textContent = state.profile.displayName || state.profile.username || 'Пользователь';
    $('my-username').textContent = `@${state.profile.username || ''}`;
    $('account-identity').textContent = `Вы вошли как @${state.profile.username || '?'} · ID ${String(state.profile.id || '').slice(0, 8)}`;
    $('my-verified').classList.toggle('hidden', !state.profile.verified);
    const preview = $('profile-avatar-preview');
    if (preview) paintAvatar(preview, state.profile);
  }
  function setSocketStatus(online, label) {
    const indicator = $('socket-indicator');
    indicator.classList.toggle('online', online);
    indicator.classList.toggle('offline', !online);
    indicator.title = label;
    $('footer-status').textContent = label;
  }
  function setComposerEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled && !state.pendingAttachment;
    $('attach-button').disabled = !enabled;
  }

  async function finishLogin(data) {
    if (data?.verificationRequired) {
      showToast(data.message || 'Проверь почту для подтверждения регистрации.');
      return;
    }
    if (!data?.token || !data?.profile) throw new Error('Сервер не вернул токен и профиль. Проверь версию сервера.');
    state.token = data.token;
    state.profile = data.profile;
    localStorage.setItem('burmal.token', state.token);
    showApp();
    updateAdminAvailability();
    connectSocket();
    await loadChats();
    if (!state.chats.length && isOwner()) await switchDirectory('people');
    showToast(`Добро пожаловать, ${state.profile.displayName || state.profile.username}!`, 'success');
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
          const username = $('login-username').value.trim();
      const password = $('login-password').value;
      const button = $('login-form').querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Входим…';
      await finishLogin(await api('/api/auth/login', 'POST', { username, password }));
    } catch (error) {
      showToast(error.message || 'Не удалось войти.', 'error');
    } finally {
      const button = $('login-form').querySelector('button[type="submit"]');
      button.disabled = false;
      button.innerHTML = 'Войти <span>→</span>';
    }
  });

  $('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
          const form = $('register-form');
      const payload = {
        username: $('register-username').value.trim(),
        displayName: $('register-displayname').value.trim(),
        email: $('register-email').value.trim(),
        password: $('register-password').value,
        claimCode: $('register-claim').value,
        passwordConfirm: $('register-confirm').value
      };
      if (payload.password !== payload.passwordConfirm) {
        throw new Error('Пароли не совпадают. Повтори пароль правильно.');
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Создаём аккаунт…';
      await finishLogin(await api('/api/auth/register', 'POST', payload));
    } catch (error) {
      showToast(error.message || 'Не удалось зарегистрироваться.', 'error');
    } finally {
      const button = $('register-form').querySelector('button[type="submit"]');
      button.disabled = false;
      button.innerHTML = 'Создать аккаунт <span>→</span>';
    }
  });

  function disconnectSocket() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    if (state.socket) {
      state.socket.onclose = null;
      try { state.socket.close(); } catch {}
      state.socket = null;
    }
    state.socketReady = false;
    setSocketStatus(false, 'Отключено');
  }
  function connectSocket() {
    disconnectSocket();
    if (!state.token || !state.baseUrl) return;
    let wsUrl;
    try {
      const url = new URL(state.baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/ws';
      url.search = '';
      url.hash = '';
      wsUrl = url.href;
    } catch {
      showToast('Неверный адрес сервера для WebSocket.', 'error');
      return;
    }
    setSocketStatus(false, 'Подключаемся…');
    let socket;
    try { socket = new WebSocket(wsUrl); } catch (error) {
      setSocketStatus(false, 'Не удалось подключиться к WebSocket');
      showToast(error.message, 'error');
      return;
    }
    state.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', token: state.token }));
    });
    socket.addEventListener('message', async (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (typeof data.type === 'string' && data.type.startsWith('call_')) {
        window.dispatchEvent(new CustomEvent('mychat:call-signal', { detail: data }));
        return;
      }
      switch (data.type) {
        case 'auth_ok':
          state.socketReady = true;
          setSocketStatus(true, 'Подключено в реальном времени');
          setComposerEnabled(Boolean(state.selectedUser) && state.selectedUser.id !== 'bpc-official-support');
          break;
        case 'auth_error':
          showToast(data.error || 'Не удалось авторизоваться в реальном времени.', 'error');
          state.token = '';
          localStorage.removeItem('burmal.token');
          disconnectSocket();
          showAuth();
          break;
        case 'message':
          if (data.message) handleIncomingMessage(data.message);
          break;
        case 'chat_refresh':
          loadChats().catch(() => {});
          break;
        case 'users':
          if (Array.isArray(data.users)) {
            for (const user of data.users) {
              if (!user?.id) continue;
              state.usersById.set(user.id, user);
              if (user.id === state.profile?.id) {
                state.profile = { ...state.profile, ...user };
                updateSelfProfile();
              }
              if (user.id === state.selectedUser?.id) {
                state.selectedUser = { ...state.selectedUser, ...user };
                renderChatHeader();
              }
            }
            state.directory = state.directory.map(user => ({ ...user, ...(state.usersById.get(user.id) || {}) }));
            state.chats = state.chats.map(chat => ({ ...chat, user: { ...chat.user, ...(state.usersById.get(chat.user?.id) || {}) } }));
            renderChatList();
            if (state.directoryMode === 'people') renderSearchResults(state.directory);
            // Refresh verification in visible message authors without altering message contents.
            for (const message of state.messages) {
              const sender = state.usersById.get(message.senderId);
              if (sender) message.senderVerified = Boolean(sender.verified);
            }
            if (state.messages.length && state.selectedUser) renderMessages(true);
          }
          break;
        case 'typing':
          if (state.selectedUser && data.fromId === state.selectedUser.id) {
            $('chat-status').textContent = data.isTyping ? 'печатает…' : (state.selectedUser.online ? 'в сети' : 'не в сети');
          }
          break;
        case 'receipts':
          if (state.selectedUser) loadMessages(state.selectedUser, true).catch(() => {});
          break;
        case 'error':
          showToast(data.error || 'Ошибка отправки сообщения.', 'error');
          state.isSending = false;
          sendButton.disabled = !state.socketReady || !state.selectedUser;
          break;
        default:
          break;
      }
    });
    socket.addEventListener('close', () => {
      if (state.socket !== socket) return;
      state.socketReady = false;
      setSocketStatus(false, 'Переподключение…');
      setComposerEnabled(false);
      if (state.token) {
        state.reconnectTimer = setTimeout(connectSocket, 2200);
      }
    });
    socket.addEventListener('error', () => {
      setSocketStatus(false, 'Проблема соединения');
    });
  }

  function getChatUserId(chat) { return chat?.user?.id; }
  async function loadChats() {
    if (!state.token) return;
    const data = await api('/api/chats');
    state.chats = (Array.isArray(data.chats) ? data.chats : []).map(chat => ({ ...chat, user: { ...chat.user, ...(state.usersById.get(chat.user?.id) || {}) } }));
    renderChatList();
    if (state.selectedUser) {
      const fresh = state.chats.find(chat => getChatUserId(chat) === state.selectedUser.id);
      if (fresh) {
        state.selectedUser = fresh.user;
        state.selectedConversationId = fresh.conversationId;
        renderChatHeader();
      }
    }
  }
  function renderChatList() {
    chatList.replaceChildren();
    if (!state.chats.length) {
      const empty = document.createElement('div');
      empty.className = 'no-results';
      empty.textContent = isOwner() ? 'Пока нет чатов. Открой вкладку «Люди».' : 'Пока нет чатов. Когда тебе напишут, переписка появится здесь.';
      chatList.append(empty);
      return;
    }
    for (const chat of state.chats) {
      const user = chat.user || {};
      if (!isOwner() && searchInput.value.trim() && !`${user.username || ''} ${user.displayName || ''}`.toLowerCase().includes(searchInput.value.trim().toLowerCase())) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chat-row${state.selectedUser?.id === user.id ? ' active' : ''}`;
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      paintAvatar(avatar, user);
      const main = document.createElement('div');
      main.className = 'chat-row-main';
      const top = document.createElement('div');
      top.className = 'chat-row-top';
      const name = document.createElement('strong');
      name.textContent = user.displayName || user.username || 'Пользователь';
      top.append(name);
      if (user.verified) {
        const badge = document.createElement('span');
        badge.className = 'verified'; badge.textContent = '✓'; top.append(badge);
      }
      const bottom = document.createElement('div');
      bottom.className = 'chat-row-bottom';
      const preview = document.createElement('span');
      preview.textContent = chat.lastMessage?.text || `@${user.username || ''}`;
      const when = document.createElement('span');
      when.className = 'chat-time'; when.textContent = timeLabel(chat.lastMessage?.time);
      bottom.append(preview, when);
      main.append(top, bottom);
      button.append(avatar, main);
      button.addEventListener('click', () => openChat(user));
      // Long press a conversation to inspect the other person's profile.
      let pressTimer = null;
      button.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { pressTimer = null; viewUserProfile(user); }, 650); }, { passive: true });
      ['touchend','touchcancel','touchmove'].forEach(evt => button.addEventListener(evt, () => clearTimeout(pressTimer), { passive: true }));
      chatList.append(button);
    }
  }

  function updateDirectoryTabs() {
    const people = isOwner() && state.directoryMode === 'people';
    $('tab-chats').classList.toggle('active', !people);
    $('tab-people').classList.toggle('active', people);
    $('tab-chats').setAttribute('aria-selected', String(!people));
    $('tab-people').setAttribute('aria-selected', String(people));
    $('list-heading-label').textContent = searchInput.value.trim() ? 'Результаты поиска' : people ? 'Пользователи' : 'Недавние чаты';
    const remote = Boolean(searchInput.value.trim()) && (isOwner() || searchInput.value.trim().startsWith('@'));
    searchResults.classList.toggle('hidden', !people && !remote);
    chatList.classList.toggle('hidden', people || remote);
  }
  async function searchUsers(query = '') {
    if (!state.token) return;
    const q = String(query || '').trim();
    if (!isOwner() && !q.startsWith('@')) { state.directoryMode = 'chats'; updateDirectoryTabs(); renderChatList(); return; }
    if (!q && state.directoryMode === 'chats') { updateDirectoryTabs(); return; }
    try {
      const data = await api(`/api/users?q=${encodeURIComponent(q)}`);
      state.directory = (Array.isArray(data.users) ? data.users : []).map(user => {
        const known = state.usersById.get(user.id);
        return known ? { ...user, ...known } : user;
      });
      renderSearchResults(state.directory);
      updateDirectoryTabs();
    } catch (error) {
      showToast(error.message || 'Ошибка поиска.', 'error');
    }
  }
  async function switchDirectory(mode) {
    if (mode === 'people' && !isOwner()) return;
    state.directoryMode = mode;
    updateDirectoryTabs();
    if (mode === 'people') await searchUsers(searchInput.value);
    else if (searchInput.value.trim()) await searchUsers(searchInput.value);
    else renderChatList();
  }
  function renderSearchResults(users) {
    searchResults.replaceChildren();
    searchResults.classList.remove('hidden');
    chatList.classList.add('hidden');
    $('list-heading-label').textContent = 'Результаты поиска';
    if (!users.length) {
      const no = document.createElement('div'); no.className = 'no-results'; no.textContent = 'Никого не найдено. Попробуй другой никнейм.'; searchResults.append(no); return;
    }
    for (const user of users) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'search-user';
      const avatar = document.createElement('div'); avatar.className = 'avatar'; paintAvatar(avatar, user);
      const text = document.createElement('div'); text.className = 'user-text';
      const name = document.createElement('strong'); name.textContent = user.displayName || user.username;
      const username = document.createElement('small'); username.textContent = `@${user.username || ''}${user.online ? ' · в сети' : ''}`;
      const titleLine = document.createElement('div');
      titleLine.className = 'directory-name-line';
      titleLine.append(name);
      if (user.verified) { const badge = document.createElement('span'); badge.className = 'verified'; badge.textContent = '✓'; badge.title = 'Подтверждённый профиль'; titleLine.append(badge); }
      text.append(titleLine, username); button.append(avatar, text);
      button.addEventListener('click', () => viewUserProfile(user)); searchResults.append(button);
    }
  }

  async function openChat(user) {
    if (!user?.id) return;
    state.selectedUser = { ...user, ...(state.usersById.get(user.id) || {}) };
    state.directoryMode = 'chats';
    searchInput.value = '';
    updateDirectoryTabs();
    appScreen.classList.add('mobile-chat-open');
    const chat = state.chats.find(item => getChatUserId(item) === user.id);
    state.selectedConversationId = chat?.conversationId || null;
    renderChatList();
    renderChatHeader();
    $('empty-state').classList.add('hidden');
    $('chat-view').classList.remove('hidden');
    setComposerEnabled(false);
    messageInput.value = '';
    messageList.replaceChildren();
    const loading = document.createElement('div'); loading.className = 'loading-label'; loading.textContent = 'Загрузка сообщений…'; messageList.append(loading);
    try {
      await loadMessages(user, false);
      if (state.socketReady) {
        state.socket.send(JSON.stringify({ type: 'read', withUserId: user.id }));
      }
      messageInput.focus();
    } catch (error) {
      messageList.replaceChildren();
      const no = document.createElement('div'); no.className = 'empty-messages'; no.textContent = error.message || 'Не удалось загрузить сообщения.'; messageList.append(no);
      showToast(error.message || 'Не удалось открыть чат.', 'error');
    }
  }
  function renderChatHeader() {
    if (!state.selectedUser) return;
    paintAvatar($('chat-avatar'), state.selectedUser);
    $('chat-name').textContent = state.selectedUser.displayName || state.selectedUser.username || 'Пользователь';
    $('chat-status').textContent = state.selectedUser.id === 'bpc-official-support' ? 'Служебный чат · только уведомления' : (state.selectedUser.online ? 'в сети' : 'не в сети');
    $('chat-verified').classList.toggle('hidden', !state.selectedUser.verified);
  }
  async function loadMessages(user, keepScroll = true) {
    const before = state.selectedUser?.id;
    const data = await api(`/api/chats/${encodeURIComponent(user.id)}/messages`);
    if (state.selectedUser?.id !== before || state.selectedUser?.id !== user.id) return;
    state.selectedConversationId = data.conversationId || state.selectedConversationId;
    state.messages = (Array.isArray(data.messages) ? data.messages : []).map(message => ({ ...message, senderVerified: Boolean(state.usersById.get(message.senderId)?.verified ?? message.senderVerified) }));
    renderMessages(keepScroll);
    setComposerEnabled(state.socketReady && user.id !== 'bpc-official-support');
  }
  function renderMessages(keepScroll = true) {
    const oldScrollHeight = messageList.scrollHeight;
    const oldTop = messageList.scrollTop;
    messageList.replaceChildren();
    if (!state.messages.length) {
      const empty = document.createElement('div'); empty.className = 'empty-messages'; empty.textContent = 'Это начало вашей переписки. Напиши первое сообщение.'; messageList.append(empty); return;
    }
    let lastDate = '';
    for (const message of state.messages) {
      const date = new Date(message.createdAt || Date.now());
      const dateStr = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      if (dateStr && dateStr !== lastDate) {
        const dateRow = document.createElement('div'); dateRow.className = 'message-date'; dateRow.textContent = dateStr; messageList.append(dateRow); lastDate = dateStr;
      }
      const item = document.createElement('article');
      const mine = message.senderId === state.profile?.id;
      item.className = `message${mine ? ' mine' : ''}`;
      if (!mine) {
        const author = document.createElement('div'); author.className = 'message-author';
        const username = document.createElement('span'); username.textContent = message.senderDisplayName || message.senderUsername || state.selectedUser?.username || '';
        author.append(username);
        author.style.cursor = 'pointer'; author.title = 'Открыть профиль';
        author.addEventListener('click', () => viewUserProfile(state.selectedUser));
        if (message.senderVerified || state.usersById.get(message.senderId)?.verified) {
          const badge = document.createElement('span'); badge.className = 'verified'; badge.title = 'Подтверждённый профиль'; badge.textContent = '✓'; author.append(badge);
        }
        item.append(author);
      }
      const bubble = document.createElement('div'); bubble.className = 'message-bubble';
      if (message.deleted) {
        bubble.textContent = 'Сообщение удалено';
      } else {
        if (message.text) {
          const text = document.createElement('div');
          text.className = 'message-text';
          text.textContent = message.text;
          bubble.append(text);
        }
        if (message.attachment) bubble.append(renderAttachment(message.attachment));
        if (!message.text && !message.attachment) bubble.textContent = 'Сообщение';
      }
      item.append(bubble);
      const meta = document.createElement('div'); meta.className = 'message-meta';
      const time = document.createElement('span'); time.textContent = timeLabel(message.createdAt);
      meta.append(time);
      if (mine) {
        const receipt = document.createElement('span'); receipt.textContent = message.readAt ? '✓✓' : message.deliveredAt ? '✓✓' : '✓'; receipt.style.color = message.readAt ? '#9db5ff' : 'inherit'; meta.append(receipt);
      }
      item.append(meta); messageList.append(item);
    }
    if (keepScroll) messageList.scrollTop = oldScrollHeight + (messageList.scrollHeight - oldScrollHeight);
    else messageList.scrollTop = messageList.scrollHeight;
    void oldTop;
  }
  function handleIncomingMessage(message) {
    if (state.selectedUser && state.selectedConversationId && message.conversationId === state.selectedConversationId) {
      if (!state.messages.some(item => item.id === message.id)) {
        state.messages.push(message);
        state.messages.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        renderMessages(true);
      }
      if (message.senderId !== state.profile?.id && state.socketReady) {
        state.socket.send(JSON.stringify({ type: 'read', withUserId: state.selectedUser.id }));
      }
    }
    loadChats().catch(() => {});
  }

  $('attach-button').addEventListener('click', () => {
    if (!state.selectedUser) return showToast('Сначала открой чат.', 'error');
    $('attachment-input').click();
  });
  $('attachment-input').addEventListener('change', () => {
    const file = $('attachment-input').files?.[0] || null;
    if (file && file.size > 15 * 1024 * 1024) {
      $('attachment-input').value = '';
      setPendingAttachment(null);
      showToast('Максимальный размер файла — 15 МБ.', 'error');
      return;
    }
    setPendingAttachment(file);
  });
  $('attachment-remove').addEventListener('click', () => {
    $('attachment-input').value = '';
    setPendingAttachment(null);
  });

  $('composer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    const file = state.pendingAttachment;
    if ((!text && !file) || !state.selectedUser) return;
    if (!state.socketReady || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
      showToast('Нет соединения с сервером. Подожди переподключения.', 'error');
      return;
    }
    if (state.isSending) return;
    state.isSending = true;
    sendButton.disabled = true;
    $('attach-button').disabled = true;
    try {
      let attachmentId = null;
      if (file) {
        showToast('Загружаю вложение…');
        const result = await uploadFile('/api/upload', 'file', file);
        attachmentId = result.attachment?.id;
        if (!attachmentId) throw new Error('Сервер не вернул ID загруженного файла.');
      }
      if (!state.socketReady || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
        throw new Error('Соединение потеряно во время загрузки файла. Нажми отправить ещё раз.');
      }
      const payload = {
        type: 'send',
        toUserId: state.selectedUser.id,
        text,
        attachmentId,
        replyToId: null,
        clientMessageId: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      };
      state.socket.send(JSON.stringify(payload));
      messageInput.value = '';
      messageInput.style.height = 'auto';
      $('attachment-input').value = '';
      setPendingAttachment(null);
    } catch (error) {
      showToast(error.message || 'Не удалось отправить сообщение.', 'error');
    } finally {
      state.isSending = false;
      sendButton.disabled = !state.socketReady || !state.selectedUser || (!messageInput.value.trim() && !state.pendingAttachment);
      $('attach-button').disabled = !state.socketReady || !state.selectedUser;
    }
  });
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 135)}px`;
    if (state.socketReady && state.selectedUser && state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: 'typing', toUserId: state.selectedUser.id, isTyping: Boolean(messageInput.value.trim()) }));
    }
  });
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('composer-form').requestSubmit();
    }
  });

  $('tab-chats').addEventListener('click', () => switchDirectory('chats'));
  $('tab-people').addEventListener('click', () => { if (isOwner()) switchDirectory('people'); });
  $('mobile-chat-back').addEventListener('click', () => appScreen.classList.remove('mobile-chat-open'));
  $('mobile-profile-button').addEventListener('click', () => $('profile-button').click());
  $('mobile-admin-button').addEventListener('click', () => $('admin-button').click());
  $('mobile-settings-button').addEventListener('click', () => $('settings-button').click());
  document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
  searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    if (isOwner() || searchInput.value.trim().startsWith('@')) state.searchTimer = setTimeout(() => searchUsers(searchInput.value), 350);
    else { renderChatList(); updateDirectoryTabs(); }
  });
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (isOwner() || searchInput.value.trim().startsWith('@'))) { event.preventDefault(); clearTimeout(state.searchTimer); searchUsers(searchInput.value); }
    if (event.key === 'Escape') { searchInput.value = ''; if (isOwner()) searchUsers(''); else { renderChatList(); updateDirectoryTabs(); } }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); if (!appScreen.classList.contains('hidden')) searchInput.focus();
    }
    if (event.key === 'Escape') {
      $('settings-modal').classList.add('hidden');
      $('other-profile-modal').classList.add('hidden');
    }
  });
  $('refresh-chats').addEventListener('click', () => loadChats().then(() => showToast('Список чатов обновлён.', 'success')).catch(error => showToast(error.message, 'error')));
  $('reload-messages').addEventListener('click', () => state.selectedUser && loadMessages(state.selectedUser, false).catch(error => showToast(error.message, 'error')));
  $('switch-account').addEventListener('click', () => $('logout-button').click());
  $('logout-button').addEventListener('click', () => {
    disconnectSocket(); $('admin-button').classList.add('hidden'); $('mobile-admin-button').classList.add('hidden'); state.token = ''; state.profile = null; state.chats = []; state.directory = []; state.usersById.clear(); state.selectedUser = null; state.selectedConversationId = null; state.messages = []; state.avatarRevisionById.clear(); appScreen.classList.remove('mobile-chat-open');
    localStorage.removeItem('burmal.token'); setComposerEnabled(false); showAuth(); showToast('Ты вышел из аккаунта.');
  });
  function showPhoneSettings() {
    if (!state.profile) return;
    $('current-phone').textContent = state.profile.phone || 'Не привязан';
    $('phone-link-number').value = state.profile.phone || '';
    $('phone-visible').checked = Boolean(state.profile.phoneVisible);
    $('phone-visible').disabled = !state.profile.phoneVerified;
    $('settings-modal').classList.remove('hidden');
  }
  $('settings-button').addEventListener('click', showPhoneSettings);
  ['close-settings','cancel-settings'].forEach(id => $(id).addEventListener('click', () => $('settings-modal').classList.add('hidden')));
  $('settings-modal').addEventListener('click', event => { if (event.target === $('settings-modal')) $('settings-modal').classList.add('hidden'); });
  async function runPhoneAction(buttonId, task) {
    const button = $(buttonId);
    if (button.disabled) return;
    button.disabled = true;
    try { await task(); } catch (error) { showToast(error.message || 'Не получилось.', 'error'); }
    finally { button.disabled = false; }
  }
  $('phone-link-send').addEventListener('click', () => runPhoneAction('phone-link-send', async () => {
    const data = await api('/api/profile/phone/start', 'POST', { phone: $('phone-link-number').value.trim() });
    showToast(data.message || 'SMS отправлено.', 'success');
  }));
  $('phone-link-confirm').addEventListener('click', () => runPhoneAction('phone-link-confirm', async () => {
    const data = await api('/api/profile/phone/confirm', 'POST', { code: $('phone-link-code').value.trim() });
    state.profile = data.profile;
    updateSelfProfile(); showPhoneSettings(); showToast('Номер привязан и скрыт по умолчанию.', 'success');
  }));
  $('save-phone-privacy').addEventListener('click', () => runPhoneAction('save-phone-privacy', async () => {
    if (!state.profile?.phoneVerified) throw new Error('Сначала привяжи номер.');
    const data = await api('/api/profile', 'PATCH', {
      username: state.profile.username, displayName: state.profile.displayName,
      bio: state.profile.bio || '', avatarColor: state.profile.avatarColor,
      presenceStatus: state.profile.presenceStatus, privacyOnline: state.profile.privacyOnline,
      phoneVisible: $('phone-visible').checked
    });
    state.profile = data.profile; updateSelfProfile(); showToast('Видимость номера сохранена.', 'success');
  }));
  $('phone-login-send').addEventListener('click', () => runPhoneAction('phone-login-send', async () => {
    const data = await api('/api/auth/phone/start', 'POST', { phone: $('phone-login-number').value.trim() });
    showToast(data.message || 'Если номер привязан, SMS отправлено.', 'success');
  }));
  $('phone-login-form').addEventListener('submit', event => {
    event.preventDefault();
    runPhoneAction('phone-login-send', async () => {
      await finishLogin(await api('/api/auth/phone/verify', 'POST', {
        phone: $('phone-login-number').value.trim(), code: $('phone-login-code').value.trim()
      }));
    });
  });

  let viewedProfile = null;
  async function viewUserProfile(user) {
    if (!user?.id) return;
    try {
      const result = await api(`/api/users/${encodeURIComponent(user.id)}`);
      viewedProfile = result.profile;
      paintAvatar($('other-profile-avatar'), viewedProfile);
      $('other-profile-title').textContent = viewedProfile.displayName || viewedProfile.username || 'Пользователь';
      $('other-profile-username').textContent = `@${viewedProfile.username || ''}`;
      $('other-profile-verified').classList.toggle('hidden', !viewedProfile.verified);
      $('other-profile-bio').textContent = viewedProfile.bio || 'Описание не указано';
      $('other-profile-phone-row').classList.toggle('hidden', !viewedProfile.phone);
      $('other-profile-phone').textContent = viewedProfile.phone || '';
      $('other-profile-modal').classList.remove('hidden');
    } catch (error) { showToast(error.message || 'Не удалось открыть профиль.', 'error'); }
  }
  $('close-other-profile').addEventListener('click', () => $('other-profile-modal').classList.add('hidden'));
  $('other-profile-modal').addEventListener('click', e => { if (e.target === $('other-profile-modal')) $('other-profile-modal').classList.add('hidden'); });
  $('other-profile-message').addEventListener('click', () => {
    $('other-profile-modal').classList.add('hidden');
    if (viewedProfile) openChat(viewedProfile);
  });
  [$('chat-avatar'), $('chat-name')].forEach(el => {
    el.style.cursor = 'pointer'; el.setAttribute('title', 'Открыть профиль');
    el.addEventListener('click', () => viewUserProfile(state.selectedUser));
  });

  function closeProfileModal() {
    $('profile-modal').classList.add('hidden');
    if (state.pendingAvatarObjectUrl) {
      URL.revokeObjectURL(state.pendingAvatarObjectUrl);
      state.pendingAvatarObjectUrl = null;
    }
    state.pendingAvatarFile = null;
  }

  function openProfileModal() {
    if (!state.profile) return;
    $('profile-display-name').value = state.profile.displayName || '';
    $('profile-username').value = state.profile.username || '';
    $('profile-bio').value = state.profile.bio || '';
    $('profile-presence').value = ['online', 'away', 'dnd'].includes(state.profile.presenceStatus) ? state.profile.presenceStatus : 'online';
    $('profile-privacy').value = ['everyone', 'nobody'].includes(state.profile.privacyOnline) ? state.profile.privacyOnline : 'everyone';
    $('profile-avatar-color').value = /^#[0-9a-f]{6}$/i.test(state.profile.avatarColor || '') ? state.profile.avatarColor : '#3390ec';
    paintAvatar($('profile-avatar-preview'), state.profile);
    $('profile-modal').classList.remove('hidden');
  }

  $('profile-button').addEventListener('click', openProfileModal);
  $('close-profile').addEventListener('click', closeProfileModal);
  $('cancel-profile').addEventListener('click', closeProfileModal);
  $('profile-modal').addEventListener('click', (event) => { if (event.target === $('profile-modal')) closeProfileModal(); });
  $('choose-avatar').addEventListener('click', () => $('profile-avatar-input').click());
  $('profile-avatar-input').addEventListener('change', () => {
    const file = $('profile-avatar-input').files?.[0] || null;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Выбери файл изображения.', 'error');
      $('profile-avatar-input').value = '';
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      showToast('Размер аватара не должен превышать 4 МБ.', 'error');
      $('profile-avatar-input').value = '';
      return;
    }
    if (state.pendingAvatarObjectUrl) URL.revokeObjectURL(state.pendingAvatarObjectUrl);
    state.pendingAvatarFile = file;
    state.pendingAvatarObjectUrl = URL.createObjectURL(file);
    paintAvatar($('profile-avatar-preview'), { ...state.profile, avatarUrl: state.pendingAvatarObjectUrl });
  });
  $('remove-avatar').addEventListener('click', async () => {
    try {
      if (state.pendingAvatarObjectUrl) URL.revokeObjectURL(state.pendingAvatarObjectUrl);
      state.pendingAvatarObjectUrl = null;
      state.pendingAvatarFile = null;
      $('profile-avatar-input').value = '';
      const result = await api('/api/profile/avatar', 'DELETE');
      state.profile = result.profile || { ...state.profile, avatarUrl: '' };
      state.avatarRevisionById.set(state.profile.id, Date.now());
      updateSelfProfile();
      renderChatList();
      showToast('Фото профиля удалено.', 'success');
    } catch (error) {
      showToast(error.message || 'Не удалось удалить фото.', 'error');
    }
  });

  $('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('save-profile');
    button.disabled = true;
    button.textContent = 'Сохраняю…';
    try {
      if (state.pendingAvatarFile) {
        const uploadedAvatar = await uploadFile('/api/profile/avatar', 'avatar', state.pendingAvatarFile);
        if (uploadedAvatar.profile) state.profile = uploadedAvatar.profile;
        if (state.profile?.id) state.avatarRevisionById.set(state.profile.id, Date.now());
      }
      const payload = {
        username: $('profile-username').value.trim().replace(/^@/, ''),
        displayName: $('profile-display-name').value.trim(),
        bio: $('profile-bio').value.trim(),
        presenceStatus: $('profile-presence').value,
        privacyOnline: $('profile-privacy').value,
        avatarColor: $('profile-avatar-color').value
      };
      const result = await api('/api/profile', 'PATCH', payload);
      state.profile = result.profile || state.profile;
      updateSelfProfile();
      renderChatList();
      if (state.selectedUser) renderChatHeader();
      closeProfileModal();
      showToast('Профиль сохранён.', 'success');
    } catch (error) {
      showToast(error.message || 'Не удалось сохранить профиль.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Сохранить изменения';
    }
  });

  function closeMediaViewer() {
    const video = $('media-viewer-video');
    video.pause();
    video.removeAttribute('src');
    $('media-viewer-image').removeAttribute('src');
    $('media-viewer').classList.add('hidden');
  }
  $('media-viewer-close').addEventListener('click', closeMediaViewer);
  $('media-viewer').addEventListener('click', (event) => { if (event.target === $('media-viewer')) closeMediaViewer(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('media-viewer').classList.contains('hidden')) closeMediaViewer();
    if (event.key === 'Escape' && !$('profile-modal').classList.contains('hidden')) closeProfileModal();
  });

  // The backend must confirm the owner's immutable account ID. Username alone is NOT admin authorization.
  async function updateAdminAvailability() {
    const isOwnerUsername = String(state.profile?.username || '').toLowerCase() === 'z1pperj';
    $('admin-button').classList.toggle('hidden', !isOwnerUsername);
    $('mobile-admin-button').classList.toggle('hidden', !isOwnerUsername);
    if (!isOwnerUsername) return;
    try {
      const info = await api('/api/admin/me');
      $('admin-button').title = info.isAdmin ? 'Админ-панель' : 'Активировать админ-панель';
    } catch {
      $('admin-button').title = 'Админ-панель — требуется настройка сервера';
    }
  }

  async function checkAdminState() {
    $('admin-manager').classList.add('hidden');
    $('admin-claim').classList.add('hidden');
    $('admin-status').textContent = 'Проверяем права аккаунта…';
    try {
      const status = await api('/api/admin/me');
      if (status.isAdmin) {
        $('admin-status').textContent = 'Права владельца подтверждены сервером. Можно выдавать и отзывать галочки.';
        $('admin-manager').classList.remove('hidden');
        await listAdminUsers();
      } else {
        $('admin-status').textContent = 'Админ-права ещё не активированы для этого аккаунта.';
        $('admin-claim').classList.remove('hidden');
      }
    } catch (error) {
      $('admin-status').textContent = 'Админ-маршруты пока не установлены на сервере. Сначала подключи модуль из папки server-patch.';
    }
  }

  async function listAdminUsers() {
    const target = $('admin-results');
    target.replaceChildren();
    target.textContent = 'Загрузка…';
    try {
      const q = $('admin-search').value.trim();
      const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
      const users = Array.isArray(data.users) ? data.users : [];
      target.replaceChildren();
      if (!users.length) { target.textContent = 'Пользователи не найдены.'; return; }
      for (const user of users) {
        const item = document.createElement('div'); item.className = 'admin-user';
        const avatar = document.createElement('div'); avatar.className = 'avatar admin-user-avatar';
        paintAvatar(avatar, user);
        const info = document.createElement('div'); info.className = 'admin-user-info';
        const name = document.createElement('strong'); name.textContent = user.displayName || user.username;
        const username = document.createElement('span'); username.textContent = `@${user.username}`;
        info.append(name, username);
        const button = document.createElement('button'); button.type = 'button';
        button.className = `secondary-button admin-user-action${user.verified ? ' revoke' : ''}`;
        button.textContent = user.isOwner ? 'Владелец' : user.verified ? 'Снять галочку' : 'Выдать галочку';
        button.disabled = Boolean(user.isOwner);
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await api(`/api/admin/users/${encodeURIComponent(user.id)}/verified`, 'PATCH', { verified: !user.verified });
            showToast('Статус подтверждения изменён.', 'success');
            await listAdminUsers();
          } catch (error) {
            button.disabled = false;
            showToast(error.message || 'Не удалось изменить галочку.', 'error');
          }
        });
        item.append(avatar, info, button); target.append(item);
      }
    } catch (error) { target.textContent = error.message || 'Не удалось получить пользователей.'; }
  }

  $('admin-button').addEventListener('click', async () => {
    if (String(state.profile?.username || '').toLowerCase() !== 'z1pperj') return;
    $('admin-modal').classList.remove('hidden');
    await checkAdminState();
  });
  $('close-admin').addEventListener('click', () => $('admin-modal').classList.add('hidden'));
  $('admin-modal').addEventListener('click', e => { if (e.target === $('admin-modal')) $('admin-modal').classList.add('hidden'); });
  $('admin-search-go').addEventListener('click', listAdminUsers);
  $('admin-search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); listAdminUsers(); } });
  $('admin-claim-submit').addEventListener('click', async () => {
    const claimCode = $('admin-claim-code').value;
    if (!claimCode) return showToast('Введите код владельца.', 'error');
    const button = $('admin-claim-submit'); button.disabled = true;
    try {
      await api('/api/admin/claim', 'POST', { claimCode });
      $('admin-claim-code').value = '';
      await checkAdminState();
      const self = await api('/api/auth/me'); if (self.profile) { state.profile = self.profile; updateSelfProfile(); }
      showToast('Админ-панель активирована.', 'success');
    } catch (error) { showToast(error.message || 'Не удалось активировать права.', 'error'); }
    finally { button.disabled = false; }
  });

  async function restoreSession() {
    if (!state.baseUrl || !state.token) { showAuth(); return; }
    try {
      state.baseUrl = IS_WEB ? window.location.origin : 'https://my-chat-ucw4.onrender.com';
      const data = await api('/api/profile');
      state.profile = data.profile;
      if (!state.profile) throw new Error('Профиль не найден.');
      showApp(); updateAdminAvailability(); connectSocket(); await loadChats(); if (!state.chats.length && isOwner()) await switchDirectory('people');
    } catch {
      state.token = ''; localStorage.removeItem('burmal.token'); showAuth();
    }
  }

  setComposerEnabled(false);
  restoreSession();
})();
