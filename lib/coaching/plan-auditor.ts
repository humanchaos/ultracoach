/**
 * Plan Auditor - "Senior Coach" Red Team Validation Layer
 * 
 * Implements four audit vectors to catch dangerous or illogical training plans:
 * 1. Recovery Reality Check - Validates intensity restrictions after major races
 * 2. Intensity Density Filter - Enforces max 2 hard sessions per rolling 7-day window
 * 3. Logical Progression Check - Catches volume spikes > 15%
 * 4. Race Specificity Filter - Ensures workouts match race distance and phase
 * 
 * Runs AFTER AI generates macro plan, BEFORE saving to DB.
 */

import { BlockPlan, DailyWorkout, Race } from '../db';
import type { StravaActivity } from './types';

// ============================================
// TYPES
// ============================================

export interface RecoveryViolation {
    weekNumber: number;
    workoutDay: string;
    workoutType: string;
    zone: string;
    daysSinceMajorEffort: number;
    allowedZone: string;
    phase: 'ACUTE' | 'STRUCTURAL' | 'SYSTEMIC' | 'REINTEGRATION';
}

export interface RecoveryAudit {
    pass: boolean;
    majorEffortDetected: boolean;
    majorEffortDate?: Date;
    majorEffortDistance?: number;
    recoveryWindowDays: number;
    violations: RecoveryViolation[];
}

export interface IntensityDensityViolation {
    windowStartDay: number;  // Day number in block (1-indexed)
    windowEndDay: number;
    weekNumber: number;
    hardSessions: { day: string; type: string; dayNumber: number }[];
    count: number;
    risk: 'moderate' | 'high';
}

export interface IntensityDensityAudit {
    pass: boolean;
    violations: IntensityDensityViolation[];
    maxHardSessionsFound: number;
}

export interface ProgressionViolation {
    fromWeek: number;
    toWeek: number;
    volumeFrom: number;
    volumeTo: number;
    percentChange: number;
    reason: string;
}

export interface ProgressionAudit {
    pass: boolean;
    violations: ProgressionViolation[];
    maxWeeklyIncrease: number;
}

export interface SpecificityViolation {
    weekNumber: number;
    weeksToRace: number;
    workoutType: string;
    phase: string;
    reason: string;
}

export interface SpecificityAudit {
    pass: boolean;
    violations: SpecificityViolation[];
}

export interface AuditFlag {
    severity: 'critical' | 'warning';
    vector: 'recovery' | 'intensity' | 'progression' | 'specificity';
    message: string;
    weekNumber?: number;
    workoutType?: string;
}

export interface TrainingPlanAudit {
    allPass: boolean;
    timestamp: Date;

    recovery: RecoveryAudit;
    intensityDensity: IntensityDensityAudit;
    progression: ProgressionAudit;
    specificity: SpecificityAudit;

    criticalFlags: AuditFlag[];
    structuralFlaws: AuditFlag[];
    fixRecommendations: string[];
}

export interface AuditInput {
    blockPlan: BlockPlan;
    weeklyWorkouts?: Record<string, DailyWorkout[]>;
    previousRace?: { date: Date; distance_km: number };
    targetRace: Race;
    startDate: Date;
    athleteAge?: number;
}

// ============================================
// CONSTANTS
// ============================================

// Recovery windows by race distance (days)
const RECOVERY_WINDOWS: Record<string, { deep: number; returnToStructure: number }> = {
    'marathon': { deep: 10, returnToStructure: 14 },
    '50k': { deep: 14, returnToStructure: 18 },
    '50m': { deep: 18, returnToStructure: 24 },
    '80k': { deep: 18, returnToStructure: 24 },
    '100k': { deep: 21, returnToStructure: 28 },
    '100m': { deep: 35, returnToStructure: 49 },
};

// Hard workout types that count toward intensity density
const HARD_WORKOUT_TYPES = [
    'Intervals',
    'Tempo',
    'LT2 Intervals',
    'VO2 Hill Repeats',
    'Race Pace Segments',
    'Sharpener',
    'Threshold',
    'Speed Work',
];

