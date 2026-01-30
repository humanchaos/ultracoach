/**
 * Block Generator v2 - Budget-Based Training Plans
 * 
 * CAUTIOUS MIGRATION: This is a NEW file that generates the v1.2 budget structure.
 * The original block-generator.ts remains unchanged and continues to work.
 * 
 * Key differences from v1:
 * - Outputs weekly BUDGETS not daily workouts
 * - Uses TrainingBlockV2 with nested Phase[].Week[] structure
 * - Daily workouts are generated on-demand by daily-prescription-engine
 */

import { Race, BlockPlan, TrainingPhase } from '../db';
import type {
    TrainingBlockV2,
    Phase,
    Week,
    PhaseType,
    SessionType,
    AthleteSnapshot,
    WeekBudget,
    WeekConstraints
} from './budget-types';
import { calculateRecoveryState } from './recovery-state';
import type { StravaActivity } from './types';

// ============================================================
// MAIN GENERATOR FUNCTION
// ============================================================

export interface GenerateBlockV2Params {
    stravaId: string;
    race: Race;
    currentFitness: {
        weeklyKm: number;
        longestRun: number;
        avgPace: string;
    };
    preferences?: {
        maxWeeklyKm: number;
        trainingDays: string[];
        preferredLongRunDay?: 'saturday' | 'sunday';
    };
    athleteProfile?: {
        lt1HeartRate?: number;
        lt2HeartRate?: number;
        age?: number;
    };
    activities?: StravaActivity[];
    apiKey: string;
}

/**
 * Generate a training block with budget-based structure (v1.2)
 * 
 * This function:
 * 1. Calculates weeks until race
 * 2. Generates phase structure with session budgets
 * 3. Returns TrainingBlockV2 ready for daily-prescription-engine
 */
export async function generateTrainingBlockV2(
    params: GenerateBlockV2Params
): Promise<TrainingBlockV2> {
    const { stravaId, race, currentFitness, preferences, athleteProfile, activities } = params;

    // Calculate weeks until race
    const now = new Date();
    const raceDate = new Date(race.date);
    const msUntilRace = raceDate.getTime() - now.getTime();
    const totalWeeks = Math.max(1, Math.ceil(msUntilRace / (7 * 24 * 60 * 60 * 1000)));

    console.log(`[BlockGenerator V2] Generating budget-based block for ${race.name}, ${totalWeeks} weeks out`);

    // Check for recovery state
    let recoveryWeeksNeeded = 0;
    if (activities && activities.length > 0) {
        const recoveryState = calculateRecoveryState({ activities, athleteAge: athleteProfile?.age });
        if (recoveryState.inRecoveryWindow) {
            recoveryWeeksNeeded = recoveryState.recoveryWeeksNeeded;
            console.log(`[BlockGenerator V2] Recovery detected: ${recoveryWeeksNeeded} weeks needed`);
        }
    }

    // Create athlete snapshot
    const athleteSnapshot: AthleteSnapshot = {
        weeklyVolumeCapacity: preferences?.maxWeeklyKm || Math.min(currentFitness.weeklyKm * 1.3, 120),
        verticalCapacity: calculateVerticalCapacity(race, currentFitness.weeklyKm),
        lt1HeartRate: athleteProfile?.lt1HeartRate || 145,
        lt2HeartRate: athleteProfile?.lt2HeartRate || 165,
        injuryHistory: [],
        preferredLongRunDay: preferences?.preferredLongRunDay || 'saturday'
    };

    // Generate phases
    const phases = generatePhases(totalWeeks, recoveryWeeksNeeded, race, currentFitness);

    const blockId = `block-${stravaId}-${race.id}-${Date.now()}`;

    const block: TrainingBlockV2 = {
        id: blockId,
        athleteId: stravaId,
        raceId: String(race.id),
        raceName: race.name,
        raceDate,
        raceDistance: race.distance_km,
        raceVertical: race.elevation_gain_m || 0,
        totalWeeks,
        createdAt: now,
        athleteProfile: athleteSnapshot,
        phases
    };

    console.log(`[BlockGenerator V2] Generated ${phases.length} phases with ${totalWeeks} weeks total`);

    return block;
}

