// lib/coaching/recovery-week-generator.ts
// Generates recovery-appropriate workouts based on recovery phase

import { RecoveryPhase } from './recovery-state';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface RecoveryWeekConfig {
  phase: RecoveryPhase;
  weekNumber: number;  // Which recovery week (1, 2, etc.)
  daysSinceEffort: number;
}

export interface DailyWorkout {
  day: string;
  type: string;
  name: string;
  durationMin: number | null;
  distanceKm: number | null;
  intensity: string;
  notes: string;
}

export interface WeekPlan {
  weekNumber: number;
  phase: string;
  totalKm: number;
  totalVert: number;
  workouts: DailyWorkout[];
}

// ---------------------------------------------------------------------------
// RECOVERY PHASE CONSTRAINTS
// ---------------------------------------------------------------------------

const RECOVERY_CONSTRAINTS = {
  ACUTE: {
    maxWeeklyKm: 15,
    maxSingleDuration: 30,
    maxSingleKm: 5,
    allowedTypes: ['Rest', 'Walk', 'Mobility'],
    intensity: 'None/Z1',
    description: 'Days 0-7: No running. Walking and mobility only.',
  },
  STRUCTURAL: {
    maxWeeklyKm: 25,
    maxSingleDuration: 45,
    maxSingleKm: 8,
    allowedTypes: ['Rest', 'Walk', 'Z1 Shuffle', 'Mobility', 'Easy Hike'],
    intensity: 'Z1 only',
    description: 'Days 8-14: Light Z1 shuffle OK. No runs over 45min.',
  },
  SYSTEMIC: {
    maxWeeklyKm: 35,
    maxSingleDuration: 60,
    maxSingleKm: 10,
    allowedTypes: ['Rest', 'Z1 Easy', 'Z2 Easy', 'Easy Hike', 'Mobility'],
    intensity: 'Z1-Z2',
    description: 'Days 15-21: Easy aerobic OK. No runs over 60min. No intensity.',
  },
  REINTEGRATION: {
    maxWeeklyKm: 40,
    maxSingleDuration: 75,
    maxSingleKm: 12,
    allowedTypes: ['Rest', 'Z1 Easy', 'Z2 Easy', 'Easy Long', 'Hill Strides', 'Easy Hike'],
    intensity: 'Z1-Z2, strides OK',
    description: 'Days 22-28: Structure returning. No hard intervals yet.',
  },
  CLEARED: {
    maxWeeklyKm: 60,
    maxSingleDuration: 120,
    maxSingleKm: 20,
    allowedTypes: ['Rest', 'Easy', 'Long', 'Tempo', 'Intervals'],
    intensity: 'All zones',
    description: 'Beyond recovery window: Normal training resumes.',
  },
};

// ---------------------------------------------------------------------------
// MAIN GENERATOR
// ---------------------------------------------------------------------------

export function generateRecoveryWeek(config: RecoveryWeekConfig): WeekPlan {
  const { phase, weekNumber, daysSinceEffort } = config;

  // Get constraints for this phase
  const constraints = RECOVERY_CONSTRAINTS[phase];
  if (!constraints) {
    throw new Error(`Unknown recovery phase: ${phase}`);
  }

  // Generate appropriate workouts based on phase
  const workouts = generateWorkoutsForPhase(phase, constraints);

  // Calculate totals
  const totalKm = workouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);

  return {
    weekNumber,
    phase: `RECOVERY (${phase})`,
    totalKm: Math.round(totalKm),
    totalVert: 0,  // No vert focus during recovery
    workouts,
  };
}

// ---------------------------------------------------------------------------
// PHASE-SPECIFIC WORKOUT GENERATION
// ---------------------------------------------------------------------------

function generateWorkoutsForPhase(
  phase: RecoveryPhase,
  constraints: typeof RECOVERY_CONSTRAINTS['ACUTE']
): DailyWorkout[] {

  switch (phase) {
    case 'ACUTE':
      return generateAcuteWeek();
    case 'STRUCTURAL':
      return generateStructuralWeek();
    case 'SYSTEMIC':
      return generateSystemicWeek();
    case 'REINTEGRATION':
      return generateReintegrationWeek();
    default:
      return generateRestWeek();
  }
}