// Moderate-hard workouts (Long runs can be hard if with intensity)
const MODERATE_HARD_TYPES = [
    'Progression Long',
    'Course Simulation',
    'Back-to-Back Run',
];

// High intensity zones (Z4+)
const HIGH_INTENSITY_ZONES = ['Zone 4', 'Zone 5', 'Z4', 'Z5', 'LT2', 'VO2'];

// Workout types inappropriate for specific phases/distances
const SPECIFICITY_RULES: {
    workoutType: string;
    inappropriateWhen: { weeksOut?: [number, number]; raceDistanceKm?: [number, number]; phase?: string };
    reason: string;
}[] = [
        {
            workoutType: 'VO2 Hill Repeats',
            inappropriateWhen: { weeksOut: [0, 4], raceDistanceKm: [50, 200] },
            reason: 'VO2 Max work is ineffective 4 weeks out from an ultra. Need economy, not explosive power.',
        },
        {
            workoutType: 'Intervals',
            inappropriateWhen: { weeksOut: [0, 2] },
            reason: 'High intensity intervals too close to race. Should be tapering.',
        },
        {
            workoutType: 'LT2 Intervals',
            inappropriateWhen: { weeksOut: [0, 1] },
            reason: 'Threshold work too close to race. Last hard session should be 5-7 days out.',
        },
        {
            workoutType: 'Long Run',
            inappropriateWhen: { weeksOut: [0, 1] },
            reason: 'No long runs in final week. Last long run should be 10-14 days pre-race.',
        },
        {
            workoutType: 'Speed Work',
            inappropriateWhen: { weeksOut: [0, 6], raceDistanceKm: [80, 200] },
            reason: 'Speed work is counterproductive for 100K+. Focus on durability and economy.',
        },
    ];

// ============================================
// MAIN AUDIT FUNCTION
// ============================================