// ============================================================
// PHASE GENERATION
// ============================================================

function generatePhases(
    totalWeeks: number,
    recoveryWeeksNeeded: number,
    race: Race,
    currentFitness: { weeklyKm: number; longestRun: number }
): Phase[] {
    const phases: Phase[] = [];
    let currentWeek = 1;

    // ─────────────────────────────────────────────────────────
    // Phase 0: Recovery (if needed)
    // ─────────────────────────────────────────────────────────
    if (recoveryWeeksNeeded > 0) {
        const recoveryWeeks = Math.min(recoveryWeeksNeeded, Math.floor(totalWeeks * 0.2));
        phases.push(createRecoveryPhase(currentWeek, recoveryWeeks));
        currentWeek += recoveryWeeks;
    }

    const remainingWeeks = totalWeeks - (currentWeek - 1);

    // ─────────────────────────────────────────────────────────
    // Short block: Taper only
    // ─────────────────────────────────────────────────────────
    if (remainingWeeks <= 2) {
        phases.push(createTaperPhase(currentWeek, remainingWeeks, currentFitness.weeklyKm));
        return phases;
    }

    // ─────────────────────────────────────────────────────────
    // Standard periodization
    // ─────────────────────────────────────────────────────────

    // Taper: 1-2 weeks
    const taperWeeks = remainingWeeks <= 8 ? 1 : 2;

    // Specific: 2-4 weeks (for races > 50km, more specific work)
    const specificWeeks = race.distance_km > 50
        ? Math.min(4, Math.floor((remainingWeeks - taperWeeks) * 0.25))
        : Math.min(2, Math.floor((remainingWeeks - taperWeeks) * 0.2));

    // Build: 40% of remaining
    const buildWeeks = Math.max(2, Math.floor((remainingWeeks - taperWeeks - specificWeeks) * 0.45));

    // Base: remainder
    const baseWeeks = remainingWeeks - taperWeeks - specificWeeks - buildWeeks;

    // Generate phases in order
    if (baseWeeks > 0) {
        phases.push(createBasePhase(currentWeek, baseWeeks, currentFitness.weeklyKm, race));
        currentWeek += baseWeeks;
    }

    if (buildWeeks > 0) {
        const baseEndKm = phases.length > 0
            ? phases[phases.length - 1].volumeProgression.endPercent * currentFitness.weeklyKm
            : currentFitness.weeklyKm;
        phases.push(createBuildPhase(currentWeek, buildWeeks, baseEndKm, race));
        currentWeek += buildWeeks;
    }

    if (specificWeeks > 0) {
        phases.push(createSpecificPhase(currentWeek, specificWeeks, race));
        currentWeek += specificWeeks;
    }

    phases.push(createTaperPhase(currentWeek, taperWeeks, currentFitness.weeklyKm));

    return phases;
}

// ============================================================
// PHASE CREATORS
// ============================================================

function createRecoveryPhase(weekStart: number, weeks: number): Phase {
    const phase: Phase = {
        type: 'base', // Recovery uses base type but with restrictions
        weekStart,
        weekEnd: weekStart + weeks - 1,
        focus: 'Post-race recovery: Structural repair, aerobic maintenance only',
        volumeProgression: {
            startPercent: 0.30,
            endPercent: 0.50,
            pattern: 'linear'
        },
        allowedQualitySessions: [], // No quality in recovery
        weeks: generateRecoveryWeeks(weekStart, weeks)
    };
    return phase;
}

