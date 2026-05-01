export const WAKE_LOCK_STATES = {
  INACTIVE: "inactive",
  ACTIVE: "active",
  UNSUPPORTED: "unsupported",
  PENDING: "pending",
  RELEASED: "released",
  DENIED: "denied",
};

function getErrorMessage(error) {
  return error?.message || error?.name || "Screen wake lock request failed.";
}

export class WakeLockController {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus;
    this.sentinel = null;
    this.enabled = false;
    this.reacquireTimer = null;
    this.status = {
      state: WAKE_LOCK_STATES.INACTIVE,
      supported: "wakeLock" in navigator,
      message: "Screen wake lock not requested.",
    };

    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleRelease = this.handleRelease.bind(this);
  }

  emit(state, message, error = null) {
    this.status = {
      state,
      supported: "wakeLock" in navigator,
      message,
      error,
      updatedAt: performance.now(),
    };

    this.onStatus?.(this.status);
    return this.status;
  }

  async start() {
    this.enabled = true;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    return this.acquire();
  }

  async acquire() {
    window.clearTimeout(this.reacquireTimer);
    this.reacquireTimer = null;

    if (!this.enabled) {
      return this.emit(WAKE_LOCK_STATES.INACTIVE, "Screen wake lock not requested.");
    }

    if (!("wakeLock" in navigator)) {
      return this.emit(
        WAKE_LOCK_STATES.UNSUPPORTED,
        "Screen wake lock is not supported in this browser.",
      );
    }

    if (document.visibilityState !== "visible") {
      return this.emit(
        WAKE_LOCK_STATES.PENDING,
        "Screen wake lock is waiting for the app to become visible.",
      );
    }

    if (this.sentinel && !this.sentinel.released) {
      return this.emit(WAKE_LOCK_STATES.ACTIVE, "Screen wake lock active.");
    }

    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", this.handleRelease, { once: true });
      return this.emit(WAKE_LOCK_STATES.ACTIVE, "Screen wake lock active.");
    } catch (error) {
      return this.emit(
        WAKE_LOCK_STATES.DENIED,
        getErrorMessage(error),
        error,
      );
    }
  }

  handleRelease() {
    this.sentinel = null;

    if (!this.enabled) {
      this.emit(WAKE_LOCK_STATES.INACTIVE, "Screen wake lock released.");
      return;
    }

    this.emit(
      WAKE_LOCK_STATES.RELEASED,
      "Screen wake lock was released by the browser.",
    );
    this.scheduleReacquire();
  }

  handleVisibilityChange() {
    if (!this.enabled) {
      return;
    }

    if (document.visibilityState === "visible") {
      this.scheduleReacquire(120);
    } else {
      this.emit(
        WAKE_LOCK_STATES.PENDING,
        "Screen wake lock paused while the app is hidden.",
      );
    }
  }

  scheduleReacquire(delayMs = 600) {
    if (this.reacquireTimer || document.visibilityState !== "visible") {
      return;
    }

    this.reacquireTimer = window.setTimeout(() => {
      void this.acquire();
    }, delayMs);
  }

  stop() {
    this.enabled = false;
    window.clearTimeout(this.reacquireTimer);
    this.reacquireTimer = null;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);

    if (this.sentinel) {
      const sentinel = this.sentinel;
      this.sentinel = null;
      void sentinel.release?.();
    }

    return this.emit(WAKE_LOCK_STATES.INACTIVE, "Screen wake lock stopped.");
  }
}
