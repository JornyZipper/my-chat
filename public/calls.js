const callUI = {
  overlay: document.getElementById("callOverlay"),
  incoming: document.getElementById("incomingCallCard"),
  incomingAvatar: document.getElementById("incomingCallAvatar"),
  incomingName: document.getElementById("incomingCallName"),
  incomingType: document.getElementById("incomingCallType"),
  accept: document.getElementById("acceptCallButton"),
  reject: document.getElementById("rejectCallButton"),
  active: document.getElementById("activeCallCard"),
  remoteVideo: document.getElementById("remoteVideo"),
  remoteAudio: document.getElementById("remoteAudio"),
  remoteFallback: document.getElementById("remoteVoiceFallback"),
  remoteAvatar: document.getElementById("callRemoteAvatar"),
  remoteName: document.getElementById("callRemoteName"),
  timer: document.getElementById("callTimer"),
  localVideo: document.getElementById("localVideo"),
  mute: document.getElementById("muteCallButton"),
  camera: document.getElementById("cameraCallButton"),
  hangup: document.getElementById("hangupCallButton"),
  error: document.getElementById("callError")
};

const voiceButton = document.getElementById("voiceCallButton");
const videoButton = document.getElementById("videoCallButton");

if (/Android/i.test(navigator.userAgent)) {
  document.body.classList.add("android");
}

let currentCall = null;
let incomingCall = null;
let peer = null;
let localStream = null;
let remoteCandidates = [];
let pendingCandidates = [];
let callTimerHandle = null;
let callStartedAt = null;
let ringtoneHandle = null;

function callSocketSend(data) {
  if (window.myChatSocketSend) window.myChatSocketSend(data);
}

function callToast(message) {
  if (window.myChatToast) window.myChatToast(message);
}

function callHaptic(ms = 12) {
  if (window.myChatHaptic) window.myChatHaptic(ms);
}

function getCurrentUser() {
  return window.myChatGetCurrentUser?.() || null;
}

function getProfile() {
  return window.myChatGetProfile?.() || null;
}

