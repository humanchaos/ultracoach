/**
 * Coaching Logic - Stateful Training Plan Management
 * 
 * Core responsibilities:
 * 1. Check for existing training plan on user login
 * 2. Audit compliance against Strava activities
 * 3. Apply adaptive modifications based on adherence
 * 4. Calculate readiness from wellness journal data
 * 
 * Philosophy: "Uphill Athlete" & "80/20 Running"
 * - Prioritize volume and aerobic base (Zone 2) over intensity
 * - Be the "Sharp Friend" - direct, data-driven, honest
 */

import { TrainingBlock, BlockPlan, TrainingPhase, JournalEntry } from '../db';

// ============================================
// TYPES
// ============================================

export interface StravaActivity {
    id: string;
    date: Date;
    distance_km: number;
    type: 'Run' | 'Walk' | 'Hike' | 'Ride' | 'Swim' | 'Other';
    average_hr?: number;
    max_hr?: number;
}

export interface ComplianceReport {
    compliance: number;        // 0-100 percentage
    missedLongRun: boolean;
    intensityMismatch: boolean;
    volumeDeficit: number;     // km missed vs planned
    volumeActual: number;      // km actually logged
    volumePlanned: number;     // km that was planned
    weekNumber: number;
}

export interface CoachingDecision {
    action: 'keep' | 'modify' | 'regenerate';
    compliance: number;
    message: string;
    modifiedBlock?: TrainingBlock;
}

export interface ReadinessReport {
    score: number;              // 0-100 (100 = fully ready)
    status: 'optimal' | 'moderate' | 'critical';
    avgSleep: number | null;    // Average sleep score (last N days)
    avgStress: number | null;   // Average stress score (last N days)
    shouldDowngrade: boolean;   // Should reduce workout intensity
    reason?: string;            // Human-readable reason for downgrade
}

// ============ LAYER 2: MATH VALIDATION ============

export interface VolumeValidation {
    isValid: boolean;
    actualVolume: number;
    targetVolume: number;
    deviation: number;          // percentage deviation (e.g., 15 = 15% over)
    scalarMultiplier?: number;  // factor to resize workouts (e.g., 0.9 to reduce by 10%)
}

// ============ LAYER 3: DRIFT DETECTION ============

export interface DriftReport {
    isDrifted: boolean;
    consecutiveMissedWeeks: number;
    weeklyDeficits: { weekNumber: number; plannedKm: number; actualKm: number; deficit: number }[];
    cumulativeDeficit: number;  // total percentage missed
    recommendation: 'continue' | 'regenerate';
    reason?: string;
}

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Compliance thresholds
    COMPLIANCE_GOOD: 80,           // Above this = keep plan
    COMPLIANCE_POOR: 50,           // Below this = modify plan

    // Volume adaptation
    VOLUME_REDUCTION_PERCENT: 0.10, // 10% reduction for missed workouts

    // Long run detection
    LONG_RUN_RATIO: 0.35,          // Long run should be ~35% of weekly km

    // Intensity zones (HR-based)
    ZONE_2_MAX_HR_PERCENT: 0.75,   // Zone 2 should be below 75% of max HR
    ZONE_4_MIN_HR_PERCENT: 0.85,   // Zone 4 is above 85% of max HR
    DEFAULT_MAX_HR: 190,           // Fallback if unknown
};

// ============================================
// COMPLIANCE AUDITING
// ============================================

/**
 * Audit a user's compliance for a specific week
 * Compares planned workout targets against actual Strava activities
 */
