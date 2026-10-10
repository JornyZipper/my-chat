(() => {
  'use strict';

  // Shared WebRTC client for the website and Electron desktop client.
  // Uses the existing authenticated /ws signaling protocol on the server.
  const $ = (id) => document.getElementById(id);
  const byIdAll = (id) => [...document.querySelectorAll(`[id="${id}"]`)];
  const toast = (message) => {
    if (window.myChatToast) window.myChatToast(message);
    else console.info('[BurmalpticajopaChat]', message);
  };
  const getCurrentUser = () => window.myChatGetCurrentUser?.() || null;
  const sendSignal = (data) => {
    if (!window.myChatSocketSend) {
      toast('Звонки пока не подключены к WebSocket. Перезайди в аккаунт.');
      return false;
    }
    return window.myChatSocketSend(data) !== false;
  };

  // The original index.html contains duplicate IDs for both call buttons.
  // Remove duplicates before attaching handlers; keeping the first preserves layout.
  for (const id of ['voiceCallButton', 'videoCallButton']) {
    const matches = byIdAll(id);
    matches.slice(1).forEach((node) => node.remove());
  }

  const ui = {
    overlay: $('callOverlay'), incoming: $('incomingCallCard'),
    incomingAvatar: $('incomingCallAvatar'), incomingName: $('incomingCallName'),
    incomingType: $('incomingCallType'), accept: $('acceptCallButton'), reject: $('rejectCallButton'),
    active: $('activeCallCard'), remoteVideo: $('remoteVideo'), remoteAudio: $('remoteAudio'),
    remoteFallback: $('remoteVoiceFallback'), remoteAvatar: $('callRemoteAvatar'),
    remoteName: $('callRemoteName'), timer: $('callTimer'), localVideo: $('localVideo'),
    mute: $('muteCallButton'), camera: $('cameraCallButton'), hangup: $('hangupCallButton'),
    error: $('callError')
  };

  let currentCall = null;
  let incomingCall = null;
  let peer = null;
  let localStream = null;
  let timerHandle = null;
  let callStartedAt = 0;
  let timeoutHandle = null;
  let disconnectHandle = null;
  const earlyIce = new Map();

  function createCallId() {
    return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function isConnected() {
    if (window.myChatSocketIsReady) return window.myChatSocketIsReady();
    const ws = window.myChatSocket;
    return Boolean(ws && ws.readyState === WebSocket.OPEN);
  }
  let turnAvailable = false;
  async function getIceServers() {
    let iceServers = [];
    try {
      if (window.myChatGetRtcConfig) {
        const data = await window.myChatGetRtcConfig();
        if (Array.isArray(data?.iceServers)) iceServers = data.iceServers;
      } else {
        const token = localStorage.getItem('burmal.token') || '';
        const response = await fetch('/api/rtc-config', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.iceServers)) iceServers = data.iceServers;
        }
      }
    } catch (error) { console.warn('RTC config unavailable:', error.message); }
    // Independent STUN provider helps when one STUN hostname is blocked or fails DNS.
    const flattened = iceServers.flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]);
    if (!flattened.some(url => String(url).includes('stun.l.google.com'))) {
      iceServers = [...iceServers, { urls: 'stun:stun.l.google.com:19302' }];
    }
    turnAvailable = iceServers.some(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(url => /^turns?:/i.test(String(url || ''))) && Boolean(server.username && server.credential);
    });
    if (!turnAvailable) console.warn('TURN is NOT configured on /api/rtc-config; calls between mobile networks may fail.');
    return iceServers;
  }
  function networkHelp() {
    return turnAvailable
      ? 'Соединение между сетями не установлено. Проверь TURN-сервер, доступность его портов и интернет у обоих участников.'
      : 'Соединение между сетями не установлено. Администратору нужно настроить TURN в Render (RTC_TURN_URLS, RTC_TURN_USERNAME, RTC_TURN_CREDENTIAL).';
  }
  function startConnectionDeadline(callId) {
    clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      if (!currentCall || currentCall.callId !== callId || peer?.connectionState === 'connected') return;
      if (currentCall.outgoing && !currentCall.answered) {
        toast('Нет ответа от собеседника.');
      } else {
        toast(networkHelp());
      }
      cleanup(true);
    }, 35000);
  }
  function setAvatar(element, user) {
    if (!element) return;
    element.replaceChildren();
    if (user?.avatarUrl) {
      const image = document.createElement('img');
      image.src = user.avatarUrl;
      image.alt = '';
      image.onerror = () => { element.textContent = String(user?.displayName || user?.username || '?').slice(0, 1).toUpperCase(); };
      element.appendChild(image);
    } else {
      element.textContent = String(user?.displayName || user?.username || '?').slice(0, 1).toUpperCase();
    }
  }
  function showOverlay() { ui.overlay?.classList.remove('hidden'); }
  function hideOverlay() { ui.overlay?.classList.add('hidden'); }
  function showError(message) {
    if (ui.error) { ui.error.textContent = message; ui.error.classList.remove('hidden'); }
    toast(message);
  }
  function clearError() { ui.error?.classList.add('hidden'); if (ui.error) ui.error.textContent = ''; }
  function updateTimer(label = '') {
    if (!ui.timer) return;
    if (!callStartedAt) { ui.timer.textContent = label || 'Подключение…'; return; }
    const seconds = Math.floor((Date.now() - callStartedAt) / 1000);
    ui.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function startTimer() {
    stopTimer();
    callStartedAt = Date.now();
    updateTimer();
    timerHandle = setInterval(() => updateTimer(), 1000);
  }
  function stopTimer() { clearInterval(timerHandle); timerHandle = null; callStartedAt = 0; }
  function stopLocalMedia() {
    if (!localStream) return;
    for (const track of localStream.getTracks()) { try { track.stop(); } catch {} }
    localStream = null;
  }
  function closePeer() {
    if (!peer) return;
    try { peer.onicecandidate = null; peer.ontrack = null; peer.onconnectionstatechange = null; peer.close(); } catch {}
    peer = null;
  }
  function clearCallTimers() { clearTimeout(timeoutHandle); timeoutHandle = null; clearTimeout(disconnectHandle); disconnectHandle = null; }
  function cleanup(sendEnd = false) {
    const call = currentCall;
    if (sendEnd && call?.remoteUser && call?.callId) {
      sendSignal({ type: 'call_end', callId: call.callId, toUserId: call.remoteUser.id, reason: 'hangup' });
    }
    clearCallTimers(); stopTimer(); closePeer(); stopLocalMedia();
    if (ui.remoteVideo) { ui.remoteVideo.pause?.(); ui.remoteVideo.srcObject = null; ui.remoteVideo.classList.add('hidden'); }
    if (ui.remoteAudio) { ui.remoteAudio.pause?.(); ui.remoteAudio.srcObject = null; }
    if (ui.localVideo) { ui.localVideo.pause?.(); ui.localVideo.srcObject = null; ui.localVideo.classList.add('hidden'); }
    ui.remoteFallback?.classList.remove('hidden');
    ui.incoming?.classList.add('hidden'); ui.active?.classList.add('hidden'); ui.camera?.classList.add('hidden');
    if (ui.mute) { ui.mute.textContent = '🎙'; ui.mute.setAttribute('aria-pressed', 'false'); }
    if (ui.camera) { ui.camera.textContent = '📷'; ui.camera.setAttribute('aria-pressed', 'false'); }
    ui.error?.classList.add('hidden');
    currentCall = null; incomingCall = null; earlyIce.clear(); hideOverlay();
  }
  function ensureEnableAudioButton() {
    if (!ui.active) return;
    const existing = $('enableCallAudioButton');
    if (existing) { existing.classList.remove('hidden'); return; }
    const button = document.createElement('button');
    button.id = 'enableCallAudioButton';
    button.className = 'call-accept enable-call-audio';
    button.type = 'button';
    button.textContent = 'Включить звук';
    button.addEventListener('click', async () => {
      try {
        if (ui.remoteAudio) { ui.remoteAudio.muted = false; ui.remoteAudio.volume = 1; await ui.remoteAudio.play(); }
        if (ui.remoteVideo) await ui.remoteVideo.play();
        button.classList.add('hidden');
      } catch { showError('Нажми ещё раз и разреши воспроизведение звука в браузере.'); }
    });
    const controls = ui.active.querySelector('.call-controls');
    ui.active.insertBefore(button, controls || null);
  }
  function showIncoming(call) {
    if (currentCall || incomingCall) {
      sendSignal({ type: 'call_busy', callId: call.callId, toUserId: call.fromUserId || call.from?.id });
      return;
    }
    incomingCall = { ...call, from: call.from || { id: call.fromUserId, username: 'Пользователь' } };
    showOverlay(); ui.active?.classList.add('hidden'); ui.incoming?.classList.remove('hidden');
    if (ui.incomingName) ui.incomingName.textContent = incomingCall.from.displayName || `@${incomingCall.from.username || 'Пользователь'}`;
    if (ui.incomingType) ui.incomingType.textContent = call.video ? 'Входящий видеозвонок' : 'Входящий голосовой звонок';
    setAvatar(ui.incomingAvatar, incomingCall.from);
    clearError();
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    if (window.Notification && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(incomingCall.from.displayName || 'Входящий звонок', { body: call.video ? 'Видеозвонок' : 'Голосовой звонок' }); } catch {}
    }
  }
  function isCameraAccessError(error) {
    return ['NotReadableError', 'TrackStartError', 'AbortError', 'NotFoundError', 'OverconstrainedError', 'NotAllowedError', 'SecurityError'].includes(error?.name);
  }
  function cameraErrorMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Нет доступа к камере. Проверь разрешения Windows и приложения.';
    }
    if (error?.name === 'NotFoundError') return 'Камера не найдена. Проверь, подключена ли она.';
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError' || error?.name === 'AbortError') {
      return 'Камера сейчас недоступна. Закрой другие программы с камерой и проверь её в приложении «Камера» Windows.';
    }
    return error?.message || 'Не удалось включить камеру.';
  }
  async function localMedia(video) {
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      throw new Error('Для звонков на телефоне открой сайт по HTTPS.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Браузер не даёт доступ к микрофону. Открой сайт в Safari/Chrome по HTTPS.');
    }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (!video) return navigator.mediaDevices.getUserMedia({ audio, video: false });
    try {
      // Request moderate settings first: 720p/30 can over-stress some Windows webcam drivers.
      return await navigator.mediaDevices.getUserMedia({
        audio,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 }, facingMode: 'user' }
      });
    } catch (error) {
      // Some devices fail with a constraint set, but work with the default camera format.
      if (!['OverconstrainedError', 'NotReadableError', 'TrackStartError', 'AbortError'].includes(error?.name)) throw error;
      try { return await navigator.mediaDevices.getUserMedia({ audio, video: true }); }
      catch (retryError) { throw retryError; }
    }
  }
  async function makePeer(video, remoteUser, token) {
    const pc = new RTCPeerConnection({ iceServers: await getIceServers(), bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    peer = pc;
    const remoteStream = new MediaStream();
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ type: 'call_ice', callId: token, toUserId: remoteUser.id, candidate: event.candidate });
    };
    pc.ontrack = async (event) => {
      if (peer !== pc) return;
      const tracks = event.streams?.[0]?.getTracks?.() || [event.track];
      for (const track of tracks) {
        if (!remoteStream.getTracks().some((other) => other.id === track.id)) remoteStream.addTrack(track);
      }
      if (ui.remoteAudio && remoteStream.getAudioTracks().length) {
        ui.remoteAudio.srcObject = remoteStream;
        ui.remoteAudio.autoplay = true; ui.remoteAudio.playsInline = true;
        ui.remoteAudio.muted = false; ui.remoteAudio.volume = 1;
        try { await ui.remoteAudio.play(); $('enableCallAudioButton')?.classList.add('hidden'); }
        catch { ensureEnableAudioButton(); }
      }
      if (video && ui.remoteVideo && remoteStream.getVideoTracks().length) {
        ui.remoteVideo.srcObject = remoteStream;
        ui.remoteVideo.autoplay = true; ui.remoteVideo.playsInline = true;
        ui.remoteVideo.muted = true; // Only the audio element plays sound: avoids echo/double audio.
        ui.remoteVideo.setAttribute('playsinline', ''); ui.remoteVideo.classList.remove('hidden'); ui.remoteFallback?.classList.add('hidden');
        try { await ui.remoteVideo.play(); } catch { ensureEnableAudioButton(); }
      }
    };
    pc.onicecandidateerror = (event) => { console.warn('ICE candidate error', event.errorCode, event.errorText || ''); };
    pc.oniceconnectionstatechange = () => {
      if (pc !== peer || !currentCall) return;
      if (pc.iceConnectionState === 'checking' && !callStartedAt) updateTimer('Соединяем сети…');
      if (pc.iceConnectionState === 'failed') showError(networkHelp());
    };
    pc.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (pc.connectionState === 'connected') { clearTimeout(disconnectHandle); disconnectHandle = null; clearTimeout(timeoutHandle); timeoutHandle = null; if (!callStartedAt) startTimer(); }
      if (pc.connectionState === 'disconnected') {
        clearTimeout(disconnectHandle);
        disconnectHandle = setTimeout(() => { if (peer === pc && currentCall) { showError('Соединение потеряно.'); cleanup(false); } }, 12000);
      }
      if (pc.connectionState === 'failed') { showError(networkHelp()); setTimeout(() => { if (peer === pc) cleanup(true); }, 3500); }
    };
    return pc;
  }
  async function flushIce(callId) {
    if (!peer?.remoteDescription) return;
    const candidates = earlyIce.get(callId) || [];
    earlyIce.delete(callId);
    for (const candidate of candidates) {
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch (error) { console.debug('Ignoring ICE candidate:', error); }
    }
  }
  function showActive(user, video, label) {
    showOverlay(); ui.incoming?.classList.add('hidden'); ui.active?.classList.remove('hidden');
    $('enableCallAudioButton')?.classList.add('hidden');
    if (ui.remoteName) ui.remoteName.textContent = user?.displayName || `@${user?.username || 'Пользователь'}`;
    setAvatar(ui.remoteAvatar, user);
    ui.camera?.classList.toggle('hidden', !video); ui.remoteVideo?.classList.toggle('hidden', !video); ui.remoteFallback?.classList.remove('hidden');
    if (ui.timer) ui.timer.textContent = label || 'Подключение…';
    clearError();
  }
  async function startCall(video = false) {
    const user = getCurrentUser();
    if (!user?.id) { toast('Сначала открой чат с пользователем.'); return; }
    if (currentCall || incomingCall) { toast('Звонок уже выполняется.'); return; }
    if (!isConnected()) { toast('Нет соединения с сервером. Подожди подключения и повтори.'); return; }
    if (!window.RTCPeerConnection) { toast('WebRTC не поддерживается в этом браузере.'); return; }
    const token = createCallId();
    currentCall = { callId: token, remoteUser: user, video, outgoing: true };
    showActive(user, video, 'Вызов…');
    startConnectionDeadline(token);
    try {
      // getUserMedia is deliberately called directly from the tap/click path for mobile browsers.
      const acquiredStream = await localMedia(video);
      if (currentCall?.callId !== token) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStream = acquiredStream;
      const pc = await makePeer(video, user, token);
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      if (video && ui.localVideo) {
        ui.localVideo.srcObject = localStream; ui.localVideo.muted = true; ui.localVideo.autoplay = true; ui.localVideo.playsInline = true;
        ui.localVideo.setAttribute('playsinline', ''); ui.localVideo.classList.remove('hidden'); ui.localVideo.play().catch(() => {});
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'call_offer', callId: token, toUserId: user.id, video, offer: pc.localDescription });
    } catch (error) {
      console.error('Start call failed:', error);
      if (video && isCameraAccessError(error) && currentCall?.callId === token) {
        const message = cameraErrorMessage(error);
        cleanup(false);
        if (window.confirm(`${message}\n\nПозвонить без камеры (голосом)?`)) {
          await startCall(false);
        } else {
          toast(message);
        }
        return;
      }
      showError(error?.name === 'NotAllowedError' ? 'Разреши доступ к микрофону в настройках Windows или браузера.' : error?.name === 'NotFoundError' ? 'Не найден микрофон.' : error?.message || 'Не удалось начать звонок.');
      setTimeout(() => cleanup(false), 1800);
    }
  }
  async function acceptCall() {
    if (!incomingCall) return;
    const call = incomingCall;
    incomingCall = null;
    currentCall = { callId: call.callId, remoteUser: call.from, video: Boolean(call.video), outgoing: false };
    showActive(call.from, Boolean(call.video), 'Соединяем сети…');
    startConnectionDeadline(call.callId);
    try {
      // User tapped Answer, so the microphone/camera request is tied to a user gesture.
      let noCamera = false;
      try {
        localStream = await localMedia(Boolean(call.video));
      } catch (error) {
        if (!call.video || !isCameraAccessError(error)) throw error;
        const message = cameraErrorMessage(error);
        if (!window.confirm(`${message}\n\nОтветить на видеозвонок без своей камеры?`)) throw error;
        localStream = await localMedia(false);
        noCamera = true;
      }
      if (currentCall?.callId !== call.callId) {
        localStream?.getTracks().forEach((track) => track.stop());
        localStream = null;
        return;
      }
      const pc = await makePeer(Boolean(call.video), call.from, call.callId);
      if (noCamera) {
        ui.camera?.classList.add('hidden');
        toast('Отвечаем без камеры. Видео собеседника по-прежнему доступно.');
      }
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      if (call.video && localStream.getVideoTracks().length && ui.localVideo) {
        ui.localVideo.srcObject = localStream; ui.localVideo.muted = true; ui.localVideo.autoplay = true; ui.localVideo.playsInline = true;
        ui.localVideo.setAttribute('playsinline', ''); ui.localVideo.classList.remove('hidden'); ui.localVideo.play().catch(() => {});
      }
      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      await flushIce(call.callId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'call_answer', callId: call.callId, toUserId: call.from.id || call.fromUserId, answer: pc.localDescription });
      if (navigator.vibrate) navigator.vibrate(25);
    } catch (error) {
      console.error('Accept call failed:', error);
      const reason = error?.name === 'NotAllowedError' ? 'Разреши доступ к микрофону/камере, затем позвони снова.' : error?.message || 'Не удалось ответить на звонок.';
      showError(reason);
      sendSignal({ type: 'call_end', callId: call.callId, toUserId: call.from.id || call.fromUserId, reason: 'media_error' });
      setTimeout(() => cleanup(false), 2000);
    }
  }
  function rejectCall() {
    if (!incomingCall) return;
    const call = incomingCall;
    sendSignal({ type: 'call_reject', callId: call.callId, toUserId: call.from.id || call.fromUserId, reason: 'rejected' });
    cleanup(false);
  }
  async function handleSignal(data) {
    switch (data?.type) {
      case 'call_offer':
        if (currentCall || incomingCall) { sendSignal({ type: 'call_busy', callId: data.callId, toUserId: data.fromUserId || data.from?.id }); return; }
        showIncoming(data); return;
      case 'call_answer':
        if (!currentCall || !peer || data.callId !== currentCall.callId) return;
        try { currentCall.answered = true; updateTimer('Соединяем сети…'); await peer.setRemoteDescription(new RTCSessionDescription(data.answer)); await flushIce(data.callId); }
        catch (error) { showError('Не удалось установить ответ звонка.'); console.error(error); }
        return;
      case 'call_ice': {
        if (!data.callId || !data.candidate) return;
        if (!earlyIce.has(data.callId)) earlyIce.set(data.callId, []);
        if (!peer || !currentCall || data.callId !== currentCall.callId || !peer.remoteDescription) {
          earlyIce.get(data.callId).push(data.candidate); return;
        }
        try { await peer.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (error) { console.debug('ICE candidate pending:', error); earlyIce.get(data.callId).push(data.candidate); }
        return;
      }
      case 'call_unavailable':
        if (currentCall?.callId === data.callId) { toast(data.error || 'Пользователь сейчас не в сети.'); cleanup(false); }
        return;
      case 'call_error':
        if (!data.callId || currentCall?.callId === data.callId || incomingCall?.callId === data.callId) { toast(data.error || 'Ошибка звонка.'); cleanup(false); }
        return;
      case 'call_busy':
        if (currentCall?.callId === data.callId) { toast('Пользователь уже разговаривает.'); cleanup(false); }
        return;
      case 'call_reject':
        if (currentCall?.callId === data.callId) { toast('Звонок отклонён.'); cleanup(false); }
        return;
      case 'call_end':
        if (currentCall?.callId === data.callId || incomingCall?.callId === data.callId) { toast('Звонок завершён.'); cleanup(false); }
        return;
    }
  }
  function toggleMute() {
    const track = localStream?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    if (ui.mute) { ui.mute.textContent = track.enabled ? '🎙' : '🔇'; ui.mute.setAttribute('aria-pressed', String(!track.enabled)); }
  }
  function toggleCamera() {
    const track = localStream?.getVideoTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    if (ui.camera) { ui.camera.textContent = track.enabled ? '📷' : '🚫'; ui.camera.setAttribute('aria-pressed', String(!track.enabled)); }
  }
  function hangup() { cleanup(true); }

  // Buttons use the same IDs as the web client, so only one code path is shared.
  $('voiceCallButton')?.addEventListener('click', (event) => { event.preventDefault(); startCall(false); });
  $('videoCallButton')?.addEventListener('click', (event) => { event.preventDefault(); startCall(true); });
  ui.accept?.addEventListener('click', acceptCall);
  ui.reject?.addEventListener('click', rejectCall);
  ui.mute?.addEventListener('click', toggleMute);
  ui.camera?.addEventListener('click', toggleCamera);
  ui.hangup?.addEventListener('click', hangup);
  window.addEventListener('mychat:call-signal', (event) => { handleSignal(event.detail || {}).catch((error) => { console.error(error); toast('Ошибка обработки сигнала звонка.'); }); });
  window.addEventListener('beforeunload', () => cleanup(true));
  document.addEventListener('visibilitychange', () => {
    // Retrying playback after returning to the page helps mobile Safari/Chrome resume audio.
    if (!document.hidden && currentCall && ui.remoteAudio?.srcObject) ui.remoteAudio.play().catch(() => ensureEnableAudioButton());
  });
})();
