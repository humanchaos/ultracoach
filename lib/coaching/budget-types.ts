/**
 * Budget-Based Coaching Types (v1.2)
 * 
 * New architecture: Lock the macro structure, free the micro execution.
 * Weekly budgets are fixed, daily execution adapts to readiness.
 */

// ============================================================
// TOP-LEVEL TRAINING BLOCK
// ============================================================

export interface TrainingBlockV2 {
    id: string;
    athleteId: string;

    // Race info
    raceId: string;
    raceName: string;
    raceDate: Date;
    raceDistance: number;      // km
    raceVertical: number;      // meters

    // Plan structure
    totalWeeks: number;
    createdAt: Date;

    // Athlete snapshot at generation time
    athleteProfile: AthleteSnapshot;

    phases: Phase[];
}

export interface AthleteSnapshot {
    weeklyVolumeCapacity: number;   // max sustainable weekly km
    verticalCapacity: number;       // max sustainable weekly vert
    lt1HeartRate: number;           // LT1 / aerobic threshold
    lt2HeartRate: number;           // LT2 / anaerobic threshold
    injuryHistory: string[];
    preferredLongRunDay: 'saturday' | 'sunday';
}

// ============================================================
// PHASE
// ============================================================

export interface Phase {
    type: PhaseType;
    weekStart: number;
    weekEnd: number;
    focus: string;               // e.g., "Aerobic foundation, structural durability"

    // Progression rules
    volumeProgression: {
        startPercent: number;      // % of athlete's capacity
        endPercent: number;
        pattern: 'linear' | 'stepLoad' | 'reverse';
    };

    // What quality sessions are allowed in this phase
    allowedQualitySessions: SessionType[];

    weeks: Week[];
}

export type PhaseType = 'base' | 'build' | 'specific' | 'taper';

export type SessionType =
    | 'hill_strides'           // Base
    | 'threshold_intervals'    // Build
    | 'vo2_hill_repeats'       // Build
    | 'tempo_run'              // Build
    | 'progression_long'       // Build
    | 'race_pace_segments'     // Specific
    | 'power_hike_intervals'   // Specific
    | 'course_simulation'      // Specific
    | 'back_to_back'           // Specific
    | 'sharpener'              // Taper
    | 'opener';                // Taper

// ============================================================
// WEEK (THE BUDGET)
// ============================================================

export interface Week {
    weekNumber: number;
    weekOf: Date;                // Monday of this week

    // === THE BUDGET (locked at generation) ===
    budget: WeekBudget;

    // Available session types this week (from phase)
    availableQualityTypes: SessionType[];

    // === CONSTRAINTS (hard rules) ===
    constraints: WeekConstraints;

    // === EXECUTION (updated as week progresses) ===
    execution: WeekExecution;
}

export interface WeekBudget {
    totalVolume: number;         // km target
    totalVertical: number;       // meters target
    qualitySessions: number;     // count of Z4/Z5 sessions
    longRunRange: {
        min: number;               // km
        max: number;
    };
}

export interface WeekConstraints {
    maxSingleDayVolume: number;      // km
    maxSingleDayVertical: number;    // meters
    minHoursBetweenQuality: 48;      // fixed
    longRunDay: 'saturday' | 'sunday' | 'flexible';
}

export interface WeekExecution {
    completedSessions: CompletedSession[];

    remainingBudget: {
        volume: number;
        vertical: number;
        qualitySessions: number;
        needsLongRun: boolean;
    };
}

export interface CompletedSession {
    date: Date;
    type: 'quality' | 'long' | 'easy' | 'recovery' | 'rest';
    qualityType?: SessionType;
    volume: number;
    vertical: number;
    stravaActivityId?: string;
}

// ============================================================
// DAILY PRESCRIPTION (ENGINE OUTPUT)
// ============================================================

export interface DailyPrescription {
    date: Date;
    recommendation: 'workout' | 'rest' | 'active_recovery';

    workout?: PrescribedWorkout;

    // Reasoning (for chat and UI)
    reasoning: PrescriptionReasoning;

    // Pre-calculated alternatives
    alternatives: AlternativePrescription[];
}

export interface PrescribedWorkout {
    type: 'quality' | 'long' | 'easy' | 'recovery';
    qualityType?: SessionType;

    // Targets (adjusted for readiness)
    targetVolume: number;          // km
    targetVertical: number;        // meters
    targetDuration: number;        // minutes

    // Intensity
    hrZones: {
        primary: HRZone;
        ceiling: HRZone;
    };

    // Pace guidance (estimated from recent activity data or LT test)
    paceTarget?: string;           // e.g., "6:00–7:00/km"

    // Nutrition guidance (for long/quality sessions)
    nutritionTip?: string;         // e.g., "Take 60g carbs/hr from km 15"

    // Workout structure
    structure: WorkoutStructure;

    // Maintenance pivot flag
    isMaintenanceMode: boolean;
    maintenanceReason?: string;
}

export type HRZone = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';

export interface WorkoutStructure {
    warmup: { duration: number; description: string };
    main: { description: string; intervals?: IntervalSet[] };
    cooldown: { duration: number; description: string };
}

export interface IntervalSet {
    reps: number;
    workDuration: number;       // seconds or meters
    workIntensity: string;      // "Z4" or "10K pace"
    restDuration: number;
    restIntensity: string;
}

export interface PrescriptionReasoning {
    summary: string;
    budgetStatus: string;
    readinessInfluence: string;
    constraintsApplied: string[];
}

export interface AlternativePrescription {
    type: 'easy' | 'recovery' | 'rest';
    description: string;
    consequence: string;        // "shifts quality to Friday"
}

// ============================================================
// ENGINE INPUT
// ============================================================

export interface DailyPrescriptionInput {
    today: Date;
    week: Week;
    readiness: ReadinessProfile;
    wellness: WellnessData;
    recentActivities: RecentActivity[];     // last 7 days from Strava
    recoveryStatus: RecoveryStatusV2;       // post-race phase if applicable
}

export interface ReadinessProfile {
    score: number;                          // 0-100 composite
    systemic: ReadinessLevel;
    structural: ReadinessLevel;
    riskFlags: string[];                    // ['fever', 'injury', etc.]
}

export type ReadinessLevel = 'optimal' | 'normal' | 'compromised';

export interface WellnessData {
    sleep: number;                          // hours last night
    stressLevel: number;                    // 1-5 scale
    muscularFatigue: number;                // 1-5 scale
    mood: number;                           // 1-5 scale
}

export interface RecentActivity {
    date: Date;
    type: 'quality' | 'long' | 'easy' | 'recovery' | 'rest';
    volume: number;
    hrData?: {
        average: number;
        max: number;
    };
}

export interface RecoveryStatusV2 {
    phase: 'normal' | 'acute' | 'structural' | 'systemic' | 'reintegration';
    daysRemaining?: number;
    restrictions?: string[];
}

// ============================================================
// SESSION CANDIDATE (INTERNAL)
// ============================================================

export interface SessionCandidate {
    type: 'quality' | 'long' | 'easy' | 'recovery';
    qualityType?: SessionType;
    targetVolume: number;
    targetVertical: number;
    targetDuration: number;
    hrZones: {
        primary: HRZone;
        ceiling: HRZone;
    };
}
