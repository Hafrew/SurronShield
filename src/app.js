import { CAMERA_MODES } from "./config.js";
import { CameraController } from "./camera.js";
import { VehicleDetector } from "./detector.js";
import { FeedbackController } from "./feedback.js";
import { OverlayRenderer } from "./overlay.js";
import {
  loadSettings,
  saveSettings,
  takeSettingsError,
  getModeCameraProfile,
  updateCalibrationSetting,
  updateCameraProfileSetting,
  updateDistanceSetting,
} from "./preferences.js";
import { HEALTH_STATES, ReliabilitySupervisor } from "./reliability.js";
import { SettingsPanelController } from "./settings-panel.js";
import { HudController } from "./ui.js";
import { WAKE_LOCK_STATES, WakeLockController } from "./wake-lock.js";

const CAMERA_RECOVERY_STATES = new Set(["muted", "stale", "ended", "failed"]);
const BLOCKING_HEALTH_STATES = new Set([
  HEALTH_STATES.RECOVERING,
  HEALTH_STATES.UNSAFE,
]);
const DETECTOR_STALE_MS = 1600;
const FIRST_INFERENCE_GRACE_MS = 2200;
const MAX_CAMERA_RECOVERY_ATTEMPTS = 5;

class SurronShieldApp {
  constructor() {
    this.video = document.getElementById("video");
    this.overlayCanvas = document.getElementById("overlay");
    this.retryButton = document.getElementById("retry-button");
    this.frontModeButton = document.getElementById("front-mode-button");
    this.rearModeButton = document.getElementById("rear-mode-button");
    this.settingsButton = document.getElementById("settings-button");
    this.diagnosticsButton = document.getElementById("diagnostics-button");
    this.diagnosticsCloseButton = document.getElementById("diagnostics-close-button");
    this.soundButton = document.getElementById("sound-button");
    this.hapticsButton = document.getElementById("haptics-button");

    this.ui = new HudController();
    this.health = new ReliabilitySupervisor({
      onChange: (snapshot) => {
        this.healthSnapshot = snapshot;
        this.ui.updateHealth(snapshot);
      },
    });
    this.healthSnapshot = this.health.getSnapshot();
    this.settingsPanel = new SettingsPanelController();
    this.camera = new CameraController(this.video, {
      onStatus: (status) => this.handleCameraStatus(status),
    });
    this.detector = new VehicleDetector(this.video, {
      onStatus: (status) => this.handleDetectorStatus(status),
    });
    this.feedback = new FeedbackController({
      onStatus: (status) => this.handleFeedbackStatus(status),
    });
    this.wakeLock = new WakeLockController({
      onStatus: (status) => this.handleWakeLockStatus(status),
    });
    this.overlay = new OverlayRenderer(this.video, this.overlayCanvas);

    this.settings = loadSettings();
    this.reportSettingsError(takeSettingsError());
    this.mode = this.settings.activeMode;
    this.detector.setSettings(this.settings);

    this.running = false;
    this.switching = false;
    this.settingsOpen = false;
    this.diagnosticsOpen = false;
    this.fpsFrames = 0;
    this.fpsLastAt = performance.now();
    this.fps = 0;
    this.startedAt = 0;
    this.cameraRecoveryAttempts = 0;
    this.cameraRecoveryTimer = null;
  }