function callId() {
  return window.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getRTCConfig() {
  const token = localStorage.getItem("mychat_token") || "";
  try {
    const response = await fetch("/api/rtc-config", {
      headers: token ? {Authorization: `Bearer ${token}`} : {}
    });
    if (!response.ok) throw new Error("RTC config error");
    const data = await response.json();
    return data.iceServers || [];
  } catch {
    return [
      {urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}
    ];
  }
}

function setCallAvatar(element, user) {
  element.innerHTML = "";
  if (user?.avatarUrl) {
    const img = document.createElement("img");
    img.src = `${user.avatarUrl}?t=${Date.now()}`;
    img.alt = "";
    element.appendChild(img);
  } else {
    element.textContent = String(user?.displayName || user?.username || "?").charAt(0).toUpperCase();
  }
}

function showOverlay() {
  callUI.overlay.classList.remove("hidden");
}

function hideOverlay() {
  callUI.overlay.classList.add("hidden");
  callUI.incoming.classList.add("hidden");
  callUI.active.classList.add("hidden");
}

function resetCallError() {
  callUI.error.textContent = "";
  callUI.error.classList.add("hidden");
}

function showCallError(message) {
  callUI.error.textContent = message;
  callUI.error.classList.remove("hidden");
}

function startTimer() {
  stopTimer();
  callStartedAt = Date.now();
  callUI.timer.textContent = "00:00";
  callTimerHandle = setInterval(() => {
    const seconds = Math.floor((Date.now() - callStartedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    callUI.timer.textContent = `${mm}:${ss}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(callTimerHandle);
  callTimerHandle = null;
  callStartedAt = null;
  callUI.timer.textContent = "00:00";
}

function startRingtoneAnimation() {
  stopRingtoneAnimation();
  callUI.incomingAvatar.classList.add("ringing");
  let flip = false;
  ringtoneHandle = setInterval(() => {
    flip = !flip;
    callUI.incomingAvatar.classList.toggle("ring-pulse", flip);
  }, 600);
}

function stopRingtoneAnimation() {
  clearInterval(ringtoneHandle);
  ringtoneHandle = null;
  callUI.incomingAvatar.classList.remove("ringing", "ring-pulse");
}

function resetMediaUI() {
  callUI.remoteVideo.srcObject = null;
  callUI.remoteAudio.srcObject = null;
  callUI.localVideo.srcObject = null;
  callUI.remoteVideo.classList.add("hidden");
  callUI.localVideo.classList.add("hidden");
  callUI.remoteFallback.classList.remove("hidden");
}

function stopLocalMedia() {
  if (!localStream) return;
  for (const track of localStream.getTracks()) {
    try { track.stop(); } catch {}
  }
  localStream = null;
}

function destroyPeer() {
  if (!peer) return;
  try { peer.onicecandidate = null; } catch {}
  try { peer.ontrack = null; } catch {}
  try { peer.close(); } catch {}
  peer = null;
}

function cleanupCallUI() {
  stopRingtoneAnimation();
  stopTimer();
  destroyPeer();
  stopLocalMedia();
  resetMediaUI();
  incomingCall = null;
  currentCall = null;
  pendingCandidates = [];
  remoteCandidates = [];
  callUI.incoming.classList.add("hidden");
  callUI.active.classList.add("hidden");
  callUI.camera.classList.add("hidden");
  callUI.mute.textContent = "🎙";
  callUI.camera.textContent = "📷";
  resetCallError();
  hideOverlay();
}

function showIncomingCall(call) {
  incomingCall = call;
  showOverlay();
  callUI.active.classList.add("hidden");
  callUI.incoming.classList.remove("hidden");
  callUI.incomingName.textContent = call.from?.displayName || `@${call.from?.username || "Пользователь"}`;
  callUI.incomingType.textContent = call.video ? "Входящий видеозвонок" : "Входящий голосовой звонок";
  setCallAvatar(callUI.incomingAvatar, call.from);
  resetCallError();
  startRingtoneAnimation();
  callHaptic(20);
  if (window.Notification && Notification.permission === "granted" && document.hidden) {
    try {
      new Notification(
        call.from?.displayName || "Входящий звонок",
        {body: call.video ? "Входящий видеозвонок" : "Входящий голосовой звонок", icon: "/icon.svg"}
      );
    } catch {}
  }
}

async function createPeer(video, remoteUser, callToken) {
  const iceServers = await getRTCConfig();
  const pc = new RTCPeerConnection({iceServers});
  peer = pc;

  pc.onicecandidate = event => {
    if (!event.candidate) return;
    callSocketSend({
      type: "call_ice",
      callId: callToken,
      toUserId: remoteUser.id,
      candidate: event.candidate
    });
  };

  pc.ontrack = event => {
    const stream = event.streams?.[0];
    if (!stream) return;
    callUI.remoteAudio.srcObject = stream;
    callUI.remoteAudio.play().catch(() => {});
    if (video) {
      callUI.remoteVideo.srcObject = stream;
      callUI.remoteVideo.muted = true;
      callUI.remoteVideo.classList.remove("hidden");
      callUI.remoteFallback.classList.add("hidden");
      callUI.remoteVideo.play().catch(() => {});
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      startTimer();
      callUI.active.classList.add("connected");
    }
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      if (currentCall) {
        callToast("Звонок завершён");
        cleanupCallUI();
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") {
      showCallError("Не удалось установить соединение. Для некоторых сетей нужен TURN-сервер.");
    }
  };

  return pc;
}

async function getLocalMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Этот браузер не поддерживает звонки.");
  }

  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video ? {
      facingMode: "user",
      width: {ideal: 1280},
      height: {ideal: 720}
    } : false
  });
}

function showActiveCall(user, video, outgoing = false) {
  showOverlay();
  callUI.incoming.classList.add("hidden");
  callUI.active.classList.remove("hidden");
  callUI.remoteName.textContent = user?.displayName || `@${user?.username || "Пользователь"}`;
  setCallAvatar(callUI.remoteAvatar, user);
  callUI.camera.classList.toggle("hidden", !video);
  callUI.remoteVideo.classList.toggle("hidden", !video);
  callUI.remoteFallback.classList.toggle("hidden", false);
  callUI.timer.textContent = outgoing ? "Вызов…" : "Подключение…";
  resetCallError();
}

async function startCall(video = false) {
  const user = getCurrentUser();
  if (!user) {
    callToast("Сначала открой чат с пользователем.");
    return;
  }
  if (currentCall || incomingCall) {
    callToast("Звонок уже выполняется.");
    return;
  }
  if (!window.RTCPeerConnection) {
    callToast("WebRTC не поддерживается этим браузером.");
    return;
  }

  const token = callId();
  currentCall = {
    callId: token,
    remoteUser: user,
    video,
    outgoing: true
  };

  showActiveCall(user, video, true);

  try {
    localStream = await getLocalMedia(video);
    for (const track of localStream.getTracks()) {
      // tracks added below after creating peer
    }

    peer = await createPeer(video, user, token);
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    if (video) {
      callUI.localVideo.srcObject = localStream;
      callUI.localVideo.classList.remove("hidden");
      callUI.localVideo.muted = true;
      callUI.localVideo.play().catch(() => {});
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    callSocketSend({
      type: "call_offer",
      callId: token,
      toUserId: user.id,
      video,
      offer: peer.localDescription
    });

    callHaptic(12);
  } catch (error) {
    console.error(error);
    showCallError(error.message || "Не удалось начать звонок.");
    setTimeout(() => cleanupCallUI(), 1600);
  }
}

async function acceptIncomingCall() {
  if (!incomingCall) return;
  const call = incomingCall;
  incomingCall = null;
  stopRingtoneAnimation();

  const user = call.from;
  currentCall = {
    callId: call.callId,
    remoteUser: user,
    video: Boolean(call.video),
    outgoing: false
  };

  showActiveCall(user, Boolean(call.video), false);

  try {
    localStream = await getLocalMedia(Boolean(call.video));
    peer = await createPeer(Boolean(call.video), user, call.callId);
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    if (call.video) {
      callUI.localVideo.srcObject = localStream;
      callUI.localVideo.classList.remove("hidden");
      callUI.localVideo.muted = true;
      callUI.localVideo.play().catch(() => {});
    }

    await peer.setRemoteDescription(new RTCSessionDescription(call.offer));
    await flushCandidates();

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    callSocketSend({
      type: "call_answer",
      callId: call.callId,
      toUserId: call.from.id,
      answer: peer.localDescription
    });

    callHaptic(18);
  } catch (error) {
    console.error(error);
    showCallError(error.message || "Не удалось ответить на звонок.");
    callSocketSend({
      type: "call_end",
      callId: call.callId,
      toUserId: call.from.id,
      reason: "media_error"
    });
    setTimeout(() => cleanupCallUI(), 1600);
  }
}

function rejectIncomingCall() {
  if (!incomingCall) return;
  const call = incomingCall;
  callSocketSend({
    type: "call_reject",
    callId: call.callId,
    toUserId: call.from.id,
    reason: "rejected"
  });
  cleanupCallUI();
  callHaptic(10);
}

async function flushCandidates() {
  if (!peer || !peer.remoteDescription) return;
  for (const candidate of pendingCandidates) {
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn("ICE candidate error", error);
    }
  }
  pendingCandidates = [];
}

async function handleCallIce(data) {
  if (!currentCall || data.callId !== currentCall.callId) return;
  if (!peer) return;
  if (!peer.remoteDescription) {
    pendingCandidates.push(data.candidate);
    return;
  }
  try {
    await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (error) {
    console.warn("ICE add error", error);
  }
}

async function handleCallOffer(data) {
  if (currentCall || incomingCall) {
    callSocketSend({
      type: "call_busy",
      callId: data.callId,
      toUserId: data.fromUserId
    });
    return;
  }

  showIncomingCall(data);
}

async function handleCallAnswer(data) {
  if (!currentCall || !peer || data.callId !== currentCall.callId) return;
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    await flushCandidates();
  } catch (error) {
    showCallError("Не удалось установить ответ звонка.");
    console.error(error);
  }
}

function handleCallReject(data) {
  if (!currentCall || data.callId !== currentCall.callId) return;
  callToast("Звонок отклонён");
  cleanupCallUI();
}

function handleCallBusy(data) {
  if (!currentCall || data.callId !== currentCall.callId) return;
  callToast("Пользователь уже разговаривает.");
  cleanupCallUI();
}

function handleCallUnavailable(data) {
  if (!currentCall || data.callId !== currentCall.callId) return;
  callToast(data.error || "Пользователь недоступен.");
  cleanupCallUI();
}

function handleCallEnd(data) {
  if (currentCall && data.callId === currentCall.callId) {
    callToast("Звонок завершён");
    cleanupCallUI();
  }
  if (incomingCall && data.callId === incomingCall.callId) {
    cleanupCallUI();
  }
}

function toggleMute() {
  if (!localStream) return;
  const audio = localStream.getAudioTracks()[0];
  if (!audio) return;
  audio.enabled = !audio.enabled;
  callUI.mute.textContent = audio.enabled ? "🎙" : "🔇";
  callHaptic(8);
}

function toggleCamera() {
  if (!localStream) return;
  const video = localStream.getVideoTracks()[0];
  if (!video) return;
  video.enabled = !video.enabled;
  callUI.camera.textContent = video.enabled ? "📷" : "🚫";
  callHaptic(8);
}

function hangup() {
  const target = currentCall?.remoteUser;
  const token = currentCall?.callId;
  if (target && token) {
    callSocketSend({
      type: "call_end",
      callId: token,
      toUserId: target.id,
      reason: "hangup"
    });
  }
  cleanupCallUI();
  callHaptic(12);
}

voiceButton?.addEventListener("click", () => startCall(false));
videoButton?.addEventListener("click", () => startCall(true));
callUI.accept?.addEventListener("click", acceptIncomingCall);
callUI.reject?.addEventListener("click", rejectIncomingCall);
callUI.mute?.addEventListener("click", toggleMute);
callUI.camera?.addEventListener("click", toggleCamera);
callUI.hangup?.addEventListener("click", hangup);

window.addEventListener("mychat:call-signal", async event => {
  const data = event.detail || {};
  switch (data.type) {
    case "call_offer": return handleCallOffer(data);
    case "call_answer": return handleCallAnswer(data);
    case "call_ice": return handleCallIce(data);
    case "call_reject": return handleCallReject(data);
    case "call_busy": return handleCallBusy(data);
    case "call_unavailable": return handleCallUnavailable(data);
    case "call_end": return handleCallEnd(data);
    case "call_error": return callToast(data.error || "Ошибка звонка.");
    default: return;
  }
});

window.addEventListener("beforeunload", () => {
  if (currentCall?.remoteUser && currentCall?.callId) {
    callSocketSend({
      type: "call_end",
      callId: currentCall.callId,
      toUserId: currentCall.remoteUser.id,
      reason: "page_closed"
    });
  }
  cleanupCallUI();
});
