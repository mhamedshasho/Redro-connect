const byId = (id) => document.getElementById(id);
const IDENTITY_DB = "redro-connect-local";
const IDENTITY_STORE = "identity";
const MESSAGE_STORE = "messages";
const IDENTITY_KEY = "primary";
const SIGNAL_PROTOCOL = "redro-connect";
const SIGNAL_VERSION = 1;
const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

let currentIdentity = null;
let toastTimer = null;
let peerConnection = null;
let dataChannel = null;
let peerIdentity = null;
let activeConversationId = null;
let messageHistory = [];

function setCapability(name, available, detail) {
  const status = byId(name + "Status");
  const indicator = byId(name + "Indicator");
  if (status) status.textContent = detail;
  if (indicator) {
    indicator.classList.toggle("good", Boolean(available));
    indicator.classList.toggle("bad", !available);
  }
}

async function checkCapabilities() {
  const secure = window.isSecureContext && Boolean(window.crypto?.subtle);
  setCapability("secure", secure, secure ? "Secure context ready" : "HTTPS required");

  if (!navigator.mediaDevices?.enumerateDevices) {
    setCapability("camera", false, "Not supported by this browser");
    setCapability("microphone", false, "Not supported by this browser");
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some((device) => device.kind === "videoinput");
    const hasMicrophone = devices.some((device) => device.kind === "audioinput");
    setCapability("camera", hasCamera, hasCamera ? "Camera detected" : "No camera detected");
    setCapability("microphone", hasMicrophone, hasMicrophone ? "Microphone detected" : "No microphone detected");
  } catch {
    setCapability("camera", false, "Device check unavailable");
    setCapability("microphone", false, "Device check unavailable");
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support local storage."));
      return;
    }
    const request = indexedDB.open(IDENTITY_DB, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        database.createObjectStore(IDENTITY_STORE);
      }
      if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
        const store = database.createObjectStore(MESSAGE_STORE, { keyPath: "key" });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local storage."));
  });
}

async function readIdentity() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IDENTITY_STORE, "readonly");
    const request = transaction.objectStore(IDENTITY_STORE).get(IDENTITY_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read your identity."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

async function saveIdentity(identity) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IDENTITY_STORE, "readwrite");
    transaction.objectStore(IDENTITY_STORE).put(identity, IDENTITY_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      const error = transaction.error || new Error("Could not save your identity.");
      database.close();
      reject(error);
    };
    transaction.onabort = () => {
      const error = transaction.error || new Error("Saving your identity was cancelled.");
      database.close();
      reject(error);
    };
  });
}

async function saveMessage(message) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MESSAGE_STORE, "readwrite");
    transaction.objectStore(MESSAGE_STORE).put(message);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      const error = transaction.error || new Error("Could not save this message locally.");
      database.close();
      reject(error);
    };
  });
}

