/**
 * Daily Prescription API Endpoint
 * 
 * POST /api/daily-prescription
 * 
 * Returns the optimal workout prescription for today based on:
 * - Remaining weekly budget
 * - Athlete readiness (sleep, stress, structural state)
 * - Safety constraints (48h rule, taper lock, etc.)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveTrainingBlock, getRecentJournal, TrainingBlock, JournalEntry } from '@/lib/db';
import { generateDailyPrescription } from '@/lib/coaching/daily-prescription-engine';
import type {
    DailyPrescriptionInput,
    Week,
    ReadinessProfile,
    WellnessData,
    RecoveryStatusV2,
    RecentActivity,
    SessionType
} from '@/lib/coaching/budget-types';
import { calculateRecoveryState } from '@/lib/coaching/recovery-state';
import { getStravaData, type RunActivity } from '@/lib/strava';


export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const stravaId = session.user.stravaId;
        const body = await req.json();
        const today = body.date ? new Date(body.date) : new Date();

        // Get active training block
        const block = await getActiveTrainingBlock(stravaId);
        if (!block) {
            return NextResponse.json({
                error: 'No active training block',
                message: 'Please set up a race goal first to receive daily prescriptions.'
            }, { status: 404 });
        }

        // Convert existing block format to new Week format
        // This is a bridge until we fully migrate the block generator
        const week = convertToWeekFormat(block, today);

        // Get recent activities for recovery spacing
        const activities = await getStravaData(stravaId);
        const recentActivities: RecentActivity[] = activities.slice(0, 14).map((a: RunActivity) => ({
            date: new Date(a.dateISO),
            type: classifyActivityType(a),
            volume: a.distance_km,
            hrData: a.heart_rate ? {
                average: a.heart_rate,
                max: a.heart_rate  // RunActivity only has average
            } : undefined
        }));

        // Get wellness data from journal
        const journalEntries = await getRecentJournal(stravaId, 7);
        const wellness = extractWellnessData(journalEntries);

        // Calculate readiness
        const readiness = calculateReadinessProfile(journalEntries, activities);

        // Calculate recovery status
        const activitiesForRecovery = activities.map((a: RunActivity) => ({
            id: String(a.id),
            name: a.name,
            date: new Date(a.dateISO),
            distance_km: a.distance_km,
            duration_minutes: a.duration_minutes,
            type: 'Run' as const,
            elevation_gain_m: a.total_elevation_gain || undefined
        }));

        const recoveryState = calculateRecoveryState({ activities: activitiesForRecovery });
        const recoveryStatus: RecoveryStatusV2 = {
            phase: recoveryState.inRecoveryWindow
                ? mapRecoveryPhase(recoveryState.phase)
                : 'normal'
        };

        // Build input for prescription engine
        const input: DailyPrescriptionInput = {
            today,
            week,
            readiness,
            wellness,
            recentActivities,
            recoveryStatus
        };

        // Generate prescription
        const prescription = await generateDailyPrescription(input);

        return NextResponse.json({
            prescription,
            week: {
                weekNumber: week.weekNumber,
                budget: week.budget,
                execution: week.execution
            },
            debug: {
                readinessScore: readiness.score,
                recoveryPhase: recoveryStatus.phase,
                daysLeftInWeek: 7 - today.getDay()
            }
        });

    } catch (error) {
        console.error('[DailyPrescription] Error:', error);
        return NextResponse.json({
            error: 'Failed to generate prescription',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// ============================================================
// BRIDGE FUNCTIONS (until full migration)
// ============================================================

interface BlockPlan {
    phases?: Array<{
        name: string;
        weekStart?: number;
        weekEnd?: number;
        weeklyKm?: number[];
    }>;
}

interface TrainingBlockLegacy {
    start_date: string;
    weekly_workouts?: Record<string, Array<{
        distance_km?: number;
        elevation_m?: number;
        intensity?: string;
        type?: string;
    }>>;
    block_plan?: BlockPlan;
}

function convertToWeekFormat(block: TrainingBlock, today: Date): Week {
    // Find current week number
    const blockStart = new Date(block.start_date);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weekNumber = Math.floor((today.getTime() - blockStart.getTime()) / msPerWeek) + 1;

    // Get this week's planned workouts from old format
    const weekKey = weekNumber.toString();
    const plannedWorkouts = block.weekly_workouts?.[weekKey] || [];

    // Calculate budget from planned workouts
    const totalVolume = plannedWorkouts.reduce((sum, w) =>
        sum + (w.distance_km || 0), 0);
    const totalVertical = plannedWorkouts.reduce((sum, w) =>
        sum + (w.elevation_m || 0), 0);

    const qualityWorkouts = plannedWorkouts.filter(w =>
        w.intensity === 'hard' || w.type?.toLowerCase().includes('interval')
    );

    const longRun = plannedWorkouts.find(w =>
        w.type?.toLowerCase().includes('long')
    );

    // Find Monday of current week
    const mondayOffset = today.getDay() === 0 ? -6 : 1 - today.getDay();
    const weekOf = new Date(today);
    weekOf.setDate(weekOf.getDate() + mondayOffset);

    // Determine available quality types based on phase
    // Calculate week ranges from cumulative weeks in phases
    let currentPhase = 'base';
    const phases = block.block_plan?.phases || [];
    let cumulativeWeeks = 0;
    for (const p of phases) {
        if (weekNumber > cumulativeWeeks && weekNumber <= cumulativeWeeks + p.weeks) {
            currentPhase = p.name;
            break;
        }
        cumulativeWeeks += p.weeks;
    }
    const availableQualityTypes = getQualityTypesForPhase(currentPhase);

    return {
        weekNumber,
        weekOf,
        budget: {
            totalVolume: totalVolume || 50, // Default 50km if no data
            totalVertical: totalVertical || 500,
            qualitySessions: qualityWorkouts.length || 2,
            longRunRange: {
                min: longRun?.distance_km ? longRun.distance_km * 0.8 : 18,
                max: longRun?.distance_km || 25
            }
        },
        availableQualityTypes,
        constraints: {
            maxSingleDayVolume: (totalVolume || 50) * 0.35,
            maxSingleDayVertical: (totalVertical || 500) * 0.5,
            minHoursBetweenQuality: 48,
            longRunDay: 'saturday'
        },
        execution: {
            completedSessions: [], // Would need Strava activity matching
            remainingBudget: {
                volume: totalVolume || 50, // TODO: subtract completed
                vertical: totalVertical || 500,
                qualitySessions: qualityWorkouts.length || 2,
                needsLongRun: true
            }
        }
    };
}

function getQualityTypesForPhase(phase: string): SessionType[] {
    const phaseLower = phase.toLowerCase();

    if (phaseLower.includes('base')) {
        return ['hill_strides'];
    }
    if (phaseLower.includes('build')) {
        return ['threshold_intervals', 'vo2_hill_repeats', 'tempo_run', 'progression_long'];
    }
    if (phaseLower.includes('specific') || phaseLower.includes('peak')) {
        return ['race_pace_segments', 'power_hike_intervals', 'course_simulation', 'back_to_back'];
    }
    if (phaseLower.includes('taper')) {
        return ['sharpener', 'opener'];
    }

    return ['hill_strides'];
}

function classifyActivityType(activity: RunActivity): RecentActivity['type'] {
    const distance = activity.distance_km;
    const avgHr = activity.heart_rate;

    // Long run: > 20km
    if (distance > 20) return 'long';

    // Quality: high HR or workout type
    if (avgHr && avgHr > 160) return 'quality';
    if (activity.workout_type === 'workout') return 'quality';

    // Recovery: very short or low HR
    if (distance < 6 || (avgHr && avgHr < 130)) return 'recovery';

    return 'easy';
}

function extractWellnessData(journalEntries: JournalEntry[]): WellnessData {
    if (!journalEntries || journalEntries.length === 0) {
        return { sleep: 7, stressLevel: 3, muscularFatigue: 3, mood: 3 };
    }

    const latest = journalEntries[0];
    return {
        sleep: latest.sleep_quality || 7,
        stressLevel: latest.stress_level || 3,
        muscularFatigue: 3, // Not tracked in current journal
        mood: 3 // Not tracked in current journal
    };
}

function calculateReadinessProfile(journalEntries: JournalEntry[], activities: RunActivity[]): ReadinessProfile {
    let score = 70; // baseline
    const riskFlags: string[] = [];

    // Check journal for issues
    if (journalEntries && journalEntries.length > 0) {
        const latest = journalEntries[0];

        // Sleep impact
        if (latest.sleep_quality && latest.sleep_quality < 5) {
            score -= 20;
            if (latest.sleep_quality < 4) riskFlags.push('poor_sleep');
        }

        // Stress impact
        if (latest.stress_level && latest.stress_level > 7) {
            score -= 15;
            if (latest.stress_level > 8) riskFlags.push('high_stress');
        }

        // Check for illness/injury tags
        const tags = latest.tags || [];
        if (tags.includes('sick') || tags.includes('illness')) {
            riskFlags.push('illness');
            score -= 30;
        }
        if (tags.includes('injury') || tags.includes('pain')) {
            riskFlags.push('injury');
            score -= 25;
        }
    }

    // Check recent activity load
    const recentVolume = activities.slice(0, 7).reduce((sum, a) =>
        sum + a.distance_km, 0);
    if (recentVolume > 100) {
        score -= 10; // High training load
    }

    return {
        score: Math.max(0, Math.min(100, score)),
        systemic: score >= 60 ? 'optimal' : score >= 40 ? 'normal' : 'compromised',
        structural: 'normal', // Would need more data
        riskFlags
    };
}

function mapRecoveryPhase(phase: string | undefined): RecoveryStatusV2['phase'] {
    if (!phase) return 'normal';
    const phaseLower = phase.toLowerCase();
    if (phaseLower.includes('acute')) return 'acute';
    if (phaseLower.includes('structural')) return 'structural';
    if (phaseLower.includes('systemic')) return 'systemic';
    if (phaseLower.includes('reintegration')) return 'reintegration';
    return 'normal';
}
