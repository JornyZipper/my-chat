const $ = id => document.getElementById(id);

const ui = {
  authScreen: $("authScreen"), authForm: $("authForm"), loginTab: $("loginTab"), registerTab: $("registerTab"), authSubtitle: $("authSubtitle"), authNameWrap: $("authNameWrap"), authEmailWrap: $("authEmailWrap"), claimWrap: $("claimWrap"), authName: $("authName"), authUsername: $("authUsername"), authEmail: $("authEmail"), claimCode: $("claimCode"), authPassword: $("authPassword"), authError: $("authError"), authSubmit: $("authSubmit"), forgotButton: $("forgotButton"),
  app: $("app"), sidebar: $("sidebar"), sidebarOverlay: $("sidebarOverlay"), openSidebar: $("openSidebar"), mobileBack: $("mobileBack"), searchInput: $("searchInput"), chatsTab: $("chatsTab"), peopleTab: $("peopleTab"), sidebarTitle: $("sidebarTitle"), chatList: $("chatList"), myProfileButton: $("myProfileButton"), myDisplayName: $("myDisplayName"), myUsername: $("myUsername"), myBio: $("myBio"), myVerified: $("myVerified"), settingsButton: $("settingsButton"),
  chatHeaderAvatar: $("chatHeaderAvatar"), chatHeaderName: $("chatHeaderName"), chatHeaderVerified: $("chatHeaderVerified"), chatHeaderStatus: $("chatHeaderStatus"), searchMessagesButton: $("searchMessagesButton"), chatMenuButton: $("chatMenuButton"), emptyScreen: $("emptyScreen"), messages: $("messages"), composer: $("composer"), messageInput: $("messageInput"), fileInput: $("fileInput"), cameraInput: $("cameraInput"), uploadProgress: $("uploadProgress"), uploadProgressBar: $("uploadProgressBar"), emojiButton: $("emojiButton"), emojiPanel: $("emojiPanel"), replyBar: $("replyBar"), replyText: $("replyText"), cancelReply: $("cancelReply"), findButton: $("findButton"),
  settingsBackdrop: $("settingsBackdrop"), closeSettings: $("closeSettings"), settingsAvatar: $("settingsAvatar"), avatarInput: $("avatarInput"), removeAvatarButton: $("removeAvatarButton"), settingsDisplayName: $("settingsDisplayName"), settingsUsername: $("settingsUsername"), settingsClaimWrap: $("settingsClaimWrap"), settingsClaimCode: $("settingsClaimCode"), settingsBio: $("settingsBio"), settingsPresence: $("settingsPresence"), settingsPrivacy: $("settingsPrivacy"), settingsVerifiedText: $("settingsVerifiedText"), settingsJoined: $("settingsJoined"), settingsError: $("settingsError"), saveProfileButton: $("saveProfileButton"), lightThemeButton: $("lightThemeButton"), darkThemeButton: $("darkThemeButton"), glassToggle: $("glassToggle"), soundToggle: $("soundToggle"), enableNotifications: $("enableNotifications"), installButton: $("installButton"), logoutButton: $("logoutButton"),
  contextMenu: $("contextMenu"), chatMenu: $("chatMenu"), pinChatButton: $("pinChatButton"), muteChatButton: $("muteChatButton"), blockUserButton: $("blockUserButton"), reportUserButton: $("reportUserButton"), toast: $("toast")
};

let mode = "login";
let token = localStorage.getItem("mychat_token") || "";
let profile = null;
let socket = null;
let reconnectTimer = null;
let currentUser = null;
let currentConversationId = null;
let currentMessages = [];
let users = [];
let chats = [];
let searchMode = "chats";
let replyTo = null;
let selectedMessage = null;
let typingTimer = null;
let typingSent = false;
let remoteTypingTimer = null;
let pendingInstallPrompt = null;
let pressTimer = null;
let touchStart = null;

// Public bridge used by calls.js. It does not expose secrets; it only
// provides access to the current chat state and the existing WebSocket sender.
window.myChatGetCurrentUser = () => currentUser;
window.myChatGetProfile = () => profile;
window.myChatSocketSend = data => socketSend(data);
window.myChatToast = message => toast(message);
window.myChatHaptic = ms => haptic(ms);

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.add("hidden"), 2400);
}

function haptic(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function makeClientMessageId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function authHeaders() {
  return {"Content-Type": "application/json", "Authorization": `Bearer ${token}`};
}

async function api(url, options = {}) {
  const headers = {...(options.headers || {})};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {...options, headers});
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function validUsername(v) { return /^[\p{L}\p{N}_.-]{2,24}$/u.test(v); }
function normalize(v) { return String(v || "").trim().toLowerCase(); }
function isVerifiedUser(u) { return normalize(u?.username) === "z1ipperj" || Boolean(u?.verified); }
function getAvatar(u) { return u?.avatarUrl ? `${u.avatarUrl}?t=${Date.now()}` : ""; }

function setAvatar(el, user, fallback = "?") {
  el.innerHTML = "";
  const url = getAvatar(user);
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    el.appendChild(img);
  } else {
    el.textContent = String(user?.displayName || user?.username || fallback).charAt(0).toUpperCase();
  }
}

