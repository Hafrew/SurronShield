import { DISTANCE_ESTIMATION } from "./config.js";

export const SETTINGS_STORAGE_KEY = "surronshield-settings-v2";

export const DEFAULT_SETTINGS = {
  activeMode: "front",
  calibration: {
    carLengthMeters: 4.5,
    horizontalFovDegrees: DISTANCE_ESTIMATION.horizontalFovDegreesDefault,
  },
  distanceTuning: {
    front: {
      dangerMeters: 6,
      warningMeters: 16,
    },
    rear: {
      dangerMeters: 5,
      warningMeters: 12,
    },
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeThresholdPair(pair, fallback) {
  const dangerMeters = clamp(
    Number(pair?.dangerMeters ?? fallback.dangerMeters),
    1.5,
    24,
  );
  const warningMeters = clamp(
    Number(pair?.warningMeters ?? fallback.warningMeters),
    dangerMeters + 0.5,
    40,
  );

  return {
    dangerMeters,
    warningMeters,
  };
}

export function normalizeSettings(input = {}) {
  return {
    activeMode: input.activeMode === "rear" ? "rear" : "front",
    calibration: {
      carLengthMeters: clamp(
        Number(input.calibration?.carLengthMeters ?? DEFAULT_SETTINGS.calibration.carLengthMeters),
        3.5,
        5.5,
      ),
      horizontalFovDegrees: clamp(
        Number(
          input.calibration?.horizontalFovDegrees ??
            DEFAULT_SETTINGS.calibration.horizontalFovDegrees,
        ),
        50,
        90,
      ),
    },
    distanceTuning: {
      front: normalizeThresholdPair(
        input.distanceTuning?.front,
        DEFAULT_SETTINGS.distanceTuning.front,
      ),
      rear: normalizeThresholdPair(
        input.distanceTuning?.rear,
        DEFAULT_SETTINGS.distanceTuning.rear,
      ),
    },
  };
}

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeSettings(DEFAULT_SETTINGS);
    }

    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to load settings", error);
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeSettings(settings)),
    );
  } catch (error) {
    console.warn("Failed to save settings", error);
  }
}

export function updateDistanceSetting(settings, mode, key, value) {
  return normalizeSettings({
    ...settings,
    distanceTuning: {
      ...settings.distanceTuning,
      [mode]: {
        ...settings.distanceTuning[mode],
        [key]: Number(value),
      },
    },
  });
}

export function updateCalibrationSetting(settings, key, value) {
  return normalizeSettings({
    ...settings,
    calibration: {
      ...settings.calibration,
      [key]: Number(value),
    },
  });
}

export function metersToCarLengths(meters, settings) {
  if (!Number.isFinite(meters)) {
    return null;
  }

  const carLengthMeters = settings.calibration.carLengthMeters;
  return meters / carLengthMeters;
}