export function auditTrainingPlan(input: AuditInput): TrainingPlanAudit {
    const { blockPlan, weeklyWorkouts, previousRace, targetRace, startDate, athleteAge } = input;

    // Run all four audits
    const recovery = auditRecovery(blockPlan, weeklyWorkouts, previousRace, startDate, athleteAge);
    const intensityDensity = auditIntensityDensity(blockPlan, weeklyWorkouts);
    const progression = auditProgression(blockPlan);
    const specificity = auditSpecificity(blockPlan, weeklyWorkouts, targetRace);

    // Compile flags
    const criticalFlags: AuditFlag[] = [];
    const structuralFlaws: AuditFlag[] = [];
    const fixRecommendations: string[] = [];

    // Process recovery violations
    if (!recovery.pass) {
        for (const v of recovery.violations) {
            if (v.phase === 'ACUTE' || v.phase === 'STRUCTURAL') {
                criticalFlags.push({
                    severity: 'critical',
                    vector: 'recovery',
                    message: `Week ${v.weekNumber} ${v.workoutDay}: ${v.workoutType} (${v.zone}) scheduled ${v.daysSinceMajorEffort} days post-race. Only ${v.allowedZone} allowed in ${v.phase} phase.`,
                    weekNumber: v.weekNumber,
                    workoutType: v.workoutType,
                });
                fixRecommendations.push(`Week ${v.weekNumber} ${v.workoutDay}: Replace ${v.workoutType} with Easy Run or Rest`);
            } else {
                structuralFlaws.push({
                    severity: 'warning',
                    vector: 'recovery',
                    message: `Week ${v.weekNumber} ${v.workoutDay}: ${v.workoutType} may be too intense for ${v.phase} recovery phase.`,
                    weekNumber: v.weekNumber,
                    workoutType: v.workoutType,
                });
            }
        }
    }

    // Process intensity density violations
    if (!intensityDensity.pass) {
        for (const v of intensityDensity.violations) {
            const flag: AuditFlag = {
                severity: v.risk === 'high' ? 'critical' : 'warning',
                vector: 'intensity',
                message: `Week ${v.weekNumber}: ${v.count} hard sessions in 7-day window (${v.hardSessions.map(s => s.type).join(', ')}). Max allowed: 2. ${v.risk === 'high' ? 'HIGH INJURY RISK.' : ''}`,
                weekNumber: v.weekNumber,
            };
            if (v.risk === 'high') {
                criticalFlags.push(flag);
                fixRecommendations.push(`Week ${v.weekNumber}: Remove or downgrade ${v.hardSessions[v.count - 1].type} to Easy Run`);
            } else {
                structuralFlaws.push(flag);
            }
        }
    }

    // Process progression violations
    if (!progression.pass) {
        for (const v of progression.violations) {
            if (v.percentChange > 20) {
                criticalFlags.push({
                    severity: 'critical',
                    vector: 'progression',
                    message: `Week ${v.fromWeek}→${v.toWeek}: ${v.percentChange}% volume spike (${v.volumeFrom}km→${v.volumeTo}km). ${v.reason}`,
                    weekNumber: v.toWeek,
                });
                fixRecommendations.push(`Week ${v.toWeek}: Reduce volume from ${v.volumeTo}km to ${Math.round(v.volumeFrom * 1.1)}km (max +10%)`);
            } else {
                structuralFlaws.push({
                    severity: 'warning',
                    vector: 'progression',
                    message: `Week ${v.fromWeek}→${v.toWeek}: ${v.percentChange}% volume increase exceeds +10% guideline.`,
                    weekNumber: v.toWeek,
                });
            }
        }
    }

    // Process specificity violations
    if (!specificity.pass) {
        for (const v of specificity.violations) {
            structuralFlaws.push({
                severity: 'warning',
                vector: 'specificity',
                message: `Week ${v.weekNumber} (${v.weeksToRace} weeks out): ${v.workoutType} is not appropriate. ${v.reason}`,
                weekNumber: v.weekNumber,
                workoutType: v.workoutType,
            });
            fixRecommendations.push(`Week ${v.weekNumber}: Replace ${v.workoutType} with phase-appropriate alternative`);
        }
    }

    const allPass = criticalFlags.length === 0 && structuralFlaws.length === 0;

    return {
        allPass,
        timestamp: new Date(),
        recovery,
        intensityDensity,
        progression,
        specificity,
        criticalFlags,
        structuralFlaws,
        fixRecommendations,
    };
}

// ============================================
// VECTOR 1: RECOVERY REALITY CHECK
// ============================================

