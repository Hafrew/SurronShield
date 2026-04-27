import { CAMERA_CONSTRAINTS, CAMERA_MODES } from "./config.js";

export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.mode = "front";
  }

  async start(mode = "front") {
    const previousStream = this.stream;
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: CAMERA_MODES[mode].facingMode },
        ...CAMERA_CONSTRAINTS,
      },
      audio: false,
    });

    this.stream = nextStream;
    this.mode = mode;
    this.video.srcObject = nextStream;
    await this.waitForMetadata();
    await this.video.play().catch(() => {});

    if (previousStream && previousStream !== nextStream) {
      previousStream.getTracks().forEach((track) => track.stop());
    }

    return nextStream;
  }

  async waitForMetadata() {
    if (this.video.readyState >= 1 && this.video.videoWidth > 0) {
      return;
    }

    await new Promise((resolve) => {
      const handleLoaded = () => resolve();
      this.video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    });
  }

  stop() {
    if (!this.stream) {
      return;
    }

    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