function createBasePhase(weekStart: number, weeks: number, currentKm: number, race: Race): Phase {
    const phase: Phase = {
        type: 'base',
        weekStart,
        weekEnd: weekStart + weeks - 1,
        focus: 'Aerobic foundation, structural durability, easy volume building',
        volumeProgression: {
            startPercent: 0.70,
            endPercent: 0.90,
            pattern: 'stepLoad'
        },
        allowedQualitySessions: ['hill_strides'],
        weeks: generateBaseWeeks(weekStart, weeks, currentKm, race)
    };
    return phase;
}

function createBuildPhase(weekStart: number, weeks: number, baseEndKm: number, race: Race): Phase {
    const phase: Phase = {
        type: 'build',
        weekStart,
        weekEnd: weekStart + weeks - 1,
        focus: 'Threshold development, VO2max work, lactate clearance',
        volumeProgression: {
            startPercent: 0.90,
            endPercent: 1.00,
            pattern: 'stepLoad'
        },
        allowedQualitySessions: [
            'threshold_intervals',
            'vo2_hill_repeats',
            'tempo_run',
            'progression_long'
        ],
        weeks: generateBuildWeeks(weekStart, weeks, baseEndKm, race)
    };
    return phase;
}

function createSpecificPhase(weekStart: number, weeks: number, race: Race): Phase {
    const phase: Phase = {
        type: 'specific',
        weekStart,
        weekEnd: weekStart + weeks - 1,
        focus: 'Race-specific preparation, terrain simulation, mental rehearsal',
        volumeProgression: {
            startPercent: 0.95,
            endPercent: 0.85,
            pattern: 'reverse' // Slight volume decrease as intensity maintains
        },
        allowedQualitySessions: [
            'race_pace_segments',
            'power_hike_intervals',
            'course_simulation',
            'back_to_back'
        ],
        weeks: generateSpecificWeeks(weekStart, weeks, race)
    };
    return phase;
}

function createTaperPhase(weekStart: number, weeks: number, peakKm: number): Phase {
    const phase: Phase = {
        type: 'taper',
        weekStart,
        weekEnd: weekStart + weeks - 1,
        focus: 'Fatigue dissipation, glycogen loading, race readiness',
        volumeProgression: {
            startPercent: 0.60,
            endPercent: 0.30,
            pattern: 'reverse'
        },
        allowedQualitySessions: ['sharpener', 'opener'],
        weeks: generateTaperWeeks(weekStart, weeks, peakKm)
    };
    return phase;
}

// ============================================================
// WEEK GENERATORS (create Week[] for each phase)
// ============================================================

function generateRecoveryWeeks(weekStart: number, count: number): Week[] {
    const weeks: Week[] = [];
    for (let i = 0; i < count; i++) {
        const weekNumber = weekStart + i;
        const progressInRecovery = (i + 1) / count;

        weeks.push({
            weekNumber,
            weekOf: getWeekOfDate(weekNumber),
            budget: {
                totalVolume: Math.round(20 + progressInRecovery * 20), // 20-40km
                totalVertical: Math.round(100 + progressInRecovery * 200), // 100-300m
                qualitySessions: 0,
                longRunRange: { min: 8, max: 12 }
            },
            availableQualityTypes: [],
            constraints: createConstraints(40),
            execution: createEmptyExecution(40)
        });
    }
    return weeks;
}

function generateBaseWeeks(weekStart: number, count: number, currentKm: number, race: Race): Week[] {
    const weeks: Week[] = [];
    const peakVolume = Math.min(currentKm * 1.3, 100);

    for (let i = 0; i < count; i++) {
        const weekNumber = weekStart + i;
        const progressInPhase = (i + 1) / count;

        // Step-load pattern: 3 weeks build, 1 week recovery
        const isRecoveryWeek = (i + 1) % 4 === 0;
        const volumeMultiplier = isRecoveryWeek ? 0.70 : (0.70 + progressInPhase * 0.25);

        const totalVolume = Math.round(peakVolume * volumeMultiplier);
        const totalVertical = calculateWeeklyVertical(totalVolume, race, 'base', progressInPhase);

        weeks.push({
            weekNumber,
            weekOf: getWeekOfDate(weekNumber),
            budget: {
                totalVolume,
                totalVertical,
                qualitySessions: isRecoveryWeek ? 0 : 1, // 1 quality (hill strides) in base
                longRunRange: {
                    min: Math.round(totalVolume * 0.25),
                    max: Math.round(totalVolume * 0.35)
                }
            },
            availableQualityTypes: ['hill_strides'],
            constraints: createConstraints(totalVolume),
            execution: createEmptyExecution(totalVolume)
        });
    }
    return weeks;
}

