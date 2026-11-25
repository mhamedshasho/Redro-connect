const byId = (id) => document.getElementById(id);
const IDENTITY_DB = "redro-connect-local";
const IDENTITY_STORE = "identity";
const IDENTITY_KEY = "primary";

let currentIdentity = null;
let toastTimer = null;

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
      reject(new Error("This browser does not support local identity storage."));
      return;
    }

    const request = indexedDB.open(IDENTITY_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        database.createObjectStore(IDENTITY_STORE);
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
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function renderIdentity(identity) {
  currentIdentity = identity;
  const card = byId("identityCard");
  const initial = identity.displayName.trim().charAt(0).toUpperCase() || "R";
  byId("identityAvatar").textContent = initial;
  byId("identityName").textContent = identity.displayName;
  byId("identityId").textContent = identity.id;
  byId("profileButton").textContent = initial;
  card.hidden = false;
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

async function copyIdentity() {
  if (!currentIdentity) return;
  try {
    await navigator.clipboard.writeText(currentIdentity.id);
    showToast("Redro ID copied.");
  } catch {
    showToast("Copy is unavailable. Select and copy your ID.");
  }
}

async function shareIdentity() {
  if (!currentIdentity) return;
  const shareData = {
    title: "My Redro Connect ID",
    text: "Add me on Redro Connect: " + currentIdentity.id
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Sharing is unavailable on this device.");
    }
  } else {
    await copyIdentity();
  }
}

function showSetupNotice() {
  if (!currentIdentity) {
    openIdentityDialog();
    return;
  }
  showToast("Peer connections are the next development milestone.");
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
byId("emptyNewChatButton")?.addEventListener("click", showSetupNotice);
byId("profileButton")?.addEventListener("click", openIdentityDialog);
byId("identityForm")?.addEventListener("submit", handleIdentitySubmit);
byId("copyIdButton")?.addEventListener("click", copyIdentity);
byId("shareIdButton")?.addEventListener("click", shareIdentity);
byId("closeIdentityDialog")?.addEventListener("click", () => {
  if (currentIdentity) byId("identityDialog").close();
});

checkCapabilities();
initializeIdentity();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