export function auditCompliance(
    block: TrainingBlock,
    activities: StravaActivity[],
    weekNumber: number
): ComplianceReport {
    // Get planned volume for this week
    const plannedKm = getPlannedKmForWeek(block.block_plan, weekNumber);

    // Sum actual volume from activities
    const actualKm = activities
        .filter(a => a.type === 'Run')
        .reduce((sum, a) => sum + a.distance_km, 0);

    // Calculate compliance percentage
    const compliance = plannedKm > 0
        ? Math.min(100, Math.round((actualKm / plannedKm) * 100))
        : 100;

    // Check for missed long run
    const expectedLongRunKm = plannedKm * CONFIG.LONG_RUN_RATIO;
    const longestRun = Math.max(0, ...activities
        .filter(a => a.type === 'Run')
        .map(a => a.distance_km));
    const missedLongRun = longestRun < expectedLongRunKm * 0.7; // 70% threshold

    // Check for intensity mismatch (ran too hard)
    const intensityMismatch = activities.some(a => {
        if (!a.average_hr) return false;
        const maxHr = CONFIG.DEFAULT_MAX_HR;
        const zone4Threshold = maxHr * CONFIG.ZONE_4_MIN_HR_PERCENT;
        return a.average_hr > zone4Threshold;
    });

    return {
        compliance,
        missedLongRun,
        intensityMismatch,
        volumeDeficit: Math.max(0, plannedKm - actualKm),
        volumeActual: actualKm,
        volumePlanned: plannedKm,
        weekNumber,
    };
}

/**
 * Get planned km for a specific week number in the block
 */
function getPlannedKmForWeek(plan: BlockPlan, weekNumber: number): number {
    let weekCounter = 0;

    for (const phase of plan.phases) {
        for (let i = 0; i < phase.weeks; i++) {
            weekCounter++;
            if (weekCounter === weekNumber) {
                return phase.weeklyKm[i] || phase.weeklyKm[0] || 40;
            }
        }
    }

    // Week beyond plan - return last week's value
    const lastPhase = plan.phases[plan.phases.length - 1];
    return lastPhase?.weeklyKm[lastPhase.weeklyKm.length - 1] || 40;
}

// ============================================
// ADAPTIVE MODIFICATIONS
// ============================================

/**
 * Apply adaptations to the training block based on compliance report
 * 
 * Rules:
 * - Compliance > 80%: Keep plan unchanged
 * - Missed long run / Compliance < 50%: Reduce future volume by 10%
 * - Intensity mismatch: Force recovery (handled at weekly plan level)
 */
export function applyAdaptations(
    block: TrainingBlock,
    report: ComplianceReport,
    weekNumber: number
): TrainingBlock {
    // High compliance - no changes needed
    if (report.compliance >= CONFIG.COMPLIANCE_GOOD && !report.missedLongRun) {
        return block;
    }

    // Need to modify - create a deep copy
    const modifiedBlock: TrainingBlock = JSON.parse(JSON.stringify(block));

    // Apply volume reduction for future weeks
    if (report.missedLongRun || report.compliance < CONFIG.COMPLIANCE_POOR) {
        modifyFutureVolume(modifiedBlock.block_plan, weekNumber, CONFIG.VOLUME_REDUCTION_PERCENT);
    }

    return modifiedBlock;
}

/**
 * Reduce volume for all weeks after the current week
 */
