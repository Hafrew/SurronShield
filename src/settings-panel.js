import { metersToCarLengths } from "./preferences.js";

function formatMeters(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return value >= 10 ? `${value.toFixed(0)} m` : `${value.toFixed(1)} m`;
}

function formatSettingValue(meters, settings) {
  const carLengths = metersToCarLengths(meters, settings);
  if (!Number.isFinite(carLengths)) {
    return formatMeters(meters);
  }

  return `${formatMeters(meters)} / ${carLengths.toFixed(1)} cars`;
}

function formatFov(profile) {
  const confidence = profile.calibrated ? "tuned" : "estimated";
  return `${profile.horizontalFovDegrees.toFixed(0)} deg / ${confidence}`;
}

function buildZoneHint(thresholds, settings) {
  return `Danger inside ${formatSettingValue(thresholds.dangerMeters, settings)}. Warning between ${formatSettingValue(thresholds.dangerMeters, settings)} and ${formatSettingValue(thresholds.warningMeters, settings)}. Safe beyond ${formatSettingValue(thresholds.warningMeters, settings)}.`;
}

export class SettingsPanelController {
  constructor() {
    this.refs = {
      scrim: document.getElementById("settings-scrim"),
      page: document.getElementById("settings-page"),
      closeButton: document.getElementById("settings-close-button"),
      currentMode: document.getElementById("settings-current-mode"),
      modelValue: document.getElementById("settings-model-value"),
      backendValue: document.getElementById("settings-backend-value"),
      frontDangerSlider: document.getElementById("front-danger-slider"),
      frontWarningSlider: document.getElementById("front-warning-slider"),
      rearDangerSlider: document.getElementById("rear-danger-slider"),
      rearWarningSlider: document.getElementById("rear-warning-slider"),
      carLengthSlider: document.getElementById("car-length-slider"),
      frontFovSlider: document.getElementById("front-fov-slider"),
      rearFovSlider: document.getElementById("rear-fov-slider"),
      frontDangerDisplay: document.getElementById("front-danger-display"),
      frontWarningDisplay: document.getElementById("front-warning-display"),
      rearDangerDisplay: document.getElementById("rear-danger-display"),
      rearWarningDisplay: document.getElementById("rear-warning-display"),
      carLengthDisplay: document.getElementById("car-length-display"),
      frontFovDisplay: document.getElementById("front-fov-display"),
      rearFovDisplay: document.getElementById("rear-fov-display"),
      frontZoneHint: document.getElementById("front-zone-hint"),
      rearZoneHint: document.getElementById("rear-zone-hint"),
    };
  }

  bind({ onClose, onThresholdChange, onCarLengthChange, onFovChange }) {
    this.refs.scrim.addEventListener("click", onClose);
    this.refs.closeButton.addEventListener("click", onClose);

    this.refs.frontDangerSlider.addEventListener("input", (event) => {
      onThresholdChange("front", "dangerMeters", event.target.value);
    });
    this.refs.frontWarningSlider.addEventListener("input", (event) => {
      onThresholdChange("front", "warningMeters", event.target.value);
    });
    this.refs.rearDangerSlider.addEventListener("input", (event) => {
      onThresholdChange("rear", "dangerMeters", event.target.value);
    });
    this.refs.rearWarningSlider.addEventListener("input", (event) => {
      onThresholdChange("rear", "warningMeters", event.target.value);
    });
    this.refs.carLengthSlider.addEventListener("input", (event) => {
      onCarLengthChange("carLengthMeters", event.target.value);
    });
    this.refs.frontFovSlider.addEventListener("input", (event) => {
      onFovChange("front", event.target.value);
    });
    this.refs.rearFovSlider.addEventListener("input", (event) => {
      onFovChange("rear", event.target.value);
    });
  }

  setOpen(open) {
    this.refs.scrim.hidden = !open;
    this.refs.page.hidden = !open;
  }

  render(settings, { mode, modelLabel, backend }) {
    this.refs.currentMode.textContent = mode === "rear" ? "Rear" : "Front";
    this.refs.modelValue.textContent = modelLabel;
    this.refs.backendValue.textContent = backend.toUpperCase();

    this.refs.frontDangerSlider.value = settings.distanceTuning.front.dangerMeters;
    this.refs.frontWarningSlider.value = settings.distanceTuning.front.warningMeters;
    this.refs.rearDangerSlider.value = settings.distanceTuning.rear.dangerMeters;
    this.refs.rearWarningSlider.value = settings.distanceTuning.rear.warningMeters;
    this.refs.carLengthSlider.value = settings.calibration.carLengthMeters;
    this.refs.frontFovSlider.value =
      settings.calibration.cameraProfiles.front.horizontalFovDegrees;
    this.refs.rearFovSlider.value =
      settings.calibration.cameraProfiles.rear.horizontalFovDegrees;

    this.refs.frontDangerDisplay.textContent = formatSettingValue(
      settings.distanceTuning.front.dangerMeters,
      settings,
    );
    this.refs.frontWarningDisplay.textContent = formatSettingValue(
      settings.distanceTuning.front.warningMeters,
      settings,
    );
    this.refs.rearDangerDisplay.textContent = formatSettingValue(
      settings.distanceTuning.rear.dangerMeters,
      settings,
    );
    this.refs.rearWarningDisplay.textContent = formatSettingValue(
      settings.distanceTuning.rear.warningMeters,
      settings,
    );
    this.refs.carLengthDisplay.textContent = formatMeters(
      settings.calibration.carLengthMeters,
    );
    this.refs.frontFovDisplay.textContent = formatFov(
      settings.calibration.cameraProfiles.front,
    );
    this.refs.rearFovDisplay.textContent = formatFov(
      settings.calibration.cameraProfiles.rear,
    );

    this.refs.frontZoneHint.textContent = buildZoneHint(
      settings.distanceTuning.front,
      settings,
    );
    this.refs.rearZoneHint.textContent = buildZoneHint(
      settings.distanceTuning.rear,
      settings,
    );
  }
}
