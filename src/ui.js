import { CAMERA_MODES, ZONE_STYLES } from "./config.js";

function formatLatency(latencyMs) {
  return latencyMs > 0 ? `${latencyMs}ms` : "--";
}

function buildThreatDetail(snapshot, mode) {
  if (!snapshot.primary) {
    return mode === "rear"
      ? "Watching the lane behind the bike."
      : "Watching the road ahead.";
  }

  const subject = snapshot.primary.label.toLowerCase();
  const direction = mode === "rear" ? "behind you" : "ahead";

  if (snapshot.primary.zone === "CLOSE") {
    return `${subject} is closing ${direction}.`;
  }

  if (snapshot.primary.zone === "MEDIUM") {
    return `${subject} is approaching ${direction}.`;
  }

  return `${subject} detected ${direction}.`;
}

function buildStatusMessage(snapshot, mode) {
  if (!snapshot.primary) {
    return mode === "rear"
      ? "Rear mirror active. Scan centered behind the bike."
      : "Road scan active. Keep the phone centered with the lane.";
  }

  const distanceLabel =
    snapshot.primary.zone === "CLOSE"
      ? "Immediate warning"
      : snapshot.primary.zone === "MEDIUM"
        ? "Caution"
        : "Heads up";

  return `${distanceLabel}. ${snapshot.primary.label} confidence ${Math.round(snapshot.primary.score * 100)} percent.`;
}

export class HudController {
  constructor() {
    this.refs = {
      loading: document.getElementById("loading"),
      loadBar: document.getElementById("load-bar"),
      loadStatus: document.getElementById("load-status"),
      permissionError: document.getElementById("permission-error"),
      cameraModeLabel: document.getElementById("camera-mode-label"),
      backendValue: document.getElementById("backend-value"),
      zoneContext: document.getElementById("zone-context"),
      zoneValue: document.getElementById("zone-value"),
      threatDetail: document.getElementById("threat-detail"),
      riskFill: document.getElementById("risk-fill"),
      rearBanner: document.getElementById("rear-banner"),
      vehicleCount: document.getElementById("vehicle-count"),
      fpsValue: document.getElementById("fps-value"),
      latencyValue: document.getElementById("latency-value"),
      modelValue: document.getElementById("model-value"),
      modeButtonValue: document.getElementById("mode-button-value"),
      soundButton: document.getElementById("sound-button"),
      soundButtonValue: document.getElementById("sound-button-value"),
      hapticsButton: document.getElementById("haptics-button"),
      hapticsButtonValue: document.getElementById("haptics-button-value"),
      statusMessage: document.getElementById("status-message"),
    };
  }

  setLoading(progress, message) {
    this.refs.loading.hidden = false;
    this.refs.loading.classList.remove("is-hidden");
    this.refs.loadBar.style.width = `${progress}%`;
    this.refs.loadStatus.textContent = message;
  }

  hideLoading() {
    this.refs.loading.classList.add("is-hidden");
    window.setTimeout(() => {
      this.refs.loading.hidden = true;
    }, 260);
  }

  showPermissionError() {
    this.refs.loading.hidden = true;
    this.refs.permissionError.hidden = false;
  }

  setMode(mode) {
    const meta = CAMERA_MODES[mode];
    this.refs.cameraModeLabel.textContent = meta.label;
    this.refs.zoneContext.textContent = meta.zoneLabel;
    this.refs.modeButtonValue.textContent = meta.shortLabel;
    this.refs.rearBanner.hidden = mode !== "rear";
    document.body.classList.toggle("rear-mode", mode === "rear");
  }

  setSoundEnabled(enabled) {
    this.refs.soundButton.classList.toggle("is-off", !enabled);
    this.refs.soundButtonValue.textContent = enabled ? "On" : "Off";
  }

  setHapticsEnabled(enabled, supported) {
    this.refs.hapticsButton.disabled = !supported;
    this.refs.hapticsButton.classList.toggle("is-off", !enabled || !supported);
    this.refs.hapticsButtonValue.textContent = supported
      ? enabled
        ? "On"
        : "Off"
      : "N/A";
  }

  update(snapshot, { mode, fps }) {
    const style = ZONE_STYLES[snapshot.zone] ?? ZONE_STYLES.CLEAR;

    document.body.dataset.zone = snapshot.zone.toLowerCase();
    document.documentElement.style.setProperty("--zone-color", style.color);

    this.refs.zoneValue.textContent = style.displayLabel;
    this.refs.threatDetail.textContent = buildThreatDetail(snapshot, mode);
    this.refs.vehicleCount.textContent = String(snapshot.count);
    this.refs.fpsValue.textContent = fps > 0 ? String(fps) : "--";
    this.refs.latencyValue.textContent = formatLatency(snapshot.latencyMs);
    this.refs.modelValue.textContent = snapshot.modelLabel;
    this.refs.backendValue.textContent = snapshot.backend.toUpperCase();
    this.refs.statusMessage.textContent = buildStatusMessage(snapshot, mode);
    this.refs.riskFill.style.transform = `scaleX(${Math.max(snapshot.risk, 0.03)})`;
  }
}
