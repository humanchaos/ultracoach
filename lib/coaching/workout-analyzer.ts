/**
 * Workout Analyzer
 * 
 * Compares Strava activities against planned workouts and generates
 * contextual insights for the AI coach.
 */

import { StravaActivity } from "./types";
import { DailyWorkout } from "../db";

// ============================================
// TYPES
// ============================================

export interface WorkoutAnalysis {
    activityId: string;
    activityName: string;
    activityDate: Date;
    distanceKm: number;
    durationMin: number;
    avgHR?: number;

    // Matched planned workout (if found)
    matchedWorkout?: {
        day: string;
        type: string;
        plannedDistanceKm?: number;
        plannedIntensity?: string;
        description?: string;
    };

    // Comparison results
    comparison: {
        matchStatus: 'matched' | 'extra' | 'no-plan';
        distanceMatch: 'under' | 'on-target' | 'over' | 'unknown';
        distanceDeltaKm: number;
        distanceDeltaPercent: number;
        intensityMatch?: 'easier' | 'on-target' | 'harder' | 'unknown';
    };

    // One-line insight for the coach
    insight: string;
}

export interface WeeklyAnalysisSummary {
    weekNumber: number;
    weekStart: Date;
    weekEnd: Date;
    plannedWorkouts: number;
    completedWorkouts: number;
    extraWorkouts: number;
    plannedDistanceKm: number;
    actualDistanceKm: number;
    volumeCompliancePercent: number;
    analyses: WorkoutAnalysis[];
    overallInsight: string;
}

// ============================================
// MAIN ANALYZER
// ============================================

/**
 * Analyze recent activities against the training plan
 */
export function analyzeRecentWorkouts(
    activities: StravaActivity[],
    weeklyWorkouts: Record<string, DailyWorkout[]>,
    blockStartDate: Date,
    lookbackDays: number = 7
): WorkoutAnalysis[] {
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    // Filter to recent run activities
    const recentRuns = activities
        .filter(a => a.type === "Run" && new Date(a.date) >= cutoffDate)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (recentRuns.length === 0) {
        return [];
    }

    const analyses: WorkoutAnalysis[] = [];

    for (const activity of recentRuns) {
        const activityDate = new Date(activity.date);
        const weekNumber = getWeekNumber(activityDate, blockStartDate);
        const dayOfWeek = getDayOfWeek(activityDate);

        // Find matching planned workout
        const weekKey = `week${weekNumber}`;
        const plannedForWeek = weeklyWorkouts[weekKey] || [];
        const matchedWorkout = findMatchingWorkout(plannedForWeek, dayOfWeek, activity);

        // Build comparison
        const comparison = compareWorkout(activity, matchedWorkout);

        // Generate insight
        const insight = generateInsight(activity, matchedWorkout, comparison);

        analyses.push({
            activityId: activity.id,
            activityName: activity.name,
            activityDate: activityDate,
            distanceKm: activity.distance_km,
            durationMin: activity.duration_minutes,
            avgHR: activity.average_hr,
            matchedWorkout: matchedWorkout ? {
                day: matchedWorkout.day,
                type: matchedWorkout.type,
                plannedDistanceKm: matchedWorkout.distance_km,
                plannedIntensity: matchedWorkout.intensity,
                description: matchedWorkout.description,
            } : undefined,
            comparison,
            insight,
        });
    }

    return analyses;
}

/**
 * Generate a weekly analysis summary
 */