function applyTheme() {
  const theme = localStorage.getItem("mychat_theme") || "light";
  const glass = localStorage.getItem("mychat_glass") !== "0";
  const wallpaper = localStorage.getItem("mychat_wallpaper") || "blue";
  const font = localStorage.getItem("mychat_font") || "16";
  document.body.classList.toggle("dark", theme === "dark");
  document.body.classList.toggle("no-glass", !glass);
  document.body.dataset.wallpaper = wallpaper;
  document.documentElement.style.setProperty("--message-font", `${font}px`);
  ui.lightThemeButton?.classList.toggle("active", theme === "light");
  ui.darkThemeButton?.classList.toggle("active", theme === "dark");
  if (ui.glassToggle) ui.glassToggle.checked = glass;
  if (ui.soundToggle) ui.soundToggle.checked = localStorage.getItem("mychat_sound") !== "0";
  document.querySelectorAll("[data-font]").forEach(b=>b.classList.toggle("active", b.dataset.font===font));
  document.querySelectorAll("[data-wallpaper]").forEach(b=>b.classList.toggle("active", b.dataset.wallpaper===wallpaper));
}
applyTheme();

function setAuthMode(next) {
  mode = next;
  const register = mode === "register";
  ui.authNameWrap.classList.toggle("hidden", !register);
  ui.authEmailWrap.classList.toggle("hidden", !register);
  ui.registerTab.classList.toggle("active", register);
  ui.loginTab.classList.toggle("active", !register);
  ui.authSubmit.textContent = register ? "Создать аккаунт" : "Войти";
  ui.authSubtitle.textContent = register ? "Создай свой профиль" : "Твой личный мессенджер";
  ui.forgotButton.classList.toggle("hidden", register);
  updateClaimField();
}

function updateClaimField() {
  const special = normalize(ui.authUsername.value) === "z1ipperj";
  ui.claimWrap.classList.toggle("hidden", !(mode === "register" && special));
}

ui.loginTab.onclick = () => setAuthMode("login");
ui.registerTab.onclick = () => setAuthMode("register");
ui.authUsername.addEventListener("input", updateClaimField);

let authBusy = false;

ui.authForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (authBusy || mode === "reset") return;
  authBusy = true;
  ui.authSubmit.disabled = true;
  ui.authError.textContent = "";
  try {
    if (mode === "register") {
      const body = {displayName: ui.authName.value.trim(), username: ui.authUsername.value.trim().replace(/^@/, ""), email: ui.authEmail.value.trim(), password: ui.authPassword.value, claimCode: ui.claimCode.value};
      if (!body.displayName) throw new Error("Введите имя.");
      if (!validUsername(body.username)) throw new Error("Неверный username.");
      if (!body.email) throw new Error("Введите email.");
      if (body.password.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");
      const data = await api("/api/auth/register", {method: "POST", body: JSON.stringify(body)});
      if (data.verificationRequired) {
        toast(data.message);
        setAuthMode("login");
        return;
      }
      token = data.token;
      localStorage.setItem("mychat_token", token);
    } else {
      const body = {username: ui.authUsername.value.trim().replace(/^@/, ""), password: ui.authPassword.value};
      const data = await api("/api/auth/login", {method: "POST", body: JSON.stringify(body)});
      token = data.token;
      localStorage.setItem("mychat_token", token);
    }
    await startApp();
  } catch (err) {
    ui.authError.textContent = err.message;
  } finally {
    authBusy = false;
    ui.authSubmit.disabled = false;
  }
});

ui.forgotButton.onclick = async () => {
  const email = prompt("Введите email аккаунта:");
  if (!email) return;
  try {
    const data = await api("/api/auth/forgot", {method: "POST", body: JSON.stringify({email})});
    toast(data.message);
  } catch (e) { toast(e.message); }
};

async function startApp() {
  try {
    const me = await api("/api/auth/me");
    profile = me.profile;
    ui.authScreen.classList.add("hidden");
    ui.app.classList.remove("hidden");
    updateMyProfileUI();
    connectSocket();
    await refreshChats();
    await refreshUsers();
    registerPWA();
  } catch (e) {
    token = "";
    localStorage.removeItem("mychat_token");
    ui.authScreen.classList.remove("hidden");
    ui.app.classList.add("hidden");
    ui.authError.textContent = e.message;
  }
}

function updateMyProfileUI() {
  ui.myDisplayName.textContent = profile?.displayName || "";
  ui.myUsername.textContent = profile?.username ? `@${profile.username}` : "";
  ui.myBio.textContent = profile?.bio || "";
  ui.myVerified.classList.toggle("hidden", !isVerifiedUser(profile));
  setAvatar(ui.myProfileButton, profile, "?");
}

function connectSocket() {
  clearTimeout(reconnectTimer);
  if (!token) return;

  // Не оставляем старое соединение, если приложение пытается подключиться повторно.
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    try { socket.close(); } catch {}
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = ws;
  window.myChatSocket = ws;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "auth", token }));
  });

  ws.addEventListener("message", e => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    if (data.type && data.type.startsWith("call_")) {
      window.dispatchEvent(new CustomEvent("mychat:call-signal", {detail: data}));
      return;
    }

    if (data.type === "auth_ok") {
      profile = data.profile;
      updateMyProfileUI();
      if (currentUser) updateChatHeader();
    }

    if (data.type === "users") {
      users = data.users || [];
      if (searchMode === "people" || ui.searchInput.value.trim()) renderPeople();
      if (currentUser) {
        const u = users.find(x => x.id === currentUser.id);
        if (u) {
          currentUser = u;
          updateChatHeader();
        }
      }
    }

    if (data.type === "chat_refresh") refreshChats();
    if (data.type === "message") handleIncomingMessage(data.message);
    if (data.type === "typing") handleRemoteTyping(data);
    if (data.type === "receipts") handleReceipts(data);
    if (data.type === "reaction") handleReaction(data);
    if (data.type === "error") toast(data.error || "Ошибка");
  });

  ws.addEventListener("close", () => {
    // Старый сокет не должен запускать ещё один reconnect поверх нового.
    if (socket !== ws) return;
    window.myChatSocket = null;
    ui.chatHeaderStatus.textContent = "переподключение…";
    reconnectTimer = setTimeout(connectSocket, 1200);
  });

  ws.addEventListener("error", () => {
    if (socket === ws) ui.chatHeaderStatus.textContent = "ошибка соединения";
  });
}