function auditRecovery(
    blockPlan: BlockPlan,
    weeklyWorkouts: Record<string, DailyWorkout[]> | undefined,
    previousRace: { date: Date; distance_km: number } | undefined,
    startDate: Date,
    athleteAge?: number
): RecoveryAudit {
    // No previous race = no recovery concerns
    if (!previousRace) {
        return {
            pass: true,
            majorEffortDetected: false,
            recoveryWindowDays: 0,
            violations: [],
        };
    }

    const raceDate = new Date(previousRace.date);
    const distanceKm = previousRace.distance_km;

    // Determine recovery window based on distance
    let windowKey = 'marathon';
    if (distanceKm >= 160) windowKey = '100m';
    else if (distanceKm >= 100) windowKey = '100k';
    else if (distanceKm >= 80) windowKey = '80k';
    else if (distanceKm >= 50) windowKey = '50k';

    let recoveryWindow = RECOVERY_WINDOWS[windowKey].returnToStructure;

    // Age adjustment (+20% for athletes >= 45)
    if (athleteAge && athleteAge >= 45) {
        recoveryWindow = Math.round(recoveryWindow * 1.2);
    }

    const violations: RecoveryViolation[] = [];

    // If we have detailed workouts, audit each one
    if (weeklyWorkouts && Object.keys(weeklyWorkouts).length > 0) {
        for (const [weekKey, workouts] of Object.entries(weeklyWorkouts)) {
            const weekNum = parseInt(weekKey);
            const weekStartDate = new Date(startDate);
            weekStartDate.setDate(weekStartDate.getDate() + (weekNum - 1) * 7);

            for (const workout of workouts) {
                const dayOffset = getDayOffset(workout.day);
                const workoutDate = new Date(weekStartDate);
                workoutDate.setDate(workoutDate.getDate() + dayOffset);

                const daysSinceRace = Math.floor((workoutDate.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));

                // Only audit if within recovery window
                if (daysSinceRace > 0 && daysSinceRace <= recoveryWindow) {
                    const phase = getRecoveryPhase(daysSinceRace);
                    const allowedZone = getAllowedZone(phase);
                    const workoutZone = workout.hrZone || 'Unknown';

                    // Check if workout intensity violates recovery phase
                    if (isIntensityViolation(workout, phase)) {
                        violations.push({
                            weekNumber: weekNum,
                            workoutDay: workout.day,
                            workoutType: workout.type,
                            zone: workoutZone,
                            daysSinceMajorEffort: daysSinceRace,
                            allowedZone,
                            phase,
                        });
                    }
                }
            }
        }
    } else {
        // Audit at phase level if no detailed workouts
        let weekCounter = 0;
        for (const phase of blockPlan.phases) {
            for (let w = 0; w < phase.weeks; w++) {
                weekCounter++;
                const weekStartDate = new Date(startDate);
                weekStartDate.setDate(weekStartDate.getDate() + (weekCounter - 1) * 7);

                const daysSinceRace = Math.floor((weekStartDate.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));

                if (daysSinceRace > 0 && daysSinceRace <= recoveryWindow) {
                    const recoveryPhase = getRecoveryPhase(daysSinceRace);
                    // Check if this phase name suggests intensity
                    if (!phase.name.toLowerCase().includes('recovery') &&
                        !phase.name.toLowerCase().includes('base') &&
                        (recoveryPhase === 'ACUTE' || recoveryPhase === 'STRUCTURAL')) {
                        violations.push({
                            weekNumber: weekCounter,
                            workoutDay: 'Week',
                            workoutType: phase.name,
                            zone: 'Unspecified',
                            daysSinceMajorEffort: daysSinceRace,
                            allowedZone: getAllowedZone(recoveryPhase),
                            phase: recoveryPhase,
                        });
                    }
                }
            }
        }
    }

    return {
        pass: violations.length === 0,
        majorEffortDetected: true,
        majorEffortDate: raceDate,
        majorEffortDistance: distanceKm,
        recoveryWindowDays: recoveryWindow,
        violations,
    };
}

function getRecoveryPhase(daysSince: number): 'ACUTE' | 'STRUCTURAL' | 'SYSTEMIC' | 'REINTEGRATION' {
    if (daysSince <= 7) return 'ACUTE';
    if (daysSince <= 14) return 'STRUCTURAL';
    if (daysSince <= 21) return 'SYSTEMIC';
    return 'REINTEGRATION';
}

function getAllowedZone(phase: 'ACUTE' | 'STRUCTURAL' | 'SYSTEMIC' | 'REINTEGRATION'): string {
    switch (phase) {
        case 'ACUTE': return 'Walking/Mobility only';
        case 'STRUCTURAL': return 'Zone 1 only (≤45min)';
        case 'SYSTEMIC': return 'Zone 1-2 only (≤75min)';
        case 'REINTEGRATION': return 'Zone 1-2, easy structure';
    }
}