function modifyFutureVolume(plan: BlockPlan, afterWeek: number, reductionPercent: number): void {
    let weekCounter = 0;

    for (const phase of plan.phases) {
        for (let i = 0; i < phase.weeklyKm.length; i++) {
            weekCounter++;
            if (weekCounter > afterWeek) {
                // Apply reduction and round to whole number
                phase.weeklyKm[i] = Math.round(phase.weeklyKm[i] * (1 - reductionPercent));
            }
        }
    }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

/**
 * Process user login - main decision engine
 * 
 * Flow:
 * 1. Check if training block exists
 * 2. If no block -> signal regeneration needed
 * 3. If block exists -> audit compliance and adapt
 */
export function processLoginDecision(
    block: TrainingBlock | null,
    activities: StravaActivity[],
    currentWeek: number
): CoachingDecision {
    // No plan exists
    if (!block) {
        return {
            action: 'regenerate',
            compliance: 0,
            message: 'No active training plan found. Let me create one based on your goals and fitness.',
        };
    }

    // Audit compliance
    const report = auditCompliance(block, activities, currentWeek);

    // High compliance - keep plan
    if (report.compliance >= CONFIG.COMPLIANCE_GOOD && !report.missedLongRun && !report.intensityMismatch) {
        return {
            action: 'keep',
            compliance: report.compliance,
            message: `Great work! You hit ${report.compliance}% of your targets this week. Keep it up.`,
        };
    }

    // Modify plan based on issues
    const modifiedBlock = applyAdaptations(block, report, currentWeek);

    let message = '';
    if (report.missedLongRun) {
        message = `You missed your long run this week. I've reduced next week's volume by 10% to help you recover and stay consistent.`;
    } else if (report.intensityMismatch) {
        message = `I noticed you ran too hard on what should have been an easy day. Tomorrow should be complete rest or very easy movement only.`;
    } else {
        message = `Compliance was ${report.compliance}%. I've adjusted the plan to be more achievable. Let's build back up gradually.`;
    }

    return {
        action: 'modify',
        compliance: report.compliance,
        message,
        modifiedBlock,
    };
}

// ============================================
// HELPER: GET CURRENT PHASE INFO
// ============================================

export interface CurrentPhaseInfo {
    phaseName: string;
    weekInPhase: number;
    totalWeeksInPhase: number;
    weekInBlock: number;
    totalWeeksInBlock: number;
    focus: string;
    targetKm: number;
}

export function getCurrentPhaseInfo(block: TrainingBlock, currentWeek: number): CurrentPhaseInfo {
    let weekCounter = 0;

    for (const phase of block.block_plan.phases) {
        for (let i = 0; i < phase.weeks; i++) {
            weekCounter++;
            if (weekCounter === currentWeek) {
                return {
                    phaseName: phase.name,
                    weekInPhase: i + 1,
                    totalWeeksInPhase: phase.weeks,
                    weekInBlock: currentWeek,
                    totalWeeksInBlock: block.block_plan.totalWeeks,
                    focus: phase.focus,
                    targetKm: phase.weeklyKm[i] || phase.weeklyKm[0],
                };
            }
        }
    }

    // Fallback to last phase
    const lastPhase = block.block_plan.phases[block.block_plan.phases.length - 1];
    return {
        phaseName: lastPhase.name,
        weekInPhase: lastPhase.weeks,
        totalWeeksInPhase: lastPhase.weeks,
        weekInBlock: block.block_plan.totalWeeks,
        totalWeeksInBlock: block.block_plan.totalWeeks,
        focus: lastPhase.focus,
        targetKm: lastPhase.weeklyKm[lastPhase.weeklyKm.length - 1],
    };
}

// ============================================
// READINESS CALCULATION (Bio-Feedback Loop)
// ============================================

/**
 * Calculate athlete readiness from journal entries.
 * 
 * Critical triggers (shouldDowngrade = true):
 * - Avg sleep < 5 for last 2 days
 * - Avg stress > 8 for last 2 days
 * 
 * The score is a composite metric (0-100) where:
 * - Sleep contributes 50%
 * - Stress contributes 50% (inverted - lower stress = higher readiness)
 */
export function calculateReadiness(
    journalEntries: JournalEntry[],
    lookbackDays: number = 3
): ReadinessReport {
    // Filter to recent entries
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const recentEntries = journalEntries.filter(
        entry => new Date(entry.date) >= cutoffDate
    );

    // No data = assume optimal (don't punish for missing data)
    if (recentEntries.length === 0) {
        return {
            score: 100,
            status: 'optimal',
            avgSleep: null,
            avgStress: null,
            shouldDowngrade: false,
        };
    }

    // Calculate averages
    const sleepScores = recentEntries
        .filter(e => e.sleep_quality !== undefined && e.sleep_quality !== null)
        .map(e => e.sleep_quality!);
    const stressScores = recentEntries
        .filter(e => e.stress_level !== undefined && e.stress_level !== null)
        .map(e => e.stress_level!);

    const avgSleep = sleepScores.length > 0
        ? sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length
        : null;
    const avgStress = stressScores.length > 0
        ? stressScores.reduce((a, b) => a + b, 0) / stressScores.length
        : null;

    // Check critical triggers (last 2 days)
    const last2DaysSleep = sleepScores.slice(0, 2);
    const last2DaysStress = stressScores.slice(0, 2);

    let shouldDowngrade = false;
    let reason: string | undefined;

    // Critical: Poor sleep for 2+ consecutive days (avg < 5)
    if (last2DaysSleep.length >= 2) {
        const avg2DaySleep = last2DaysSleep.reduce((a, b) => a + b, 0) / last2DaysSleep.length;
        if (avg2DaySleep < 5) {
            shouldDowngrade = true;
            reason = `Poor sleep for ${last2DaysSleep.length} consecutive days (avg: ${avg2DaySleep.toFixed(1)}/10)`;
        }
    }

    // Critical: High stress for 2+ consecutive days (avg > 8)
    if (!shouldDowngrade && last2DaysStress.length >= 2) {
        const avg2DayStress = last2DaysStress.reduce((a, b) => a + b, 0) / last2DaysStress.length;
        if (avg2DayStress > 8) {
            shouldDowngrade = true;
            reason = `High stress for ${last2DaysStress.length} consecutive days (avg: ${avg2DayStress.toFixed(1)}/10)`;
        }
    }

    // Calculate composite score (0-100)
    let score = 100;
    if (avgSleep !== null) {
        // Sleep: 1-10 → contribution to score (1 = 0%, 10 = 100%)
        score = (avgSleep / 10) * 50; // 50% weight
    } else {
        score = 50; // Neutral if no data
    }
    if (avgStress !== null) {
        // Stress is inverted: 1 (low) = 100%, 10 (high) = 0%
        score += ((10 - avgStress) / 10) * 50; // 50% weight
    } else {
        score += 25; // Neutral if no data
    }

    // Determine status
    let status: 'optimal' | 'moderate' | 'critical';
    if (shouldDowngrade || score < 40) {
        status = 'critical';
    } else if (score < 70) {
        status = 'moderate';
    } else {
        status = 'optimal';
    }

    return {
        score: Math.round(score),
        status,
        avgSleep,
        avgStress,
        shouldDowngrade,
        reason,
    };
}

// ============================================
// LAYER 2: VOLUME VALIDATION
// ============================================

interface Workout {
    distance_km?: number;
    duration_min?: number;
    type?: string;
}

/**
 * Validate that generated workouts match the macro volume target.
 * Used to ensure AI doesn't generate dangerous/disconnected plans.
 * 
 * @param workouts - Array of generated workouts
 * @param targetVolume - Target volume from macro plan (km)
 * @param tolerancePercent - Allowed deviation (default 10%)
 */
export function validateWeeklyVolume(
    workouts: Workout[],
    targetVolume: number,
    tolerancePercent: number = 10
): VolumeValidation {
    // Sum all distance_km values (rest days have 0)
    const actualVolume = workouts.reduce((sum, w) => sum + (w.distance_km || 0), 0);

    // Calculate deviation
    const deviation = ((actualVolume - targetVolume) / targetVolume) * 100;
    const isValid = Math.abs(deviation) <= tolerancePercent;

    // Calculate scalar to resize if invalid
    const scalarMultiplier = isValid ? undefined : targetVolume / actualVolume;

    return {
        isValid,
        actualVolume: Math.round(actualVolume * 10) / 10,
        targetVolume,
        deviation: Math.round(deviation * 10) / 10,
        scalarMultiplier: scalarMultiplier ? Math.round(scalarMultiplier * 100) / 100 : undefined,
    };
}

/**
 * Rescale all workouts to match target volume.
 * Fallback when AI cannot generate within tolerance after 3 retries.
 * 
 * @param workouts - Array of workouts to rescale
 * @param scalarMultiplier - Factor to apply (e.g., 0.9 = reduce by 10%)
 */
export function rescaleWorkouts<T extends Workout>(
    workouts: T[],
    scalarMultiplier: number
): T[] {
    return workouts.map(w => ({
        ...w,
        distance_km: w.distance_km ? Math.round(w.distance_km * scalarMultiplier * 10) / 10 : undefined,
        duration_min: w.duration_min ? Math.round(w.duration_min * scalarMultiplier) : undefined,
    }));
}

// ============================================
// LAYER 3: MACRO DRIFT DETECTION
// ============================================

/**
 * Check if user has drifted too far from the macro plan.
 * Triggers when user misses >20% volume for 2+ consecutive weeks.
 * 
 * @param block - The training block
 * @param activities - User's Strava activities
 * @param currentWeek - Current week number in block
 * @param lookbackWeeks - How many weeks to analyze (default 3)
 */
export function checkMacroDrift(
    block: TrainingBlock,
    activities: StravaActivity[],
    currentWeek: number,
    lookbackWeeks: number = 3
): DriftReport {
    const weeklyDeficits: DriftReport['weeklyDeficits'] = [];
    let consecutiveMissedWeeks = 0;
    let currentStreak = 0;

    // Analyze each of the last N weeks
    for (let i = 0; i < lookbackWeeks && currentWeek - i > 0; i++) {
        const weekNum = currentWeek - i;

        // Get planned km for this week
        const plannedKm = getPlannedKmForWeek(block.block_plan, weekNum);

        // Get actual km from activities for this week
        const weekStart = new Date(block.start_date);
        weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const weekActivities = activities.filter(a => {
            const actDate = new Date(a.date);
            return actDate >= weekStart && actDate < weekEnd &&
                (a.type === 'Run' || a.type === 'Walk' || a.type === 'Hike');
        });

        const actualKm = weekActivities.reduce((sum, a) => sum + a.distance_km, 0);
        const deficit = plannedKm > 0 ? ((plannedKm - actualKm) / plannedKm) * 100 : 0;

        weeklyDeficits.push({
            weekNumber: weekNum,
            plannedKm: Math.round(plannedKm),
            actualKm: Math.round(actualKm),
            deficit: Math.round(deficit),
        });

        // Track consecutive weeks with >20% deficit
        if (deficit > 20) {
            currentStreak++;
        } else {
            consecutiveMissedWeeks = Math.max(consecutiveMissedWeeks, currentStreak);
            currentStreak = 0;
        }
    }
    consecutiveMissedWeeks = Math.max(consecutiveMissedWeeks, currentStreak);

    // Calculate cumulative deficit
    const totalPlanned = weeklyDeficits.reduce((sum, d) => sum + d.plannedKm, 0);
    const totalActual = weeklyDeficits.reduce((sum, d) => sum + d.actualKm, 0);
    const cumulativeDeficit = totalPlanned > 0
        ? Math.round(((totalPlanned - totalActual) / totalPlanned) * 100)
        : 0;

    // Drift detection: 2+ consecutive weeks with >20% deficit
    const isDrifted = consecutiveMissedWeeks >= 2;

    let recommendation: 'continue' | 'regenerate' = 'continue';
    let reason: string | undefined;

    if (isDrifted) {
        recommendation = 'regenerate';
        reason = `You've missed ${consecutiveMissedWeeks} consecutive weeks (>${20}% deficit). ` +
            `Your current fitness doesn't match the plan. Regeneration recommended to prevent injury.`;
    }

    return {
        isDrifted,
        consecutiveMissedWeeks,
        weeklyDeficits,
        cumulativeDeficit,
        recommendation,
        reason,
    };
}
