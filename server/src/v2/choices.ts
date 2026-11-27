// The fixed choices on owner-entered coaching records.
export const reasons = [
  "attendance",
  "quality",
  "behaviour",
  "recognition",
] as const;
export const coachingTypes = [
  "corrective",
  "recognition",
  "follow-up",
] as const;
export const measures = ["none", "lateness", "missing", "breaks"] as const;
export const followUpStates = ["open", "done", "kept", "not kept"] as const;
