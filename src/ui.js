import { CAMERA_MODES, ZONE_STYLES } from "./config.js";

const BLOCKING_HEALTH_STATES = new Set(["RECOVERING", "UNSAFE"]);

function formatMeters(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return value >= 10 ? `${value.toFixed(0)}m` : `${value.toFixed(1)}m`;
}

function formatCarLengths(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(1)} cars`;
}

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
  const direction = CAMERA_MODES[mode].directionLabel;
  const meters = formatMeters(snapshot.primary.distanceMeters);
  const carLengths = formatCarLengths(snapshot.primary.distanceCarLengths);
  const rangeSource =
    snapshot.primary.calibrationSource === "tuned" ? "tuned range" : "estimated range";

  return `${subject} ${direction} at about ${meters} (${carLengths}, ${rangeSource}).`;
}

function buildStatusMessage(snapshot, mode, thresholds) {
  if (!snapshot.primary) {
    return `Danger under ${formatMeters(thresholds.dangerMeters)}. Warning under ${formatMeters(thresholds.warningMeters)} in ${mode} mode.`;
  }

  const label = ZONE_STYLES[snapshot.zone]?.displayLabel ?? snapshot.zone;
  const direction = CAMERA_MODES[mode].directionLabel;
  return `${label}. ${snapshot.primary.label} ${direction} at about ${formatMeters(snapshot.primary.distanceMeters)}.`;
}

export class HudController {
  constructor() {
    this.refs = {
      loading: document.getElementById("loading"),
      loadBar: document.getElementById("load-bar"),
      loadStatus: document.getElementById("load-status"),
      permissionError: document.getElementById("permission-error"),
      errorEyebrow: document.getElementById("error-eyebrow"),
      errorTitle: document.getElementById("error-title"),
      errorMessage: document.getElementById("error-message"),
      healthBanner: document.getElementById("health-banner"),
      healthState: document.getElementById("health-state"),
      healthDetail: document.getElementById("health-detail"),
      cameraModeLabel: document.getElementById("camera-mode-label"),
      backendValue: document.getElementById("backend-value"),
      frontModeButton: document.getElementById("front-mode-button"),
      rearModeButton: document.getElementById("rear-mode-button"),
      zoneContext: document.getElementById("zone-context"),
      zoneValue: document.getElementById("zone-value"),
      heroDistance: document.getElementById("hero-distance"),
      threatDetail: document.getElementById("threat-detail"),
      riskFill: document.getElementById("risk-fill"),
      heroThresholds: document.getElementById("hero-thresholds"),
      rearBanner: document.getElementById("rear-banner"),
      distanceValue: document.getElementById("distance-value"),
      vehicleCount: document.getElementById("vehicle-count"),
      fpsValue: document.getElementById("fps-value"),
      latencyValue: document.getElementById("latency-value"),
      soundButton: document.getElementById("sound-button"),
      soundButtonValue: document.getElementById("sound-button-value"),
      hapticsButton: document.getElementById("haptics-button"),
      hapticsButtonValue: document.getElementById("haptics-button-value"),
      statusMessage: document.getElementById("status-message"),
      settingsButton: document.getElementById("settings-button"),
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
    this.showFatalError({
      eyebrow: "Camera access required",
      title: "Point the phone toward traffic and allow camera access.",
      message:
        "SurronShield needs the camera to watch for cars, trucks, buses, motorcycles, and bicycles around your bike.",
    });
  }

  showFatalError({ eyebrow, title, message }) {
    this.refs.loading.hidden = true;
    this.refs.errorEyebrow.textContent = eyebrow;
    this.refs.errorTitle.textContent = title;
    this.refs.errorMessage.textContent = message;
    this.refs.permissionError.hidden = false;
  }

  setMode(mode) {
    const meta = CAMERA_MODES[mode];
    this.refs.cameraModeLabel.textContent = meta.label;
    this.refs.zoneContext.textContent = meta.zoneLabel;
    this.refs.rearBanner.hidden = mode !== "rear";
    this.refs.frontModeButton.classList.toggle("is-active", mode === "front");
    this.refs.rearModeButton.classList.toggle("is-active", mode === "rear");
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

  setSettingsOpen(open) {
    document.body.classList.toggle("settings-open", open);
    this.refs.settingsButton.classList.toggle("is-active", open);
  }

  update(snapshot, { mode, fps, health }) {
    const style = ZONE_STYLES[snapshot.zone] ?? ZONE_STYLES.CLEAR;
    const thresholds = snapshot.thresholds;
    const healthBlocksVision = health && BLOCKING_HEALTH_STATES.has(health.state);

    document.body.dataset.zone = healthBlocksVision
      ? health.state === "UNSAFE"
        ? "close"
        : "medium"
      : snapshot.zone.toLowerCase();
    document.documentElement.style.setProperty(
      "--zone-color",
      healthBlocksVision
        ? health.state === "UNSAFE"
          ? ZONE_STYLES.CLOSE.color
          : ZONE_STYLES.MEDIUM.color
        : style.color,
    );

    if (healthBlocksVision) {
      this.refs.zoneValue.textContent =
        health.state === "UNSAFE" ? "UNSAFE" : "RECOVER";
      this.refs.heroDistance.textContent = "No live feed";
      this.refs.threatDetail.textContent = health.message;
      this.refs.heroThresholds.textContent =
        "Do not rely on vehicle detection until recovery completes.";
      this.refs.distanceValue.textContent = "--";
      this.refs.vehicleCount.textContent = "--";
      this.refs.fpsValue.textContent = fps > 0 ? String(fps) : "--";
      this.refs.latencyValue.textContent = "--";
      this.refs.backendValue.textContent = snapshot.backend.toUpperCase();
      this.refs.statusMessage.textContent = health.message;
      this.refs.riskFill.style.transform =
        health.state === "UNSAFE" ? "scaleX(1)" : "scaleX(0.62)";
      return;
    }

    this.refs.zoneValue.textContent = style.displayLabel;
    this.refs.heroDistance.textContent = snapshot.primary
      ? `~ ${formatMeters(snapshot.primary.distanceMeters)}`
      : "No target";
    this.refs.threatDetail.textContent = buildThreatDetail(snapshot, mode);
    this.refs.heroThresholds.textContent =
      `Warning under ${formatMeters(thresholds.warningMeters)}. Danger under ${formatMeters(thresholds.dangerMeters)}.`;
    this.refs.distanceValue.textContent = snapshot.primary
      ? formatMeters(snapshot.primary.distanceMeters)
      : "--";
    this.refs.vehicleCount.textContent = String(snapshot.count);
    this.refs.fpsValue.textContent = fps > 0 ? String(fps) : "--";
    this.refs.latencyValue.textContent = formatLatency(snapshot.latencyMs);
    this.refs.backendValue.textContent = snapshot.backend.toUpperCase();
    this.refs.statusMessage.textContent = buildStatusMessage(snapshot, mode, thresholds);
    this.refs.riskFill.style.transform = `scaleX(${Math.max(snapshot.risk, 0.03)})`;
  }

  updateHealth(health) {
    const isReady = health.state === "READY";
    this.refs.healthBanner.hidden = isReady;

    if (isReady) {
      return;
    }

    const primary = health.issues[0];
    this.refs.healthBanner.dataset.healthState = health.state;
    this.refs.healthState.textContent = primary?.title || health.state;
    this.refs.healthDetail.textContent = health.message;
  }
}