async function loadMessages(conversationId) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MESSAGE_STORE, "readonly");
    const request = transaction.objectStore(MESSAGE_STORE).index("conversationId").getAll(conversationId);
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.timestamp - b.timestamp));
    request.onerror = () => reject(request.error || new Error("Could not load local messages."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

function toBase64(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function toBase32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of new Uint8Array(bytes)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

async function createIdentity(displayName) {
  if (!window.isSecureContext || !crypto?.subtle) {
    throw new Error("Identity creation requires HTTPS and Web Crypto support.");
  }
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const fingerprint = await crypto.subtle.digest("SHA-256", publicKey);
  const id = "REDRO-" + toBase32(fingerprint).slice(0, 20);
  const identity = {
    id,
    displayName,
    publicKey: toBase64(publicKey),
    privateKey: keyPair.privateKey,
    createdAt: new Date().toISOString(),
    version: 1
  };
  await saveIdentity(identity);
  return identity;
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function renderIdentity(identity) {
  currentIdentity = identity;
  const initial = identity.displayName.trim().charAt(0).toUpperCase() || "R";
  byId("identityAvatar").textContent = initial;
  byId("identityName").textContent = identity.displayName;
  byId("identityId").textContent = identity.id;
  byId("profileButton").textContent = initial;
  byId("identityCard").hidden = false;
}

function openIdentityDialog() {
  byId("identityError").hidden = true;
  byId("identityError").textContent = "";
  byId("displayNameInput").value = currentIdentity?.displayName || "";
  byId("identityDialogTitle").textContent = currentIdentity ? "Edit your profile" : "Create your Redro ID";
  byId("identitySaveButton").textContent = currentIdentity ? "Save profile" : "Create my identity";
  byId("identityDialog").showModal();
  byId("displayNameInput").focus();
}

async function handleIdentitySubmit(event) {
  event.preventDefault();
  const input = byId("displayNameInput");
  const displayName = input.value.trim();
  const error = byId("identityError");
  const button = byId("identitySaveButton");
  if (displayName.length < 2) {
    error.textContent = "Please enter at least 2 characters.";
    error.hidden = false;
    input.focus();
    return;
  }
  button.disabled = true;
  button.textContent = currentIdentity ? "Saving…" : "Generating secure identity…";
  error.hidden = true;
  try {
    if (currentIdentity) {
      const updated = { ...currentIdentity, displayName };
      await saveIdentity(updated);
      renderIdentity(updated);
      showToast("Profile updated on this device.");
    } else {
      const created = await createIdentity(displayName);
      renderIdentity(created);
      showToast("Your Redro ID has been created.");
    }
    byId("identityDialog").close();
  } catch (failure) {
    error.textContent = failure?.message || "Something went wrong. Please try again.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = currentIdentity ? "Save profile" : "Create my identity";
  }
}

function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    showToast("Clipboard access is unavailable. Select and copy the text.");
  }
}

async function copyIdentity() {
  if (currentIdentity) await copyText(currentIdentity.id, "Redro ID copied.");
}

async function shareIdentity() {
  if (!currentIdentity) return;
  const contactCard = {
    version: 1,
    id: currentIdentity.id,
    displayName: currentIdentity.displayName,
    publicKey: currentIdentity.publicKey
  };
  const text = "Add me on Redro Connect.\nID: " + currentIdentity.id + "\nContact card: REDRO1:" + toBase64Url(JSON.stringify(contactCard));
  if (navigator.share) {
    try {
      await navigator.share({ title: "My Redro Connect contact", text });
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Sharing is unavailable on this device.");
    }
  } else {
    await copyText(text, "Contact card copied.");
  }
}

function parseSignal(value, expectedKind) {
  let packet;
  try {
    packet = JSON.parse(fromBase64Url(value.trim()));
  } catch {
    throw new Error("This code is not valid. Copy the complete code and try again.");
  }
  if (packet?.protocol !== SIGNAL_PROTOCOL || packet?.version !== SIGNAL_VERSION || packet?.kind !== expectedKind || !packet?.sdp?.type || !packet?.sdp?.sdp) {
    throw new Error("This is not a valid Redro Connect " + expectedKind + " code.");
  }
  if (typeof packet.from?.id !== "string" || typeof packet.from?.displayName !== "string") {
    throw new Error("The connection code is missing peer information.");
  }
  return packet;
}

function makeSignal(kind, sdp) {
  const packet = {
    protocol: SIGNAL_PROTOCOL,
    version: SIGNAL_VERSION,
    kind,
    from: {
      id: currentIdentity.id,
      displayName: currentIdentity.displayName,
      publicKey: currentIdentity.publicKey
    },
    sdp: { type: sdp.type, sdp: sdp.sdp }
  };
  return "REDRO1:" + toBase64Url(JSON.stringify(packet));
}

function extractSignalCode(text) {
  const match = text.trim().match(/REDRO1:([A-Za-z0-9_-]+)/);
  return match ? match[1] : text.trim().replace(/^REDRO1:/, "");
}

function waitForIceGathering(connection) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Network setup timed out while gathering connection details. Try again."));
    }, 25000);
    const onChange = () => {
      if (connection.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", onChange);
    };
    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

function updateConnectionStatus(text, connected = false) {
  const status = byId("connectionStatus");
  status.innerHTML = "";
  const dot = document.createElement("i");
  dot.className = connected ? "connected" : "";
  status.append(dot, document.createTextNode(text));
  status.classList.toggle("is-connected", connected);
}

function setPeer(identity) {
  peerIdentity = identity;
  activeConversationId = identity.id;
  byId("peerAvatar").textContent = identity.displayName.trim().charAt(0).toUpperCase() || "P";
  byId("peerName").textContent = identity.displayName;
  byId("peerId").textContent = identity.id;
  byId("chatPanel").hidden = false;
  byId("connectionStatus").scrollIntoView?.({ block: "nearest" });
  loadActiveConversation();
}

async function loadActiveConversation() {
  if (!activeConversationId) return;
  try {
    messageHistory = await loadMessages(activeConversationId);
    renderMessages();
  } catch (error) {
    showToast(error.message);
  }
}

function renderMessages() {
  const list = byId("messageList");
  list.replaceChildren();
  if (!messageHistory.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Your direct conversation starts here.";
    list.append(empty);
    return;
  }
  for (const message of messageHistory) {
    const bubble = document.createElement("article");
    bubble.className = "message-bubble " + (message.senderId === currentIdentity.id ? "outgoing" : "incoming");
    const body = document.createElement("p");
    body.textContent = message.text;
    const meta = document.createElement("time");
    meta.dateTime = message.timestamp;
    meta.textContent = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    bubble.append(body, meta);
    list.append(bubble);
  }
  list.scrollTop = list.scrollHeight;
}

async function receiveDataChannelMessage(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }
  if (payload?.type !== "message" || typeof payload.text !== "string" || payload.text.length > 4000) return;
  const message = {
    key: activeConversationId + ":" + payload.id,
    conversationId: activeConversationId,
    senderId: peerIdentity?.id || "unknown",
    senderName: peerIdentity?.displayName || "Contact",
    text: payload.text,
    timestamp: Number(payload.timestamp) || Date.now()
  };
  try {
    await saveMessage(message);
    messageHistory.push(message);
    renderMessages();
  } catch {
    showToast("Received a message but could not save it locally.");
  }
}

