// UltraCoach Type Definitions
// All data structures used by the coaching intelligence system

export interface Athlete {
  id: string;
  name: string;
  age: number | null;  // Can be null if unknown - AI should ask if needed
  gender: "male" | "female" | "other";
  weight_kg?: number;
  height_cm?: number;
  maxHR?: number;
  restingHR?: number;
  // Fitness metrics - can come from Strava API or user input
  vo2max?: number;              // From Strava (fitness_trend) or lab test
  lactateThreshold?: {          // From Strava or field test
    heartRate: number;          // LTHR in bpm
    pace?: number;              // LT pace in min/km
  };
  ftp?: number;                 // Functional Threshold Power (cycling/running power)
  signupDate: Date;
  preferences: AthletePreferences;
}

export interface AthletePreferences {
  preferredDays: string[];
  maxWeeklyVolume_km: number;
  injuries: string[];
  dietaryRestrictions: string[];
  experienceLevel: "beginner" | "intermediate" | "advanced" | "elite";
}

export interface StravaActivity {
  id: string;
  name: string;
  date: Date;
  distance_km: number;
  duration_minutes: number;
  pace_min_per_km?: number;
  average_hr?: number;
  max_hr?: number;
  elevation_gain_m?: number;
  type: "Run" | "Walk" | "Hike" | "Ride" | "Swim" | "Other";
  description?: string;
}

export interface UpcomingRace {
  id: string;
  name: string;
  date: Date;
  distance_km: number;
  elevation_gain_m?: number;  // Total climbing in meters
  elevation_loss_m?: number;  // Total descent in meters
  goalTime?: string;
  priority: "A" | "B" | "C";
  terrain?: "road" | "trail" | "track" | "mixed";
}

// Pre-calculated context injected into prompts
export interface PreCalculatedContext {
  recoveryStatus: RecoveryStatus;
  volumeConstraints: VolumeConstraints;
  hrZones: HRZones;
  dataQuality: DataQualityReport;
  adaptationTriggers: AdaptationTrigger[];
  trainingPhase: TrainingPhase;
}

export interface RecoveryStatus {
  isInRecovery: boolean;
  type: "ultra" | "marathon" | "long_race" | "hard_long_run" | "none";
  eventName?: string;
  eventDistance_km?: number;
  eventDate?: Date;
  daysSinceEvent: number;
  mandatoryRestUntil: Date;
  currentPhase: RecoveryPhase;
  allowedActivities: string[];
  prohibitedActivities: string[];
}

export type RecoveryPhase =
  | "complete_rest"      // Days 1-2 post-ultra, Day 1 post-marathon
  | "walking_only"       // Days 3-7 post-ultra, Days 2-4 post-marathon
  | "light_recovery"     // Days 8-14 post-ultra, Days 5-7 post-marathon
  | "return_to_training" // Beyond mandatory recovery
  | "none";              // No recent major effort

export interface VolumeConstraints {
  fourWeekAverage_km: number;
  maxSafeIncrease_km: number;
  maxPrescribedThisWeek_km: number;
  currentWeekSoFar_km: number;
  remainingBudget_km: number;
  isVolumeConstrained: boolean;
  constraintReason?: string;
}

export interface HRZones {
  method: "karvonen" | "percentage_max" | "athlete_defined" | "estimated" | "lactate_anchored";
  maxHR: number;
  restingHR: number;
  zones: {
    zone1: { min: number; max: number; name: "Recovery" };
    zone2: { min: number; max: number; name: "Easy/Aerobic" };
    zone3: { min: number; max: number; name: "Tempo" };
    zone4: { min: number; max: number; name: "Threshold" };
    zone5: { min: number; max: number; name: "VO2max" };
  };
}

export interface DataQualityReport {
  isValid: boolean;
  lastSyncDate: Date | null;
  syncAgeHours: number;
  activityCount: number;
  hasHRData: boolean;
  hrDataPercentage: number;
  issues: DataIssue[];
  warnings: DataWarning[];
}

export interface DataIssue {
  type: "stale_data" | "no_data" | "missing_hr" | "incomplete_profile";
  message: string;
  severity: "blocking" | "degraded" | "info";
  userAction?: string;
}

export interface DataWarning {
  type: string;
  message: string;
}

export interface AdaptationTrigger {
  triggered: boolean;
  type: "missed_workouts" | "volume_deficit" | "volume_excess" | "race_approaching" | "overtraining_signals" | "illness_injury";
  description: string;
  recommendedAction: "regenerate_plan" | "reduce_volume" | "increase_volume" | "switch_to_taper" | "enter_recovery" | "flag_for_review";
  urgency: "immediate" | "next_plan" | "monitor";
}

export interface TrainingPhase {
  phase: "base" | "build" | "peak" | "taper" | "recovery" | "off_season";
  weeksUntilRace?: number;
  targetRace?: UpcomingRace;
  phaseDescription: string;
}

// Planned workout from AI
export interface PlannedWorkout {
  day: string;
  date: string;
  type: "run" | "rest" | "cross" | "long" | "recovery" | "tempo" | "intervals";
  title: string;
  description: string;
  duration: string | null;
  distance_km?: number;
  intensity: "easy" | "moderate" | "hard";
  targetHRZone?: number;
  rationale: string;
}

// Compliance tracking
export interface ComplianceResult {
  date: Date;
  planned: PlannedWorkout | null;
  actual: StravaActivity | null;
  score: number;
  maxPossibleScore: number;
  note: string;
  emoji: "✓" | "~" | "✗" | "🎉" | "⚠️";
}

export interface CoachHappiness {
  score: number; // 0-100
  emoji: "😊" | "🙂" | "😐" | "😤" | "😡";
  trend: "improving" | "stable" | "declining";
  complianceDetails: ComplianceResult[];
  summary: string;
  warnings: string[];
}
