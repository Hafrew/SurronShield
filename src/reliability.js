export const HEALTH_STATES = {
  READY: "READY",
  DEGRADED: "DEGRADED",
  RECOVERING: "RECOVERING",
  UNSAFE: "UNSAFE",
};

const STATE_RANK = {
  [HEALTH_STATES.READY]: 0,
  [HEALTH_STATES.DEGRADED]: 1,
  [HEALTH_STATES.RECOVERING]: 2,
  [HEALTH_STATES.UNSAFE]: 3,
};

const DEFAULT_MESSAGES = {
  [HEALTH_STATES.READY]: "All safety systems are live.",
  [HEALTH_STATES.DEGRADED]: "Safety system degraded.",
  [HEALTH_STATES.RECOVERING]: "Recovering safety system.",
  [HEALTH_STATES.UNSAFE]: "Vision safety unavailable.",
};

function normalizeState(state) {
  return STATE_RANK[state] === undefined ? HEALTH_STATES.DEGRADED : state;
}

function sanitizeError(error) {
  if (!error) {
    return null;
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || error.name || "Unknown error";
}

function summarizeIssue(issue) {
  return [
    issue.code,
    issue.state,
    issue.title,
    issue.detail,
    issue.error,
  ].join("|");
}

export class ReliabilitySupervisor {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.issues = new Map();
    this.snapshot = this.createSnapshot();
  }

  createSnapshot() {
    return {
      state: HEALTH_STATES.READY,
      message: DEFAULT_MESSAGES[HEALTH_STATES.READY],
      issues: [],
      changedAt: performance.now(),
    };
  }

  report(code, issue) {
    const previous = this.issues.get(code);
    const now = performance.now();
    const nextIssue = {
      code,
      state: normalizeState(issue.state),
      title: issue.title || DEFAULT_MESSAGES[normalizeState(issue.state)],
      detail: issue.detail || "",
      subsystem: issue.subsystem || "runtime",
      recoverable: issue.recoverable !== false,
      error: sanitizeError(issue.error),
      since: previous?.since ?? now,
      updatedAt: now,
    };

    if (previous && summarizeIssue(previous) === summarizeIssue(nextIssue)) {
      return this.snapshot;
    }

    this.issues.set(code, nextIssue);
    return this.publish();
  }

  clear(code) {
    if (!this.issues.delete(code)) {
      return this.snapshot;
    }

    return this.publish();
  }

  clearSubsystem(subsystem) {
    let changed = false;

    for (const [code, issue] of this.issues) {
      if (issue.subsystem === subsystem) {
        this.issues.delete(code);
        changed = true;
      }
    }

    return changed ? this.publish() : this.snapshot;
  }

  publish() {
    const issues = Array.from(this.issues.values()).sort(
      (a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.since - b.since,
    );
    const state = issues[0]?.state ?? HEALTH_STATES.READY;
    const primary = issues[0];

    this.snapshot = {
      state,
      message:
        primary?.detail ||
        primary?.title ||
        DEFAULT_MESSAGES[state] ||
        DEFAULT_MESSAGES[HEALTH_STATES.DEGRADED],
      issues,
      changedAt: performance.now(),
    };

    this.onChange?.(this.snapshot);
    return this.snapshot;
  }

  getSnapshot() {
    return this.snapshot;
  }
}
