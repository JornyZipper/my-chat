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
    pendingFiles: [],
    replyTo: null,
    voiceRecorder: null,
    pendingAvatarFile: null,
    pendingAvatarObjectUrl: null,
    avatarRevisionById: new Map(),
    seenNotificationIds: new Set(),
    popupsEnabled: localStorage.getItem('burmal.popups.v8') !== 'off'
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

  // Keep small media in a bounded, account-scoped cache. Large video is never cached.
  const mediaPromiseCache = new Map();
  let mediaCacheToken = '';
  async function loadAttachmentDataUrl(attachment) {
    if (mediaCacheToken !== state.token) {
      mediaPromiseCache.clear();
      mediaCacheToken = state.token;
    }
    const path = String(attachment?.url || '');
    const key = `${state.baseUrl}|${path}`;
    const cached = mediaPromiseCache.get(key);
    if (cached) return cached;
    const task = (async () => {
      const result = await window.burmalDesktop.mediaRequest({ baseUrl: state.baseUrl, path, token: state.token });
      if (!result.ok) throw new Error(result.error || `Не удалось открыть файл (HTTP ${result.status}).`);
      const url = `data:${result.mimeType || attachment?.mime || 'application/octet-stream'};base64,${result.base64}`;
      // At most ~2 MiB per cached media. Keep videos and large photos out of RAM cache.
      if (url.length > 2_500_000 && mediaPromiseCache.get(key) === task) mediaPromiseCache.delete(key);
      return url;
    })();
    mediaPromiseCache.set(key, task);
    if (mediaPromiseCache.size > 12) mediaPromiseCache.delete(mediaPromiseCache.keys().next().value);
    task.catch(() => { if (mediaPromiseCache.get(key) === task) mediaPromiseCache.delete(key); });
    return task;
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
    element.classList.add('avatar-ready');
    const isOfficialSupport = user?.id === 'bpc-official-support';
    let url = isOfficialSupport
      ? new URL('./assets/support-icon.png', document.baseURI).href
      : absoluteAssetUrl(user?.avatarUrl);
    const revision = state.avatarRevisionById.get(user?.id);
    if (url && revision && url.startsWith('http')) {
      const parsed = new URL(url); parsed.searchParams.set('avatar_v', String(revision)); url = parsed.href;
    }
    element.style.background = user?.avatarColor || '';
    if (url) {
      // Preserve existing avatar while online status / chat previews refresh.
      const displayed = element.querySelector('img.avatar-image');
      if (displayed && displayed.src === url) return;
      element.replaceChildren();
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
      const text = initials(user?.displayName || user?.username);
      if (!element.querySelector('img') && element.textContent === text) return;
      element.textContent = text;
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
    state.pendingFiles = file ? [file] : [];
    drawMediaPreviews();
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
  const filePreviews = [];
  function clearPreviewUrls() {for (const url of filePreviews.splice(0)) URL.revokeObjectURL(url);}
  function drawMediaPreviews() {
    clearPreviewUrls();
    const list = $('media-preview'); if(!list) return;
    list.replaceChildren();
    const files = state.pendingFiles || [];
    list.classList.toggle('hidden',files.length===0);
    if (!files.length) return;
    files.forEach((file,index)=>{
      const tile=document.createElement('div');tile.className='v7-preview-tile';
      if(file.type.startsWith('image/')){const im=document.createElement('img'); const url=URL.createObjectURL(file); filePreviews.push(url);im.src=url;im.alt=file.name;tile.append(im);}
      else if(file.type.startsWith('video/')){const v=document.createElement('video'); const url=URL.createObjectURL(file);filePreviews.push(url);v.src=url;v.muted=true;v.preload='metadata';tile.append(v);}
      else {const ico=document.createElement('span');ico.textContent=file.type.startsWith('audio/')?'♫':'▤';tile.append(ico);}
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Убрать '+file.name;
      remove.addEventListener('click',()=>{state.pendingFiles.splice(index,1);state.pendingAttachment=state.pendingFiles[0]||null;drawMediaPreviews(); $('attachment-pending').classList.toggle('hidden',!!state.pendingFiles.length||!state.pendingAttachment);});
      const label=document.createElement('small');label.textContent=file.name;tile.append(remove,label);list.append(tile);
    });
  }
  function selectFiles(files) {
    const chosen=Array.from(files||[]);
    if(!chosen.length)return;
    if(chosen.length>10){showToast('Можно отправить до 10 файлов за раз.','error');return;}
    if(chosen.some(f=>f.size>15*1024*1024)){showToast('Один файл может быть не больше 15 МБ.','error');return;}
    state.pendingFiles=chosen;state.pendingAttachment=chosen[0];
    $('attachment-pending').classList.add('hidden');drawMediaPreviews();sendButton.disabled=false;
  }
  function updateCallActions() {
    const isSupport=state.selectedUser?.id==='bpc-official-support';
    ['voiceCallButton','videoCallButton'].forEach(id=>{const button=$(id);if(button){button.disabled=isSupport;button.classList.toggle('hidden',isSupport);}});
  }
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
    $('my-verified').classList.toggle('v8-owner-badge', Boolean(state.profile.ownerBadge));
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

  // Keep multiple *server-issued* sessions. Never store passwords or SMS codes.
  const ACCOUNTS_KEY = 'burmal.saved-accounts.v8';
  function savedAccounts() {
    try {
      const rows = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
      return Array.isArray(rows) ? rows.filter(x => x && typeof x.id === 'string' && typeof x.token === 'string').slice(0, 5) : [];
    } catch { return []; }
  }
  function saveAccounts(rows) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(rows.slice(0, 5))); }
  function rememberAccount() {
    if (!state.profile?.id || !state.token) return;
    const p = state.profile;
    saveAccounts([{id: String(p.id), username: String(p.username || ''),
      displayName: String(p.displayName || p.username || ''), token: state.token},
      ...savedAccounts().filter(x => x.id !== p.id)]);
  }
  function forgetCurrentAccount() {
    if (state.profile?.id) saveAccounts(savedAccounts().filter(x => x.id !== state.profile.id));
  }
  function resetSession() {
    disconnectSocket(); $('admin-button').classList.add('hidden'); $('mobile-admin-button').classList.add('hidden');
    state.token = ''; state.profile = null; state.chats = []; state.directory = [];
    state.usersById.clear(); state.selectedUser = null; state.selectedConversationId = null;
    state.messages = []; state.avatarRevisionById.clear(); state.seenNotificationIds.clear();
    appScreen.classList.remove('mobile-chat-open'); localStorage.removeItem('burmal.token');
    setComposerEnabled(false); showAuth();
  }
  function showAccountPicker() {
    const modal = $('v8-accounts-modal');
    const list = $('v8-accounts-list'); list.replaceChildren();
    for (const account of savedAccounts()) {
      const row = document.createElement('div'); row.className = 'v8-account-row';
      const name = document.createElement('button'); name.type = 'button'; name.className = 'v8-account-select';
      name.textContent = `${account.displayName} · @${account.username}${state.profile?.id === account.id ? '  ✓ текущий' : ''}`;
      name.addEventListener('click', async () => {
        if (state.profile?.id === account.id) { modal.classList.add('hidden'); return; }
        modal.classList.add('hidden'); resetSession();
        state.token = account.token; localStorage.setItem('burmal.token', account.token);
        try {
          const result = await api('/api/auth/me');
          if (!result.profile || result.profile.id !== account.id) throw new Error('Сессия истекла. Войди заново.');
          state.profile = result.profile; rememberAccount(); showApp(); updateAdminAvailability();
          connectSocket(); await loadChats();
        } catch (error) {
          saveAccounts(savedAccounts().filter(x => x.id !== account.id)); resetSession();
          showToast(error.message || 'Не удалось переключить аккаунт.', 'error');
        }
      });
      const remove = document.createElement('button'); remove.type = 'button';
      remove.className = 'v8-account-remove'; remove.title = 'Удалить сохранённый вход'; remove.textContent = '×';
      remove.addEventListener('click', () => {
        saveAccounts(savedAccounts().filter(x => x.id !== account.id));
        if (state.profile?.id === account.id) resetSession();
        showAccountPicker();
      });
      row.append(name, remove); list.append(row);
    }
    if (!list.children.length) { const blank = document.createElement('p'); blank.textContent = 'Сохранённых аккаунтов пока нет.'; list.append(blank); }
    modal.classList.remove('hidden');
  }
  $('v8-add-account').addEventListener('click', () => {
    $('v8-accounts-modal').classList.add('hidden'); resetSession();
    showToast('Войди в другой аккаунт: прежний вход останется сохранённым.');
  });
  $('v8-accounts-close').addEventListener('click', () => $('v8-accounts-modal').classList.add('hidden'));
  $('v8-accounts-modal').addEventListener('click', e => { if (e.target === $('v8-accounts-modal')) e.target.classList.add('hidden'); });
  $('v8-settings-accounts').addEventListener('click', () => { $('settings-modal').classList.add('hidden'); showAccountPicker(); });
  $('v8-popups-enabled').checked = state.popupsEnabled;
  $('v8-popups-enabled').addEventListener('change', (event) => {
    state.popupsEnabled = Boolean(event.target.checked);
    localStorage.setItem('burmal.popups.v8', state.popupsEnabled ? 'on' : 'off');
    if (state.popupsEnabled) {
      try { window.BurmalAndroidNotifications?.requestPermission(); } catch {}
      if (!window.BurmalAndroidNotifications && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  });
  function notifyIncoming(message) {
    if (!state.popupsEnabled || !message?.id || message.senderId === state.profile?.id || state.seenNotificationIds.has(message.id)) return;
    state.seenNotificationIds.add(message.id);
    if (state.seenNotificationIds.size > 120) state.seenNotificationIds.delete(state.seenNotificationIds.values().next().value);
    const user = state.usersById.get(message.senderId) || state.chats.find(x => x.user?.id === message.senderId)?.user;
    const title = String(user?.displayName || message.senderDisplayName || message.senderUsername || 'Новое сообщение').slice(0, 60);
    const body = String(message.text || (message.attachment ? '📎 Вложение' : 'Новое сообщение')).slice(0, 160);
    const pop = $('v8-notification');
    $('v8-notification-title').textContent = title;
    $('v8-notification-text').textContent = body;
    pop.classList.remove('hidden');
    clearTimeout(notifyIncoming.timer);
    notifyIncoming.timer = setTimeout(() => pop.classList.add('hidden'), 5400);
    pop.onclick = async () => {
      pop.classList.add('hidden');
      if (user) await openChat(user);
      else { try { const found = await api(`/api/users/${encodeURIComponent(message.senderId)}`); if (found.profile) await openChat(found.profile); } catch {} }
    };
    if (window.BurmalAndroidNotifications) {
      try { window.BurmalAndroidNotifications.show(title, body, String(message.senderId || '')); } catch {}
    } else if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { const item = new Notification(title, { body, tag: `burmal-${message.id}` }); item.onclick = () => { window.focus(); pop.click(); item.close(); }; } catch {}
    }
  }
  // Native notification tap: opens the matching conversation when WebView is alive.
  window.burmalOpenChatFromNotification = async (id) => {
    const user = state.usersById.get(id) || state.chats.find(x => x.user?.id === id)?.user;
    if (user) await openChat(user);
  };

  async function finishLogin(data) {
    if (data?.verificationRequired) {
      showToast(data.message || 'Проверь почту для подтверждения регистрации.');
      return;
    }
    if (!data?.token || !data?.profile) throw new Error('Сервер не вернул токен и профиль. Проверь версию сервера.');
    state.token = data.token;
    state.profile = data.profile;
    state.usersById.set(state.profile.id, state.profile);
    localStorage.setItem('burmal.token', state.token);
    rememberAccount();
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
      if (socket !== state.socket) return;
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
          if (data.message) { notifyIncoming(data.message); handleIncomingMessage(data.message); }
          break;
        case 'reaction':
          {const changed=state.messages.find(m=>m.id===data.messageId);if(changed){changed.reactions=data.reactions||[];renderMessages(true);}}
          break;
        case 'message_hidden':
          state.messages=state.messages.filter(m=>m.id!==data.messageId);renderMessages(true);break;
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
            if (state.messages.length && state.selectedUser) {
              messageList.querySelectorAll('[data-message-id]').forEach(node => {
                const msg = state.messages.find(m => m.id === node.dataset.messageId);
                if (!msg) return;
                const badge = node.querySelector('.message-author .verified');
                if (badge) badge.classList.toggle('v8-owner-badge', !!(state.usersById.get(msg.senderId)?.ownerBadge));
              });
            }
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
  // Diff existing rows so a new message never reloads avatars in unrelated chats.
  function reconcileNodes(parent, desired) {
    let cursor = parent.firstChild;
    for (const node of desired) {
      if (cursor === node) { cursor = cursor.nextSibling; continue; }
      parent.insertBefore(node, cursor);
    }
    while (cursor) {
      const next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
  }
  function renderChatList() {
    const oldRows = new Map(Array.from(chatList.querySelectorAll('[data-chat-user-id]'), node => [node.dataset.chatUserId, node]));
    const rows = [];
    if (!state.chats.length) {
      const empty = document.createElement('div');
      empty.className = 'no-results';
      empty.textContent = isOwner() ? 'Пока нет чатов. Открой вкладку «Люди».' : 'Пока нет чатов. Когда тебе напишут, переписка появится здесь.';
      reconcileNodes(chatList, [empty]);
      return;
    }
    for (const chat of state.chats) {
      const user = chat.user || {};
      if (!isOwner() && searchInput.value.trim() && !`${user.username || ''} ${user.displayName || ''}`.toLowerCase().includes(searchInput.value.trim().toLowerCase())) continue;
      const chatId = String(user.id || '');
      const signature = JSON.stringify([user.displayName,user.username,user.avatarUrl,user.avatarColor,user.verified,user.ownerBadge,state.avatarRevisionById.get(user.id), chat.lastMessage?.text, chat.lastMessage?.time, state.selectedUser?.id === user.id]);
      const oldButton = oldRows.get(chatId);
      if (oldButton && oldButton.dataset.renderSignature === signature) {
        rows.push(oldButton);
        continue;
      }
      const button = document.createElement('button');
      button.dataset.chatUserId = chatId;
      button.dataset.renderSignature = signature;
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
        badge.className = `verified${user.ownerBadge ? ' v8-owner-badge' : ''}`; badge.textContent = '✓'; top.append(badge);
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
      rows.push(button);
    }
    reconcileNodes(chatList, rows);
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
      if (user.verified) { const badge = document.createElement('span'); badge.className = `verified${user.ownerBadge ? ' v8-owner-badge' : ''}`; badge.textContent = '✓'; badge.title = user.ownerBadge ? 'Владелец BurmalpticajopaChat' : 'Подтверждённый профиль'; titleLine.append(badge); }
      text.append(titleLine, username); button.append(avatar, text);
      button.addEventListener('click', () => viewUserProfile(user)); searchResults.append(button);
    }
  }

  async function openChat(user) {
    if (!user?.id) return;
    if (state.selectedUser?.id === user.id && !$('chat-view').classList.contains('hidden')) {
      appScreen.classList.add('mobile-chat-open');
      return;
    }
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
    $('chat-verified').classList.toggle('v8-owner-badge', Boolean(state.selectedUser.ownerBadge));
    updateCallActions();
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
    const wasAtBottom = oldScrollHeight - oldTop - messageList.clientHeight < 95;
    if (!state.messages.length) {
      const empty = document.createElement('div'); empty.className = 'empty-messages'; empty.textContent = 'Это начало вашей переписки. Напиши первое сообщение.';
      reconcileNodes(messageList, [empty]); return;
    }
    const oldItems = new Map(Array.from(messageList.querySelectorAll('article[data-message-id]'), node => [node.dataset.messageId, node]));
    const oldDates = new Map(Array.from(messageList.querySelectorAll('.message-date[data-date]'), node => [node.dataset.date, node]));
    const desired = [];
    let lastDate = '';
    for (const message of state.messages) {
      const date = new Date(message.createdAt || Date.now());
      const dateStr = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      if (dateStr && dateStr !== lastDate) {
        const dateRow = oldDates.get(dateStr) || document.createElement('div');
        dateRow.className = 'message-date'; dateRow.dataset.date = dateStr; dateRow.textContent = dateStr;
        desired.push(dateRow); lastDate = dateStr;
      }
      // Unchanged messages keep their real DOM nodes: no media download, flicker, or playback reset.
      const authorProfile = state.usersById.get(message.senderId) || (message.senderId === state.profile?.id ? state.profile : state.selectedUser);
      const signature = JSON.stringify([
        message.senderId, message.senderUsername, message.senderDisplayName, message.senderVerified,
        authorProfile?.verified, authorProfile?.ownerBadge,
        message.text, message.deleted, message.createdAt, message.forwarded,
        message.replyTo?.id, message.replyTo?.text, message.replyTo?.username,
        message.attachment?.id, message.attachment?.mime, message.attachment?.filename,
        message.reactions, Boolean(message.readAt), Boolean(message.deliveredAt), state.profile?.id
      ]);
      const oldItem = oldItems.get(String(message.id));
      if (oldItem && oldItem.dataset.renderSignature === signature) {
        desired.push(oldItem);
        continue;
      }
      const item = document.createElement('article');
      item.dataset.renderSignature = signature;
      const mine = message.senderId === state.profile?.id;
      item.className = `message${mine ? ' mine' : ''}`;
      if (!mine) {
        const author = document.createElement('div'); author.className = 'message-author';
        const username = document.createElement('span'); username.textContent = message.senderDisplayName || message.senderUsername || state.selectedUser?.username || '';
        author.append(username);
        author.style.cursor = 'pointer'; author.title = 'Открыть профиль';
        author.addEventListener('click', () => viewUserProfile(state.selectedUser));
        if (message.senderVerified || state.usersById.get(message.senderId)?.verified) {
          const ownerBadge = Boolean((state.usersById.get(message.senderId) || (message.senderId === state.profile?.id ? state.profile : state.selectedUser))?.ownerBadge);
          const badge = document.createElement('span'); badge.className = `verified${ownerBadge ? ' v8-owner-badge' : ''}`; badge.title = ownerBadge ? 'Владелец BurmalpticajopaChat' : 'Подтверждённый профиль'; badge.textContent = '✓'; author.append(badge);
        }
        item.append(author);
      }
      const bubble = document.createElement('div'); bubble.className = 'message-bubble';
      bubble.setAttribute('data-message-id',message.id);
      if(message.replyTo){const quote=document.createElement('div');quote.className='v7-quote';quote.textContent=`↳ ${message.replyTo.username||'Пользователь'}: ${message.replyTo.text||'Вложение'}`;bubble.append(quote);}
      if(message.forwarded){const fw=document.createElement('div');fw.className='v7-forwarded';fw.textContent='➜ Пересланное сообщение';bubble.append(fw);}
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
      if(Array.isArray(message.reactions)&&message.reactions.length){
        const reactions=document.createElement('div');reactions.className='v7-reactions';
        const grouped=new Map();for(const rr of message.reactions)grouped.set(rr.emoji,(grouped.get(rr.emoji)||0)+1);
        for(const [emoji,count] of grouped){const b=document.createElement('button');b.type='button';b.textContent=`${emoji} ${count}`;b.className='v7-reaction';b.addEventListener('click',()=>changeReaction(message,emoji));reactions.append(b);}
        bubble.append(reactions);
      }
      enableMessageMenu(item,message);
      item.append(bubble);
      item.dataset.messageId = String(message.id || '');
      const meta = document.createElement('div'); meta.className = 'message-meta';
      const time = document.createElement('span'); time.textContent = timeLabel(message.createdAt);
      meta.append(time);
      if (mine) {
        const receipt = document.createElement('span'); receipt.textContent = message.readAt ? '✓✓' : message.deliveredAt ? '✓✓' : '✓'; receipt.style.color = message.readAt ? '#9db5ff' : 'inherit'; meta.append(receipt);
      }
      item.append(meta); desired.push(item);
    }
    reconcileNodes(messageList, desired);
    if (!keepScroll || wasAtBottom) messageList.scrollTop = messageList.scrollHeight;
    else messageList.scrollTop = oldTop;
    // Lazy thumbnails may change height later. Do not jump while user reads older messages.
  }
  function handleIncomingMessage(message) {
    if (state.selectedUser && state.selectedConversationId && message.conversationId === state.selectedConversationId) {
      const existingIndex=state.messages.findIndex(item => item.id === message.id);
      if (existingIndex>=0) {state.messages[existingIndex]=message;renderMessages(true);}
      else {
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

  function clearReply(){state.replyTo=null;$('reply-preview').classList.add('hidden');$('reply-preview-text').textContent='';}
  $('reply-cancel').addEventListener('click',clearReply);
  function setReply(message){state.replyTo=message;$('reply-preview-text').textContent=`Ответ ${message.senderUsername||''}: ${(message.text||'Вложение').slice(0,100)}`;$('reply-preview').classList.remove('hidden');messageInput.focus();}
  const msgMenu=$('v7-message-menu');
  function closeMessageMenu(){msgMenu.classList.add('hidden');msgMenu.replaceChildren();}
  document.addEventListener('pointerdown',e=>{if(!msgMenu.contains(e.target) && !e.target.closest('.message'))closeMessageMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMessageMenu();});
  async function changeReaction(message,emoji){try {const result=await api(`/api/messages/${encodeURIComponent(message.id)}/reactions`,'POST',{emoji});message.reactions=result.reactions||[];renderMessages(true);}catch(err){showToast(err.message,'error');}closeMessageMenu();}
  function menuButton(text,onClick,danger=false){const b=document.createElement('button');b.type='button';b.textContent=text;b.className='v7-menu-option'+(danger?' danger':'');b.addEventListener('click',async()=>{closeMessageMenu();try{await onClick();}catch(err){showToast(err.message||'Ошибка операции','error');}});msgMenu.append(b);}
  function openMessageMenu(message){
    closeMessageMenu();msgMenu.classList.remove('hidden');
    const emojis=document.createElement('div');emojis.className='v7-emoji-row';
    for(const emoji of ['👍','❤️','😂','🔥','😮','😢','👏']){const b=document.createElement('button');b.type='button';b.textContent=emoji;b.addEventListener('click',()=>changeReaction(message,emoji));emojis.append(b);}msgMenu.append(emojis);
    menuButton('↩ Ответить',()=>setReply(message));
    menuButton('➜ Переслать',()=>showForwardPicker(message));
    if(message.text && !message.deleted)menuButton('▣ Скопировать',async()=>{await navigator.clipboard.writeText(message.text);showToast('Текст скопирован','success');});
    menuButton('⌫ Удалить у себя',async()=>{await api(`/api/messages/${encodeURIComponent(message.id)}/hide`,'POST');state.messages=state.messages.filter(m=>m.id!==message.id);renderMessages(true);},true);
    if(message.senderId===state.profile?.id&&!message.deleted)menuButton('✕ Удалить у обоих',async()=>{if(!confirm('Удалить сообщение у обоих участников?'))return;const response=await api(`/api/messages/${encodeURIComponent(message.id)}`,'DELETE');const i=state.messages.findIndex(m=>m.id===message.id);if(i>=0){state.messages[i]=response.message;renderMessages(true);}},true);
    msgMenu.classList.remove('hidden');
  }
  function enableMessageMenu(item,message){
    let timer=0,startX=0,startY=0,opened=false;
    item.addEventListener('contextmenu',e=>{e.preventDefault();openMessageMenu(message);});
    item.addEventListener('touchstart',e=>{opened=false;startX=e.touches[0]?.clientX||0;startY=e.touches[0]?.clientY||0;clearTimeout(timer);timer=setTimeout(()=>{opened=true;openMessageMenu(message);navigator.vibrate?.(12);},560);},{passive:true});
    item.addEventListener('touchmove',e=>{if(Math.abs((e.touches[0]?.clientX||0)-startX)>12||Math.abs((e.touches[0]?.clientY||0)-startY)>12)clearTimeout(timer);},{passive:true});
    ['touchend','touchcancel'].forEach(t=>item.addEventListener(t,()=>clearTimeout(timer),{passive:true}));
    item.addEventListener('click',e=>{if(opened){e.preventDefault();e.stopPropagation();opened=false;}},true);
  }
  function showForwardPicker(message){
    closeMessageMenu();msgMenu.classList.remove('hidden');
    const title=document.createElement('h3');title.textContent='Переслать в чат';msgMenu.append(title);
    const chats=state.chats.filter(ch=>ch.user?.id&&ch.user.id!=='bpc-official-support');
    if(!chats.length){msgMenu.append('Нет других чатов');return;}
    chats.forEach(ch=>menuButton(ch.user.displayName||'@'+ch.user.username,async()=>{await api(`/api/messages/${encodeURIComponent(message.id)}/forward`,'POST',{toUserId:ch.user.id});showToast('Сообщение переслано','success');}));
    menuButton('Отмена',()=>{});
  }
  let recordingStream=null,recordingChunks=[],recordingStart=0,recordingLimit=0;
  const mic=$('voice-record-button');
  function resetRecorderUi(){mic.classList.remove('recording');mic.textContent='🎙';$('voice-record-status').classList.add('hidden');clearInterval(recordingLimit);recordingLimit=0;}
  async function stopRecording(sendIt=true){
    const rec=state.voiceRecorder;if(!rec)return;
    state.voiceRecorder=null;
    rec.onstop=async()=>{
      recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;resetRecorderUi();
      if(!sendIt||!recordingChunks.length)return;
      const type=rec.mimeType||'audio/webm';const blob=new Blob(recordingChunks,{type});recordingChunks=[];
      if(blob.size>15*1024*1024){showToast('Голосовое сообщение слишком большое','error');return;}
      const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
      selectFiles([new File([blob],`voice-${Date.now()}.${ext}`,{type})]);
      $('composer-form').requestSubmit();
    };
    if(rec.state!=='inactive')rec.stop();else {recordingStream?.getTracks().forEach(t=>t.stop());resetRecorderUi();}
  }
  mic.addEventListener('click',async()=>{
    if(state.voiceRecorder){await stopRecording(true);return;}
    if(!state.selectedUser||state.selectedUser.id==='bpc-official-support'){showToast('Сначала открой обычный чат','error');return;}
    if(!state.socketReady){showToast('Нет подключения','error');return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){showToast('Запись аудио не поддерживается этим устройством','error');return;}
    try{
      recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg'].find(v=>MediaRecorder.isTypeSupported(v));
      const rec=mime?new MediaRecorder(recordingStream,{mimeType:mime}):new MediaRecorder(recordingStream);
      state.voiceRecorder=rec;recordingChunks=[];recordingStart=Date.now();
      rec.ondataavailable=e=>{if(e.data?.size)recordingChunks.push(e.data);};
      rec.onerror=()=>{stopRecording(false);showToast('Ошибка записи звука','error');};
      rec.start();mic.classList.add('recording');mic.textContent='■';$('voice-record-status').classList.remove('hidden');
      recordingLimit=setInterval(()=>{const sec=Math.floor((Date.now()-recordingStart)/1000);$('voice-record-time').textContent=`● ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;if(sec>=60)stopRecording(true);},250);
    }catch(err){recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;showToast('Разреши доступ к микрофону: '+(err.message||err.name),'error');resetRecorderUi();}
  });
  $('voice-record-cancel').addEventListener('click',()=>stopRecording(false));
  $('attach-button').addEventListener('click', () => {
    if (!state.selectedUser) return showToast('Сначала открой чат.', 'error');
    $('v7-attach-sheet').classList.remove('hidden');
  });
  $('attachment-input').addEventListener('change', () => {
    const file = $('attachment-input').files?.[0] || null;
    if (file && file.size > 15 * 1024 * 1024) {
      $('attachment-input').value = '';
      setPendingAttachment(null);
      showToast('Максимальный размер файла — 15 МБ.', 'error');
      return;
    }
    selectFiles(file ? [file] : []);
  });
  $('gallery-input').addEventListener('change',()=>{selectFiles($('gallery-input').files);$('gallery-input').value='';});
  $('v7-pick-gallery').addEventListener('click',()=>{$('v7-attach-sheet').classList.add('hidden');$('gallery-input').click();});
  $('v7-pick-file').addEventListener('click',()=>{$('v7-attach-sheet').classList.add('hidden');$('attachment-input').click();});
  document.querySelector('[data-v7-sheet-close]').addEventListener('click',()=> $('v7-attach-sheet').classList.add('hidden'));
  $('attachment-remove').addEventListener('click', () => {
    $('attachment-input').value = '';
    setPendingAttachment(null);
  });

  $('composer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    const files = [...(state.pendingFiles || [])];
    if ((!text && !files.length) || !state.selectedUser) return;
    if (!state.socketReady || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
      showToast('Нет соединения с сервером. Подожди переподключения.', 'error'); return;
    }
    if (state.isSending) return;
    state.isSending = true;sendButton.disabled = true;$('attach-button').disabled = true;
    try {
      const entries=files.length?files:[null];
      for(let i=0;i<entries.length;i++) {
        const file=entries[i];let attachmentId=null;
        if(file){showToast(`Загружаю ${i+1} из ${entries.length}…`);const uploaded=await uploadFile('/api/upload','file',file);attachmentId=uploaded.attachment?.id;if(!attachmentId)throw new Error('Сервер не вернул ID файла.');}
        if(!state.socketReady||state.socket.readyState!==WebSocket.OPEN)throw new Error('Соединение потеряно во время отправки.');
        state.socket.send(JSON.stringify({type:'send',toUserId:state.selectedUser.id,
          text:i===0?text:'', attachmentId,
          replyToId:i===0?state.replyTo?.id||null:null,
          clientMessageId:(typeof crypto.randomUUID==='function')?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}));
      }
      messageInput.value='';messageInput.style.height='auto';
      $('attachment-input').value='';state.pendingFiles=[];state.pendingAttachment=null;
      drawMediaPreviews();$('attachment-pending').classList.add('hidden');clearReply();
    } catch (error) {
      showToast(error.message || 'Не удалось отправить сообщение.', 'error');
    } finally {
      state.isSending = false;
      sendButton.disabled = !state.socketReady || !state.selectedUser || (!messageInput.value.trim() && !(state.pendingFiles||[]).length);
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
  $('switch-account').addEventListener('click', showAccountPicker);
  $('logout-button').addEventListener('click', () => {
    forgetCurrentAccount(); resetSession(); showToast('Ты вышел из аккаунта.');
  });
  function showPhoneSettings() {
    if (!state.profile) return;
    $('current-phone').textContent = state.profile.phone || 'Не привязан';
    $('phone-link-number').value = state.profile.linkedPhone || (state.profile.officialNumber ? '' : state.profile.phone) || '';
    $('phone-visible').checked = Boolean(state.profile.phoneVisible);
    $('phone-visible').disabled = !state.profile.phoneVerified || Boolean(state.profile.officialNumber);
    $('call-privacy').value=state.profile.callPrivacy||'everyone';
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

  function updateCallPrivacy(){const selector=$('call-privacy');if(selector)selector.value=state.profile?.callPrivacy||'everyone';}
  $('settings-button').addEventListener('click',updateCallPrivacy);
  $('mobile-settings-button').addEventListener('click',updateCallPrivacy);
  $('save-call-privacy').addEventListener('click',async()=>{
    const priv=$('call-privacy').value;
    try{const current=state.profile||{};const response=await api('/api/profile','PATCH',{
      username:current.username,displayName:current.displayName,bio:current.bio||'',avatarColor:current.avatarColor,
      presenceStatus:current.presenceStatus,privacyOnline:current.privacyOnline,phoneVisible:current.phoneVisible,callPrivacy:priv});
      state.profile=response.profile||state.profile;updateSelfProfile();showToast('Приватность звонков сохранена','success');
    }catch(err){showToast(err.message||'Не удалось сохранить','error');}
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
      $('other-profile-phone').textContent = viewedProfile.officialNumber || viewedProfile.phone || '';
      $('other-profile-phone-row').querySelector('small').textContent = viewedProfile.officialNumber ? 'Официальный номер +888' : 'Номер телефона';
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
      if (state.profile) state.usersById.set(state.profile.id, state.profile);
      if (!state.profile) throw new Error('Профиль не найден.');
      rememberAccount(); showApp(); updateAdminAvailability(); connectSocket(); await loadChats(); if (!state.chats.length && isOwner()) await switchDirectory('people');
    } catch {
      forgetCurrentAccount(); resetSession();
    }
  }

  setComposerEnabled(false);
  restoreSession();
})();
