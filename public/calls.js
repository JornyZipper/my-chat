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
let pendingCandidates = new Map();
let callTimerHandle = null;
let callStartedAt = null;
let ringtoneHandle = null;
let disconnectTimer = null;
let callTimeoutHandle = null;

function callSocketSend(data) {
  if (window.myChatSocketSend) {
    window.myChatSocketSend(data);
  }
}

function callToast(message) {
  if (window.myChatToast) {
    window.myChatToast(message);
  }
}

function callHaptic(ms = 12) {
  if (window.myChatHaptic) {
    window.myChatHaptic(ms);
  }
}

function getCurrentUser() {
  return window.myChatGetCurrentUser?.() || null;
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
      headers: token
        ? {Authorization: `Bearer ${token}`}
        : {}
    });

    if (!response.ok) {
      throw new Error("RTC config error");
    }

    const data = await response.json();

    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      return data.iceServers;
    }
  } catch (error) {
    console.warn("RTC config fallback:", error);
  }

  return [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302"
      ]
    }
  ];
}

function setCallAvatar(element, user) {
  if (!element) return;

  element.innerHTML = "";

  if (user?.avatarUrl) {
    const img = document.createElement("img");
    img.src = `${user.avatarUrl}?t=${Date.now()}`;
    img.alt = "";
    element.appendChild(img);
    return;
  }

  element.textContent = String(
    user?.displayName || user?.username || "?"
  )
    .charAt(0)
    .toUpperCase();
}

function showOverlay() {
  callUI.overlay?.classList.remove("hidden");
}

function hideOverlay() {
  callUI.overlay?.classList.add("hidden");
  callUI.incoming?.classList.add("hidden");
  callUI.active?.classList.add("hidden");
}

function resetCallError() {
  callUI.error?.classList.add("hidden");
  if (callUI.error) {
    callUI.error.textContent = "";
  }
}

function showCallError(message) {
  if (!callUI.error) return;
  callUI.error.textContent = message;
  callUI.error.classList.remove("hidden");
}

