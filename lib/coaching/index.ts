// UltraCoach Coaching Intelligence Module
// Simplified architecture: Data + Prompt + AI = Coaching

// Types
export * from "./types";

// System prompt (the coach's personality and expertise)
export { SYSTEM_PROMPT, SYSTEM_PROMPT_V4, SYSTEM_PROMPT_V5, SYSTEM_PROMPT_V6 } from "./system-prompt";

// Data formatting (facts only, no constraints)
export {
  buildDataContext,
  formatAthleteProfile,
  formatTrainingLog,
  formatUpcomingRaces,
  formatVolumeSummary,
  formatDataAvailability,
  type RecoveryState,
} from "./data-context";

// Recovery State (post-race recovery detection and signal overrides)
export {
  calculateRecoveryState,
  formatRecoveryStateForPrompt,
  type RecoveryPhase,
  type SignalOverrides,
} from "./recovery-state";

// HR Zones (personalized, not hardcoded)
export {
  calculateHRZones,
  classifyActivityIntensity,
  formatHRZonesForPrompt,
  checkIntensityCompliance,
} from "./hr-zones";

// Coaching Signals (compliance, fatigue, intensity patterns)
export {
  calculateCoachingSignals,
  formatSignalsForPrompt,
  type CoachingSignals,
  type IntensityViolation,
  type MajorEffort,
} from "./signals";

// Stateful coaching logic
export {
  auditCompliance,
  applyAdaptations,
  processLoginDecision,
  getCurrentPhaseInfo,
  type ComplianceReport,
  type CoachingDecision,
  type CurrentPhaseInfo,
} from "./logic";

// Legacy exports (kept for backwards compatibility)
export { calculateCoachHappiness, getHappinessDisplay } from "./compliance-scorer";

// Workout Analyzer (compares activities against plan)
export {
  analyzeRecentWorkouts,
  analyzeWeek,
  formatWorkoutAnalysisForPrompt,
  type WorkoutAnalysis,
  type WeeklyAnalysisSummary,
} from "./workout-analyzer";