function configureDataChannel(channel) {
  dataChannel = channel;
  dataChannel.onopen = () => {
    updateConnectionStatus("Connected directly", true);
    byId("chatPanel").hidden = false;
    showToast("Direct connection established.");
    loadActiveConversation();
  };
  dataChannel.onclose = () => {
    updateConnectionStatus("Disconnected");
  };
  dataChannel.onerror = () => showToast("The direct data channel reported an error.");
  dataChannel.onmessage = receiveDataChannelMessage;
}

function createPeerConnection() {
  if (!window.RTCPeerConnection) throw new Error("This browser does not support WebRTC.");
  if (peerConnection) peerConnection.close();
  peerConnection = new RTCPeerConnection(RTC_CONFIGURATION);
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "failed") {
      updateConnectionStatus("Connection failed");
      showToast("Direct connection failed. Your network may require a TURN relay.");
    } else if (peerConnection.connectionState === "disconnected") {
      updateConnectionStatus("Connection interrupted");
    }
  };
  peerConnection.ondatachannel = (event) => configureDataChannel(event.channel);
  return peerConnection;
}

async function createInvitation() {
  if (!currentIdentity) {
    openIdentityDialog();
    return;
  }
  try {
    byId("offerStep").hidden = false;
    byId("answerStep").hidden = true;
    byId("createOfferButton").disabled = true;
    updateConnectionStatus("Preparing invitation");
    const connection = createPeerConnection();
    configureDataChannel(connection.createDataChannel("redro-messages", { ordered: true }));
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await waitForIceGathering(connection);
    byId("offerOutput").value = makeSignal("offer", connection.localDescription);
    byId("answerInput").value = "";
    updateConnectionStatus("Invitation ready");
    showToast("Invitation created. Send it to your contact.");
  } catch (error) {
    updateConnectionStatus("Not connected");
    showToast(error.message || "Could not create an invitation.");
  } finally {
    byId("createOfferButton").disabled = false;
  }
}