function startTimer() {
  stopTimer();
  callStartedAt = Date.now();

  if (callUI.timer) {
    callUI.timer.textContent = "00:00";
  }

  callTimerHandle = setInterval(() => {
    const seconds = Math.floor(
      (Date.now() - callStartedAt) / 1000
    );

    const mm = String(
      Math.floor(seconds / 60)
    ).padStart(2, "0");

    const ss = String(
      seconds % 60
    ).padStart(2, "0");

    if (callUI.timer) {
      callUI.timer.textContent = `${mm}:${ss}`;
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(callTimerHandle);
  callTimerHandle = null;
  callStartedAt = null;

  if (callUI.timer) {
    callUI.timer.textContent = "00:00";
  }
}

function startRingtoneAnimation() {
  stopRingtoneAnimation();

  if (!callUI.incomingAvatar) return;

  callUI.incomingAvatar.classList.add("ringing");

  let flip = false;

  ringtoneHandle = setInterval(() => {
    flip = !flip;
    callUI.incomingAvatar.classList.toggle(
      "ring-pulse",
      flip
    );
  }, 600);
}

function stopRingtoneAnimation() {
  clearInterval(ringtoneHandle);
  ringtoneHandle = null;

  callUI.incomingAvatar?.classList.remove(
    "ringing",
    "ring-pulse"
  );
}

function resetMediaUI() {
  if (callUI.remoteVideo) {
    callUI.remoteVideo.srcObject = null;
    callUI.remoteVideo.classList.add("hidden");
  }

  if (callUI.remoteAudio) {
    callUI.remoteAudio.srcObject = null;
  }

  if (callUI.localVideo) {
    callUI.localVideo.srcObject = null;
    callUI.localVideo.classList.add("hidden");
  }

  callUI.remoteFallback?.classList.remove(
    "hidden"
  );
}

function stopLocalMedia() {
  if (!localStream) return;

  for (const track of localStream.getTracks()) {
    try {
      track.stop();
    } catch {}
  }

  localStream = null;
}

function destroyPeer() {
  if (!peer) return;

  try {
    peer.onicecandidate = null;
    peer.onicecandidateerror = null;
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
  } catch {}

  try {
    peer.close();
  } catch {}

  peer = null;
}

function clearCallTimers() {
  clearTimeout(disconnectTimer);
  disconnectTimer = null;

  clearTimeout(callTimeoutHandle);
  callTimeoutHandle = null;
}

function cleanupCallUI() {
  clearCallTimers();
  stopRingtoneAnimation();
  stopTimer();
  destroyPeer();
  stopLocalMedia();
  resetMediaUI();

  incomingCall = null;
  currentCall = null;
  pendingCandidates.clear();

  callUI.incoming?.classList.add("hidden");
  callUI.active?.classList.add("hidden");
  callUI.camera?.classList.add("hidden");

  if (callUI.mute) {
    callUI.mute.textContent = "🎙";
  }

  if (callUI.camera) {
    callUI.camera.textContent = "📷";
  }

  resetCallError();
  hideOverlay();
}

function showIncomingCall(call) {
  incomingCall = {
    ...call,
    pendingCandidates: pendingCandidates.get(
      call.callId
    ) || []
  };

  showOverlay();

  callUI.active?.classList.add("hidden");
  callUI.incoming?.classList.remove("hidden");

  if (callUI.incomingName) {
    callUI.incomingName.textContent =
      call.from?.displayName ||
      `@${call.from?.username || "Пользователь"}`;
  }

  if (callUI.incomingType) {
    callUI.incomingType.textContent = call.video
      ? "Входящий видеозвонок"
      : "Входящий голосовой звонок";
  }

  setCallAvatar(
    callUI.incomingAvatar,
    call.from
  );

  resetCallError();
  startRingtoneAnimation();
  callHaptic(20);

  if (
    window.Notification &&
    Notification.permission === "granted" &&
    document.hidden
  ) {
    try {
      new Notification(
        call.from?.displayName ||
          "Входящий звонок",
        {
          body: call.video
            ? "Входящий видеозвонок"
            : "Входящий голосовой звонок",
          icon: "/icon.svg"
        }
      );
    } catch {}
  }
}

function queueCandidate(callToken, candidate) {
  if (!callToken || !candidate) return;

  if (!pendingCandidates.has(callToken)) {
    pendingCandidates.set(callToken, []);
  }

  pendingCandidates.get(callToken).push(candidate);
}

async function flushCandidates(callToken) {
  if (!peer || !peer.remoteDescription) return;

  const list = pendingCandidates.get(callToken) || [];

  for (const candidate of list) {
    try {
      await peer.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (error) {
      console.warn(
        "ICE candidate error:",
        error
      );
    }
  }

  pendingCandidates.delete(callToken);
}

function waitForIceGatheringComplete(
  pc,
  timeoutMs = 7000
) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pc.removeEventListener(
        "icegatheringstatechange",
        check
      );
      resolve();
    };

    const check = () => {
      if (
        pc.iceGatheringState ===
        "complete"
      ) {
        finish();
      }
    };

    const timer = setTimeout(
      finish,
      timeoutMs
    );

    pc.addEventListener(
      "icegatheringstatechange",
      check
    );
  });
}