function isIntensityViolation(workout: DailyWorkout, phase: 'ACUTE' | 'STRUCTURAL' | 'SYSTEMIC' | 'REINTEGRATION'): boolean {
    const type = workout.type.toLowerCase();
    const intensity = workout.intensity;
    const hrZone = workout.hrZone || '';

    // Rest is always allowed
    if (type === 'rest' || type.includes('rest')) return false;

    // ACUTE: Only walking/mobility allowed
    if (phase === 'ACUTE') {
        return type !== 'walk' && type !== 'mobility' && type !== 'rest';
    }

    // STRUCTURAL: Only Z1 runs ≤45min
    if (phase === 'STRUCTURAL') {
        if (HARD_WORKOUT_TYPES.some(h => type.includes(h.toLowerCase()))) return true;
        if (intensity === 'hard' || intensity === 'moderate') return true;
        if (HIGH_INTENSITY_ZONES.some(z => hrZone.includes(z))) return true;
        if (workout.duration_min && workout.duration_min > 45) return true;
        return false;
    }

    // SYSTEMIC: Z1-Z2 only, ≤75min
    if (phase === 'SYSTEMIC') {
        if (HARD_WORKOUT_TYPES.some(h => type.includes(h.toLowerCase()))) return true;
        if (intensity === 'hard') return true;
        if (hrZone.includes('Zone 4') || hrZone.includes('Zone 5') || hrZone.includes('Z4') || hrZone.includes('Z5')) return true;
        if (workout.duration_min && workout.duration_min > 75) return true;
        return false;
    }

    // REINTEGRATION: Easy structure, no racing/hard intervals
    if (phase === 'REINTEGRATION') {
        if (['intervals', 'tempo', 'race'].some(t => type.includes(t))) return true;
        return false;
    }

    return false;
}

function getDayOffset(dayName: string): number {
    const days: Record<string, number> = {
        'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3,
        'Friday': 4, 'Saturday': 5, 'Sunday': 6,
    };
    return days[dayName] ?? 0;
}

// ============================================
// VECTOR 2: INTENSITY DENSITY FILTER
// ============================================

function auditIntensityDensity(
    blockPlan: BlockPlan,
    weeklyWorkouts: Record<string, DailyWorkout[]> | undefined
): IntensityDensityAudit {
    const violations: IntensityDensityViolation[] = [];
    let maxHardSessionsFound = 0;

    if (!weeklyWorkouts || Object.keys(weeklyWorkouts).length === 0) {
        // Can't audit without detailed workouts
        return { pass: true, violations: [], maxHardSessionsFound: 0 };
    }

    // Flatten all workouts into a continuous array with day numbers
    const allWorkouts: { dayNumber: number; weekNumber: number; dayName: string; workout: DailyWorkout }[] = [];

    for (const [weekKey, workouts] of Object.entries(weeklyWorkouts)) {
        const weekNum = parseInt(weekKey);
        for (let i = 0; i < workouts.length; i++) {
            allWorkouts.push({
                dayNumber: (weekNum - 1) * 7 + i + 1,
                weekNumber: weekNum,
                dayName: workouts[i].day,
                workout: workouts[i],
            });
        }
    }

    // Sort by day number
    allWorkouts.sort((a, b) => a.dayNumber - b.dayNumber);

    // Check each 7-day rolling window
    for (let startIdx = 0; startIdx < allWorkouts.length; startIdx++) {
        const windowStart = allWorkouts[startIdx].dayNumber;
        const windowEnd = windowStart + 6;

        // Find all hard sessions in this window
        const hardInWindow = allWorkouts.filter(w =>
            w.dayNumber >= windowStart &&
            w.dayNumber <= windowEnd &&
            isHardSession(w.workout)
        );

        maxHardSessionsFound = Math.max(maxHardSessionsFound, hardInWindow.length);

        // Flag if more than 2 hard sessions
        if (hardInWindow.length > 2) {
            // Avoid duplicate violations for overlapping windows
            const existingViolation = violations.find(v =>
                v.windowStartDay === windowStart
            );

            if (!existingViolation) {
                violations.push({
                    windowStartDay: windowStart,
                    windowEndDay: windowEnd,
                    weekNumber: allWorkouts[startIdx].weekNumber,
                    hardSessions: hardInWindow.map(h => ({
                        day: h.dayName,
                        type: h.workout.type,
                        dayNumber: h.dayNumber,
                    })),
                    count: hardInWindow.length,
                    risk: hardInWindow.length >= 4 ? 'high' : 'moderate',
                });
            }
        }
    }

    return {
        pass: violations.length === 0,
        violations,
        maxHardSessionsFound,
    };
}

