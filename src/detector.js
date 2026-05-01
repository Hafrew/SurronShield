import {
  DETECTION_LIMIT,
  DISTANCE_ESTIMATION,
  FALLBACK_RISK_PROFILES,
  INFERENCE,
  MODEL_BASE,
  MODEL_LABELS,
  RANGE_FILTER,
  SCORE_THRESHOLD_BY_CLASS,
  TRACKING,
  VEHICLE_CLASSES,
  VEHICLE_DIMENSIONS_METERS,
} from "./config.js";
import {
  DEFAULT_SETTINGS,
  metersToCarLengths,
  normalizeSettings,
} from "./preferences.js";

const MAX_CONSECUTIVE_INFERENCE_ERRORS = 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function intersectionOverUnion(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];

  const overlapX1 = Math.max(a[0], b[0]);
  const overlapY1 = Math.max(a[1], b[1]);
  const overlapX2 = Math.min(ax2, bx2);
  const overlapY2 = Math.min(ay2, by2);

  const overlapWidth = Math.max(0, overlapX2 - overlapX1);
  const overlapHeight = Math.max(0, overlapY2 - overlapY1);
  const overlapArea = overlapWidth * overlapHeight;

  const areaA = a[2] * a[3];
  const areaB = b[2] * b[3];
  const union = areaA + areaB - overlapArea;

  return union > 0 ? overlapArea / union : 0;
}

function getBoxCenter(bbox) {
  return {
    x: bbox[0] + bbox[2] / 2,
    y: bbox[1] + bbox[3] / 2,
  };
}

function getBoxArea(bbox) {
  return Math.max(1, bbox[2] * bbox[3]);
}

function getBoxDiagonal(bbox) {
  return Math.hypot(Math.max(1, bbox[2]), Math.max(1, bbox[3]));
}

function predictBox(track, now) {
  const velocity = track.velocity ?? [0, 0, 0, 0];
  const dt = clamp(
    (now - (track.motionAt ?? track.seenAt ?? now)) / 1000,
    0,
    TRACKING.predictionMaxDtSeconds,
  );

  return [
    track.bbox[0] + velocity[0] * dt,
    track.bbox[1] + velocity[1] * dt,
    Math.max(1, track.bbox[2] + velocity[2] * dt),
    Math.max(1, track.bbox[3] + velocity[3] * dt),
  ];
}

function scoreTrackMatch(track, detection) {
  const predicted = track.predictedBbox ?? track.bbox;
  const iou = intersectionOverUnion(predicted, detection.bbox);
  const predictedCenter = getBoxCenter(predicted);
  const detectionCenter = getBoxCenter(detection.bbox);
  const centerDistance = Math.hypot(
    predictedCenter.x - detectionCenter.x,
    predictedCenter.y - detectionCenter.y,
  );
  const centerScale = Math.max(getBoxDiagonal(predicted), getBoxDiagonal(detection.bbox));
  const centerDistanceRatio = centerDistance / centerScale;
  const centerScore = 1 - clamp(
    centerDistanceRatio / TRACKING.centerDistanceGate,
    0,
    1,
  );
  const sizeRatio =
    Math.min(getBoxArea(predicted), getBoxArea(detection.bbox)) /
    Math.max(getBoxArea(predicted), getBoxArea(detection.bbox));

  if (
    iou < TRACKING.trackIouThreshold &&
    (centerDistanceRatio > TRACKING.centerDistanceGate ||
      sizeRatio < TRACKING.sizeRatioGate)
  ) {
    return 0;
  }

  return iou * 0.54 + centerScore * 0.32 + sizeRatio * 0.14;
}

function getZoneSeverity(zone) {
  if (zone === "CLOSE") {
    return 3;
  }

  if (zone === "MEDIUM") {
    return 2;
  }

  if (zone === "FAR") {
    return 1;
  }

  return 0;
}

function toDisplayLabel(className) {
  if (className === "motorcycle") {
    return "Motorcycle";
  }

  return className.charAt(0).toUpperCase() + className.slice(1);
}