function generateBuildWeeks(weekStart: number, count: number, baseEndKm: number, race: Race): Week[] {
    const weeks: Week[] = [];
    const peakVolume = Math.min(baseEndKm * 1.1, 110);

    for (let i = 0; i < count; i++) {
        const weekNumber = weekStart + i;
        const progressInPhase = (i + 1) / count;

        const isRecoveryWeek = (i + 1) % 4 === 0;
        const volumeMultiplier = isRecoveryWeek ? 0.75 : (0.90 + progressInPhase * 0.10);

        const totalVolume = Math.round(peakVolume * volumeMultiplier);
        const totalVertical = calculateWeeklyVertical(totalVolume, race, 'build', progressInPhase);

        weeks.push({
            weekNumber,
            weekOf: getWeekOfDate(weekNumber),
            budget: {
                totalVolume,
                totalVertical,
                qualitySessions: isRecoveryWeek ? 1 : 2, // 2 quality in build
                longRunRange: {
                    min: Math.round(totalVolume * 0.28),
                    max: Math.round(totalVolume * 0.38)
                }
            },
            availableQualityTypes: ['threshold_intervals', 'vo2_hill_repeats', 'tempo_run', 'progression_long'],
            constraints: createConstraints(totalVolume),
            execution: createEmptyExecution(totalVolume)
        });
    }
    return weeks;
}

function generateSpecificWeeks(weekStart: number, count: number, race: Race): Week[] {
    const weeks: Week[] = [];

    for (let i = 0; i < count; i++) {
        const weekNumber = weekStart + i;
        const progressInPhase = (i + 1) / count;

        // Specific phase: high specificity, moderate-high volume
        const totalVolume = Math.round(80 - progressInPhase * 10); // 80 → 70km
        const totalVertical = calculateWeeklyVertical(totalVolume, race, 'specific', progressInPhase);

        weeks.push({
            weekNumber,
            weekOf: getWeekOfDate(weekNumber),
            budget: {
                totalVolume,
                totalVertical,
                qualitySessions: 1, // 1 quality + 1 long specific
                longRunRange: {
                    min: Math.round(race.distance_km * 0.5),
                    max: Math.round(race.distance_km * 0.7)
                }
            },
            availableQualityTypes: ['race_pace_segments', 'power_hike_intervals', 'course_simulation', 'back_to_back'],
            constraints: createConstraints(totalVolume),
            execution: createEmptyExecution(totalVolume)
        });
    }
    return weeks;
}

