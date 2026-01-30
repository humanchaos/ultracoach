/**
 * Shared Type Definitions
 * Single source of truth for common types across the app.
 */

// ============================================
// RACE TYPES
// ============================================

export interface Race {
    id?: number;
    name: string;
    date: string;
    distance_km: number;
    race_type?: string;
    goal_time?: string;
    priority?: 'A' | 'B' | 'C';
    notes?: string;
}

// ============================================
// ACTIVITY TYPES
// ============================================

export interface Activity {
    id?: string;
    name: string;
    date: string;
    dateISO?: string;  // ISO format for accurate date parsing
    distance_km: number;
    duration_minutes?: number;
    pace?: string;
    pace_min_per_km?: number;
    average_hr?: number;
    max_hr?: number;
    heart_rate?: number;  // Legacy alias for average_hr
    elevation_gain_m?: number;
    suffer_score?: number;
    type?: string;
}

// ============================================
// ATHLETE TYPES
// ============================================

export interface AthleteProfile {
    firstName?: string;
    lastName?: string;
    sex?: 'M' | 'F' | null;
    age?: number | null;
    weight?: number | null;  // kg
    city?: string | null;
    country?: string | null;
}

export interface UserPreferences {
    training_days?: string[];
    long_run_day?: string;
    max_weekly_km?: number;
    notes?: string;
    injuries?: string[];
    dietary_restrictions?: string[];
}

// ============================================
// TRAINING TYPES
// ============================================

export type TrainingPhaseType =
    | "recovery"
    | "maintain"
    | "general"
    | "base"
    | "build"
    | "peak"
    | "taper"
    | "race_week";

export interface TrainingPhase {
    phase: TrainingPhaseType;
    label: string;
    icon: string;
    color: string;
    weeksUntil?: number;
    daysUntil?: number;
    nextRace?: Race;
    recentRace?: Race | Activity;
    recoveryDaysLeft?: number;
}

// ============================================
// PLAN TYPES
// ============================================

export interface DayPlan {
    day: string;
    date: string;
    type: string;
    title: string;
    duration?: string;
    description: string;
    intensity?: string;
}

export interface WeeklyPlan {
    days: DayPlan[];
    summary: string;
    generatedAt: Date;
}