function socketSend(data) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

async function refreshUsers() {
  try {
    const q = ui.searchInput.value.trim();
    const data = await api(`/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    users = data.users || [];
    if (searchMode === "people" || q) renderPeople();
  } catch {}
}

async function refreshChats() {
  try {
    const data = await api("/api/chats");
    chats = data.chats || [];
    const unreadTotal = chats.reduce((sum,c)=>sum + Number(c.unread||0),0);
    localStorage.setItem("mychat_badge", String(unreadTotal));
    if (navigator.setAppBadge) navigator.setAppBadge(unreadTotal).catch(()=>{});
    if (searchMode === "chats" && !ui.searchInput.value.trim()) renderChats();
  } catch {}
}

function openSidebar() { ui.sidebar.classList.add("open"); ui.sidebarOverlay.classList.add("visible"); }
function closeSidebar() { ui.sidebar.classList.remove("open"); ui.sidebarOverlay.classList.remove("visible"); }
ui.openSidebar.onclick = openSidebar;
ui.sidebarOverlay.onclick = closeSidebar;
ui.mobileBack.onclick = () => { closeCurrentChat(); openSidebar(); };

function renderChats() {
  ui.sidebarTitle.textContent = "Последние чаты";
  ui.chatList.innerHTML = "";
  if (!chats.length) { ui.chatList.innerHTML = `<div class="empty-users">Чатов пока нет.<br>Найди пользователя сверху.</div>`; return; }
  for (const chat of chats) {
    const u = chat.user;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item" + (currentUser?.id === u.id ? " active" : "");
    const av = document.createElement("div"); av.className = "list-avatar"; setAvatar(av, u, "?");
    const info = document.createElement("div"); info.className = "list-info";
    const name = document.createElement("div"); name.className = "list-name-line";
    const nm = document.createElement("strong"); nm.textContent = u.displayName;
    name.appendChild(nm); if (u.verified) { const b = document.createElement("span"); b.className = "verified-badge small-badge"; b.textContent = "✓"; name.appendChild(b); }
    const meta = document.createElement("div"); meta.className = "list-meta"; meta.textContent = chat.lastMessage?.text || "Новый чат";
    const right = document.createElement("div"); right.className = "list-right"; if (chat.unread) { const badge = document.createElement("span"); badge.className = "unread-badge"; badge.textContent = chat.unread > 99 ? "99+" : chat.unread; right.appendChild(badge); }
    info.appendChild(name); info.appendChild(meta); item.append(av, info, right);
    item.onclick = () => openChat(u);
    ui.chatList.appendChild(item);
  }
}

function renderPeople() {
  ui.sidebarTitle.textContent = "Пользователи";
  ui.chatList.innerHTML = "";
  const q = ui.searchInput.value.trim().toLowerCase().replace(/^@/, "");
  const list = users.filter(u => u.id !== profile.id && (!q || normalize(u.username).includes(q) || normalize(u.displayName).includes(q)));
  if (!list.length) { ui.chatList.innerHTML = `<div class="empty-users">Пользователь не найден.</div>`; return; }
  for (const u of list) {
    const item = document.createElement("button"); item.type = "button"; item.className = "list-item" + (currentUser?.id === u.id ? " active" : "");
    const av = document.createElement("div"); av.className = "list-avatar"; setAvatar(av, u, "?"); if (u.online) { const dot = document.createElement("span"); dot.className = `status-dot ${u.status || "online"}`; av.appendChild(dot); }
    const info = document.createElement("div"); info.className = "list-info";
    const name = document.createElement("div"); name.className = "list-name-line"; const nm = document.createElement("strong"); nm.textContent = u.displayName; name.appendChild(nm); if (u.verified) { const b = document.createElement("span"); b.className = "verified-badge small-badge"; b.textContent = "✓"; name.appendChild(b); }
    const nick = document.createElement("div"); nick.className = "list-username"; nick.textContent = `@${u.username}`;
    const st = document.createElement("div"); st.className = "list-meta"; st.textContent = u.online ? (u.status === "dnd" ? "Не беспокоить" : u.status === "away" ? "Отошёл" : "В сети") : "Не в сети";
    info.append(name, nick, st); item.append(av, info); item.onclick = () => openChat(u); ui.chatList.appendChild(item);
  }
}

ui.chatsTab.onclick = () => { searchMode = "chats"; ui.chatsTab.classList.add("active"); ui.peopleTab.classList.remove("active"); if (!ui.searchInput.value.trim()) renderChats(); else renderPeople(); };
ui.peopleTab.onclick = () => { searchMode = "people"; ui.peopleTab.classList.add("active"); ui.chatsTab.classList.remove("active"); renderPeople(); };
ui.searchInput.addEventListener("input", async () => { if (ui.searchInput.value.trim()) { searchMode = "people"; ui.peopleTab.classList.add("active"); ui.chatsTab.classList.remove("active"); await refreshUsers(); } else { searchMode = "chats"; ui.peopleTab.classList.remove("active"); ui.chatsTab.classList.add("active"); renderChats(); } });

async function openChat(user) {
  currentUser = user;
  ui.emptyScreen.classList.add("hidden");
  ui.messages.classList.remove("hidden");
  ui.composer.classList.remove("hidden");
  ui.mobileBack.classList.remove("hidden");
  ui.openSidebar.classList.add("hidden");
  updateChatHeader();
  closeSidebar();

  try {
    const data = await api(`/api/chats/${encodeURIComponent(user.id)}/messages`);
    currentConversationId = data.conversationId;
    currentMessages = data.messages || [];
    renderMessages();
    markRead();
  } catch (e) {
    console.error("Load chat error:", e);
    toast(e.message);
    closeCurrentChat();
  }
}

function closeCurrentChat() {
  currentUser = null; currentConversationId = null; currentMessages = []; ui.messages.innerHTML = ""; ui.messages.classList.add("hidden"); ui.composer.classList.add("hidden"); ui.replyBar.classList.add("hidden"); ui.emptyScreen.classList.remove("hidden"); ui.mobileBack.classList.add("hidden"); ui.openSidebar.classList.remove("hidden"); updateChatHeader(); closeMenus();
}

function updateChatHeader() {
  if (!currentUser) {
    ui.chatHeaderName.textContent = "Личные сообщения"; ui.chatHeaderStatus.textContent = "Выберите пользователя"; ui.chatHeaderVerified.classList.add("hidden"); setAvatar(ui.chatHeaderAvatar, null, "?"); return;
  }
  ui.chatHeaderName.textContent = currentUser.displayName;
  ui.chatHeaderVerified.classList.toggle("hidden", !currentUser.verified);
  setAvatar(ui.chatHeaderAvatar, currentUser, "?");
  if (!ui.chatHeaderStatus.classList.contains("typing-status")) updateStatusText();
}

function updateStatusText() {
  if (!currentUser) return;
  if (!currentUser.online) { ui.chatHeaderStatus.textContent = "не в сети"; return; }
  if (currentUser.status === "dnd") ui.chatHeaderStatus.textContent = "Не беспокоить";
  else if (currentUser.status === "away") ui.chatHeaderStatus.textContent = "Отошёл";
  else ui.chatHeaderStatus.textContent = "в сети";
}

function renderMessages() {
  ui.messages.innerHTML = "";
  for (const m of currentMessages) renderMessage(m);
  scrollBottom();
}

function messageStatus(m) {
  if (!m || m.senderId !== profile.id) return "";
  if (m.readAt) return "✓✓";
  if (m.deliveredAt) return "✓✓";
  return "✓";
}

function renderMessage(m) {
  const row = document.createElement("div"); row.className = `message-row ${m.senderId === profile.id ? "outgoing" : "incoming"}`; row.dataset.id = m.id;
  const bubble = document.createElement("div"); bubble.className = `message ${m.senderId === profile.id ? "outgoing" : "incoming"}`;
  if (m.forwarded) { const f = document.createElement("div"); f.className = "forwarded-label"; f.textContent = "Переслано"; bubble.appendChild(f); }
  if (m.replyTo) { const r = document.createElement("div"); r.className = "reply-quote"; r.textContent = `↩ @${m.replyTo.username}: ${m.replyTo.text}`; bubble.appendChild(r); }
  if (m.senderId !== profile.id) { const a = document.createElement("div"); a.className = "message-author"; a.textContent = `@${m.senderUsername}`; if (m.senderVerified) { const b = document.createElement("span"); b.className = "message-author-badge"; b.textContent = "✓"; a.appendChild(b); } bubble.appendChild(a); }
  if (m.attachment) {
    const att = document.createElement("div"); att.className = "attachment";
    const src = `${m.attachment.url}?token=${encodeURIComponent(token)}`;
    if (m.attachment.mime.startsWith("image/")) { const img = document.createElement("img"); img.src = src; img.alt = m.attachment.filename; att.appendChild(img); }
    else if (m.attachment.mime.startsWith("video/")) { const video = document.createElement("video"); video.src = src; video.controls = true; att.appendChild(video); }
    const link = document.createElement("a"); link.href = src; link.target = "_blank"; link.rel = "noopener"; link.textContent = m.attachment.filename; att.appendChild(link); bubble.appendChild(att);
  }
  const text = document.createElement("div"); text.className = "message-text"; text.textContent = m.text || ""; if (m.deleted) text.classList.add("deleted"); bubble.appendChild(text);
  const reactions = document.createElement("div"); reactions.className = "reactions"; for (const r of groupReactions(m.reactions || [])) { const rb = document.createElement("button"); rb.type = "button"; rb.textContent = `${r.emoji} ${r.count}`; rb.onclick = () => react(m.id, r.emoji); reactions.appendChild(rb); } if (reactions.childElementCount) bubble.appendChild(reactions);
  const meta = document.createElement("div"); meta.className = "message-meta"; meta.textContent = `${new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}${m.edited ? " · изменено" : ""}`; const s = messageStatus(m); if (s) { const st = document.createElement("span"); st.className = `message-status ${m.readAt ? "read" : ""}`; st.textContent = s; meta.appendChild(st); } bubble.appendChild(meta);
  row.appendChild(bubble); attachMessageInteractions(row, m); ui.messages.appendChild(row);
}

function rerenderMessage(id) { const old = ui.messages.querySelector(`[data-id="${CSS.escape(id)}"]`); const m = currentMessages.find(x => x.id === id); if (!old || !m) return; const temp = document.createElement("div"); ui.messages.appendChild(temp); temp.remove(); old.remove(); renderMessage(m); }

function groupReactions(list) { const map = new Map(); for (const r of list) map.set(r.emoji, (map.get(r.emoji) || 0) + 1); return [...map.entries()].map(([emoji,count]) => ({emoji,count})); }

function attachMessageInteractions(row, m) {
  row.addEventListener("contextmenu", e => { e.preventDefault(); showMessageMenu(e.clientX, e.clientY, m); });
  row.addEventListener("pointerdown", e => { clearTimeout(pressTimer); pressTimer = setTimeout(() => showMessageMenu(e.clientX, e.clientY, m), 550); });
  row.addEventListener("pointerup", () => clearTimeout(pressTimer));
  row.addEventListener("pointercancel", () => clearTimeout(pressTimer));
  row.addEventListener("touchstart", e => { const t = e.touches[0]; touchStart = {x:t.clientX,y:t.clientY}; }, {passive:true});
  row.addEventListener("touchend", e => { if (!touchStart) return; const t = e.changedTouches[0]; const dx = t.clientX-touchStart.x; const dy=t.clientY-touchStart.y; if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)) { haptic(7); setReply(m); } touchStart=null; });
}

function showMessageMenu(x,y,m) { selectedMessage = m; closeMenus(); ui.contextMenu.classList.remove("hidden"); ui.contextMenu.style.left = `${Math.min(x, innerWidth-230)}px`; ui.contextMenu.style.top = `${Math.min(y, innerHeight-290)}px`; ui.contextMenu.querySelector('[data-action="edit"]').classList.toggle("hidden", m.senderId !== profile.id || m.deleted); ui.contextMenu.querySelector('[data-action="delete"]').classList.toggle("hidden", m.senderId !== profile.id); }

ui.contextMenu.addEventListener("click", async e => {
  const reactEmoji = e.target.closest("[data-react]")?.dataset.react;
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (reactEmoji && selectedMessage) { await react(selectedMessage.id, reactEmoji); closeMenus(); return; }
  if (!selectedMessage || !action) return;
  if (action === "reply") setReply(selectedMessage);
  if (action === "copy") { await navigator.clipboard?.writeText(selectedMessage.text || ""); toast("Скопировано"); }
  if (action === "edit") await editMessage(selectedMessage);
  if (action === "delete") await deleteMessage(selectedMessage);
  if (action === "forward") await forwardMessage(selectedMessage);
  closeMenus();
});

function closeMenus() { ui.contextMenu.classList.add("hidden"); ui.chatMenu.classList.add("hidden"); }
document.addEventListener("click", e => { if (!e.target.closest(".context-menu") && !e.target.closest("#chatMenuButton")) closeMenus(); });

function setReply(m) { replyTo = m; ui.replyText.textContent = `@${m.senderUsername}: ${m.text || "Вложение"}`; ui.replyBar.classList.remove("hidden"); ui.messageInput.focus(); haptic(10); }
ui.cancelReply.onclick = () => { replyTo = null; ui.replyBar.classList.add("hidden"); };

async function editMessage(m) { const text = prompt("Изменить сообщение:", m.text); if (text === null) return; try { const data = await api(`/api/messages/${m.id}`, {method:"PATCH", body:JSON.stringify({text})}); updateLocalMessage(data.message); } catch(e) { toast(e.message); } }
async function deleteMessage(m) { if (!confirm("Удалить сообщение?")) return; try { const data = await api(`/api/messages/${m.id}`, {method:"DELETE"}); updateLocalMessage(data.message); } catch(e) { toast(e.message); } }
async function forwardMessage(m) { const nick = prompt("Username получателя:"); if (!nick) return; try { const data = await api(`/api/users?q=${encodeURIComponent(nick.replace(/^@/,""))}`); const target = data.users?.find(u => normalize(u.username) === normalize(nick.replace(/^@/,""))); if (!target) throw new Error("Пользователь не найден."); const out = await api(`/api/messages/${m.id}/forward`, {method:"POST", body:JSON.stringify({toUserId:target.id})}); toast(`Переслано @${target.username}`); } catch(e) { toast(e.message); } }
async function react(messageId, emoji) { try { const data = await api(`/api/messages/${messageId}/reactions`, {method:"POST", body:JSON.stringify({emoji})}); const m=currentMessages.find(x=>x.id===messageId); if (m) { m.reactions=data.reactions; rerenderMessage(messageId); } haptic(8); } catch(e) { toast(e.message); } }
function updateLocalMessage(m) { const i=currentMessages.findIndex(x=>x.id===m.id); if(i>=0){currentMessages[i]=m; rerenderMessage(m.id);} }

async function markRead() { if (!currentUser) return; socketSend({type:"read", withUserId:currentUser.id}); localStorage.setItem("mychat_badge","0"); if (navigator.clearAppBadge) navigator.clearAppBadge().catch(()=>{}); }
function handleReceipts(data) { for(const id of data.messageIds || []){ const m=currentMessages.find(x=>x.id===id); if(m){ if(data.kind === "delivered" && !m.readAt) m.deliveredAt=new Date().toISOString(); if(data.kind === "read") m.readAt=new Date().toISOString(); rerenderMessage(id);} } }
function handleReaction(data) { const m=currentMessages.find(x=>x.id===data.messageId); if(m){m.reactions=data.reactions || []; rerenderMessage(m.id);} }

function handleIncomingMessage(m) {
  const belongs = currentUser && (
    m.senderId === currentUser.id ||
    (m.senderId === profile.id && m.conversationId === currentConversationId)
  );

  if (belongs) {
    const existingIndex = currentMessages.findIndex(x => x.id === m.id);

    if (existingIndex >= 0) {
      currentMessages[existingIndex] = m;
      rerenderMessage(m.id);
    } else {
      currentMessages.push(m);
      renderMessage(m);
    }

    scrollBottom();
    markRead();
  }

  refreshChats();

  if (
    m.senderId !== profile.id &&
    (!currentUser || m.senderId !== currentUser.id || document.hidden)
  ) {
    notifyIncoming(m);
  }
}

function notifyIncoming(m) {
  const sourceChat = chats.find(c => c.user.id === m.senderId);
  if (sourceChat?.muted) return;
  if (localStorage.getItem("mychat_sound") !== "0") beep();
  const mention = profile?.username && (m.text || "").toLowerCase().includes(`@${profile.username.toLowerCase()}`);
  const body = mention ? `Упоминание: ${m.text || "Вложение"}` : (m.text || "Вложение");
  if ("Notification" in window && Notification.permission === "granted") new Notification(m.senderDisplayName || m.senderUsername, {body, icon:"/icon.svg"});
  const count = Number(localStorage.getItem("mychat_badge") || "0") + 1; localStorage.setItem("mychat_badge", String(count)); if (navigator.setAppBadge) navigator.setAppBadge(count).catch(()=>{});
}

function beep() { try { const C=window.AudioContext||window.webkitAudioContext; if(!C)return; const c=new C(); const o=c.createOscillator(); const g=c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value=660; g.gain.value=.035; o.start(); o.stop(c.currentTime+.08); } catch {} }

function handleRemoteTyping(data) {
  if (!currentUser || data.fromId !== currentUser.id) return;
  clearTimeout(remoteTypingTimer);
  if (data.isTyping) {
    ui.chatHeaderStatus.textContent = "печатает";
    ui.chatHeaderStatus.classList.add("typing-status");
    remoteTypingTimer = setTimeout(() => { ui.chatHeaderStatus.classList.remove("typing-status"); updateStatusText(); }, 1800);
  } else { ui.chatHeaderStatus.classList.remove("typing-status"); updateStatusText(); }
}

ui.messageInput.addEventListener("input", () => {
  if (!currentUser) return;
  if (!typingSent) { socketSend({type:"typing", toUserId:currentUser.id, isTyping:true}); typingSent=true; }
  clearTimeout(typingTimer); typingTimer=setTimeout(stopTyping,1200);
});
function stopTyping(){ clearTimeout(typingTimer); if(typingSent && currentUser) socketSend({type:"typing",toUserId:currentUser.id,isTyping:false}); typingSent=false; }
ui.messageInput.addEventListener("blur", stopTyping);

async function sendCurrentMessage(attachmentId=null) {
  const text = ui.messageInput.value.trim();
  if (!currentUser || (!text && !attachmentId)) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    toast("Нет соединения с сервером.");
    return;
  }

  const clientMessageId = makeClientMessageId();

  socketSend({
    type: "send",
    toUserId: currentUser.id,
    text,
    attachmentId,
    replyToId: replyTo?.id || null,
    clientMessageId
  });

  ui.messageInput.value = "";
  replyTo = null;
  ui.replyBar.classList.add("hidden");
  stopTyping();
  haptic(7);
}

ui.composer.addEventListener("submit", e => {
  e.preventDefault();
  sendCurrentMessage();
});

async function uploadAndSend(file) {
  if (!file || !currentUser) return;
  if (file.size > 15*1024*1024) { toast("Файл больше 15 МБ."); return; }
  ui.uploadProgress.classList.remove("hidden"); ui.uploadProgressBar.style.width="15%";
  try {
    const form = new FormData(); form.append("file",file);
    const xhr = new XMLHttpRequest(); xhr.open("POST","/api/upload"); xhr.setRequestHeader("Authorization",`Bearer ${token}`);
    const done = new Promise((resolve,reject)=>{xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText); if(xhr.status>=200&&xhr.status<300) resolve(d); else reject(new Error(d.error||"Upload error"));}catch{reject(new Error("Upload error"));}}; xhr.onerror=()=>reject(new Error("Upload error"));});
    xhr.upload.onprogress=e=>{if(e.lengthComputable)ui.uploadProgressBar.style.width=`${Math.round(e.loaded/e.total*100)}%`;}; xhr.send(form); const d=await done; await sendCurrentMessage(d.attachment.id);
  } catch(e){toast(e.message);} finally{setTimeout(()=>ui.uploadProgress.classList.add("hidden"),300);ui.uploadProgressBar.style.width="0";}
}
ui.fileInput.addEventListener("change", e=>{const f=e.target.files?.[0]; if(f) uploadAndSend(f); e.target.value="";});
ui.cameraInput.addEventListener("change", e=>{const f=e.target.files?.[0]; if(f) uploadAndSend(f); e.target.value="";});
ui.messages.addEventListener("dragover", e=>{e.preventDefault();});
ui.messages.addEventListener("drop", e=>{e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f) uploadAndSend(f);});

ui.emojiButton.onclick = e => { e.stopPropagation(); ui.emojiPanel.classList.toggle("open"); };
ui.emojiPanel.querySelectorAll("button").forEach(b=>b.onclick=()=>{ui.messageInput.value+=b.textContent;ui.messageInput.focus();ui.emojiPanel.classList.remove("open");});

ui.findButton.onclick = () => { openSidebar(); ui.searchInput.focus(); };
ui.searchMessagesButton.onclick = async () => {
  if (!currentUser) return toast("Открой чат.");
  const q = prompt("Поиск в этом чате:"); if (!q) return;
  try { const d=await api(`/api/chats/${currentUser.id}/messages?search=${encodeURIComponent(q)}`); currentMessages=d.messages||[]; renderMessages(); toast(`Найдено: ${currentMessages.length}`); } catch(e){toast(e.message);} 
};

ui.chatMenuButton.onclick = e => { e.stopPropagation(); if(!currentUser)return; closeMenus(); ui.chatMenu.classList.remove("hidden"); const r=ui.chatMenuButton.getBoundingClientRect(); ui.chatMenu.style.right=`${innerWidth-r.right}px`; ui.chatMenu.style.top=`${r.bottom+6}px`; };

ui.pinChatButton.onclick = async()=>{ if(!currentUser)return; const chat=chats.find(x=>x.user.id===currentUser.id); try{await api(`/api/chats/${currentUser.id}/settings`,{method:"POST",body:JSON.stringify({pinned:!chat?.pinned,muted:chat?.muted||false})});toast(chat?.pinned?"Откреплено":"Закреплено");refreshChats();}catch(e){toast(e.message);} closeMenus(); };
ui.muteChatButton.onclick = async()=>{ if(!currentUser)return; const chat=chats.find(x=>x.user.id===currentUser.id); try{await api(`/api/chats/${currentUser.id}/settings`,{method:"POST",body:JSON.stringify({pinned:chat?.pinned||false,muted:!chat?.muted})});toast(chat?.muted?"Звук включён":"Чат заглушён");refreshChats();}catch(e){toast(e.message);} closeMenus(); };
ui.blockUserButton.onclick=async()=>{ if(!currentUser)return; if(!confirm(`Заблокировать @${currentUser.username}?`))return; try{await api(`/api/users/${currentUser.id}/block`,{method:"POST"});toast("Пользователь заблокирован");closeCurrentChat();refreshChats();refreshUsers();}catch(e){toast(e.message);} closeMenus(); };
ui.reportUserButton.onclick=async()=>{ if(!currentUser)return; const reason=prompt("Причина жалобы:"); if(!reason)return; try{await api(`/api/users/${currentUser.id}/report`,{method:"POST",body:JSON.stringify({reason})});toast("Жалоба отправлена");}catch(e){toast(e.message);} closeMenus(); };

ui.myProfileButton.onclick = ui.settingsButton.onclick = openSettings;
ui.closeSettings.onclick = closeSettings;
ui.settingsBackdrop.addEventListener("click", e=>{if(e.target===ui.settingsBackdrop)closeSettings();});
function openSettings(){ updateSettingsUI(); ui.settingsBackdrop.classList.remove("hidden"); }
function closeSettings(){ ui.settingsBackdrop.classList.add("hidden"); }
function updateSettingsUI(){
  setAvatar(ui.settingsAvatar,profile,"?"); ui.settingsDisplayName.value=profile.displayName||""; ui.settingsUsername.value=profile.username||""; ui.settingsBio.value=profile.bio||""; ui.settingsPresence.value=profile.presenceStatus||"online"; ui.settingsPrivacy.value=profile.privacyOnline||"everyone"; ui.settingsVerifiedText.classList.toggle("hidden",!isVerifiedUser(profile)); ui.settingsJoined.textContent=profile.createdAt ? `В Burmalchat с ${new Date(profile.createdAt).toLocaleDateString()}` : ""; ui.settingsError.textContent=""; ui.settingsClaimCode.value=""; ui.settingsClaimWrap.classList.toggle("hidden", normalize(profile.username) !== "z1ipperj"); document.querySelectorAll("[data-avatar-color]").forEach(b=>b.classList.toggle("active", b.dataset.avatarColor === (profile.avatarColor || "#3390ec")));
}
ui.settingsUsername.addEventListener("input", () => { ui.settingsClaimWrap.classList.toggle("hidden", normalize(ui.settingsUsername.value.replace(/^@/, "")) !== "z1ipperj"); });
ui.saveProfileButton.onclick = async()=>{
  ui.settingsError.textContent=""; const username=ui.settingsUsername.value.trim().replace(/^@/,""); const displayName=ui.settingsDisplayName.value.trim();
  if(!validUsername(username)) return ui.settingsError.textContent="Неверный username."; if(!displayName)return ui.settingsError.textContent="Введите имя.";
  try{const d=await api("/api/profile",{method:"PATCH",body:JSON.stringify({username,displayName,bio:ui.settingsBio.value.trim(),presenceStatus:ui.settingsPresence.value,privacyOnline:ui.settingsPrivacy.value,avatarColor:profile.avatarColor || "#3390ec",claimCode:ui.settingsClaimCode.value})});profile=d.profile;saveLocalAndRefreshProfile();ui.settingsError.textContent="Сохранено.";refreshUsers();refreshChats();}catch(e){ui.settingsError.textContent=e.message;}
};
function saveLocalAndRefreshProfile(){updateMyProfileUI();updateChatHeader();}
ui.avatarInput.onchange = async()=>{const f=ui.avatarInput.files?.[0];if(!f)return;const fd=new FormData();fd.append("avatar",f);try{const d=await api("/api/profile/avatar",{method:"POST",body:fd});profile=d.profile;saveLocalAndRefreshProfile();toast("Аватар обновлён");}catch(e){toast(e.message);}ui.avatarInput.value="";};

document.querySelectorAll("[data-avatar-color]").forEach(b=>b.onclick=()=>{ profile.avatarColor=b.dataset.avatarColor; document.querySelectorAll("[data-avatar-color]").forEach(x=>x.classList.toggle("active",x===b)); });

ui.removeAvatarButton.onclick=async()=>{try{const d=await api("/api/profile/avatar",{method:"DELETE"});profile=d.profile;saveLocalAndRefreshProfile();toast("Аватар удалён");}catch(e){toast(e.message);}};

ui.lightThemeButton.onclick=()=>{localStorage.setItem("mychat_theme","light");applyTheme();};
ui.darkThemeButton.onclick=()=>{localStorage.setItem("mychat_theme","dark");applyTheme();};
ui.glassToggle.onchange=()=>{localStorage.setItem("mychat_glass",ui.glassToggle.checked?"1":"0");applyTheme();};
ui.soundToggle.onchange=()=>localStorage.setItem("mychat_sound",ui.soundToggle.checked?"1":"0");
document.querySelectorAll("[data-wallpaper]").forEach(b=>b.onclick=()=>{localStorage.setItem("mychat_wallpaper",b.dataset.wallpaper);applyTheme();});
document.querySelectorAll("[data-font]").forEach(b=>b.onclick=()=>{localStorage.setItem("mychat_font",b.dataset.font);applyTheme();});

ui.enableNotifications.onclick=async()=>{try{if (!("Notification" in window)) throw new Error("Уведомления не поддерживаются этим браузером."); const p=await Notification.requestPermission();if(p!=="granted")return toast("Уведомления не разрешены.");await subscribePush();toast("Уведомления включены");}catch(e){toast(e.message);}};
async function subscribePush(){if(!('serviceWorker' in navigator))return;const reg=await navigator.serviceWorker.ready;const d=await api("/api/push/public-key");if(!d.publicKey)return toast("Push ещё не настроен на сервере.");let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(d.publicKey)});await api("/api/push/subscribe",{method:"POST",body:JSON.stringify({subscription:sub.toJSON()})});}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}

ui.installButton.onclick=async()=>{if(!pendingInstallPrompt)return toast("На iPhone выбери «Поделиться» → «На экран Домой».");pendingInstallPrompt.prompt();await pendingInstallPrompt.userChoice;pendingInstallPrompt=null;};
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();pendingInstallPrompt=e;});

ui.logoutButton.onclick=()=>{token="";localStorage.removeItem("mychat_token");if(socket)socket.close();profile=null;currentUser=null;closeSettings();ui.app.classList.add("hidden");ui.authScreen.classList.remove("hidden");setAuthMode("login");};

function registerPWA(){ if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); }
navigator.serviceWorker?.addEventListener("message", e=>{if(e.data?.type==="open_user" && e.data.userId){const u=users.find(x=>x.id===e.data.userId);if(u)openChat(u);}});

function scrollBottom(){ requestAnimationFrame(()=>ui.messages.scrollTop=ui.messages.scrollHeight); }

document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeMenus();closeSettings();ui.emojiPanel.classList.remove("open");}});

const query = new URLSearchParams(location.search);
const verifyToken = query.get("verify");
const resetToken = query.get("reset");

async function handleAuthLink() {
  if (verifyToken) {
    try {
      await fetch(`/api/auth/verify?token=${encodeURIComponent(verifyToken)}`);
      history.replaceState({}, "", "/");
      toast("Email подтверждён. Теперь войди в аккаунт.");
    } catch {}
  }
  if (resetToken) {
    mode = "reset";
    ui.authNameWrap.classList.add("hidden");
    ui.authEmailWrap.classList.add("hidden");
    ui.claimWrap.classList.add("hidden");
    ui.authUsername.closest(".form-wrap").classList.add("hidden");
    ui.loginTab.classList.remove("active");
    ui.registerTab.classList.remove("active");
    ui.authSubtitle.textContent = "Придумай новый пароль";
    ui.authSubmit.textContent = "Сменить пароль";
    ui.forgotButton.classList.add("hidden");
    ui.authScreen.classList.remove("hidden");
    ui.authPassword.value = "";
    ui.authPassword.focus();
    ui.authForm.onsubmit = async e => {
      e.preventDefault();
      ui.authError.textContent = "";
      try {
        const d = await api("/api/auth/reset", {method:"POST", body:JSON.stringify({token:resetToken,password:ui.authPassword.value})});
        if (!d.ok) throw new Error("Не удалось сменить пароль.");
        history.replaceState({}, "", "/");
        ui.authUsername.closest(".form-wrap").classList.remove("hidden");
        setAuthMode("login");
        toast("Пароль изменён. Войди с новым паролем.");
      } catch(e) { ui.authError.textContent = e.message; }
    };
    return true;
  }
  return false;
}

(async () => {
  const handled = await handleAuthLink();
  if (handled) return;
  if (!token) setAuthMode("login");
  else startApp();
})();
