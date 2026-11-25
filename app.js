const byId = (id) => document.getElementById(id);

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
  const secure = window.isSecureContext;
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
    setCapability("camera", false, "Permission or device check unavailable");
    setCapability("microphone", false, "Permission or device check unavailable");
  }
}

function showSetupNotice() {
  window.alert("Conversation setup will be available in the next development milestone.");
}

byId("refreshCapabilities")?.addEventListener("click", checkCapabilities);
byId("newChatButton")?.addEventListener("click", showSetupNotice);
byId("emptyNewChatButton")?.addEventListener("click", showSetupNotice);
checkCapabilities();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
