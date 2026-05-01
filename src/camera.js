import { CAMERA_CONSTRAINTS, CAMERA_MODES } from "./config.js";

const METADATA_TIMEOUT_MS = 3500;
const STALE_FRAME_MS = 1500;
const WATCHDOG_INTERVAL_MS = 500;

export class CameraError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "CameraError";
    this.code = code;
    this.cause = cause;
  }
}

export class CameraController {
  constructor(video, { onStatus } = {}) {
    this.video = video;
    this.onStatus = onStatus;
    this.stream = null;
    this.mode = "front";
    this.status = "stopped";
    this.statusMessage = "";
    this.lastFrameAt = 0;
    this.lastVideoTime = 0;
    this.watchdogTimer = null;
    this.frameCallbackId = null;
    this.boundTrackHandlers = [];
  }

  async start(mode = "front") {
    const previousStream = this.stream;
    const previousMode = this.mode;
    this.emitStatus("starting", `Starting ${CAMERA_MODES[mode].label} camera.`);

    let nextStream = null;

    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: CAMERA_MODES[mode].facingMode },
          ...CAMERA_CONSTRAINTS,
        },
        audio: false,
      });

      this.unbindTrackHandlers();
      this.stream = nextStream;
      this.mode = mode;
      this.video.srcObject = nextStream;
      this.bindTrackHandlers(nextStream);
      await this.waitForMetadata();
      await this.playVideo();

      if (previousStream && previousStream !== nextStream) {
        previousStream.getTracks().forEach((track) => track.stop());
      }

      this.lastFrameAt = performance.now();
      this.lastVideoTime = this.video.currentTime;
      this.startFrameWatchdog();
      this.emitStatus("live", `${CAMERA_MODES[mode].label} camera live.`);
      return nextStream;
    } catch (error) {
      this.unbindTrackHandlers();

      if (nextStream) {
        nextStream.getTracks().forEach((track) => track.stop());
      }

      if (previousStream && this.hasLiveTrack(previousStream)) {
        this.stream = previousStream;
        this.mode = previousMode;
        this.video.srcObject = previousStream;
        this.bindTrackHandlers(previousStream);
        this.startFrameWatchdog();
        this.emitStatus("live", `${CAMERA_MODES[previousMode].label} camera still live.`);
      } else {
        this.stream = null;
        this.video.srcObject = null;
        this.stopFrameWatchdog();
        this.emitStatus("failed", "Camera failed to start.", error);
      }

      throw error instanceof CameraError
        ? error
        : new CameraError("CAMERA_START_FAILED", "Camera failed to start.", error);
    }
  }

  async waitForMetadata() {
    if (this.video.readyState >= 1 && this.video.videoWidth > 0) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(
          new CameraError(
            "CAMERA_METADATA_TIMEOUT",
            "Camera metadata did not become available in time.",
          ),
        );
      }, METADATA_TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timeout);
        this.video.removeEventListener("loadedmetadata", handleLoaded);
      };

      const handleLoaded = () => {
        cleanup();
        resolve();
      };

      this.video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    });
  }

  async playVideo() {
    try {
      await this.video.play();
    } catch (error) {
      throw new CameraError(
        "CAMERA_PLAY_FAILED",
        "Camera playback was blocked or failed.",
        error,
      );
    }
  }

  bindTrackHandlers(stream) {
    this.unbindTrackHandlers();

    for (const track of stream.getVideoTracks()) {
      const handleEnded = () => {
        this.emitStatus("ended", "Camera stream ended.");
      };
      const handleMute = () => {
        this.emitStatus("muted", "Camera stream is not delivering frames.");
      };
      const handleUnmute = () => {
        this.lastFrameAt = performance.now();
        this.emitStatus("live", "Camera stream resumed.");
      };

      track.addEventListener("ended", handleEnded);
      track.addEventListener("mute", handleMute);
      track.addEventListener("unmute", handleUnmute);

      this.boundTrackHandlers.push({ track, type: "ended", handler: handleEnded });
      this.boundTrackHandlers.push({ track, type: "mute", handler: handleMute });
      this.boundTrackHandlers.push({ track, type: "unmute", handler: handleUnmute });
    }
  }

  unbindTrackHandlers() {
    this.boundTrackHandlers.forEach(({ track, type, handler }) => {
      track.removeEventListener(type, handler);
    });
    this.boundTrackHandlers = [];
  }

  startFrameWatchdog() {
    this.stopFrameWatchdog();

    if ("requestVideoFrameCallback" in this.video) {
      this.scheduleVideoFrameCallback();
    }

    this.watchdogTimer = window.setInterval(() => {
      this.updateFrameHeartbeatFromVideoTime();
      this.checkFrameFreshness();
    }, WATCHDOG_INTERVAL_MS);
  }

  scheduleVideoFrameCallback() {
    if (!this.stream || !("requestVideoFrameCallback" in this.video)) {
      return;
    }

    this.frameCallbackId = this.video.requestVideoFrameCallback(() => {
      this.lastFrameAt = performance.now();
      this.lastVideoTime = this.video.currentTime;

      if (this.status === "stale" || this.status === "muted") {
        this.emitStatus("live", "Camera frames resumed.");
      }

      this.scheduleVideoFrameCallback();
    });
  }

  updateFrameHeartbeatFromVideoTime() {
    if ("requestVideoFrameCallback" in this.video) {
      return;
    }

    if (this.video.readyState < 2) {
      return;
    }

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      this.lastFrameAt = performance.now();

      if (this.status === "stale" || this.status === "muted") {
        this.emitStatus("live", "Camera frames resumed.");
      }
    }
  }

  checkFrameFreshness() {
    if (!this.stream || this.status === "ended" || this.status === "failed") {
      return;
    }

    const trackLive = this.hasLiveTrack(this.stream);
    if (!trackLive) {
      this.emitStatus("ended", "Camera track is no longer live.");
      return;
    }

    if (performance.now() - this.lastFrameAt > STALE_FRAME_MS) {
      this.emitStatus("stale", "Camera frames are stale.");
    }
  }

  stopFrameWatchdog() {
    if (this.watchdogTimer) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (
      this.frameCallbackId !== null &&
      "cancelVideoFrameCallback" in this.video
    ) {
      this.video.cancelVideoFrameCallback(this.frameCallbackId);
    }

    this.frameCallbackId = null;
  }

  hasLiveTrack(stream = this.stream) {
    return Boolean(
      stream?.getVideoTracks().some((track) => track.readyState === "live"),
    );
  }

  isLive() {
    return this.status === "live" && this.hasLiveTrack();
  }

  emitStatus(state, message, error = null) {
    if (state === this.status && message === this.statusMessage && !error) {
      return;
    }

    this.status = state;
    this.statusMessage = message;
    this.onStatus?.({
      state,
      mode: this.mode,
      message,
      error,
      lastFrameAt: this.lastFrameAt,
      updatedAt: performance.now(),
    });
  }

  stop() {
    if (!this.stream) {
      return;
    }

    this.stopFrameWatchdog();
    this.unbindTrackHandlers();
    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.emitStatus("stopped", "Camera stopped.");
  }
}
