import {
  DETECTION_LIMIT,
  DISTANCE_ESTIMATION,
  FALLBACK_RISK_PROFILES,
  INFERENCE,
  MODEL_BASE,
  MODEL_LABELS,
  SCORE_THRESHOLD_BY_CLASS,
  TRACKING,
  VEHICLE_CLASSES,
  VEHICLE_DIMENSIONS_METERS,
} from "./config.js";
import { DEFAULT_SETTINGS, metersToCarLengths, normalizeSettings } from "./preferences.js";

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

function toDisplayLabel(className) {
  if (className === "motorcycle") {
    return "Motorcycle";
  }

  return className.charAt(0).toUpperCase() + className.slice(1);
}

export class VehicleDetector {
  constructor(video) {
    this.video = video;
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
      return;
    }

    for (const backend of ["webgl", "cpu"]) {
      try {
        const success = await tf.setBackend(backend);
        if (success) {
          break;
        }
      } catch (error) {
        void error;
      }
    }

    await tf.ready();
    this.backend = (tf.getBackend && tf.getBackend()) || "Ready";
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

        try {
          this.modelBase = MODEL_BASE;
          this.model = await cocoSsd.load({ base: MODEL_BASE });
        } catch (error) {
          void error;
          this.modelBase = "lite_mobilenet_v2";
          this.model = await cocoSsd.load({ base: this.modelBase });
        }

        this.modelLabel = MODEL_LABELS[this.modelBase] ?? this.modelBase;
        this.snapshot = {
          ...this.snapshot,
          modelLabel: this.modelLabel,
          backend: this.backend,
        };

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
      };
    } catch (error) {
      console.warn("Detection error", error);
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
    );
    const usedTrackIds = new Set();
    const updatedTracks = [];

    for (const detection of detections.sort((a, b) => b.score - a.score)) {
      let bestTrack = null;
      let bestIou = TRACKING.trackIouThreshold;

      for (const track of activeTracks) {
        if (usedTrackIds.has(track.id) || track.class !== detection.class) {
          continue;
        }

        const iou = intersectionOverUnion(track.bbox, detection.bbox);
        if (iou > bestIou) {
          bestIou = iou;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        bestTrack.bbox = bestTrack.bbox.map((value, index) =>
          lerp(value, detection.bbox[index], TRACKING.smoothingAlpha),
        );
        bestTrack.score = lerp(bestTrack.score, detection.score, 0.5);
        bestTrack.seenAt = now;
        bestTrack.label = detection.label;
        usedTrackIds.add(bestTrack.id);
        updatedTracks.push(bestTrack);
      } else {
        updatedTracks.push({
          id: this.nextTrackId++,
          class: detection.class,
          label: detection.label,
          bbox: [...detection.bbox],
          score: detection.score,
          seenAt: now,
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
        score: track.score * TRACKING.retainedScoreDecay,
      }));

    this.tracks = [...updatedTracks, ...retainedTracks];

    return this.tracks.map((track) => ({
      ...track,
      ...this.computeMetrics(track),
    }));
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

  getCameraFocalLengths(frameWidth, frameHeight) {
    const horizontalFovRadians =
      (this.settings.calibration.horizontalFovDegrees * Math.PI) / 180;
    const focalLengthX = frameWidth / (2 * Math.tan(horizontalFovRadians / 2));
    const verticalFovRadians =
      2 * Math.atan((frameHeight / frameWidth) * Math.tan(horizontalFovRadians / 2));
    const focalLengthY = frameHeight / (2 * Math.tan(verticalFovRadians / 2));

    return {
      focalLengthX,
      focalLengthY,
    };
  }

  estimateDistanceMeters(track, frameWidth, frameHeight) {
    const dimensions = VEHICLE_DIMENSIONS_METERS[track.class] ?? VEHICLE_DIMENSIONS_METERS.car;
    const { focalLengthX, focalLengthY } = this.getCameraFocalLengths(
      frameWidth,
      frameHeight,
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

    return clamp(
      distanceMeters,
      DISTANCE_ESTIMATION.minDistanceMeters,
      DISTANCE_ESTIMATION.maxDistanceMeters,
    );
  }

  zoneFromDistance(distanceMeters) {
    const thresholds = this.getModeThresholds();

    if (distanceMeters <= thresholds.dangerMeters) {
      return "CLOSE";
    }

    if (distanceMeters <= thresholds.warningMeters) {
      return "MEDIUM";
    }

    return "FAR";
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

  computeMetrics(track) {
    const frameWidth = this.video.videoWidth || 1;
    const frameHeight = this.video.videoHeight || 1;
    const fallback = this.getFallbackRisk(track, frameWidth, frameHeight);
    const distanceMeters = this.estimateDistanceMeters(track, frameWidth, frameHeight);
    const distanceCarLengths = metersToCarLengths(distanceMeters, this.settings);
    const zone = Number.isFinite(distanceMeters)
      ? this.zoneFromDistance(distanceMeters)
      : fallback.zone;
    const risk = Number.isFinite(distanceMeters)
      ? this.riskFromDistance(distanceMeters)
      : fallback.risk;

    return {
      ...fallback,
      distanceMeters,
      distanceCarLengths,
      risk,
      zone,
    };
  }
}
