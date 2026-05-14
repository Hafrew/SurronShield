# BikSAFE Safety Reliability Upgrade

This version turns BikSAFE from a simple camera detection demo into a supervised riding-assist runtime. The core goal was to remove silent failure modes and make camera, detector, wake-lock, feedback, and calibration state explicit in the app.

## Reliability Runtime

- Added a central `ReliabilitySupervisor` with `READY`, `DEGRADED`, `RECOVERING`, and `UNSAFE` states.
- Added a persistent health banner so safety-critical failures are visible while riding.
- Runtime faults, model failures, inference failures, settings persistence failures, missing haptics, and audio startup failures now report through health state instead of disappearing into console-only warnings.
- When vision is recovering or unsafe, the HUD no longer presents normal `CLEAR` output from stale data.

## Screen Wake Lock

- Added a wake-lock controller that requests `navigator.wakeLock.request("screen")`.
- The controller tracks unsupported, denied, pending, released, and active states.
- Wake lock is reacquired when the document becomes visible again.
- If wake lock is unavailable, the app continues in degraded mode with an explicit warning because the screen may sleep.

## Camera Lifecycle

- Camera startup now fails explicitly when metadata or playback does not become available.
- Video tracks are monitored for `ended`, `mute`, and `unmute`.
- A frame watchdog detects stale camera frames using `requestVideoFrameCallback` when available, with a `currentTime` fallback.
- If the stream stalls or disconnects during ride mode, the app enters recovery and attempts camera restart with exponential backoff.
- After repeated recovery failure, the app moves to `UNSAFE`.

## Detector Reliability

- TensorFlow backend selection and model fallback are now visible health events.
- Missing TensorFlow.js or COCO-SSD libraries fail explicitly.
- Repeated inference failures escalate from degraded to unsafe.
- Detector snapshots carry freshness metadata so stale output can be blocked by the app runtime.

## Alert Channels

- Audio priming and playback failures now report degraded health.
- Unsupported vibration is explicitly surfaced as degraded haptic capability.
- Visual detection remains available when audio or haptics degrade.

## Safety Behavior

- Fail fast before ride mode for fatal camera/model failures.
- Fail soft during ride mode when recoverable components degrade.
- Never silently claim clear road state when the camera or detector is stale.
- Prefer conservative visual state over stale precision.
