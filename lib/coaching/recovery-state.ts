// lib/coaching/recovery-state.ts
// Calculates recovery context from recent major efforts

import { StravaActivity } from './types';

// Import SignalOverrides from signals.ts to ensure type compatibility
import type { SignalOverrides } from './signals';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type RecoveryPhase =
  | 'ACUTE'           // Days 0-7
  | 'STRUCTURAL'      // Days 8-14
  | 'SYSTEMIC'        // Days 15-21
  | 'REINTEGRATION'   // Days 22-28+
  | 'CLEARED';

export interface RecoveryState {
  inRecoveryWindow: boolean;
  daysSinceEffort: number | null;
  effortType: '50K' | '50M' | '100K' | '100M' | 'MARATHON' | null;
  effortName: string | null;
  effortDate: string | null;
  phase: RecoveryPhase;
  structuredTrainingResumes: string | null;
  recoveryWeeksNeeded: number;
}

// ---------------------------------------------------------------------------
// RECOVERY WINDOWS BY EVENT
// ---------------------------------------------------------------------------

const RECOVERY_WINDOWS = {
  'MARATHON': { deep: 10, structured: 14, full: 21 },
  '50K': { deep: 14, structured: 18, full: 24 },
  '50M': { deep: 18, structured: 24, full: 28 },
  '100K': { deep: 21, structured: 28, full: 35 },
  '100M': { deep: 35, structured: 49, full: 56 },
};

// ---------------------------------------------------------------------------
// MAIN FUNCTION
// ---------------------------------------------------------------------------

export interface CalculateRecoveryStateInput {
  activities: StravaActivity[];
  races?: Array<{ date: Date | string; distance_km: number; name: string }>;
  athleteAge?: number;
  highLifeStress?: boolean;
  extremeRaceConditions?: boolean;
}

export function calculateRecoveryState(
  input: CalculateRecoveryStateInput | StravaActivity[],
  athleteAge?: number
): RecoveryState & { signalOverrides: SignalOverrides } {

  // Handle both old and new call signatures
  let activities: StravaActivity[];
  let age: number | undefined;
  let highStress = false;
  let extremeConditions = false;

  if (Array.isArray(input)) {
    activities = input;
    age = athleteAge;
  } else {
    activities = input.activities;
    age = input.athleteAge;
    highStress = input.highLifeStress || false;
    extremeConditions = input.extremeRaceConditions || false;
  }

  // Find most recent major effort
  const majorEffort = findMostRecentMajorEffort(activities);

  if (!majorEffort) {
    return {
      inRecoveryWindow: false,
      daysSinceEffort: null,
      effortType: null,
      effortName: null,
      effortDate: null,
      phase: 'CLEARED',
      structuredTrainingResumes: null,
      recoveryWeeksNeeded: 0,
      signalOverrides: getSignalOverridesForPhase('CLEARED'),
    };
  }

  const now = new Date();
  const effortDate = new Date(majorEffort.date);
  const daysSince = Math.floor((now.getTime() - effortDate.getTime()) / (1000 * 60 * 60 * 24));

  // Get recovery window for this event type
  const windows = RECOVERY_WINDOWS[majorEffort.type];

  // Apply adjustments
  let adjustedStructured = windows.structured;
  if (age && age >= 45) adjustedStructured = Math.ceil(adjustedStructured * 1.2);
  if (highStress) adjustedStructured = Math.ceil(adjustedStructured * 1.25);
  if (extremeConditions) adjustedStructured = Math.ceil(adjustedStructured * 1.25);

  // Check if still in recovery window
  if (daysSince > adjustedStructured) {
    return {
      inRecoveryWindow: false,
      daysSinceEffort: daysSince,
      effortType: majorEffort.type,
      effortName: majorEffort.name,
      effortDate: majorEffort.date,
      phase: 'CLEARED',
      structuredTrainingResumes: null,
      recoveryWeeksNeeded: 0,
      signalOverrides: getSignalOverridesForPhase('CLEARED'),
    };
  }

  // Calculate phase
  const phase = calculatePhase(daysSince);

  // Calculate when structured training can resume
  const structuredDate = new Date(effortDate);
  structuredDate.setDate(structuredDate.getDate() + adjustedStructured);

  // Calculate recovery weeks needed from today
  const daysUntilStructured = Math.max(0, adjustedStructured - daysSince);
  const recoveryWeeksNeeded = Math.ceil(daysUntilStructured / 7);

  // Calculate signal overrides for this phase
  const signalOverrides = getSignalOverridesForPhase(phase);

  return {
    inRecoveryWindow: true,
    daysSinceEffort: daysSince,
    effortType: majorEffort.type,
    effortName: majorEffort.name,
    effortDate: majorEffort.date,
    phase,
    structuredTrainingResumes: structuredDate.toISOString().split('T')[0],
    recoveryWeeksNeeded,
    signalOverrides,
  };
}