export function analyzeWeek(
    activities: StravaActivity[],
    plannedWorkouts: DailyWorkout[],
    weekStart: Date,
    weekNumber: number
): WeeklyAnalysisSummary {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Filter activities for this week
    const weekActivities = activities.filter(a => {
        const d = new Date(a.date);
        return d >= weekStart && d <= weekEnd && a.type === "Run";
    });

    // Calculate totals
    const plannedDistanceKm = plannedWorkouts
        .filter(w => w.type?.toLowerCase() !== 'rest')
        .reduce((sum, w) => sum + (w.distance_km || 0), 0);

    const actualDistanceKm = weekActivities
        .reduce((sum, a) => sum + a.distance_km, 0);

    const plannedCount = plannedWorkouts.filter(w => w.type?.toLowerCase() !== 'rest').length;
    const completedCount = weekActivities.length;
    const extraCount = Math.max(0, completedCount - plannedCount);

    const volumeCompliance = plannedDistanceKm > 0
        ? Math.round((actualDistanceKm / plannedDistanceKm) * 100)
        : 100;

    // Analyze each workout
    const analyses = weekActivities.map(activity => {
        const dayOfWeek = getDayOfWeek(new Date(activity.date));
        const matchedWorkout = findMatchingWorkout(plannedWorkouts, dayOfWeek, activity);
        const comparison = compareWorkout(activity, matchedWorkout);
        const insight = generateInsight(activity, matchedWorkout, comparison);

        return {
            activityId: activity.id,
            activityName: activity.name,
            activityDate: new Date(activity.date),
            distanceKm: activity.distance_km,
            durationMin: activity.duration_minutes,
            avgHR: activity.average_hr,
            matchedWorkout: matchedWorkout ? {
                day: matchedWorkout.day,
                type: matchedWorkout.type,
                plannedDistanceKm: matchedWorkout.distance_km,
                plannedIntensity: matchedWorkout.intensity,
                description: matchedWorkout.description,
            } : undefined,
            comparison,
            insight,
        };
    });

    // Generate overall insight
    const overallInsight = generateWeeklyInsight(volumeCompliance, completedCount, plannedCount, analyses);

    return {
        weekNumber,
        weekStart,
        weekEnd,
        plannedWorkouts: plannedCount,
        completedWorkouts: completedCount,
        extraWorkouts: extraCount,
        plannedDistanceKm,
        actualDistanceKm,
        volumeCompliancePercent: volumeCompliance,
        analyses,
        overallInsight,
    };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getWeekNumber(date: Date, blockStartDate: Date): number {
    const diffMs = date.getTime() - blockStartDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}

function getDayOfWeek(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
}

function findMatchingWorkout(
    plannedWorkouts: DailyWorkout[],
    dayOfWeek: string,
    activity: StravaActivity
): DailyWorkout | null {
    // First try exact day match
    const dayMatch = plannedWorkouts.find(w =>
        w.day?.toLowerCase() === dayOfWeek.toLowerCase() &&
        w.type?.toLowerCase() !== 'rest'
    );

    if (dayMatch) return dayMatch;

    // If no day match, try to match by workout type based on activity characteristics
    // Long runs typically > 15km, tempo/intervals detected by name patterns
    const activityLower = activity.name.toLowerCase();

    if (activity.distance_km >= 15 || activityLower.includes('long')) {
        return plannedWorkouts.find(w =>
            w.type?.toLowerCase().includes('long') ||
            (w.distance_km && w.distance_km >= 15)
        ) || null;
    }

    if (activityLower.includes('tempo') || activityLower.includes('threshold')) {
        return plannedWorkouts.find(w =>
            w.type?.toLowerCase().includes('tempo') ||
            w.intensity?.toLowerCase() === 'threshold'
        ) || null;
    }

    if (activityLower.includes('interval') || activityLower.includes('speed')) {
        return plannedWorkouts.find(w =>
            w.type?.toLowerCase().includes('interval') ||
            w.type?.toLowerCase().includes('speed')
        ) || null;
    }

    return null;
}

function compareWorkout(
    activity: StravaActivity,
    planned: DailyWorkout | null
): WorkoutAnalysis['comparison'] {
    if (!planned) {
        return {
            matchStatus: 'no-plan',
            distanceMatch: 'unknown',
            distanceDeltaKm: 0,
            distanceDeltaPercent: 0,
            intensityMatch: 'unknown',
        };
    }

    const plannedKm = planned.distance_km || 0;
    const actualKm = activity.distance_km;
    const deltaKm = actualKm - plannedKm;
    const deltaPercent = plannedKm > 0 ? Math.round((deltaKm / plannedKm) * 100) : 0;

    // Distance match (within 15% = on-target)
    let distanceMatch: WorkoutAnalysis['comparison']['distanceMatch'] = 'unknown';
    if (plannedKm > 0) {
        if (deltaPercent < -15) distanceMatch = 'under';
        else if (deltaPercent > 15) distanceMatch = 'over';
        else distanceMatch = 'on-target';
    }

    // Intensity match (if we have HR data and planned intensity)
    let intensityMatch: WorkoutAnalysis['comparison']['intensityMatch'] = 'unknown';
    if (activity.average_hr && planned.intensity) {
        // Simple heuristic: "easy" should be < 145bpm avg, "hard" > 160bpm
        const hr = activity.average_hr;
        const plannedIntensity = planned.intensity.toLowerCase();

        if (plannedIntensity.includes('easy') || plannedIntensity.includes('zone 2')) {
            if (hr < 145) intensityMatch = 'on-target';
            else if (hr < 160) intensityMatch = 'harder';
            else intensityMatch = 'harder';
        } else if (plannedIntensity.includes('tempo') || plannedIntensity.includes('threshold')) {
            if (hr >= 155 && hr <= 175) intensityMatch = 'on-target';
            else if (hr < 155) intensityMatch = 'easier';
            else intensityMatch = 'harder';
        }
    }

    return {
        matchStatus: 'matched',
        distanceMatch,
        distanceDeltaKm: Math.round(deltaKm * 10) / 10,
        distanceDeltaPercent: deltaPercent,
        intensityMatch,
    };
}

function generateInsight(
    activity: StravaActivity,
    planned: DailyWorkout | null,
    comparison: WorkoutAnalysis['comparison']
): string {
    const dateStr = formatDate(new Date(activity.date));

    if (!planned || comparison.matchStatus === 'no-plan') {
        // Extra/unplanned workout
        if (activity.distance_km >= 15) {
            return `${dateStr}: Unplanned long run (${activity.distance_km.toFixed(1)}km) - coach should check recovery implications`;
        }
        return `${dateStr}: Extra run logged (${activity.distance_km.toFixed(1)}km)`;
    }

    // Matched workout
    const parts: string[] = [];
    parts.push(`${dateStr}: ${planned.type || 'Run'}`);

    if (comparison.distanceMatch === 'under') {
        parts.push(`${Math.abs(comparison.distanceDeltaPercent)}% shorter than planned`);
    } else if (comparison.distanceMatch === 'over') {
        parts.push(`${comparison.distanceDeltaPercent}% longer than planned`);
    } else if (comparison.distanceMatch === 'on-target') {
        parts.push(`distance on target`);
    }

    if (comparison.intensityMatch === 'easier') {
        parts.push(`ran easier than prescribed`);
    } else if (comparison.intensityMatch === 'harder') {
        parts.push(`ran harder than prescribed`);
    }

    return parts.join(' - ');
}

function generateWeeklyInsight(
    volumeCompliance: number,
    completed: number,
    planned: number,
    analyses: WorkoutAnalysis[]
): string {
    const parts: string[] = [];

    // Volume compliance
    if (volumeCompliance >= 90 && volumeCompliance <= 110) {
        parts.push('Volume on target');
    } else if (volumeCompliance < 90) {
        parts.push(`Volume ${100 - volumeCompliance}% under target`);
    } else {
        parts.push(`Volume ${volumeCompliance - 100}% over target`);
    }

    // Session count
    if (completed === planned) {
        parts.push(`all ${planned} sessions completed`);
    } else if (completed < planned) {
        parts.push(`${planned - completed} of ${planned} sessions missed`);
    } else {
        parts.push(`${completed - planned} extra sessions`);
    }

    // Check for intensity issues
    const tooHard = analyses.filter(a => a.comparison.intensityMatch === 'harder').length;
    if (tooHard >= 2) {
        parts.push(`⚠️ ${tooHard} sessions ran harder than prescribed`);
    }

    return parts.join('. ') + '.';
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ============================================
// PROMPT FORMATTING
// ============================================

/**
 * Format workout analyses for injection into AI prompt
 */
export function formatWorkoutAnalysisForPrompt(analyses: WorkoutAnalysis[]): string {
    if (analyses.length === 0) {
        return '';
    }

    const lines: string[] = [
        '## RECENT WORKOUT ANALYSIS',
        '',
        'Comparison of recent activities against the training plan:',
        '',
    ];

    for (const analysis of analyses) {
        lines.push(`• ${analysis.insight}`);
    }

    // Add summary if multiple workouts
    if (analyses.length >= 3) {
        const onTarget = analyses.filter(a => a.comparison.distanceMatch === 'on-target').length;
        const tooHard = analyses.filter(a => a.comparison.intensityMatch === 'harder').length;

        lines.push('');
        lines.push('**Summary:**');
        lines.push(`${onTarget}/${analyses.length} workouts hit distance targets.`);
        if (tooHard > 0) {
            lines.push(`⚠️ ${tooHard} workouts executed at higher intensity than prescribed.`);
        }
    }

    return lines.join('\n');
}