function isHardSession(workout: DailyWorkout): boolean {
    const type = workout.type;
    const intensity = workout.intensity;

    // Check explicit hard types
    if (HARD_WORKOUT_TYPES.some(h => type.includes(h))) return true;

    // Check intensity label
    if (intensity === 'hard') return true;

    // Check moderate-hard types (count as hard for density purposes)
    if (MODERATE_HARD_TYPES.some(h => type.includes(h))) return true;

    return false;
}

// ============================================
// VECTOR 3: LOGICAL PROGRESSION CHECK
// ============================================

function auditProgression(blockPlan: BlockPlan): ProgressionAudit {
    const violations: ProgressionViolation[] = [];
    let maxWeeklyIncrease = 0;

    // Flatten weekly volumes
    const weeklyVolumes: { weekNumber: number; volume: number; phaseName: string }[] = [];
    let weekCounter = 0;

    for (const phase of blockPlan.phases) {
        for (let i = 0; i < phase.weeks; i++) {
            weekCounter++;
            weeklyVolumes.push({
                weekNumber: weekCounter,
                volume: phase.weeklyKm[i] || 40,
                phaseName: phase.name,
            });
        }
    }

    // Check week-over-week progression
    for (let i = 1; i < weeklyVolumes.length; i++) {
        const prev = weeklyVolumes[i - 1];
        const curr = weeklyVolumes[i];

        const percentChange = ((curr.volume - prev.volume) / prev.volume) * 100;

        // Track max increase
        if (percentChange > 0) {
            maxWeeklyIncrease = Math.max(maxWeeklyIncrease, percentChange);
        }

        // Allow decreases (down weeks, taper)
        if (percentChange < 0) continue;

        // Flag increases > 15%
        if (percentChange > 15) {
            // Determine if this is a return from down week
            const isReturnFromDownWeek = i >= 2 &&
                weeklyVolumes[i - 2].volume > prev.volume * 1.2;

            if (!isReturnFromDownWeek) {
                violations.push({
                    fromWeek: prev.weekNumber,
                    toWeek: curr.weekNumber,
                    volumeFrom: Math.round(prev.volume),
                    volumeTo: Math.round(curr.volume),
                    percentChange: Math.round(percentChange),
                    reason: percentChange > 20
                        ? 'Dangerous volume spike. Risk of overtraining/injury.'
                        : 'Volume increase exceeds +10% weekly cap.',
                });
            }
        }
    }

    return {
        pass: violations.length === 0,
        violations,
        maxWeeklyIncrease: Math.round(maxWeeklyIncrease),
    };
}

// ============================================
// VECTOR 4: RACE SPECIFICITY FILTER
// ============================================