function generateTaperWeeks(weekStart: number, count: number, peakKm: number): Week[] {
    const weeks: Week[] = [];

    for (let i = 0; i < count; i++) {
        const weekNumber = weekStart + i;
        const progressInPhase = (i + 1) / count;

        // Aggressive taper: 60% → 30% of peak
        const volumeMultiplier = 0.60 - progressInPhase * 0.30;
        const totalVolume = Math.round(peakKm * volumeMultiplier);

        weeks.push({
            weekNumber,
            weekOf: getWeekOfDate(weekNumber),
            budget: {
                totalVolume,
                totalVertical: Math.round(totalVolume * 15), // Low vert in taper
                qualitySessions: i === 0 ? 1 : 0, // 1 sharpener first week only
                longRunRange: {
                    min: 8,
                    max: 15
                }
            },
            availableQualityTypes: i === 0 ? ['sharpener'] : ['opener'],
            constraints: {
                maxSingleDayVolume: totalVolume * 0.40,
                maxSingleDayVertical: 500,
                minHoursBetweenQuality: 48,
                longRunDay: 'saturday'
            },
            execution: createEmptyExecution(totalVolume)
        });
    }
    return weeks;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function calculateVerticalCapacity(race: Race, weeklyKm: number): number {
    if (!race.elevation_gain_m) return weeklyKm * 30; // Default 30m/km
    const raceVertDensity = race.elevation_gain_m / race.distance_km;
    return Math.round(weeklyKm * raceVertDensity * 0.8); // 80% of race density
}

function calculateWeeklyVertical(
    volumeKm: number,
    race: Race,
    phase: string,
    progressInPhase: number
): number {
    if (!race.elevation_gain_m) return Math.round(volumeKm * 25); // Default

    const raceVertDensity = race.elevation_gain_m / race.distance_km;

    // Phase-based multipliers
    let multiplier: number;
    switch (phase) {
        case 'base':
            multiplier = 0.40 + progressInPhase * 0.20; // 40% → 60%
            break;
        case 'build':
            multiplier = 0.60 + progressInPhase * 0.25; // 60% → 85%
            break;
        case 'specific':
            multiplier = 0.90; // Match race density
            break;
        default:
            multiplier = 0.30;
    }

    return Math.round(volumeKm * raceVertDensity * multiplier);
}

function createConstraints(weeklyVolume: number): WeekConstraints {
    return {
        maxSingleDayVolume: weeklyVolume * 0.35,
        maxSingleDayVertical: Math.round(weeklyVolume * 0.5 * 30), // Rough estimate
        minHoursBetweenQuality: 48,
        longRunDay: 'saturday'
    };
}

function createEmptyExecution(weeklyVolume: number): Week['execution'] {
    return {
        completedSessions: [],
        remainingBudget: {
            volume: weeklyVolume,
            vertical: 0, // Will be calculated from budget
            qualitySessions: 0, // Will be set from budget
            needsLongRun: true
        }
    };
}

function getWeekOfDate(weekNumber: number): Date {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - monday.getDay() + 1 + (weekNumber - 1) * 7);
    return monday;
}

// ============================================================
// LEGACY BRIDGE: Convert V2 to V1 format for backward compatibility
// ============================================================

export function convertV2ToLegacyBlockPlan(block: TrainingBlockV2): BlockPlan {
    const phases: TrainingPhase[] = block.phases.map(phase => ({
        name: capitalizePhaseType(phase.type),
        weeks: phase.weeks.length,
        focus: phase.focus,
        weeklyKm: phase.weeks.map(w => w.budget.totalVolume)
    }));

    return {
        totalWeeks: block.totalWeeks,
        phases,
        keyWorkouts: getKeyWorkoutsForPhases(block.phases),
        notes: `Budget-based plan generated for ${block.raceName}. Daily workouts determined by prescription engine.`
    };
}

function capitalizePhaseType(type: PhaseType): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
}

function getKeyWorkoutsForPhases(phases: Phase[]): string[] {
    const workouts = new Set<string>();
    for (const phase of phases) {
        for (const session of phase.allowedQualitySessions) {
            workouts.add(formatSessionName(session));
        }
    }
    workouts.add('Long Run');
    return Array.from(workouts);
}

function formatSessionName(session: SessionType): string {
    const names: Record<SessionType, string> = {
        hill_strides: 'Hill Strides',
        threshold_intervals: 'LT2 Intervals',
        vo2_hill_repeats: 'VO2 Hill Repeats',
        tempo_run: 'Tempo',
        progression_long: 'Progression Long',
        race_pace_segments: 'Race Pace',
        power_hike_intervals: 'Power Hikes',
        course_simulation: 'Course Simulation',
        back_to_back: 'Back-to-Back',
        sharpener: 'Sharpener',
        opener: 'Opener'
    };
    return names[session] || session;
}
