/**
 * Safety Interlocks (v1.2)
 * 
 * Hard-coded constraints that cannot be overridden by the AI or user.
 * These are the non-negotiable guardrails for athlete safety.
 */

import type {
    SessionCandidate,
    DailyPrescriptionInput,
    HRZone
} from './budget-types';

// ============================================================
// SAFETY CONSTANTS
// ============================================================

export const SAFETY_INTERLOCKS = {
    // Time-based
    MIN_HOURS_BETWEEN_QUALITY: 48,

    // Volume caps (prevent cramming)
    MAX_SINGLE_DAY_VOLUME_PERCENT: 0.35,      // 35% of weekly target
    MAX_LONG_RUN_PERCENT: 0.40,               // 40% of weekly volume
    MAX_SINGLE_DAY_VERTICAL_PERCENT: 0.50,    // 50% of weekly vert

    // Sleep gate
    MIN_SLEEP_FOR_INTENSITY: 6,               // hours

    // Taper protection
    TAPER_WINDOW_DAYS: 14,
    TAPER_INTENSITY_CEILING: 'Z4' as HRZone,  // No Z5 in final 2 weeks

    // Minimum viable week
    MIN_VIABLE_WEEK: {
        qualitySessions: 1,
        longRunRequired: true,
        minVolumePercent: 0.60
    }
} as const;

// ============================================================
// CONSTRAINT CHECKER
// ============================================================

export interface ConstraintResult {
    passes: boolean;
    violations: string[];
}

export function passesAllConstraints(
    session: SessionCandidate,
    input: DailyPrescriptionInput
): ConstraintResult {
    const violations: string[] = [];

    // ─────────────────────────────────────────────────────────
    // 48-Hour Rule
    // ─────────────────────────────────────────────────────────
    if (session.type === 'quality') {
        const hoursSince = getHoursSinceLastQuality(input.recentActivities);
        if (hoursSince < SAFETY_INTERLOCKS.MIN_HOURS_BETWEEN_QUALITY) {
            violations.push(
                `48h rule: ${hoursSince.toFixed(0)}h since last quality (need 48h)`
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    // Sleep Gate
    // ─────────────────────────────────────────────────────────
    if (session.type === 'quality' &&
        input.wellness.sleep < SAFETY_INTERLOCKS.MIN_SLEEP_FOR_INTENSITY) {
        violations.push(
            `Sleep gate: ${input.wellness.sleep}h sleep blocks intensity (need 6h)`
        );
    }

    // ─────────────────────────────────────────────────────────
    // Volume Cap
    // ─────────────────────────────────────────────────────────
    const maxDailyVolume = input.week.budget.totalVolume *
        SAFETY_INTERLOCKS.MAX_SINGLE_DAY_VOLUME_PERCENT;
    if (session.targetVolume > maxDailyVolume) {
        violations.push(
            `Volume cap: ${session.targetVolume}km exceeds daily max ${maxDailyVolume.toFixed(0)}km`
        );
    }

    // ─────────────────────────────────────────────────────────
    // Vertical Cap
    // ─────────────────────────────────────────────────────────
    const maxDailyVertical = input.week.budget.totalVertical *
        SAFETY_INTERLOCKS.MAX_SINGLE_DAY_VERTICAL_PERCENT;
    if (session.targetVertical > maxDailyVertical) {
        violations.push(
            `Vertical cap: ${session.targetVertical}m exceeds daily max ${maxDailyVertical.toFixed(0)}m`
        );
    }

    // ─────────────────────────────────────────────────────────
    // Taper Lock
    // ─────────────────────────────────────────────────────────
    // Note: raceDate would need to be passed in input or derived from week
    // For now, we check if we're in taper phase based on week constraints
    if (session.hrZones.primary === 'Z5') {
        // If we're in a taper window (would need race date context)
        // This is a placeholder - full implementation needs race date
        const isInTaper = input.week.constraints.longRunDay === 'flexible'; // Proxy for taper
        if (isInTaper) {
            violations.push(
                `Taper lock: No Z5 within ${SAFETY_INTERLOCKS.TAPER_WINDOW_DAYS} days of race`
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    // Recovery Phase Restrictions
    // ─────────────────────────────────────────────────────────
    if (input.recoveryStatus.phase !== 'normal') {
        if (session.type === 'quality') {
            violations.push(
                `Recovery phase: No quality sessions during ${input.recoveryStatus.phase} recovery`
            );
        }
        if (session.type === 'long' && input.recoveryStatus.phase === 'acute') {
            violations.push(
                `Recovery phase: No long runs during acute recovery`
            );
        }
    }

    return {
        passes: violations.length === 0,
        violations
    };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getHoursSinceLastQuality(
    activities: DailyPrescriptionInput['recentActivities']
): number {
    const qualityActivities = activities
        .filter(a => a.type === 'quality')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (qualityActivities.length === 0) {
        return 999; // No recent quality = unlimited time since
    }

    const lastQuality = qualityActivities[0];
    const now = new Date();
    const msSince = now.getTime() - new Date(lastQuality.date).getTime();
    return msSince / (1000 * 60 * 60);
}

export function getDaysLeftInWeek(today: Date): number {
    const dayOfWeek = today.getDay();
    // Sunday = 0, so days left = 7 - dayOfWeek (Mon is 1, so 6 days left)
    // But if today is Sunday (0), that's the last day (0 left after today)
    return dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
}

export function getDaysUntil(from: Date, to: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.ceil((to.getTime() - from.getTime()) / msPerDay);
}

export function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
}

// ============================================================
// MINIMUM VIABLE WEEK CHECK
// ============================================================

export function isMinimumViableWeekAtRisk(
    remaining: DailyPrescriptionInput['week']['execution']['remainingBudget'],
    daysLeft: number
): boolean {
    // If we have quality sessions left and days are running out
    if (remaining.qualitySessions >= 1 && daysLeft <= 2) {
        return true;
    }

    // If long run is needed and we're past Thursday
    if (remaining.needsLongRun && daysLeft <= 3) {
        return true;
    }

    // If volume is way behind (< 60% with only 2 days left)
    // Note: This would need total budget to calculate percentage

    return false;
}