function auditSpecificity(
    blockPlan: BlockPlan,
    weeklyWorkouts: Record<string, DailyWorkout[]> | undefined,
    targetRace: Race
): SpecificityAudit {
    const violations: SpecificityViolation[] = [];
    const raceDistanceKm = targetRace.distance_km;
    const totalWeeks = blockPlan.totalWeeks;

    if (!weeklyWorkouts || Object.keys(weeklyWorkouts).length === 0) {
        return { pass: true, violations: [] };
    }

    // Determine current phase for each week
    const weekPhases: Record<number, string> = {};
    let weekCounter = 0;
    for (const phase of blockPlan.phases) {
        for (let i = 0; i < phase.weeks; i++) {
            weekCounter++;
            weekPhases[weekCounter] = phase.name;
        }
    }

    for (const [weekKey, workouts] of Object.entries(weeklyWorkouts)) {
        const weekNum = parseInt(weekKey);
        const weeksToRace = totalWeeks - weekNum + 1;
        const phaseName = weekPhases[weekNum] || 'Unknown';

        for (const workout of workouts) {
            // Check each specificity rule
            for (const rule of SPECIFICITY_RULES) {
                if (!workout.type.includes(rule.workoutType)) continue;

                const { inappropriateWhen } = rule;
                let isViolation = true;

                // Check weeks out
                if (inappropriateWhen.weeksOut) {
                    const [min, max] = inappropriateWhen.weeksOut;
                    if (weeksToRace < min || weeksToRace > max) {
                        isViolation = false;
                    }
                }

                // Check race distance
                if (inappropriateWhen.raceDistanceKm && isViolation) {
                    const [min, max] = inappropriateWhen.raceDistanceKm;
                    if (raceDistanceKm < min || raceDistanceKm > max) {
                        isViolation = false;
                    }
                }

                // Check phase
                if (inappropriateWhen.phase && isViolation) {
                    if (!phaseName.toLowerCase().includes(inappropriateWhen.phase.toLowerCase())) {
                        isViolation = false;
                    }
                }

                if (isViolation) {
                    // Avoid duplicate violations for same week/workout
                    const exists = violations.some(v =>
                        v.weekNumber === weekNum && v.workoutType === workout.type
                    );
                    if (!exists) {
                        violations.push({
                            weekNumber: weekNum,
                            weeksToRace,
                            workoutType: workout.type,
                            phase: phaseName,
                            reason: rule.reason,
                        });
                    }
                }
            }
        }
    }

    return {
        pass: violations.length === 0,
        violations,
    };
}

// ============================================
// UTILITY: Detect major effort from activities
// ============================================

export function findMajorEffort(activities: StravaActivity[]): { date: Date; distance_km: number } | undefined {
    // Sort by date descending to find most recent
    const sorted = [...activities].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    for (const activity of sorted) {
        if (activity.type !== 'Run') continue;

        // Marathon+
        if (activity.distance_km >= 42) {
            return { date: new Date(activity.date), distance_km: activity.distance_km };
        }
    }

    return undefined;
}

/**
 * Format audit results as a human-readable report
 */
export function formatAuditReport(audit: TrainingPlanAudit): string {
    const lines: string[] = [];

    lines.push(`# Training Plan Audit Report`);
    lines.push(`Generated: ${audit.timestamp.toISOString()}`);
    lines.push(`Overall Status: ${audit.allPass ? '✅ PASS' : '❌ ISSUES DETECTED'}`);
    lines.push('');

    if (audit.criticalFlags.length > 0) {
        lines.push('## 🚨 Critical Flags (Must Fix)');
        for (const flag of audit.criticalFlags) {
            lines.push(`- [${flag.vector.toUpperCase()}] ${flag.message}`);
        }
        lines.push('');
    }

    if (audit.structuralFlaws.length > 0) {
        lines.push('## ⚠️ Structural Flaws (Review Recommended)');
        for (const flag of audit.structuralFlaws) {
            lines.push(`- [${flag.vector.toUpperCase()}] ${flag.message}`);
        }
        lines.push('');
    }

    if (audit.fixRecommendations.length > 0) {
        lines.push('## 🔧 Fix Recommendations');
        for (const fix of audit.fixRecommendations) {
            lines.push(`- ${fix}`);
        }
        lines.push('');
    }

    // Summary stats
    lines.push('## Summary');
    lines.push(`- Recovery: ${audit.recovery.pass ? '✅' : '❌'} ${audit.recovery.majorEffortDetected ? `(${audit.recovery.recoveryWindowDays} day window)` : '(No major effort detected)'}`);
    lines.push(`- Intensity Density: ${audit.intensityDensity.pass ? '✅' : '❌'} (Max ${audit.intensityDensity.maxHardSessionsFound} hard sessions in 7-day window)`);
    lines.push(`- Progression: ${audit.progression.pass ? '✅' : '❌'} (Max ${audit.progression.maxWeeklyIncrease}% weekly increase)`);
    lines.push(`- Specificity: ${audit.specificity.pass ? '✅' : '❌'}`);

    return lines.join('\n');
}