async function createPeer(
  video,
  remoteUser,
  callToken
) {
  const iceServers =
    await getRTCConfig();

  const pc =
    new RTCPeerConnection({
      iceServers,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    });

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

  pc.onicecandidateerror = event => {
    console.warn(
      "ICE candidate error:",
      event.errorText || event.url
    );
  };

  pc.ontrack = event => {
    const stream =
      event.streams?.[0] ||
      new MediaStream([event.track]);

    if (callUI.remoteAudio) {
      callUI.remoteAudio.srcObject =
        stream;
      callUI.remoteAudio.autoplay = true;
      callUI.remoteAudio.playsInline = true;

      const playPromise =
        callUI.remoteAudio.play();

      if (playPromise?.catch) {
        playPromise.catch(error => {
          console.warn(
            "Remote audio autoplay blocked:",
            error
          );
        });
      }
    }

    if (video && callUI.remoteVideo) {
      callUI.remoteVideo.srcObject =
        stream;
      callUI.remoteVideo.autoplay = true;
      callUI.remoteVideo.playsInline = true;
      callUI.remoteVideo.classList.remove(
        "hidden"
      );
      callUI.remoteFallback?.classList.add(
        "hidden"
      );

      const playPromise =
        callUI.remoteVideo.play();

      if (playPromise?.catch) {
        playPromise.catch(error => {
          console.warn(
            "Remote video autoplay blocked:",
            error
          );
        });
      }
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;

    console.log(
      "WebRTC connection state:",
      state
    );

    if (state === "connected") {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
      startTimer();
      callUI.active?.classList.add(
        "connected"
      );
      return;
    }

    if (state === "disconnected") {
      /*
      Mobile networks can briefly disconnect.
      Не закрываем звонок мгновенно.
      */
      clearTimeout(disconnectTimer);

      disconnectTimer = setTimeout(() => {
        if (
          peer === pc &&
          currentCall
        ) {
          showCallError(
            "Соединение потеряно."
          );

          cleanupCallUI();
        }
      }, 8000);

      return;
    }

    if (state === "failed") {
      showCallError(
        "Не удалось установить соединение. Попробуйте ещё раз."
      );

      callTimeoutHandle = setTimeout(
        () => cleanupCallUI(),
        1800
      );

      return;
    }

    if (state === "closed") {
      if (currentCall) {
        cleanupCallUI();
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(
      "WebRTC ICE state:",
      pc.iceConnectionState
    );

    if (
      pc.iceConnectionState ===
      "connected" ||
      pc.iceConnectionState ===
      "completed"
    ) {
      clearTimeout(disconnectTimer);
    }

    if (
      pc.iceConnectionState ===
      "failed"
    ) {
      showCallError(
        "ICE-соединение не установлено. Для некоторых сетей нужен TURN."
      );
    }
  };

  return pc;
}

async function getLocalMedia(video) {
  if (
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error(
      "Этот браузер не поддерживает звонки."
    );
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: video
      ? {
          facingMode: "user",
          width: {ideal: 1280},
          height: {ideal: 720},
          frameRate: {ideal: 30, max: 30}
        }
      : false
  });
}

function showActiveCall(
  user,
  video,
  outgoing = false
) {
  showOverlay();

  callUI.incoming?.classList.add(
    "hidden"
  );

  callUI.active?.classList.remove(
    "hidden"
  );

  if (callUI.remoteName) {
    callUI.remoteName.textContent =
      user?.displayName ||
      `@${user?.username || "Пользователь"}`;
  }

  setCallAvatar(
    callUI.remoteAvatar,
    user
  );

  callUI.camera?.classList.toggle(
    "hidden",
    !video
  );

  callUI.remoteVideo?.classList.toggle(
    "hidden",
    !video
  );

  callUI.remoteFallback?.classList.toggle(
    "hidden",
    false
  );

  if (callUI.timer) {
    callUI.timer.textContent = outgoing
      ? "Вызов…"
      : "Подключение…";
  }

  resetCallError();
}

async function startCall(video = false) {
  const user = getCurrentUser();

  if (!user) {
    callToast(
      "Сначала открой чат с пользователем."
    );
    return;
  }

  if (currentCall || incomingCall) {
    callToast(
      "Звонок уже выполняется."
    );
    return;
  }

  if (!window.RTCPeerConnection) {
    callToast(
      "WebRTC не поддерживается этим браузером."
    );
    return;
  }

  const token = callId();

  currentCall = {
    callId: token,
    remoteUser: user,
    video,
    outgoing: true
  };

  showActiveCall(
    user,
    video,
    true
  );

  /*
  Чтобы вызов не висел бесконечно.
  */
  callTimeoutHandle = setTimeout(() => {
    if (
      currentCall?.callId === token
    ) {
      callToast(
        "Пользователь не ответил."
      );

      const target =
        currentCall.remoteUser;

      callSocketSend({
        type: "call_end",
        callId: token,
        toUserId: target.id,
        reason: "timeout"
      });

      cleanupCallUI();
    }
  }, 45000);

  try {
    localStream =
      await getLocalMedia(video);

    peer = await createPeer(
      video,
      user,
      token
    );

    for (
      const track of
      localStream.getTracks()
    ) {
      peer.addTrack(
        track,
        localStream
      );
    }

    if (
      video &&
      callUI.localVideo
    ) {
      callUI.localVideo.srcObject =
        localStream;
      callUI.localVideo.classList.remove(
        "hidden"
      );
      callUI.localVideo.muted = true;
      callUI.localVideo.playsInline = true;
      callUI.localVideo.play().catch(
        () => {}
      );
    }

    const offer =
      await peer.createOffer();

    await peer.setLocalDescription(
      offer
    );

    /*
    Ждём немного завершения ICE-сбора.
    Это дополнительно защищает от ситуации,
    когда кандидат ушёл до нажатия «Ответить».
    */
    await waitForIceGatheringComplete(
      peer,
      7000
    );

    callSocketSend({
      type: "call_offer",
      callId: token,
      toUserId: user.id,
      video,
      offer: peer.localDescription
    });

    callHaptic(12);
  } catch (error) {
    console.error(
      "Start call error:",
      error
    );

    const message =
      error?.name ===
      "NotAllowedError"
        ? "Нет разрешения на микрофон или камеру."
        : error?.message ||
          "Не удалось начать звонок.";

    showCallError(message);

    setTimeout(
      () => cleanupCallUI(),
      1800
    );
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

  showActiveCall(
    user,
    Boolean(call.video),
    false
  );

  try {
    localStream =
      await getLocalMedia(
        Boolean(call.video)
      );

    peer = await createPeer(
      Boolean(call.video),
      user,
      call.callId
    );

    for (
      const track of
      localStream.getTracks()
    ) {
      peer.addTrack(
        track,
        localStream
      );
    }

    if (
      call.video &&
      callUI.localVideo
    ) {
      callUI.localVideo.srcObject =
        localStream;
      callUI.localVideo.classList.remove(
        "hidden"
      );
      callUI.localVideo.muted = true;
      callUI.localVideo.playsInline = true;
      callUI.localVideo.play().catch(
        () => {}
      );
    }

    await peer.setRemoteDescription(
      new RTCSessionDescription(
        call.offer
      )
    );

    /*
    ICE-кандидаты, пришедшие во время ringing,
    теперь не теряются.
    */
    await flushCandidates(
      call.callId
    );

    const answer =
      await peer.createAnswer();

    await peer.setLocalDescription(
      answer
    );

    await waitForIceGatheringComplete(
      peer,
      7000
    );

    callSocketSend({
      type: "call_answer",
      callId: call.callId,
      toUserId: call.from.id,
      answer: peer.localDescription
    });

    callHaptic(18);
  } catch (error) {
    console.error(
      "Accept call error:",
      error
    );

    const message =
      error?.name ===
      "NotAllowedError"
        ? "Разрешите доступ к микрофону или камере."
        : error?.message ||
          "Не удалось ответить на звонок.";

    showCallError(message);

    callSocketSend({
      type: "call_end",
      callId: call.callId,
      toUserId: call.from.id,
      reason: "media_error"
    });

    setTimeout(
      () => cleanupCallUI(),
      1800
    );
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

  pendingCandidates.delete(
    call.callId
  );

  cleanupCallUI();
  callHaptic(10);
}

async function handleCallIce(data) {
  const callToken = data.callId;

  if (!callToken || !data.candidate) {
    return;
  }

  /*
  Если звонок ещё не принят,
  сохраняем кандидата.
  */
  if (
    !currentCall ||
    callToken !==
      currentCall.callId
  ) {
    if (
      incomingCall &&
      callToken ===
        incomingCall.callId
    ) {
      queueCandidate(
        callToken,
        data.candidate
      );
    }

    return;
  }

  if (!peer) {
    queueCandidate(
      callToken,
      data.candidate
    );
    return;
  }

  if (!peer.remoteDescription) {
    queueCandidate(
      callToken,
      data.candidate
    );
    return;
  }

  try {
    await peer.addIceCandidate(
      new RTCIceCandidate(
        data.candidate
      )
    );
  } catch (error) {
    console.warn(
      "ICE add error:",
      error
    );
  }
}

function handleCallOffer(data) {
  if (
    currentCall ||
    incomingCall
  ) {
    callSocketSend({
      type: "call_busy",
      callId: data.callId,
      toUserId: data.fromUserId
    });
    return;
  }

  if (
    !pendingCandidates.has(
      data.callId
    )
  ) {
    pendingCandidates.set(
      data.callId,
      []
    );
  }

  showIncomingCall(data);
}

async function handleCallAnswer(data) {
  if (
    !currentCall ||
    !peer ||
    data.callId !==
      currentCall.callId
  ) {
    return;
  }

  try {
    await peer.setRemoteDescription(
      new RTCSessionDescription(
        data.answer
      )
    );

    await flushCandidates(
      data.callId
    );
  } catch (error) {
    console.error(
      "Answer error:",
      error
    );

    showCallError(
      "Не удалось установить ответ звонка."
    );
  }
}

function handleCallReject(data) {
  if (
    !currentCall ||
    data.callId !==
      currentCall.callId
  ) {
    return;
  }

  callToast(
    "Звонок отклонён"
  );

  cleanupCallUI();
}

function handleCallBusy(data) {
  if (
    !currentCall ||
    data.callId !==
      currentCall.callId
  ) {
    return;
  }

  callToast(
    "Пользователь уже разговаривает."
  );

  cleanupCallUI();
}

function handleCallUnavailable(data) {
  if (
    !currentCall ||
    data.callId !==
      currentCall.callId
  ) {
    return;
  }

  callToast(
    data.error ||
      "Пользователь недоступен."
  );

  cleanupCallUI();
}

function handleCallEnd(data) {
  if (
    currentCall &&
    data.callId ===
      currentCall.callId
  ) {
    callToast(
      "Звонок завершён"
    );

    cleanupCallUI();
  }

  if (
    incomingCall &&
    data.callId ===
      incomingCall.callId
  ) {
    cleanupCallUI();
  }
}

function toggleMute() {
  if (!localStream) return;

  const audio =
    localStream.getAudioTracks()[0];

  if (!audio) return;

  audio.enabled =
    !audio.enabled;

  if (callUI.mute) {
    callUI.mute.textContent =
      audio.enabled
        ? "🎙"
        : "🔇";
  }

  callHaptic(8);
}

function toggleCamera() {
  if (!localStream) return;

  const video =
    localStream.getVideoTracks()[0];

  if (!video) return;

  video.enabled =
    !video.enabled;

  if (callUI.camera) {
    callUI.camera.textContent =
      video.enabled
        ? "📷"
        : "🚫";
  }

  callHaptic(8);
}

function hangup() {
  const target =
    currentCall?.remoteUser;

  const token =
    currentCall?.callId;

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

voiceButton?.addEventListener(
  "click",
  () => startCall(false)
);

videoButton?.addEventListener(
  "click",
  () => startCall(true)
);

callUI.accept?.addEventListener(
  "click",
  acceptIncomingCall
);

callUI.reject?.addEventListener(
  "click",
  rejectIncomingCall
);

callUI.mute?.addEventListener(
  "click",
  toggleMute
);

callUI.camera?.addEventListener(
  "click",
  toggleCamera
);

callUI.hangup?.addEventListener(
  "click",
  hangup
);

window.addEventListener(
  "mychat:call-signal",
  async event => {
    const data =
      event.detail || {};

    switch (data.type) {
      case "call_offer":
        return handleCallOffer(data);

      case "call_answer":
        return handleCallAnswer(data);

      case "call_ice":
        return handleCallIce(data);

      case "call_reject":
        return handleCallReject(data);

      case "call_busy":
        return handleCallBusy(data);

      case "call_unavailable":
        return handleCallUnavailable(data);

      case "call_end":
        return handleCallEnd(data);

      case "call_error":
        return callToast(
          data.error ||
            "Ошибка звонка."
        );

      default:
        return;
    }
  }
);

window.addEventListener(
  "beforeunload",
  () => {
    if (
      currentCall?.remoteUser &&
      currentCall?.callId
    ) {
      callSocketSend({
        type: "call_end",
        callId: currentCall.callId,
        toUserId:
          currentCall.remoteUser.id,
        reason: "page_closed"
      });
    }

    cleanupCallUI();
  }
);
