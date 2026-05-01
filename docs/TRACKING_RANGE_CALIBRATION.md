# Tracking, Range, and Calibration Upgrade

This version improves the real-time stability of vehicle identity, distance estimates, and alert zones while keeping the browser runtime lightweight enough for mobile use.

## Motion-Aware Tracking

The previous tracker matched detections only by IoU. At riding speed, bounding boxes can move, resize, or briefly miss overlap between inference frames, causing IDs to reset.

The new tracker adds:

- Constant-velocity box prediction for each track.
- Association scoring from predicted IoU, center distance, and size ratio.
- Velocity smoothing for box position and scale.
- Short retained tracks for brief detection gaps.
- Track hit, miss, match-score, and velocity metadata.

This keeps object identity more stable without adding a heavy tracking dependency.

## Distance Smoothing

Single-frame distance estimates are noisy because detector boxes jitter with camera vibration, partial occlusion, and model variance.

The new range path adds:

- Raw distance from camera FOV and detected box size.
- Temporal distance filtering with prediction and residual-based alpha.
- Distance velocity and closing-speed estimates.
- Per-track uncertainty and confidence.
- Conservative effective distance for zone classification.

The HUD still shows the smoothed distance, while alert logic uses a more conservative effective distance when uncertainty is high.

## Zone Hysteresis

Warning and danger zones no longer switch directly on one-frame threshold crossings.

The new classifier:

- Escalates quickly into closer danger states.
- Holds downgrades for a short delay.
- Uses exit margins around danger and warning thresholds.
- Applies uncertainty margins so untuned distance does not appear overly precise.

This reduces flickering zones and noisy feedback without adding meaningful latency to danger escalation.

## Camera FOV Calibration

Distance accuracy depends heavily on the active camera lens and browser crop. This version replaces the old single hardcoded FOV value with per-mode camera profiles.

Settings now include:

- Front camera FOV.
- Rear camera FOV.
- Tuned versus estimated profile state.
- Legacy migration from the old single `horizontalFovDegrees` setting.

Untuned profiles are treated as estimated and use wider uncertainty margins. Once the rider adjusts a front or rear FOV slider, that profile is marked as tuned.

## Runtime Impact

- No external tracking or filtering libraries were added.
- Matching remains bounded by the existing detection limit.
- Range smoothing is per-track scalar math.
- Zone hysteresis uses timestamps and simple severity ordering.
- All new work runs inside the existing inference/update cadence.