export class DetectorError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "DetectorError";
    this.code = code;
    this.cause = cause;
  }
}

export class VehicleDetector {
  constructor(video, { onStatus } = {}) {
    this.video = video;
    this.onStatus = onStatus;
    this.model = null;
    this.modelBase = MODEL_BASE;
    this.modelLabel = MODEL_LABELS[MODEL_BASE];
    this.modelPromise = null;
    this.backend = "Pending";
    this.mode = "front";
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    this.inferenceInFlight = false;
    this.nextInferenceAt = 0;
    this.avgInferenceMs = INFERENCE.startingIntervalMs;
    this.snapshot = this.createEmptySnapshot();
    this.tracks = [];
    this.nextTrackId = 1;
    this.consecutiveInferenceErrors = 0;
    this.lastSuccessfulInferenceAt = 0;
    this.lastStatusKey = "";
    this.workCanvas = document.createElement("canvas");
    this.workCtx = this.workCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
  }

  createEmptySnapshot() {
    return {
      zone: "CLEAR",
      vehicles: [],
      primary: null,
      count: 0,
      risk: 0,
      latencyMs: 0,
      inferenceSize: "--",
      modelLabel: this.modelLabel,
      backend: this.backend,
      thresholds: this.getModeThresholds(),
      updatedAt: 0,
      stale: true,
    };
  }

  setSettings(settings) {
    this.settings = normalizeSettings(settings);
    this.snapshot = {
      ...this.snapshot,
      thresholds: this.getModeThresholds(),
    };
  }

  getModeThresholds() {
    return this.settings.distanceTuning[this.mode];
  }

  async configureBackend() {
    if (!window.tf) {
      throw new DetectorError(
        "TF_UNAVAILABLE",
        "TensorFlow.js did not load.",
      );
    }

    const failures = [];
    let selectedBackend = null;

    for (const backend of ["webgl", "cpu"]) {
      try {
        const success = await tf.setBackend(backend);
        if (success) {
          selectedBackend = backend;
          break;
        }
        failures.push({
          backend,
          error: new DetectorError(
            "TF_BACKEND_REJECTED",
            `${backend} backend was rejected by TensorFlow.js.`,
          ),
        });
      } catch (error) {
        failures.push({ backend, error });
      }
    }

    if (!selectedBackend) {
      throw new DetectorError(
        "TF_BACKEND_UNAVAILABLE",
        "No TensorFlow.js backend could start.",
        failures[0]?.error,
      );
    }

    await tf.ready();
    this.backend = (tf.getBackend && tf.getBackend()) || "Ready";

    if (failures.length > 0 && selectedBackend === "cpu") {
      this.emitStatus("backend-fallback", {
        state: "degraded",
        message: "WebGL unavailable; detector is running on CPU.",
        error: failures[0].error,
      });
    } else {
      this.emitStatus("backend-ready", {
        state: "ready",
        message: `Detector backend ready: ${this.backend}.`,
      });
    }
  }