function getSignalOverridesForPhase(phase: RecoveryPhase): SignalOverrides {
  // Match the interface from signals.ts:
  // suppressAcwrWarnings, suppressIntensityViolations, suppressVolumeWarnings, reframeAllSignals, overrideReason

  if (phase === 'CLEARED') {
    return {
      suppressAcwrWarnings: false,
      suppressIntensityViolations: false,
      suppressVolumeWarnings: false,
      reframeAllSignals: false,
      overrideReason: null,
    };
  }

  // During recovery: suppress all negative signals
  return {
    suppressAcwrWarnings: true,       // Low ACWR is expected during recovery
    suppressIntensityViolations: true, // Don't flag low intensity during recovery
    suppressVolumeWarnings: true,     // Low volume is expected
    reframeAllSignals: true,          // Reframe "fitness declining" as "recovering"
    overrideReason: `${phase} recovery phase - low training is intentional and healthy`,
  };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function findMostRecentMajorEffort(activities: StravaActivity[]): {
  type: '50K' | '50M' | '100K' | '100M' | 'MARATHON';
  name: string;
  date: string;
} | null {

  for (const activity of activities) {
    // Only check runs (includes trail runs in our type)
    if (activity.type !== 'Run') continue;

    const distanceKm = activity.distance_km; // Already in km
    const name = activity.name.toLowerCase();

    let effortType: '50K' | '50M' | '100K' | '100M' | 'MARATHON' | null = null;

    // Check by distance
    if (distanceKm >= 155) effortType = '100M';
    else if (distanceKm >= 95) effortType = '100K';
    else if (distanceKm >= 75) effortType = '50M';
    else if (distanceKm >= 48) effortType = '50K';
    else if (distanceKm >= 40) effortType = 'MARATHON';

    // Check by name pattern
    if (!effortType) {
      if (name.includes('100 mile') || name.includes('100mi')) effortType = '100M';
      else if (name.includes('100k')) effortType = '100K';
      else if (name.includes('50 mile') || name.includes('80k')) effortType = '50M';
      else if (name.includes('50k') || name.includes('ultra')) effortType = '50K';
      else if (name.includes('marathon')) effortType = 'MARATHON';
    }

    if (effortType) {
      // Convert Date to ISO string if needed
      const dateStr = typeof activity.date === 'string'
        ? activity.date
        : activity.date.toISOString();
      return {
        type: effortType,
        name: activity.name,
        date: dateStr,
      };
    }
  }

  return null;
}

function calculatePhase(daysSince: number): RecoveryPhase {
  if (daysSince <= 7) return 'ACUTE';
  if (daysSince <= 14) return 'STRUCTURAL';
  if (daysSince <= 21) return 'SYSTEMIC';
  if (daysSince <= 28) return 'REINTEGRATION';
  return 'CLEARED';
}

// ---------------------------------------------------------------------------
// FORMATTING FOR PROMPTS
// ---------------------------------------------------------------------------

export function formatRecoveryForMacroPlanner(state: RecoveryState): string {
  if (!state.inRecoveryWindow) {
    return 'RECOVERY STATUS: Cleared for normal training. No recent major efforts detected.';
  }

  // Get phase-specific prescription
  const { maxDuration, maxIntensity, allowedActivities } = getPhaseGuidelines(state.phase);

  return `
## RECOVERY STATUS

**Race:** ${state.effortName} (${state.effortType})
**Days Post-Race:** ${state.daysSinceEffort}
**Current Phase:** ${state.phase}
**Structured Training Resumes:** ${state.structuredTrainingResumes}

### Phase ${state.phase} Limits (for NEW training prescriptions only)

When prescribing new training:
- Maximum Duration: ${maxDuration}
- Maximum Intensity: ${maxIntensity}
- Allowed Activities: ${allowedActivities}

Note: These limits apply to PRESCRIPTIONS for future training. If the athlete asks about analyzing past workouts, answer their question directly - recovery status doesn't affect workout analysis.
`.trim();
}

function getPhaseGuidelines(phase: RecoveryPhase): { maxDuration: string; maxIntensity: string; allowedActivities: string } {
  switch (phase) {
    case 'ACUTE':
      return {
        maxDuration: 'NO RUNNING',
        maxIntensity: 'Walking only',
        allowedActivities: 'Walking, mobility work, sleep',
      };
    case 'STRUCTURAL':
      return {
        maxDuration: '45 minutes maximum',
        maxIntensity: 'Zone 1 only (easy shuffle)',
        allowedActivities: 'Z1 shuffle, hiking, easy walking',
      };
    case 'SYSTEMIC':
      return {
        maxDuration: '60-75 minutes maximum',
        maxIntensity: 'Zone 1-2 (conversational)',
        allowedActivities: 'Z1-Z2 easy runs, hiking',
      };
    case 'REINTEGRATION':
      return {
        maxDuration: '90 minutes maximum',
        maxIntensity: 'Zone 2, occasional Zone 3 touches',
        allowedActivities: 'Easy runs with light strides, return to structure',
      };
    default:
      return {
        maxDuration: 'No limit',
        maxIntensity: 'Full training',
        allowedActivities: 'All training activities',
      };
  }
}

// Backwards-compatible alias for existing code
export const formatRecoveryStateForPrompt = formatRecoveryForMacroPlanner;

// Re-export SignalOverrides from signals.ts for backwards compatibility
export type { SignalOverrides } from './signals';

// Get signal overrides from a recovery state
export function getSignalOverrides(state: RecoveryState & { signalOverrides: SignalOverrides }): SignalOverrides {
  return state.signalOverrides;
}
