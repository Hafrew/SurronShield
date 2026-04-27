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
    facingMode: "environment",
    mirrored: false,
  },
  rear: {
    label: "Rear watch",
    shortLabel: "Rear",
    zoneLabel: "Traffic behind",
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
  trackTtlMs: 480,
  holdTtlMs: 220,
  retainedScoreDecay: 0.985,
  minAreaRatio: 0.0013,
  minShortSidePx: 18,
};

export const RISK_PROFILES = {
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
    displayLabel: "WATCH",
    boxColor: "#5ef2c4",
  },
  MEDIUM: {
    color: "#ffbe62",
    displayLabel: "ALERT",
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