  async loadModel() {
    if (this.model) {
      return {
        label: this.modelLabel,
        base: this.modelBase,
        backend: this.backend,
      };
    }

    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        await this.configureBackend();

        const loader = window.cocoSsd;
        if (!loader) {
          throw new DetectorError(
            "MODEL_LIBRARY_UNAVAILABLE",
            "COCO-SSD model library did not load.",
          );
        }

        try {
          this.modelBase = MODEL_BASE;
          this.model = await loader.load({ base: MODEL_BASE });
        } catch (error) {
          this.emitStatus("model-fallback", {
            state: "degraded",
            message: "Primary detector model failed; loading lighter fallback model.",
            error,
          });

          this.modelBase = "lite_mobilenet_v2";

          try {
            this.model = await loader.load({ base: this.modelBase });
          } catch (fallbackError) {
            this.emitStatus("model-failed", {
              state: "unsafe",
              message: "Vehicle detector model failed to load.",
              error: fallbackError,
            });
            throw new DetectorError(
              "MODEL_LOAD_FAILED",
              "Vehicle detector model failed to load.",
              fallbackError,
            );
          }
        }

        this.modelLabel = MODEL_LABELS[this.modelBase] ?? this.modelBase;
        this.snapshot = {
          ...this.snapshot,
          modelLabel: this.modelLabel,
          backend: this.backend,
        };

        this.emitStatus("model-ready", {
          state: "ready",
          message: `Vehicle detector ready: ${this.modelLabel}.`,
        });

        return {
          label: this.modelLabel,
          base: this.modelBase,
          backend: this.backend,
        };
      })();
    }

    return this.modelPromise;
  }

  setMode(mode) {
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.resetTracks();
  }

  resetTracks() {
    this.tracks = [];
    this.snapshot = {
      ...this.createEmptySnapshot(),
      modelLabel: this.modelLabel,
      backend: this.backend,
    };
    this.lastSuccessfulInferenceAt = 0;
  }

  tick(now) {
    if (this.shouldInfer(now)) {
      void this.runInference();
    }

    return {
      ...this.snapshot,
      thresholds: this.getModeThresholds(),
      modelLabel: this.modelLabel,
      backend: this.backend,
    };
  }

  shouldInfer(now) {
    return (
      this.model &&
      !this.inferenceInFlight &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      now >= this.nextInferenceAt
    );
  }

  prepareInput() {
    const videoWidth = this.video.videoWidth || 1;
    const videoHeight = this.video.videoHeight || 1;
    const scale = Math.min(1, INFERENCE.maxSide / Math.max(videoWidth, videoHeight));
    const targetWidth = Math.max(256, Math.round(videoWidth * scale));
    const targetHeight = Math.max(256, Math.round(videoHeight * scale));

    if (
      this.workCanvas.width !== targetWidth ||
      this.workCanvas.height !== targetHeight
    ) {
      this.workCanvas.width = targetWidth;
      this.workCanvas.height = targetHeight;
    }

    this.workCtx.drawImage(this.video, 0, 0, targetWidth, targetHeight);

    return { targetWidth, targetHeight };
  }

  async runInference() {
    this.inferenceInFlight = true;
    const startedAt = performance.now();

    try {
      const input = this.prepareInput();
      const predictions = await this.model.detect(this.workCanvas, DETECTION_LIMIT);
      const normalized = this.normalizeDetections(predictions, input);
      const tracked = this.trackDetections(normalized, performance.now())
        .sort((a, b) => {
          const aDistance = a.distanceMeters ?? Number.POSITIVE_INFINITY;
          const bDistance = b.distanceMeters ?? Number.POSITIVE_INFINITY;
          if (aDistance !== bDistance) {
            return aDistance - bDistance;
          }

          return b.risk - a.risk;
        })
        .slice(0, DETECTION_LIMIT);

      const primary = tracked[0] ?? null;
      const zone = primary?.zone ?? "CLEAR";
      const latencyMs = Math.round(performance.now() - startedAt);
      const completedAt = performance.now();

      this.snapshot = {
        zone,
        vehicles: tracked.slice(0, 5),
        primary,
        count: tracked.length,
        risk: primary?.risk ?? 0,
        latencyMs,
        inferenceSize: `${input.targetWidth}x${input.targetHeight}`,
        modelLabel: this.modelLabel,
        backend: this.backend,
        thresholds: this.getModeThresholds(),
        updatedAt: completedAt,
        stale: false,
      };
      this.consecutiveInferenceErrors = 0;
      this.lastSuccessfulInferenceAt = completedAt;
      this.emitStatus("inference-ready", {
        state: "ready",
        message: "Detector inference healthy.",
      });
    } catch (error) {
      this.consecutiveInferenceErrors += 1;
      this.snapshot = {
        ...this.snapshot,
        stale: true,
      };

      this.emitStatus("inference-error", {
        state:
          this.consecutiveInferenceErrors >= MAX_CONSECUTIVE_INFERENCE_ERRORS
            ? "unsafe"
            : "degraded",
        message:
          this.consecutiveInferenceErrors >= MAX_CONSECUTIVE_INFERENCE_ERRORS
            ? "Detector inference is repeatedly failing."
            : "Detector inference failed; using last known state.",
        error,
      });
    } finally {
      const duration = performance.now() - startedAt;
      this.avgInferenceMs = lerp(this.avgInferenceMs, duration, 0.28);
      this.nextInferenceAt =
        performance.now() +
        clamp(
          this.avgInferenceMs * INFERENCE.intervalMultiplier,
          INFERENCE.minIntervalMs,
          INFERENCE.maxIntervalMs,
        );
      this.inferenceInFlight = false;
    }
  }

  normalizeDetections(predictions, input) {
    const scaleX = (this.video.videoWidth || 1) / input.targetWidth;
    const scaleY = (this.video.videoHeight || 1) / input.targetHeight;

    return predictions
      .map((prediction) => ({
        class: prediction.class,
        label: toDisplayLabel(prediction.class),
        score: prediction.score,
        bbox: [
          prediction.bbox[0] * scaleX,
          prediction.bbox[1] * scaleY,
          prediction.bbox[2] * scaleX,
          prediction.bbox[3] * scaleY,
        ],
      }))
      .filter((prediction) => this.isUsefulPrediction(prediction));
  }

  isUsefulPrediction(prediction) {
    if (!VEHICLE_CLASSES.has(prediction.class)) {
      return false;
    }

    const threshold = SCORE_THRESHOLD_BY_CLASS[prediction.class] ?? 0.45;
    if (prediction.score < threshold) {
      return false;
    }

    const frameArea = (this.video.videoWidth || 1) * (this.video.videoHeight || 1);
    const boxWidth = prediction.bbox[2];
    const boxHeight = prediction.bbox[3];
    const aspectRatio = boxWidth / Math.max(boxHeight, 1);
    const areaRatio = (boxWidth * boxHeight) / frameArea;

    if (areaRatio < TRACKING.minAreaRatio) {
      return false;
    }

    if (Math.min(boxWidth, boxHeight) < TRACKING.minShortSidePx) {
      return false;
    }

    if (prediction.class === "motorcycle" || prediction.class === "bicycle") {
      return aspectRatio > 0.24 && aspectRatio < 4.2;
    }

    return aspectRatio > 0.45 && aspectRatio < 5.6;
  }

  trackDetections(detections, now) {
    const activeTracks = this.tracks.filter(
      (track) => now - track.seenAt <= TRACKING.trackTtlMs,
    ).map((track) => ({
      ...track,
      predictedBbox: predictBox(track, now),
    }));
    const usedTrackIds = new Set();
    const updatedTracks = [];

    for (const detection of detections.sort((a, b) => b.score - a.score)) {
      let bestTrack = null;
      let bestScore = TRACKING.minAssociationScore;

      for (const track of activeTracks) {
        if (usedTrackIds.has(track.id) || track.class !== detection.class) {
          continue;
        }

        const score = scoreTrackMatch(track, detection);
        if (score > bestScore) {
          bestScore = score;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        const dt = Math.max((now - (bestTrack.seenAt ?? now)) / 1000, 0.001);
        const rawVelocity = detection.bbox.map(
          (value, index) => (value - bestTrack.bbox[index]) / dt,
        );

        bestTrack.velocity = (bestTrack.velocity ?? [0, 0, 0, 0]).map(
          (value, index) =>
            lerp(value, rawVelocity[index], TRACKING.velocitySmoothingAlpha),
        );
        bestTrack.bbox = (bestTrack.predictedBbox ?? bestTrack.bbox).map(
          (value, index) => lerp(value, detection.bbox[index], TRACKING.smoothingAlpha),
        );
        bestTrack.score = lerp(bestTrack.score, detection.score, 0.5);
        bestTrack.seenAt = now;
        bestTrack.motionAt = now;
        bestTrack.label = detection.label;
        bestTrack.hits = (bestTrack.hits ?? 0) + 1;
        bestTrack.misses = 0;
        bestTrack.matchScore = bestScore;
        usedTrackIds.add(bestTrack.id);
        updatedTracks.push(bestTrack);
      } else {
        updatedTracks.push({
          id: this.nextTrackId++,
          class: detection.class,
          label: detection.label,
          bbox: [...detection.bbox],
          predictedBbox: [...detection.bbox],
          velocity: [0, 0, 0, 0],
          score: detection.score,
          seenAt: now,
          motionAt: now,
          hits: 1,
          misses: 0,
        });
      }
    }

    const retainedTracks = activeTracks
      .filter(
        (track) =>
          !usedTrackIds.has(track.id) && now - track.seenAt <= TRACKING.holdTtlMs,
      )
      .map((track) => ({
        ...track,
        bbox: track.predictedBbox ?? track.bbox,
        score: track.score * TRACKING.retainedScoreDecay,
        misses: (track.misses ?? 0) + 1,
        motionAt: now,
      }));

    this.tracks = [...updatedTracks, ...retainedTracks];

    return this.tracks.map((track) => this.computeMetrics(track, now));
  }

  getFallbackRisk(track, frameWidth, frameHeight) {
    const [x, y, width, height] = track.bbox;
    const areaRatio = (width * height) / (frameWidth * frameHeight);
    const bottomRatio = clamp((y + height) / frameHeight, 0, 1);
    const centerRatio = clamp((x + width / 2) / frameWidth, 0, 1);
    const centerBias = 1 - clamp(Math.abs(centerRatio - 0.5) / 0.5, 0, 1);
    const threshold = SCORE_THRESHOLD_BY_CLASS[track.class] ?? 0.45;
    const confidenceScore = clamp((track.score - threshold) / (1 - threshold), 0, 1);
    const areaScore = clamp((areaRatio - 0.002) / 0.18, 0, 1);
    const bottomScore = clamp((bottomRatio - 0.35) / 0.65, 0, 1);

    const risk = clamp(
      areaScore * 0.52 +
        bottomScore * 0.22 +
        centerBias * 0.16 +
        confidenceScore * 0.1,
      0,
      1,
    );

    const thresholds = FALLBACK_RISK_PROFILES[this.mode];
    let zone = "CLEAR";

    if (risk >= thresholds.close) {
      zone = "CLOSE";
    } else if (risk >= thresholds.medium) {
      zone = "MEDIUM";
    } else if (risk >= thresholds.far) {
      zone = "FAR";
    }

    return { risk, zone, areaRatio, bottomRatio, centerBias };
  }

  getActiveCameraProfile() {
    return this.settings.calibration.cameraProfiles[this.mode];
  }

  getCalibrationConfidence(profile) {
    return profile.calibrated
      ? DISTANCE_ESTIMATION.calibratedConfidence
      : DISTANCE_ESTIMATION.estimatedConfidence;
  }

  getCameraFocalLengths(frameWidth, frameHeight, profile = this.getActiveCameraProfile()) {
    const horizontalFovRadians =
      (profile.horizontalFovDegrees * Math.PI) / 180;
    const focalLengthX = frameWidth / (2 * Math.tan(horizontalFovRadians / 2));
    const verticalFovRadians =
      2 * Math.atan((frameHeight / frameWidth) * Math.tan(horizontalFovRadians / 2));
    const focalLengthY = frameHeight / (2 * Math.tan(verticalFovRadians / 2));

    return {
      focalLengthX,
      focalLengthY,
    };
  }

  estimateRange(track, frameWidth, frameHeight) {
    const dimensions = VEHICLE_DIMENSIONS_METERS[track.class] ?? VEHICLE_DIMENSIONS_METERS.car;
    const cameraProfile = this.getActiveCameraProfile();
    const { focalLengthX, focalLengthY } = this.getCameraFocalLengths(
      frameWidth,
      frameHeight,
      cameraProfile,
    );
    const boxWidth = Math.max(track.bbox[2], 1);
    const boxHeight = Math.max(track.bbox[3], 1);
    const widthEstimate = (dimensions.width * focalLengthX) / boxWidth;
    const heightEstimate = (dimensions.height * focalLengthY) / boxHeight;
    const widthWeight =
      track.class === "car" || track.class === "truck" || track.class === "bus"
        ? 0.65
        : 0.45;

    const distanceMeters =
      widthEstimate * widthWeight + heightEstimate * (1 - widthWeight);

    return {
      rawDistanceMeters: clamp(
        distanceMeters,
        DISTANCE_ESTIMATION.minDistanceMeters,
        DISTANCE_ESTIMATION.maxDistanceMeters,
      ),
      calibrationConfidence: this.getCalibrationConfidence(cameraProfile),
      calibrationSource: cameraProfile.calibrated ? "tuned" : "estimated",
      horizontalFovDegrees: cameraProfile.horizontalFovDegrees,
    };
  }

  zoneCandidateFromDistance(distanceMeters, previousZone) {
    const thresholds = this.getModeThresholds();

    if (
      previousZone === "CLOSE" &&
      distanceMeters <= thresholds.dangerMeters + RANGE_FILTER.dangerExitMarginMeters
    ) {
      return "CLOSE";
    }

    if (distanceMeters <= thresholds.dangerMeters) {
      return "CLOSE";
    }

    if (
      previousZone === "MEDIUM" &&
      distanceMeters <= thresholds.warningMeters + RANGE_FILTER.warningExitMarginMeters
    ) {
      return "MEDIUM";
    }

    if (distanceMeters <= thresholds.warningMeters) {
      return "MEDIUM";
    }

    return "FAR";
  }

  applyZoneHysteresis(track, candidateZone, now) {
    const currentZone = track.zone ?? candidateZone;
    const currentSeverity = getZoneSeverity(currentZone);
    const candidateSeverity = getZoneSeverity(candidateZone);

    if (candidateSeverity >= currentSeverity) {
      track.pendingZone = null;
      track.pendingZoneSince = 0;
      return candidateZone;
    }

    if (track.pendingZone !== candidateZone) {
      track.pendingZone = candidateZone;
      track.pendingZoneSince = now;
      return currentZone;
    }

    if (now - track.pendingZoneSince >= RANGE_FILTER.downgradeHoldMs) {
      track.pendingZone = null;
      track.pendingZoneSince = 0;
      return candidateZone;
    }

    return currentZone;
  }

  riskFromDistance(distanceMeters) {
    const thresholds = this.getModeThresholds();

    if (distanceMeters <= thresholds.dangerMeters) {
      const intensity = 1 - distanceMeters / thresholds.dangerMeters;
      return clamp(0.76 + intensity * 0.24, 0.76, 1);
    }

    if (distanceMeters <= thresholds.warningMeters) {
      const span = Math.max(thresholds.warningMeters - thresholds.dangerMeters, 0.5);
      const intensity = 1 - (distanceMeters - thresholds.dangerMeters) / span;
      return clamp(0.42 + intensity * 0.3, 0.42, 0.75);
    }

    return clamp(0.14 + thresholds.warningMeters / (distanceMeters * 4), 0.14, 0.38);
  }

  updateRangeFilter(track, rawDistanceMeters, calibrationConfidence, now) {
    const previousDistance = track.distanceMeters;
    const previousVelocity = track.distanceVelocityMps ?? 0;
    const previousAt = track.distanceUpdatedAt ?? now;
    const dt = clamp(
      (now - previousAt) / 1000,
      0.001,
      TRACKING.predictionMaxDtSeconds,
    );
    const calibrated = calibrationConfidence >= DISTANCE_ESTIMATION.calibratedConfidence;
    const baseUncertainty =
      rawDistanceMeters *
      (calibrated
        ? RANGE_FILTER.calibratedUncertaintyRatio
        : RANGE_FILTER.estimatedUncertaintyRatio);

    if (!Number.isFinite(previousDistance)) {
      track.rawDistanceMeters = rawDistanceMeters;
      track.distanceMeters = rawDistanceMeters;
      track.distanceVelocityMps = 0;
      track.closingSpeedMps = 0;
      track.distanceUncertaintyMeters = baseUncertainty;
      track.distanceConfidence = clamp(calibrationConfidence, 0.2, 0.95);
      track.distanceUpdatedAt = now;
      return track;
    }

    const predictedDistance = clamp(
      previousDistance + previousVelocity * dt,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
    const residual = rawDistanceMeters - predictedDistance;
    const alpha = clamp(
      RANGE_FILTER.distanceAlphaMin +
        Math.abs(residual) * RANGE_FILTER.distanceResidualScale,
      RANGE_FILTER.distanceAlphaMin,
      RANGE_FILTER.distanceAlphaMax,
    );
    const smoothedDistance = clamp(
      predictedDistance + residual * alpha,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
    const rawVelocity = (smoothedDistance - previousDistance) / dt;
    const velocity = lerp(previousVelocity, rawVelocity, RANGE_FILTER.velocityAlpha);
    const nextUncertainty =
      baseUncertainty + Math.abs(residual) * RANGE_FILTER.residualUncertaintyWeight;
    const uncertainty = lerp(
      track.distanceUncertaintyMeters ?? nextUncertainty,
      nextUncertainty,
      RANGE_FILTER.uncertaintyAlpha,
    );
    const confidencePenalty = clamp(
      (uncertainty / Math.max(smoothedDistance, 1)) * 0.72,
      0,
      0.5,
    );

    track.rawDistanceMeters = rawDistanceMeters;
    track.distanceMeters = smoothedDistance;
    track.distanceVelocityMps = velocity;
    track.closingSpeedMps = Math.max(0, -velocity);
    track.distanceUncertaintyMeters = uncertainty;
    track.distanceConfidence = clamp(
      calibrationConfidence - confidencePenalty,
      0.2,
      0.95,
    );
    track.distanceUpdatedAt = now;
    return track;
  }

  computeMetrics(track, now) {
    const frameWidth = this.video.videoWidth || 1;
    const frameHeight = this.video.videoHeight || 1;
    const fallback = this.getFallbackRisk(track, frameWidth, frameHeight);
    const range = this.estimateRange(track, frameWidth, frameHeight);
    this.updateRangeFilter(
      track,
      range.rawDistanceMeters,
      range.calibrationConfidence,
      now,
    );

    const effectiveDistanceMeters = clamp(
      track.distanceMeters -
        track.distanceUncertaintyMeters * RANGE_FILTER.conservativeUncertaintyWeight,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
    const distanceCarLengths = metersToCarLengths(track.distanceMeters, this.settings);
    const candidateZone = Number.isFinite(track.distanceMeters)
      ? this.zoneCandidateFromDistance(effectiveDistanceMeters, track.zone)
      : fallback.zone;
    const zone = Number.isFinite(track.distanceMeters)
      ? this.applyZoneHysteresis(track, candidateZone, now)
      : fallback.zone;
    const risk = Number.isFinite(track.distanceMeters)
      ? this.riskFromDistance(effectiveDistanceMeters)
      : fallback.risk;

    Object.assign(track, {
      ...fallback,
      rawDistanceMeters: range.rawDistanceMeters,
      distanceMeters: track.distanceMeters,
      distanceCarLengths,
      effectiveDistanceMeters,
      distanceVelocityMps: track.distanceVelocityMps,
      closingSpeedMps: track.closingSpeedMps,
      distanceUncertaintyMeters: track.distanceUncertaintyMeters,
      distanceConfidence: track.distanceConfidence,
      calibrationSource: range.calibrationSource,
      horizontalFovDegrees: range.horizontalFovDegrees,
      risk,
      zone,
    });

    return { ...track };
  }

  emitStatus(code, { state, message, error = null }) {
    const key = `${code}|${state}|${message}|${error?.message || error?.name || ""}`;
    if (key === this.lastStatusKey) {
      return;
    }

    this.lastStatusKey = key;
    this.onStatus?.({
      code,
      state,
      message,
      error,
      consecutiveInferenceErrors: this.consecutiveInferenceErrors,
      lastSuccessfulInferenceAt: this.lastSuccessfulInferenceAt,
      updatedAt: performance.now(),
    });
  }
}
