export const VEHICLE_CLASSES = new Set([
  "car",
  "truck",
  "bus",
  "motorcycle",
  "bicycle",
]);

export const CAMERA_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 60 },
};

export const CAMERA_MODES = {
  front: {
    label: "Front watch",
    shortLabel: "Front",
    zoneLabel: "Traffic ahead",
    directionLabel: "ahead",
    facingMode: "environment",
    mirrored: false,
  },
  rear: {
    label: "Rear mirror",
    shortLabel: "Rear",
    zoneLabel: "Traffic behind",
    directionLabel: "behind",
    facingMode: "user",
    mirrored: true,
  },
};

export const MODEL_BASE = "mobilenet_v2";

export const MODEL_LABELS = {
  mobilenet_v1: "COCO SSD V1",
  mobilenet_v2: "COCO SSD V2",
  lite_mobilenet_v2: "COCO SSD Lite",
};

export const SCORE_THRESHOLD_BY_CLASS = {
  car: 0.45,
  truck: 0.4,
  bus: 0.38,
  motorcycle: 0.42,
  bicycle: 0.46,
};

export const VEHICLE_DIMENSIONS_METERS = {
  car: { width: 1.82, height: 1.47 },
  truck: { width: 2.55, height: 3.2 },
  bus: { width: 2.6, height: 3.15 },
  motorcycle: { width: 0.82, height: 1.16 },
  bicycle: { width: 0.62, height: 1.05 },
};

export const DETECTION_LIMIT = 8;

export const INFERENCE = {
  maxSide: 640,
  minIntervalMs: 80,
  maxIntervalMs: 220,
  startingIntervalMs: 120,
  intervalMultiplier: 0.85,
};

export const TRACKING = {
  smoothingAlpha: 0.58,
  trackIouThreshold: 0.2,
  minAssociationScore: 0.34,
  centerDistanceGate: 1.45,
  sizeRatioGate: 0.38,
  velocitySmoothingAlpha: 0.38,
  predictionMaxDtSeconds: 0.7,
  trackTtlMs: 480,
  holdTtlMs: 220,
  retainedScoreDecay: 0.985,
  minAreaRatio: 0.0013,
  minShortSidePx: 18,
};

export const DISTANCE_ESTIMATION = {
  horizontalFovDegreesDefault: 67,
  horizontalFovDegreesMin: 50,
  horizontalFovDegreesMax: 90,
  calibratedConfidence: 0.86,
  estimatedConfidence: 0.62,
  minDistanceMeters: 1,
  maxDistanceMeters: 60,
};

export const RANGE_FILTER = {
  distanceAlphaMin: 0.18,
  distanceAlphaMax: 0.68,
  distanceResidualScale: 0.035,
  velocityAlpha: 0.24,
  uncertaintyAlpha: 0.28,
  calibratedUncertaintyRatio: 0.08,
  estimatedUncertaintyRatio: 0.16,
  residualUncertaintyWeight: 0.35,
  dangerExitMarginMeters: 1.2,
  warningExitMarginMeters: 2.0,
  downgradeHoldMs: 650,
  conservativeUncertaintyWeight: 0.45,
};

export const FALLBACK_RISK_PROFILES = {
  front: {
    far: 0.18,
    medium: 0.46,
    close: 0.72,
  },
  rear: {
    far: 0.16,
    medium: 0.4,
    close: 0.66,
  },
};

export const ZONE_STYLES = {
  CLEAR: {
    color: "#5ef2c4",
    displayLabel: "CLEAR",
    boxColor: "#5ef2c4",
  },
  FAR: {
    color: "#5ef2c4",
    displayLabel: "SAFE",
    boxColor: "#5ef2c4",
  },
  MEDIUM: {
    color: "#ffbe62",
    displayLabel: "WARNING",
    boxColor: "#ffbe62",
  },
  CLOSE: {
    color: "#ff6b8f",
    displayLabel: "DANGER",
    boxColor: "#ff6b8f",
  },
};

export const FEEDBACK_INTERVALS = {
  FAR: 2600,
  MEDIUM: 1400,
  CLOSE: 750,
};

export const AUDIO_PROFILES = {
  FAR: { frequency: 300, duration: 0.08, gain: 0.045, type: "triangle" },
  MEDIUM: { frequency: 520, duration: 0.11, gain: 0.08, type: "sawtooth" },
  CLOSE: { frequency: 760, duration: 0.16, gain: 0.12, type: "square" },
};

export const HAPTIC_PATTERNS = {
  FAR: [18],
  MEDIUM: [32, 44, 32],
  CLOSE: [52, 36, 52, 36, 72],
};
