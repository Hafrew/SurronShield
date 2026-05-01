import { DISTANCE_ESTIMATION } from "./config.js";

export const SETTINGS_STORAGE_KEY = "surronshield-settings-v2";

let lastSettingsError = null;

export const DEFAULT_SETTINGS = {
  activeMode: "front",
  calibration: {
    carLengthMeters: 4.5,
    cameraProfiles: {
      front: {
        horizontalFovDegrees: DISTANCE_ESTIMATION.horizontalFovDegreesDefault,
        calibrated: false,
      },
      rear: {
        horizontalFovDegrees: DISTANCE_ESTIMATION.horizontalFovDegreesDefault,
        calibrated: false,
      },
    },
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

function normalizeCameraProfile(profile, fallback) {
  return {
    horizontalFovDegrees: clamp(
      Number(profile?.horizontalFovDegrees ?? fallback.horizontalFovDegrees),
      DISTANCE_ESTIMATION.horizontalFovDegreesMin,
      DISTANCE_ESTIMATION.horizontalFovDegreesMax,
    ),
    calibrated: Boolean(profile?.calibrated),
  };
}

export function normalizeSettings(input = {}) {
  const legacyFov = Number(
    input.calibration?.horizontalFovDegrees ??
      DISTANCE_ESTIMATION.horizontalFovDegreesDefault,
  );
  const legacyFallback = {
    horizontalFovDegrees: Number.isFinite(legacyFov)
      ? legacyFov
      : DISTANCE_ESTIMATION.horizontalFovDegreesDefault,
    calibrated: false,
  };

  return {
    activeMode: input.activeMode === "rear" ? "rear" : "front",
    calibration: {
      carLengthMeters: clamp(
        Number(input.calibration?.carLengthMeters ?? DEFAULT_SETTINGS.calibration.carLengthMeters),
        3.5,
        5.5,
      ),
      cameraProfiles: {
        front: normalizeCameraProfile(
          input.calibration?.cameraProfiles?.front,
          input.calibration?.cameraProfiles
            ? DEFAULT_SETTINGS.calibration.cameraProfiles.front
            : legacyFallback,
        ),
        rear: normalizeCameraProfile(
          input.calibration?.cameraProfiles?.rear,
          input.calibration?.cameraProfiles
            ? DEFAULT_SETTINGS.calibration.cameraProfiles.rear
            : legacyFallback,
        ),
      },
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
    lastSettingsError = {
      type: "load",
      error,
    };
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeSettings(settings)),
    );
    return { ok: true };
  } catch (error) {
    lastSettingsError = {
      type: "save",
      error,
    };
    return { ok: false, error };
  }
}

export function takeSettingsError() {
  const error = lastSettingsError;
  lastSettingsError = null;
  return error;
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

export function updateCameraProfileSetting(settings, mode, key, value) {
  const normalized = normalizeSettings(settings);
  const nextMode = mode === "rear" ? "rear" : "front";

  return normalizeSettings({
    ...normalized,
    calibration: {
      ...normalized.calibration,
      cameraProfiles: {
        ...normalized.calibration.cameraProfiles,
        [nextMode]: {
          ...normalized.calibration.cameraProfiles[nextMode],
          [key]: Number(value),
          calibrated: true,
        },
      },
    },
  });
}

export function getModeCameraProfile(settings, mode) {
  const normalized = normalizeSettings(settings);
  return normalized.calibration.cameraProfiles[mode === "rear" ? "rear" : "front"];
}

export function metersToCarLengths(meters, settings) {
  if (!Number.isFinite(meters)) {
    return null;
  }

  const carLengthMeters = settings.calibration.carLengthMeters;
  return meters / carLengthMeters;
}
