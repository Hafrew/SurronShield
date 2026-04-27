import { CAMERA_MODES } from "./config.js";
import { CameraController } from "./camera.js";
import { VehicleDetector } from "./detector.js";
import { FeedbackController } from "./feedback.js";
import { OverlayRenderer } from "./overlay.js";
import {
  loadSettings,
  saveSettings,
  updateCalibrationSetting,
  updateDistanceSetting,
} from "./preferences.js";
import { SettingsPanelController } from "./settings-panel.js";
import { HudController } from "./ui.js";

class SurronShieldApp {
  constructor() {
    this.video = document.getElementById("video");
    this.overlayCanvas = document.getElementById("overlay");
    this.retryButton = document.getElementById("retry-button");
    this.frontModeButton = document.getElementById("front-mode-button");
    this.rearModeButton = document.getElementById("rear-mode-button");
    this.settingsButton = document.getElementById("settings-button");
    this.soundButton = document.getElementById("sound-button");
    this.hapticsButton = document.getElementById("haptics-button");

    this.ui = new HudController();
    this.settingsPanel = new SettingsPanelController();
    this.camera = new CameraController(this.video);
    this.detector = new VehicleDetector(this.video);
    this.feedback = new FeedbackController();
    this.overlay = new OverlayRenderer(this.video, this.overlayCanvas);

    this.settings = loadSettings();
    this.mode = this.settings.activeMode;
    this.detector.setSettings(this.settings);

    this.running = false;
    this.switching = false;
    this.settingsOpen = false;
    this.fpsFrames = 0;
    this.fpsLastAt = performance.now();
    this.fps = 0;
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

    this.settingsPanel.bind({
      onClose: () => this.setSettingsOpen(false),
      onThresholdChange: (mode, key, value) => {
        this.settings = updateDistanceSetting(this.settings, mode, key, value);
        saveSettings(this.settings);
        this.applySettings();
      },
      onCarLengthChange: (key, value) => {
        this.settings = updateCalibrationSetting(this.settings, key, value);
        saveSettings(this.settings);
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
    this.renderSettingsPanel(this.detector.snapshot);
  }

  applyModeState() {
    const meta = CAMERA_MODES[this.mode];
    this.video.classList.toggle("mirrored", meta.mirrored);
    this.overlayCanvas.classList.toggle("mirrored", meta.mirrored);
    this.ui.setMode(this.mode);
    this.detector.setMode(this.mode);
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
      saveSettings(this.settings);
      this.applyModeState();
      this.renderSettingsPanel(this.detector.snapshot);
      this.ui.hideLoading();
    } catch (error) {
      console.warn("Camera switch failed", error);
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
    this.overlay.render(snapshot);
    this.ui.update(snapshot, {
      mode: this.mode,
      fps: this.updateFps(now),
    });
    this.feedback.handleZone(snapshot.zone);

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
    this.ui.setSettingsOpen(false);

    this.ui.setLoading(18, "Preparing detector...");
    const modelTask = this.detector.loadModel();

    this.ui.setLoading(38, "Starting camera...");
    try {
      await this.camera.start(this.mode);
    } catch (error) {
      console.warn("Camera start failed", error);
      this.ui.showPermissionError();
      return;
    }

    this.video.classList.add("live");
    this.applyModeState();
    this.ui.setLoading(70, "Loading vehicle model...");

    try {
      await modelTask;
    } catch (error) {
      console.warn("Model load failed", error);
      this.ui.setLoading(100, "Model failed to load. Check connection.");
      return;
    }

    this.renderSettingsPanel(this.detector.snapshot);
    this.ui.setLoading(100, "Ready to ride.");
    this.ui.hideLoading();

    this.running = true;
    window.requestAnimationFrame(this.loop);
  }
}

const app = new SurronShieldApp();
app.init();