  bindEvents() {
    this.retryButton.addEventListener("click", () => {
      window.location.reload();
    });

    this.frontModeButton.addEventListener("click", () => {
      void this.switchMode("front");
    });
    this.rearModeButton.addEventListener("click", () => {
      void this.switchMode("rear");
    });

    this.soundButton.addEventListener("click", async () => {
      await this.feedback.prime();
      this.feedback.setSoundEnabled(!this.feedback.soundEnabled);
      this.ui.setSoundEnabled(this.feedback.soundEnabled);
    });

    this.hapticsButton.addEventListener("click", () => {
      this.feedback.setHapticsEnabled(!this.feedback.hapticsEnabled);
      this.ui.setHapticsEnabled(
        this.feedback.hapticsEnabled,
        this.feedback.supportsHaptics,
      );
    });

    this.settingsButton.addEventListener("click", () => {
      this.setSettingsOpen(true);
    });

    this.diagnosticsButton.addEventListener("click", () => {
      this.setDiagnosticsOpen(!this.diagnosticsOpen);
    });
    this.diagnosticsCloseButton.addEventListener("click", () => {
      this.setDiagnosticsOpen(false);
    });

    this.settingsPanel.bind({
      onClose: () => this.setSettingsOpen(false),
      onThresholdChange: (mode, key, value) => {
        this.settings = updateDistanceSetting(this.settings, mode, key, value);
        this.persistSettings();
        this.applySettings();
      },
      onCarLengthChange: (key, value) => {
        this.settings = updateCalibrationSetting(this.settings, key, value);
        this.persistSettings();
        this.applySettings();
      },
      onFovChange: (mode, value) => {
        this.settings = updateCameraProfileSetting(
          this.settings,
          mode,
          "horizontalFovDegrees",
          value,
        );
        this.persistSettings();
        this.applySettings();
      },
    });

    document.addEventListener(
      "pointerdown",
      async () => {
        await this.feedback.prime();
      },
      { once: true },
    );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.settingsOpen) {
        this.setSettingsOpen(false);
      } else if (event.key === "Escape" && this.diagnosticsOpen) {
        this.setDiagnosticsOpen(false);
      }
    });

    window.addEventListener("resize", () => {
      this.overlay.resize();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.feedback.lastZone = "CLEAR";
      }
    });

    window.addEventListener("error", (event) => {
      this.reportRuntimeFault(event.error || event.message);
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.reportRuntimeFault(event.reason);
    });
  }

  renderSettingsPanel(snapshot = this.detector.snapshot) {
    this.settingsPanel.render(this.settings, {
      mode: this.mode,
      modelLabel: snapshot.modelLabel ?? this.detector.modelLabel,
      backend: snapshot.backend ?? this.detector.backend,
    });
  }

  setSettingsOpen(open) {
    this.settingsOpen = open;
    this.settingsPanel.setOpen(open);
    this.ui.setSettingsOpen(open);
    if (open) {
      this.renderSettingsPanel(this.detector.snapshot);
    }
  }

  applySettings() {
    this.detector.setSettings(this.settings);
    this.reportCalibrationHealth();
    this.renderSettingsPanel(this.detector.snapshot);
  }

  persistSettings() {
    const result = saveSettings(this.settings);
    if (result?.ok === false) {
      this.reportSettingsError({ type: "save", error: result.error });
    } else {
      this.health.clear("settings.save");
    }
  }

  setDiagnosticsOpen(open) {
    this.diagnosticsOpen = open;
    this.ui.setDiagnosticsOpen(open);
  }

  reportSettingsError(settingsError) {
    if (!settingsError) {
      return;
    }

    this.health.report(`settings.${settingsError.type}`, {
      state: HEALTH_STATES.DEGRADED,
      title:
        settingsError.type === "load"
          ? "Settings fallback"
          : "Settings not saved",
      detail:
        settingsError.type === "load"
          ? "Saved settings could not be loaded; defaults are active."
          : "Settings changed for this session but could not be saved.",
      subsystem: "settings",
      error: settingsError.error,
    });
  }

  applyModeState() {
    const meta = CAMERA_MODES[this.mode];
    this.video.classList.toggle("mirrored", meta.mirrored);
    this.overlayCanvas.classList.toggle("mirrored", meta.mirrored);
    this.ui.setMode(this.mode);
    this.detector.setMode(this.mode);
    this.reportCalibrationHealth();
  }

  reportCalibrationHealth() {
    const profile = getModeCameraProfile(this.settings, this.mode);

    if (profile.calibrated) {
      this.health.clear("calibration.fov");
      return;
    }

    this.health.report("calibration.fov", {
      state: HEALTH_STATES.DEGRADED,
      title: "Camera FOV estimated",
      detail: "Distance margins widened until camera FOV is tuned.",
      subsystem: "calibration",
    });
  }

  handleCameraStatus(status) {
    if (status.state === "live") {
      this.health.clear("camera.stream");
      this.health.clear("camera.recovery");
      this.cameraRecoveryAttempts = 0;
      return;
    }

    if (status.state === "starting") {
      if (this.running) {
        this.health.report("camera.stream", {
          state: HEALTH_STATES.RECOVERING,
          title: "Camera starting",
          detail: status.message,
          subsystem: "camera",
        });
      }
      return;
    }

    if (status.state === "stopped" && !this.running) {
      this.health.clear("camera.stream");
      return;
    }

    const state =
      status.state === "failed" && this.cameraRecoveryAttempts >= MAX_CAMERA_RECOVERY_ATTEMPTS
        ? HEALTH_STATES.UNSAFE
        : HEALTH_STATES.RECOVERING;

    this.health.report("camera.stream", {
      state,
      title: state === HEALTH_STATES.UNSAFE ? "Camera unavailable" : "Camera recovering",
      detail: status.message,
      subsystem: "camera",
      error: status.error,
    });

    if (this.running && CAMERA_RECOVERY_STATES.has(status.state)) {
      this.scheduleCameraRecovery();
    }
  }

  handleDetectorStatus(status) {
    if (status.state === "ready") {
      if (status.code === "backend-ready") {
        this.health.clear("detector.backend");
      } else if (status.code === "model-ready") {
        this.health.clear("detector.model");
      } else if (status.code === "inference-ready") {
        this.health.clear("detector.inference");
        this.health.clear("detector.stale");
      }
      return;
    }

    if (status.code === "backend-fallback") {
      this.health.report("detector.backend", {
        state: HEALTH_STATES.DEGRADED,
        title: "Detector backend degraded",
        detail: status.message,
        subsystem: "detector",
        error: status.error,
      });
      return;
    }

    if (status.code === "model-fallback") {
      this.health.report("detector.model", {
        state: HEALTH_STATES.DEGRADED,
        title: "Detector model degraded",
        detail: status.message,
        subsystem: "detector",
        error: status.error,
      });
      return;
    }

    const issueCode = status.code.startsWith("inference")
      ? "detector.inference"
      : status.code.startsWith("model")
        ? "detector.model"
        : `detector.${status.code}`;

    this.health.report(issueCode, {
      state:
        status.state === "unsafe"
          ? HEALTH_STATES.UNSAFE
          : HEALTH_STATES.DEGRADED,
      title:
        status.state === "unsafe"
          ? "Detector unavailable"
          : "Detector degraded",
      detail: status.message,
      subsystem: "detector",
      error: status.error,
    });
  }

  handleWakeLockStatus(status) {
    if (status.state === WAKE_LOCK_STATES.ACTIVE) {
      this.health.clear("wake.lock");
      return;
    }

    if (status.state === WAKE_LOCK_STATES.INACTIVE && !this.running) {
      this.health.clear("wake.lock");
      return;
    }

    this.health.report("wake.lock", {
      state: HEALTH_STATES.DEGRADED,
      title: "Screen not locked awake",
      detail: status.message,
      subsystem: "wake-lock",
      error: status.error,
    });
  }

  handleFeedbackStatus(status) {
    if (status.state === "ready") {
      this.health.clear("feedback.audio");
      return;
    }

    this.health.report("feedback.audio", {
      state: HEALTH_STATES.DEGRADED,
      title: "Audio alert degraded",
      detail: status.message,
      subsystem: "feedback",
      error: status.error,
    });
  }

  reportRuntimeFault(error) {
    this.health.report("runtime.fault", {
      state: HEALTH_STATES.UNSAFE,
      title: "Runtime fault",
      detail: "A browser runtime error occurred.",
      subsystem: "runtime",
      error,
    });
  }

  scheduleCameraRecovery() {
    if (
      this.cameraRecoveryTimer ||
      this.switching ||
      !this.running ||
      this.camera.isLive()
    ) {
      return;
    }

    const delay = Math.min(5000, 500 * 2 ** this.cameraRecoveryAttempts);
    this.health.report("camera.recovery", {
      state: HEALTH_STATES.RECOVERING,
      title: "Camera recovery",
      detail: `Restarting camera in ${(delay / 1000).toFixed(1)}s.`,
      subsystem: "camera",
    });

    this.cameraRecoveryTimer = window.setTimeout(() => {
      this.cameraRecoveryTimer = null;
      void this.recoverCamera();
    }, delay);
  }

  async recoverCamera() {
    if (!this.running || this.switching || this.camera.isLive()) {
      return;
    }

    this.cameraRecoveryAttempts += 1;

    try {
      await this.camera.start(this.mode);
      this.video.classList.add("live");
      this.health.clear("camera.recovery");
    } catch (error) {
      const exhausted = this.cameraRecoveryAttempts >= MAX_CAMERA_RECOVERY_ATTEMPTS;
      this.health.report("camera.recovery", {
        state: exhausted ? HEALTH_STATES.UNSAFE : HEALTH_STATES.RECOVERING,
        title: exhausted ? "Camera recovery failed" : "Camera recovery",
        detail: exhausted
          ? "Camera could not be restarted. Stop riding before relying on this app."
          : "Camera restart failed; retrying.",
        subsystem: "camera",
        error,
      });

      if (!exhausted) {
        this.scheduleCameraRecovery();
      }
    }
  }

  checkRuntimeHealth(now, snapshot) {
    if (!this.running || !this.camera.isLive() || !this.detector.model) {
      return;
    }

    if (!snapshot.updatedAt) {
      if (now - this.startedAt > FIRST_INFERENCE_GRACE_MS) {
        this.health.report("detector.stale", {
          state: HEALTH_STATES.UNSAFE,
          title: "Detector stale",
          detail: "Detector has not produced a live result.",
          subsystem: "detector",
        });
      }
      return;
    }

    if (now - snapshot.updatedAt > DETECTOR_STALE_MS) {
      this.health.report("detector.stale", {
        state: HEALTH_STATES.UNSAFE,
        title: "Detector stale",
        detail: "Detector results are stale.",
        subsystem: "detector",
      });
    } else {
      this.health.clear("detector.stale");
    }
  }

  updateFps(now) {
    this.fpsFrames += 1;

    if (now - this.fpsLastAt >= 1000) {
      this.fps = this.fpsFrames;
      this.fpsFrames = 0;
      this.fpsLastAt = now;
    }

    return this.fps;
  }

  async switchMode(nextMode) {
    if (this.switching || nextMode === this.mode) {
      return;
    }

    this.switching = true;
    this.ui.setLoading(76, `Switching to ${CAMERA_MODES[nextMode].label}...`);

    try {
      await this.camera.start(nextMode);
      this.mode = nextMode;
      this.settings.activeMode = nextMode;
      this.persistSettings();
      this.applyModeState();
      this.renderSettingsPanel(this.detector.snapshot);
      this.health.clear("camera.switch");
      this.ui.hideLoading();
    } catch (error) {
      this.health.report("camera.switch", {
        state: HEALTH_STATES.DEGRADED,
        title: "Camera switch failed",
        detail: "Continuing with the previous camera mode.",
        subsystem: "camera",
        error,
      });
      this.ui.hideLoading();
    } finally {
      this.switching = false;
    }
  }

  loop = (now) => {
    if (!this.running) {
      return;
    }

    const snapshot = this.detector.tick(now);
    this.checkRuntimeHealth(now, snapshot);
    const health = this.health.getSnapshot();
    this.overlay.render(snapshot);
    this.ui.update(snapshot, {
      mode: this.mode,
      fps: this.updateFps(now),
      health,
    });
    this.feedback.handleZone(
      BLOCKING_HEALTH_STATES.has(health.state) ? "CLEAR" : snapshot.zone,
    );

    if (this.settingsOpen) {
      this.renderSettingsPanel(snapshot);
    }

    window.requestAnimationFrame(this.loop);
  };

  async init() {
    this.bindEvents();
    this.applyModeState();
    this.applySettings();
    this.ui.setSoundEnabled(this.feedback.soundEnabled);
    this.ui.setHapticsEnabled(
      this.feedback.hapticsEnabled,
      this.feedback.supportsHaptics,
    );
    if (!this.feedback.supportsHaptics) {
      this.health.report("feedback.haptics", {
        state: HEALTH_STATES.DEGRADED,
        title: "Haptic alert unavailable",
        detail: "This browser or device does not support vibration alerts.",
        subsystem: "feedback",
      });
    }
    this.ui.setSettingsOpen(false);
    this.ui.setDiagnosticsOpen(false);
    this.ui.updateHealth(this.healthSnapshot);

    this.ui.setLoading(18, "Preparing detector...");
    const modelTask = this.detector.loadModel().then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );

    this.ui.setLoading(38, "Starting camera...");
    try {
      await this.camera.start(this.mode);
    } catch (error) {
      this.health.report("camera.start", {
        state: HEALTH_STATES.UNSAFE,
        title: "Camera unavailable",
        detail: "Camera could not start.",
        subsystem: "camera",
        error,
      });
      this.ui.showFatalError({
        eyebrow: "Camera unavailable",
        title: "Camera could not start.",
        message:
          error?.message ||
          "Allow camera access and make sure no other app is using the camera.",
      });
      return;
    }

    this.video.classList.add("live");
    this.applyModeState();
    this.ui.setLoading(58, "Holding screen awake...");
    await this.wakeLock.start();
    this.ui.setLoading(70, "Loading vehicle model...");

    try {
      const modelResult = await modelTask;
      if (!modelResult.ok) {
        throw modelResult.error;
      }
    } catch (error) {
      this.health.report("detector.model", {
        state: HEALTH_STATES.UNSAFE,
        title: "Detector unavailable",
        detail: "Vehicle detector model failed to load.",
        subsystem: "detector",
        error,
      });
      this.ui.showFatalError({
        eyebrow: "Detector unavailable",
        title: "Vehicle detection could not start.",
        message:
          error?.message ||
          "Check the network connection and reload before relying on this app.",
      });
      return;
    }

    this.renderSettingsPanel(this.detector.snapshot);
    this.ui.setLoading(
      100,
      this.health.getSnapshot().state === HEALTH_STATES.READY
        ? "Ready to ride."
        : "Ready with safety warnings.",
    );
    this.ui.hideLoading();

    this.running = true;
    this.startedAt = performance.now();
    window.requestAnimationFrame(this.loop);
  }
}

const app = new SurronShieldApp();
app.init();
