# SurronShield Current Version vs April V3

This document compares the April V3 baseline with the current safety-upgrade version. The current version keeps the same mobile browser foundation, TensorFlow.js COCO-SSD model path, camera modes, distance display, bounding boxes, haptics, and audio feedback, while adding reliability supervision, recovery behavior, smoother range estimates, and stronger calibration controls.

## April V3 Baseline

| Category | April V3 Result |
| --- | --- |
| Loading time | 5s, 13s, 9s |
| Average loading time | 9.0s |
| Latency | 104ms, 108ms, 106ms |
| Average latency | 106ms |
| Model | MobileNet V2 with COCO-SSD, Lite fallback |
| UI readability | 8.5/10 |
| Accuracy | 92%, 89%, 89% |
| Average accuracy | 90% |
| Camera modes | Yes |
| Detection distance | Yes, with adjustment settings |
| Multiple cars | Yes |
| Bounding box scaling | Yes |
| Bounding box placement | Correctly placed on car |
| Haptic feedback | Yes |
| Sound | Yes |

## Current Version Observations

| Category | Current Version Result |
| --- | --- |
| Loading behavior | Consistent loading state within 5-7s across 3 noticed tests |
| Estimated average loading time | About 6s |
| Average latency | About 110ms |
| Latency change vs April V3 | +4ms average, roughly +3.8% |
| Model | MobileNet V2 with COCO-SSD, Lite fallback |
| Camera modes | Front and rear modes retained |
| Detection distance | Retained, now smoothed and uncertainty-aware |
| Multiple cars | Retained, with more stable tracking IDs |
| Bounding box scaling | Retained, now motion-predicted between frames |
| Haptic feedback | Retained, now reports unsupported/degraded state |
| Sound | Retained, now reports priming/playback failures |

Accuracy and UI readability were not re-scored in this comparison pass. They should be measured again during the final verification run after documentation and deployment are complete.

## New Features Added

### Reliability and Safety State

- Central app health supervisor with `READY`, `DEGRADED`, `RECOVERING`, and `UNSAFE` states.
- Persistent health banner for safety-critical warnings.
- Runtime faults, camera faults, detector faults, feedback faults, settings failures, and calibration limitations are now explicit.
- Stale or unsafe vision state blocks normal `CLEAR` presentation.

### Screen Wake Lock

- Screen wake-lock support using the browser Wake Lock API where available.
- Wake-lock reacquisition after visibility changes.
- Explicit degraded state when wake lock is unsupported, denied, pending, or released.

### Camera Disconnect and Recovery

- Camera startup now validates metadata and playback.
- Camera tracks are monitored for `ended`, `mute`, and `unmute`.
- Stale-frame watchdog detects when the stream stops delivering fresh frames.
- Automatic camera recovery with backoff.
- Repeated camera recovery failure escalates to `UNSAFE`.

### Error Visibility

- TensorFlow backend failures are reported.
- Model fallback is reported instead of silent.
- Repeated inference failures escalate from degraded to unsafe.
- Audio priming/playback failures are reported.
- Unsupported haptics are reported.
- Settings load/save failures are reported.

### Motion-Aware Tracking

- Track matching now uses predicted box position, IoU, center distance, and size ratio.
- Per-track velocity smoothing reduces ID resets.
- Tracks are briefly retained across missed detections.
- Multiple vehicles should remain more stable during motion and fast approach.

### Distance Smoothing

- Distance estimates are temporally smoothed per track.
- Distance velocity and closing speed are tracked.
- Range uncertainty and confidence are computed.
- Alert classification uses conservative effective distance when uncertainty is high.

### Zone Hysteresis

- Danger and warning zones escalate quickly.
- Downgrades are delayed briefly to reduce flicker.
- Exit margins prevent noisy threshold bouncing.
- Alerts should feel steadier and less noisy near threshold boundaries.

### Camera FOV Calibration

- Front and rear camera FOV profiles are now separate.
- FOV sliders are available in settings.
- Old single-FOV settings migrate automatically.
- Untuned profiles are treated as estimated and use wider safety margins.
- Tuned profiles show as tuned range in the HUD.

## Summary

The current version trades a small latency increase, from about 106ms to about 110ms, for significantly stronger real-time safety behavior. The biggest practical improvement is not raw detection speed; it is that the app now knows when it is reliable, degraded, recovering, or unsafe, and it no longer silently presents stale vision as normal riding awareness.

Loading behavior appears more consistent than April V3. April V3 ranged from 5s to 13s with a 9s average, while the current version has been observed staying within a 5-7s loading window across three noticed tests.
