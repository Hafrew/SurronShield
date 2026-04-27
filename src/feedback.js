import { AUDIO_PROFILES, FEEDBACK_INTERVALS, HAPTIC_PATTERNS } from "./config.js";

export class FeedbackController {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
    this.hapticsEnabled = typeof navigator.vibrate === "function";
    this.supportsHaptics = this.hapticsEnabled;
    this.lastZone = "CLEAR";
    this.lastAlertAt = 0;
    this.lastHapticAt = 0;
  }

  async prime() {
    if (!window.AudioContext && !window.webkitAudioContext) {
      return;
    }

    if (!this.audioCtx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextCtor();
    }

    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume().catch(() => {});
    }
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    if (!enabled) {
      this.lastAlertAt = 0;
    }
  }

  setHapticsEnabled(enabled) {
    this.hapticsEnabled = this.supportsHaptics && enabled;
    if (!enabled) {
      this.lastHapticAt = 0;
    }
  }

  handleZone(zone) {
    if (zone === "CLEAR") {
      this.lastZone = "CLEAR";
      return;
    }

    const now = performance.now();
    const zoneChanged = zone !== this.lastZone;
    const interval = FEEDBACK_INTERVALS[zone] ?? 2000;

    if (!zoneChanged && now - this.lastAlertAt < interval) {
      return;
    }

    if (this.soundEnabled) {
      this.playTone(zone);
    }

    if (this.hapticsEnabled && (zoneChanged || zone === "CLOSE")) {
      this.vibrate(zone, now);
    }

    this.lastAlertAt = now;
    this.lastZone = zone;
  }

  playTone(zone) {
    const profile = AUDIO_PROFILES[zone];
    if (!profile || !this.audioCtx) {
      return;
    }

    const oscillator = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    oscillator.type = profile.type;
    oscillator.frequency.value = profile.frequency;
    gain.gain.setValueAtTime(profile.gain, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + profile.duration);

    oscillator.connect(gain);
    gain.connect(this.audioCtx.destination);

    oscillator.start();
    oscillator.stop(this.audioCtx.currentTime + profile.duration);
  }

  vibrate(zone, now) {
    if (!this.supportsHaptics || now - this.lastHapticAt < 800) {
      return;
    }

    navigator.vibrate(HAPTIC_PATTERNS[zone] ?? HAPTIC_PATTERNS.FAR);
    this.lastHapticAt = now;
  }
}