async function acceptInvitation() {
  if (!currentIdentity) {
    openIdentityDialog();
    return;
  }
  try {
    const code = extractSignalCode(byId("offerInput").value);
    if (!code) throw new Error("Paste the invitation code first.");
    byId("makeAnswerButton").disabled = true;
    updateConnectionStatus("Reading invitation");
    const packet = parseSignal(code, "offer");
    const connection = createPeerConnection();
    setPeer(packet.from);
    await connection.setRemoteDescription(packet.sdp);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await waitForIceGathering(connection);
    byId("answerOutput").value = makeSignal("answer", connection.localDescription);
    updateConnectionStatus("Reply ready");
    showToast("Reply code created. Send it to the person who invited you.");
  } catch (error) {
    updateConnectionStatus("Not connected");
    showToast(error.message || "Could not accept this invitation.");
  } finally {
    byId("makeAnswerButton").disabled = false;
  }
}

async function applyAnswer() {
  try {
    const code = extractSignalCode(byId("answerInput").value);
    if (!code) throw new Error("Paste the reply code first.");
    const packet = parseSignal(code, "answer");
    if (!peerConnection || peerConnection.signalingState !== "have-local-offer") {
      throw new Error("Create a new invitation before applying a reply.");
    }
    await peerConnection.setRemoteDescription(packet.sdp);
    setPeer(packet.from);
    updateConnectionStatus("Connecting…");
    showToast("Reply accepted. Connecting directly…");
  } catch (error) {
    showToast(error.message || "Could not apply the reply code.");
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = byId("messageInput");
  const text = input.value.trim();
  if (!text || !activeConversationId) return;
  if (!dataChannel || dataChannel.readyState !== "open") {
    showToast("The direct connection is not open.");
    return;
  }
  const payload = { type: "message", id: crypto.randomUUID(), text, timestamp: Date.now() };
  const message = {
    key: activeConversationId + ":" + payload.id,
    conversationId: activeConversationId,
    senderId: currentIdentity.id,
    senderName: currentIdentity.displayName,
    text,
    timestamp: payload.timestamp
  };
  try {
    dataChannel.send(JSON.stringify(payload));
    await saveMessage(message);
    messageHistory.push(message);
    input.value = "";
    renderMessages();
  } catch {
    showToast("Message could not be sent or saved. Please try again.");
  }
}

function disconnectPeer() {
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  peerIdentity = null;
  activeConversationId = null;
  messageHistory = [];
  byId("chatPanel").hidden = true;
  byId("offerStep").hidden = true;
  byId("answerStep").hidden = true;
  updateConnectionStatus("Not connected");
  showToast("Disconnected.");
}

function showSetupNotice() {
  if (!currentIdentity) {
    openIdentityDialog();
    return;
  }
  byId("connectionPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function initializeIdentity() {
  try {
    const identity = await readIdentity();
    if (identity?.id && identity?.privateKey && identity?.publicKey) {
      renderIdentity(identity);
    } else {
      openIdentityDialog();
    }
  } catch (error) {
    byId("identityError").textContent = error?.message || "Local identity storage is unavailable.";
    byId("identityError").hidden = false;
    byId("identityDialog").showModal();
  }
}

byId("refreshCapabilities")?.addEventListener("click", checkCapabilities);
byId("newChatButton")?.addEventListener("click", showSetupNotice);
byId("profileButton")?.addEventListener("click", openIdentityDialog);
byId("identityForm")?.addEventListener("submit", handleIdentitySubmit);
byId("copyIdButton")?.addEventListener("click", copyIdentity);
byId("shareIdButton")?.addEventListener("click", shareIdentity);
byId("closeIdentityDialog")?.addEventListener("click", () => {
  if (currentIdentity) byId("identityDialog").close();
});
byId("createOfferButton")?.addEventListener("click", createInvitation);
byId("acceptOfferButton")?.addEventListener("click", () => {
  byId("answerStep").hidden = false;
  byId("offerStep").hidden = true;
  byId("offerInput").focus();
});
byId("makeAnswerButton")?.addEventListener("click", acceptInvitation);
byId("applyAnswerButton")?.addEventListener("click", applyAnswer);
byId("copyOfferButton")?.addEventListener("click", () => copyText(byId("offerOutput").value, "Invitation copied."));
byId("copyAnswerButton")?.addEventListener("click", () => copyText(byId("answerOutput").value, "Reply code copied."));
byId("messageForm")?.addEventListener("submit", sendMessage);
byId("disconnectButton")?.addEventListener("click", disconnectPeer);

checkCapabilities();
initializeIdentity();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