function generateAcuteWeek(): DailyWorkout[] {
  return [
    { day: 'Mon', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Tue', type: 'Mobility', name: 'Mobility', durationMin: 20, distanceKm: null, intensity: 'None', notes: 'Gentle stretching, foam rolling' },
    { day: 'Wed', type: 'Walk', name: 'Easy Walk', durationMin: 30, distanceKm: 3, intensity: 'Z1', notes: 'Flat terrain, no pace pressure' },
    { day: 'Thu', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Fri', type: 'Mobility', name: 'Mobility', durationMin: 20, distanceKm: null, intensity: 'None', notes: 'Gentle stretching, foam rolling' },
    { day: 'Sat', type: 'Walk', name: 'Easy Walk', durationMin: 40, distanceKm: 4, intensity: 'Z1', notes: 'Flat or gentle terrain' },
    { day: 'Sun', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
  ];
}

function generateStructuralWeek(): DailyWorkout[] {
  return [
    { day: 'Mon', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Tue', type: 'Z1 Shuffle', name: 'Z1 Shuffle', durationMin: 30, distanceKm: 5, intensity: 'Z1', notes: 'Walk breaks OK. HR cap 120.' },
    { day: 'Wed', type: 'Mobility', name: 'Mobility + Walk', durationMin: 30, distanceKm: 2, intensity: 'Z1', notes: '15min mobility, 15min walk' },
    { day: 'Thu', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Fri', type: 'Z1 Shuffle', name: 'Z1 Shuffle', durationMin: 35, distanceKm: 6, intensity: 'Z1', notes: 'Walk breaks OK. HR cap 120.' },
    { day: 'Sat', type: 'Easy Hike', name: 'Easy Hike', durationMin: 45, distanceKm: 5, intensity: 'Z1', notes: 'Gentle terrain with poles' },
    { day: 'Sun', type: 'Walk', name: 'Easy Walk', durationMin: 40, distanceKm: 4, intensity: 'Z1', notes: 'Flat terrain, recovery focus' },
  ];
}

function generateSystemicWeek(): DailyWorkout[] {
  return [
    { day: 'Mon', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Tue', type: 'Z1 Easy', name: 'Easy Run', durationMin: 40, distanceKm: 7, intensity: 'Z1-Z2', notes: 'Conversational pace. No pushing.' },
    { day: 'Wed', type: 'Mobility', name: 'Mobility + Strength', durationMin: 30, distanceKm: null, intensity: 'None', notes: 'Light strength, core work' },
    { day: 'Thu', type: 'Z1 Easy', name: 'Easy Run', durationMin: 35, distanceKm: 6, intensity: 'Z1', notes: 'Keep it genuinely easy' },
    { day: 'Fri', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Sat', type: 'Z2 Easy', name: 'Easy Long', durationMin: 60, distanceKm: 10, intensity: 'Z1-Z2', notes: 'Building back time on feet' },
    { day: 'Sun', type: 'Walk', name: 'Easy Walk', durationMin: 45, distanceKm: 5, intensity: 'Z1', notes: 'Active recovery' },
  ];
}

function generateReintegrationWeek(): DailyWorkout[] {
  return [
    { day: 'Mon', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Complete rest' },
    { day: 'Tue', type: 'Hill Strides', name: 'Hill Strides', durationMin: 40, distanceKm: 7, intensity: 'Z1 + strides', notes: '30min Z1 + 6x15sec hill strides, walk recovery' },
    { day: 'Wed', type: 'Z1 Easy', name: 'Easy Run', durationMin: 40, distanceKm: 7, intensity: 'Z1', notes: 'Conversational pace' },
    { day: 'Thu', type: 'Mobility', name: 'Mobility + Strength', durationMin: 30, distanceKm: null, intensity: 'None', notes: 'Building back strength work' },
    { day: 'Fri', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: 'Pre-long run rest' },
    { day: 'Sat', type: 'Easy Long', name: 'Medium Long Run', durationMin: 75, distanceKm: 12, intensity: 'Z1-Z2', notes: 'First longer effort. Walk breaks OK.' },
    { day: 'Sun', type: 'Z1 Easy', name: 'Easy Run', durationMin: 45, distanceKm: 7, intensity: 'Z1', notes: 'Tired legs, keep it easy' },
  ];
}

function generateRestWeek(): DailyWorkout[] {
  return [
    { day: 'Mon', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
    { day: 'Tue', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
    { day: 'Wed', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
    { day: 'Thu', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
    { day: 'Fri', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
    { day: 'Sat', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
    { day: 'Sun', type: 'Rest', name: 'Rest', durationMin: null, distanceKm: null, intensity: 'None', notes: '' },
  ];
}

// ---------------------------------------------------------------------------
// UTILITY: Check if week should be recovery
// ---------------------------------------------------------------------------

export function shouldBeRecoveryWeek(
  daysSinceEffort: number,
  effortType: string
): boolean {
  const windows = {
    'MARATHON': 14,
    '50K': 18,
    '50M': 24,
    '100K': 28,
    '100M': 49,
  };

  const window = windows[effortType as keyof typeof windows];
  return window ? daysSinceEffort < window : false;
}

export function getRecoveryPhaseForDay(daysSinceEffort: number): RecoveryPhase {
  if (daysSinceEffort <= 7) return 'ACUTE';
  if (daysSinceEffort <= 14) return 'STRUCTURAL';
  if (daysSinceEffort <= 21) return 'SYSTEMIC';
  if (daysSinceEffort <= 28) return 'REINTEGRATION';
  return 'CLEARED';
}
