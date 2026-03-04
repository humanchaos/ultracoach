/**
 * Daily Prescription Engine (v1.2)
 * 
 * Core component that generates optimal daily workout prescriptions
 * based on remaining budget, readiness, and safety constraints.
 */

import type {
    DailyPrescription,
    DailyPrescriptionInput,
    SessionCandidate,
    SessionType,
    Week,
    PrescribedWorkout,
    WorkoutStructure,
    HRZone,
    ReadinessProfile,
    WellnessData
} from './budget-types';

import {
    passesAllConstraints,
    getHoursSinceLastQuality,
    getDaysLeftInWeek,
    isMinimumViableWeekAtRisk,
    SAFETY_INTERLOCKS
} from './safety-interlocks';

// ============================================================
// MAIN ENGINE LOOP
// ============================================================

export async function generateDailyPrescription(
    input: DailyPrescriptionInput
): Promise<DailyPrescription> {

    // ══════════════════════════════════════════════════════════
    // GATE 0: Risk Flags (Injury/Illness)
    // ══════════════════════════════════════════════════════════
    if (input.readiness.riskFlags.length > 0) {
        return prescribeRest(`Risk flag active: ${input.readiness.riskFlags[0]}`);
    }

    // ══════════════════════════════════════════════════════════
    // GATE 1: Post-Race Recovery
    // ══════════════════════════════════════════════════════════
    if (input.recoveryStatus.phase !== 'normal') {
        return prescribeRecoveryPhaseWorkout(input.recoveryStatus, input);
    }

    // ══════════════════════════════════════════════════════════
    // GATE 2: Minimum Viable Week Check
    // ══════════════════════════════════════════════════════════
    const remaining = input.week.execution.remainingBudget;
    const daysLeft = getDaysLeftInWeek(input.today);

    if (isMinimumViableWeekAtRisk(remaining, daysLeft)) {
        return prescribeMinimumViablePriority(remaining, daysLeft, input);
    }

    // ══════════════════════════════════════════════════════════
    // STEP 1: Filter available sessions from budget
    // ══════════════════════════════════════════════════════════
    const candidates = getAvailableSessions(remaining, input.week);

    // ══════════════════════════════════════════════════════════
    // STEP 2: Apply Safety Interlocks
    // ══════════════════════════════════════════════════════════
    const validCandidates = candidates.filter(session =>
        passesAllConstraints(session, input).passes
    );

    // ══════════════════════════════════════════════════════════
    // STEP 3: Score by Readiness Fit
    // ══════════════════════════════════════════════════════════
    const scored = validCandidates.map(session => ({
        session,
        score: calculateSessionScore(session, input)
    })).sort((a, b) => b.score - a.score);

    // ══════════════════════════════════════════════════════════
    // STEP 4: Return Best Option
    // ══════════════════════════════════════════════════════════
    if (scored.length === 0) {
        return prescribeRest("No suitable sessions for current state");
    }

    return buildPrescription(scored[0].session, input);
}

// ============================================================
// SESSION SCORING ALGORITHM
// ============================================================

export function calculateSessionScore(
    session: SessionCandidate,
    input: DailyPrescriptionInput
): number {
    let score = 0;
    const { week, readiness, wellness, today } = input;
    const remaining = week.execution.remainingBudget;
    const daysLeft = getDaysLeftInWeek(today);

    // ─────────────────────────────────────────────────────────
    // READINESS MATCH (0-30 points)
    // ─────────────────────────────────────────────────────────
    const readinessScore = calculateReadinessScore(readiness, wellness);

    if (session.type === 'quality') {
        // Quality needs high readiness
        if (readinessScore >= 70) score += 30;
        else if (readinessScore >= 50) score += 15;
        else score += 0;  // Low readiness = quality scores poorly
    }
    else if (session.type === 'easy' || session.type === 'recovery') {
        // Easy/recovery always appropriate, bonus when tired
        score += readinessScore < 50 ? 30 : 20;
    }
    else if (session.type === 'long') {
        // Long runs need moderate readiness
        score += readinessScore >= 50 ? 30 : 15;
    }

    // ─────────────────────────────────────────────────────────
    // BUDGET URGENCY (0-25 points)
    // ─────────────────────────────────────────────────────────
    if (session.type === 'quality' && remaining.qualitySessions > 0) {
        const urgency = remaining.qualitySessions / Math.max(daysLeft, 1);
        score += Math.min(25, urgency * 15);
    }

    if (session.type === 'long' && remaining.needsLongRun) {
        const dayOfWeek = today.getDay();
        // Long run urgency increases toward weekend
        if (dayOfWeek >= 5) score += 25;       // Fri/Sat
        else if (dayOfWeek >= 3) score += 15;  // Wed/Thu
        else score += 10;                       // Mon/Tue
    }

    // ─────────────────────────────────────────────────────────
    // RECOVERY SPACING (0-20 points)
    // ─────────────────────────────────────────────────────────
    if (session.type === 'quality') {
        const hoursSinceHard = getHoursSinceLastQuality(input.recentActivities);
        // Bonus for extra recovery beyond minimum 48h
        score += Math.min(20, Math.max(0, (hoursSinceHard - 48) / 2));
    }

    // ─────────────────────────────────────────────────────────
    // PHASE ALIGNMENT (0-15 points)
    // ─────────────────────────────────────────────────────────
    if (session.qualityType && week.availableQualityTypes.includes(session.qualityType)) {
        score += 15;
    }

    // ─────────────────────────────────────────────────────────
    // DAY PREFERENCE (0-10 points)
    // ─────────────────────────────────────────────────────────
    if (session.type === 'long') {
        const dayOfWeek = today.getDay();
        const pref = week.constraints.longRunDay;
        if ((pref === 'saturday' && dayOfWeek === 6) ||
            (pref === 'sunday' && dayOfWeek === 0)) {
            score += 10;
        }
    }

    return Math.max(0, score);
}

export function calculateReadinessScore(
    readiness: ReadinessProfile,
    wellness: WellnessData
): number {
    let score = 50; // baseline

    // Sleep impact (-20 to +20)
    score += (wellness.sleep - 7) * 10;

    // Stress impact (-15 to +15)  
    score -= (wellness.stressLevel - 3) * 5;

    // Systemic status
    if (readiness.systemic === 'compromised') score -= 20;
    if (readiness.systemic === 'optimal') score += 10;

    // Structural status
    if (readiness.structural === 'compromised') score -= 15;

    return Math.max(0, Math.min(100, score));
}

// ============================================================
// MINIMUM VIABLE WEEK & MAINTENANCE PIVOT
// ============================================================

function prescribeMinimumViablePriority(
    remaining: Week['execution']['remainingBudget'],
    daysLeft: number,
    input: DailyPrescriptionInput
): DailyPrescription {
    const readinessScore = calculateReadinessScore(input.readiness, input.wellness);
    const isCompromised = readinessScore < 50;
    const dayOfWeek = input.today.getDay();

    // ═══════════════════════════════════════════════════════════
    // MAINTENANCE PIVOT: Tired + Week at risk → Scale down, don't skip
    // ═══════════════════════════════════════════════════════════
    if (isCompromised && remaining.qualitySessions > 0) {
        return buildMaintenanceWorkout({
            originalType: selectQualityType(input.week.availableQualityTypes),
            volumeScale: 0.5,           // 50% of intended volume
            intensityCap: 'Z4',         // No Z5
            reasoning: "Readiness low + Week at risk: Maintenance mode preserves stimulus without digging a hole.",
            input
        });
    }

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 1: Long run on weekend
    // ═══════════════════════════════════════════════════════════
    if (remaining.needsLongRun) {
        if (dayOfWeek === 5) {
            // Friday - save energy for weekend long run
            return prescribeEasyRun(input, "Saving energy for weekend long run");
        }
        if (dayOfWeek === 6 || dayOfWeek === 0) {
            // Saturday or Sunday
            return prescribeLongRun(input, "Priority: Long run is essential for aerobic development");
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 2: One quality session
    // ═══════════════════════════════════════════════════════════
    if (remaining.qualitySessions > 0) {
        const hoursSince = getHoursSinceLastQuality(input.recentActivities);
        if (hoursSince >= 48) {
            return prescribeQualitySession(
                input,
                remaining.qualitySessions > 1
                    ? "Priority: Fitting in one quality session before week ends"
                    : "Priority: Your essential quality session this week"
            );
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DEFAULT: Easy run or rest
    // ═══════════════════════════════════════════════════════════
    return prescribeEasyOrRest(input);
}

function buildMaintenanceWorkout(config: {
    originalType: SessionType;
    volumeScale: number;
    intensityCap: HRZone;
    reasoning: string;
    input: DailyPrescriptionInput;
}): DailyPrescription {
    const template = getWorkoutTemplate(config.originalType);

    return {
        date: config.input.today,
        recommendation: 'workout',
        workout: {
            type: 'quality',
            qualityType: config.originalType,
            targetVolume: template.volume * config.volumeScale,
            targetVertical: template.vertical * config.volumeScale,
            targetDuration: template.duration * config.volumeScale,
            hrZones: {
                primary: template.hrZones.primary,
                ceiling: config.intensityCap  // Capped
            },
            structure: scaleIntervals(template.structure, config.volumeScale),
            isMaintenanceMode: true,
            maintenanceReason: config.reasoning
        },
        reasoning: {
            summary: "Maintenance workout: Reduced volume, capped intensity",
            budgetStatus: "Week at risk - prioritizing consistency over progression",
            readinessInfluence: config.reasoning,
            constraintsApplied: ["Maintenance pivot active"]
        },
        alternatives: [
            { type: 'easy', description: "Easy 30-40min", consequence: "Sacrifices quality session this week" },
            { type: 'rest', description: "Full rest", consequence: "May compromise weekly minimum" }
        ]
    };
}

// ============================================================
// PRESCRIPTION BUILDERS
// ============================================================

function prescribeRest(reason: string): DailyPrescription {
    return {
        date: new Date(),
        recommendation: 'rest',
        reasoning: {
            summary: reason,
            budgetStatus: "Rest day",
            readinessInfluence: reason,
            constraintsApplied: []
        },
        alternatives: []
    };
}

function prescribeEasyRun(input: DailyPrescriptionInput, reason: string): DailyPrescription {
    const remaining = input.week.execution.remainingBudget;
    const targetVolume = Math.min(10, remaining.volume * 0.15); // ~15% of remaining

    return {
        date: input.today,
        recommendation: 'workout',
        workout: {
            type: 'easy',
            targetVolume,
            targetVertical: 0,
            targetDuration: targetVolume * 6, // ~6 min/km
            hrZones: { primary: 'Z2', ceiling: 'Z2' },
            paceTarget: '6:00–7:00/km (conversational)',
            structure: {
                warmup: { duration: 5, description: "Walk 5 min" },
                main: { description: `Easy run ${targetVolume}km at conversational pace` },
                cooldown: { duration: 5, description: "Walk 5 min" }
            },
            isMaintenanceMode: false
        },
        reasoning: {
            summary: "Easy aerobic run",
            budgetStatus: `${remaining.volume.toFixed(0)}km remaining this week`,
            readinessInfluence: reason,
            constraintsApplied: []
        },
        alternatives: [
            { type: 'rest', description: "Full rest", consequence: "Preserves energy for upcoming sessions" }
        ]
    };
}

function prescribeLongRun(input: DailyPrescriptionInput, reason: string): DailyPrescription {
    const remaining = input.week.execution.remainingBudget;
    const budget = input.week.budget;
    const targetVolume = Math.min(
        budget.longRunRange.max,
        remaining.volume * 0.5
    );

    return {
        date: input.today,
        recommendation: 'workout',
        workout: {
            type: 'long',
            targetVolume,
            targetVertical: Math.round(targetVolume * 30), // ~30m/km estimate
            targetDuration: targetVolume * 6.5,
            hrZones: { primary: 'Z2', ceiling: 'Z3' },
            paceTarget: '6:15–7:00/km (aerobic, conversation pace)',
            nutritionTip: targetVolume >= 25
                ? 'Take 60g carbs/hr from km 15. Practice race-day nutrition.'
                : targetVolume >= 18
                    ? 'Carry gel or snack. Hydrate every 20min.'
                    : undefined,
            structure: {
                warmup: { duration: 10, description: "Easy 10 min" },
                main: { description: `Long run ${targetVolume}km at Z2, final 20% can push to Z3` },
                cooldown: { duration: 5, description: "Walk 5 min" }
            },
            isMaintenanceMode: false
        },
        reasoning: {
            summary: `Long run: ${targetVolume}km`,
            budgetStatus: `Long run required (${budget.longRunRange.min}-${budget.longRunRange.max}km)`,
            readinessInfluence: reason,
            constraintsApplied: []
        },
        alternatives: [
            { type: 'easy', description: "Medium run (50% of long)", consequence: "Partial long run credit" },
            { type: 'rest', description: "Skip", consequence: "Miss long run this week" }
        ]
    };
}

function prescribeQualitySession(input: DailyPrescriptionInput, reason: string): DailyPrescription {
    const qualityType = selectQualityType(input.week.availableQualityTypes);
    const template = getWorkoutTemplate(qualityType);

    return {
        date: input.today,
        recommendation: 'workout',
        workout: {
            type: 'quality',
            qualityType,
            targetVolume: template.volume,
            targetVertical: template.vertical,
            targetDuration: template.duration,
            hrZones: template.hrZones,
            structure: template.structure,
            isMaintenanceMode: false
        },
        reasoning: {
            summary: `Quality session: ${formatSessionType(qualityType)}`,
            budgetStatus: `${input.week.execution.remainingBudget.qualitySessions} quality sessions remaining`,
            readinessInfluence: reason,
            constraintsApplied: []
        },
        alternatives: [
            { type: 'easy', description: "Easy run instead", consequence: "Shifts quality to later in week" },
            { type: 'rest', description: "Full rest", consequence: "Must fit quality in remaining days" }
        ]
    };
}

function prescribeRecoveryPhaseWorkout(
    recoveryStatus: DailyPrescriptionInput['recoveryStatus'],
    input: DailyPrescriptionInput
): DailyPrescription {
    const phase = recoveryStatus.phase;

    if (phase === 'acute') {
        return prescribeRest("Acute recovery phase - complete rest required");
    }

    // Structural/Systemic/Reintegration - allow easy movement
    return prescribeEasyRun(input, `Recovery phase: ${phase} - easy movement only`);
}

function prescribeEasyOrRest(input: DailyPrescriptionInput): DailyPrescription {
    const readinessScore = calculateReadinessScore(input.readiness, input.wellness);

    if (readinessScore < 40) {
        return prescribeRest("Low readiness - rest recommended");
    }

    return prescribeEasyRun(input, "Volume builder");
}

function buildPrescription(session: SessionCandidate, input: DailyPrescriptionInput): DailyPrescription {
    const remaining = input.week.execution.remainingBudget;

    return {
        date: input.today,
        recommendation: 'workout',
        workout: {
            type: session.type,
            qualityType: session.qualityType,
            targetVolume: session.targetVolume,
            targetVertical: session.targetVertical,
            targetDuration: session.targetDuration,
            hrZones: session.hrZones,
            structure: getWorkoutTemplate(session.qualityType || 'hill_strides').structure,
            isMaintenanceMode: false
        },
        reasoning: {
            summary: session.qualityType
                ? formatSessionType(session.qualityType)
                : `${session.type} run`,
            budgetStatus: `${remaining.volume.toFixed(0)}km / ${remaining.qualitySessions} quality remaining`,
            readinessInfluence: `Readiness score: ${calculateReadinessScore(input.readiness, input.wellness)}`,
            constraintsApplied: []
        },
        alternatives: [
            { type: 'easy', description: "Easy run instead", consequence: "Shifts this session to later" },
            { type: 'rest', description: "Full rest", consequence: "May need to adjust week" }
        ]
    };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getAvailableSessions(
    remaining: Week['execution']['remainingBudget'],
    week: Week
): SessionCandidate[] {
    const candidates: SessionCandidate[] = [];

    // Always can do easy/recovery
    if (remaining.volume > 5) {
        candidates.push({
            type: 'easy',
            targetVolume: Math.min(10, remaining.volume * 0.15),
            targetVertical: 0,
            targetDuration: 60,
            hrZones: { primary: 'Z2', ceiling: 'Z2' }
        });

        candidates.push({
            type: 'recovery',
            targetVolume: 6,
            targetVertical: 0,
            targetDuration: 40,
            hrZones: { primary: 'Z1', ceiling: 'Z1' }
        });
    }

    // Quality sessions if budget allows
    if (remaining.qualitySessions > 0) {
        for (const sessionType of week.availableQualityTypes) {
            const template = getWorkoutTemplate(sessionType);
            candidates.push({
                type: 'quality',
                qualityType: sessionType,
                targetVolume: template.volume,
                targetVertical: template.vertical,
                targetDuration: template.duration,
                hrZones: template.hrZones
            });
        }
    }

    // Long run if needed
    if (remaining.needsLongRun) {
        candidates.push({
            type: 'long',
            targetVolume: week.budget.longRunRange.max,
            targetVertical: Math.round(week.budget.longRunRange.max * 30),
            targetDuration: week.budget.longRunRange.max * 6.5,
            hrZones: { primary: 'Z2', ceiling: 'Z3' }
        });
    }

    return candidates;
}

function selectQualityType(available: SessionType[]): SessionType {
    // Simple selection: prefer first available
    return available[0] || 'hill_strides';
}

interface WorkoutTemplate {
    volume: number;
    vertical: number;
    duration: number;
    hrZones: { primary: HRZone; ceiling: HRZone };
    structure: WorkoutStructure;
}

function getWorkoutTemplate(type: SessionType): WorkoutTemplate {
    const templates: Record<SessionType, WorkoutTemplate> = {
        hill_strides: {
            volume: 10,
            vertical: 200,
            duration: 55,
            hrZones: { primary: 'Z2', ceiling: 'Z4' },
            structure: {
                warmup: { duration: 15, description: "Easy jog" },
                main: {
                    description: "8x15sec steep uphill at fast effort, walk down recovery",
                    intervals: [{ reps: 8, workDuration: 15, workIntensity: "Fast", restDuration: 60, restIntensity: "Walk" }]
                },
                cooldown: { duration: 10, description: "Easy jog" }
            }
        },
        threshold_intervals: {
            volume: 14,
            vertical: 100,
            duration: 70,
            hrZones: { primary: 'Z4', ceiling: 'Z4' },
            structure: {
                warmup: { duration: 15, description: "Easy jog" },
                main: {
                    description: "4x8min at LT2 HR with 3min jog recovery",
                    intervals: [{ reps: 4, workDuration: 480, workIntensity: "Z4", restDuration: 180, restIntensity: "Z2" }]
                },
                cooldown: { duration: 10, description: "Easy jog" }
            }
        },
        vo2_hill_repeats: {
            volume: 12,
            vertical: 400,
            duration: 65,
            hrZones: { primary: 'Z4', ceiling: 'Z5' },
            structure: {
                warmup: { duration: 15, description: "Easy jog" },
                main: {
                    description: "6x3min steep uphill at RPE 8-9, walk down",
                    intervals: [{ reps: 6, workDuration: 180, workIntensity: "Z5", restDuration: 180, restIntensity: "Walk" }]
                },
                cooldown: { duration: 10, description: "Easy jog" }
            }
        },
        tempo_run: {
            volume: 12,
            vertical: 80,
            duration: 60,
            hrZones: { primary: 'Z3', ceiling: 'Z4' },
            structure: {
                warmup: { duration: 15, description: "Easy jog" },
                main: { description: "30min at tempo pace (comfortably hard)" },
                cooldown: { duration: 10, description: "Easy jog" }
            }
        },
        progression_long: {
            volume: 28,
            vertical: 500,
            duration: 180,
            hrZones: { primary: 'Z2', ceiling: 'Z3' },
            structure: {
                warmup: { duration: 10, description: "Very easy" },
                main: { description: "First 60% at Z1, next 30% at Z2, final 10% at Z3" },
                cooldown: { duration: 5, description: "Walk" }
            }
        },
        race_pace_segments: {
            volume: 14,
            vertical: 150,
            duration: 75,
            hrZones: { primary: 'Z3', ceiling: 'Z4' },
            structure: {
                warmup: { duration: 15, description: "Easy jog" },
                main: {
                    description: "3x10min at goal race effort with 3min recovery",
                    intervals: [{ reps: 3, workDuration: 600, workIntensity: "Race pace", restDuration: 180, restIntensity: "Easy" }]
                },
                cooldown: { duration: 10, description: "Easy jog" }
            }
        },
        power_hike_intervals: {
            volume: 10,
            vertical: 600,
            duration: 80,
            hrZones: { primary: 'Z3', ceiling: 'Z4' },
            structure: {
                warmup: { duration: 10, description: "Walk" },
                main: {
                    description: "5x10min power hiking at 15%+ grade, hands on knees",
                    intervals: [{ reps: 5, workDuration: 600, workIntensity: "Z3-Z4", restDuration: 180, restIntensity: "Easy walk" }]
                },
                cooldown: { duration: 10, description: "Easy walk" }
            }
        },
        course_simulation: {
            volume: 35,
            vertical: 1200,
            duration: 240,
            hrZones: { primary: 'Z2', ceiling: 'Z3' },
            structure: {
                warmup: { duration: 10, description: "Easy" },
                main: { description: "Match race vertical profile, practice aid station routine" },
                cooldown: { duration: 5, description: "Walk" }
            }
        },
        back_to_back: {
            volume: 18,
            vertical: 300,
            duration: 120,
            hrZones: { primary: 'Z1', ceiling: 'Z2' },
            structure: {
                warmup: { duration: 0, description: "" },
                main: { description: "Easy run on tired legs from yesterday. Build durability." },
                cooldown: { duration: 5, description: "Walk" }
            }
        },
        sharpener: {
            volume: 8,
            vertical: 50,
            duration: 40,
            hrZones: { primary: 'Z2', ceiling: 'Z4' },
            structure: {
                warmup: { duration: 10, description: "Easy jog" },
                main: {
                    description: "4x2min at race pace with full recovery",
                    intervals: [{ reps: 4, workDuration: 120, workIntensity: "Race pace", restDuration: 120, restIntensity: "Walk" }]
                },
                cooldown: { duration: 10, description: "Easy jog" }
            }
        },
        opener: {
            volume: 5,
            vertical: 30,
            duration: 30,
            hrZones: { primary: 'Z1', ceiling: 'Z3' },
            structure: {
                warmup: { duration: 10, description: "Very easy" },
                main: { description: "4x30sec strides to wake up the legs" },
                cooldown: { duration: 5, description: "Easy" }
            }
        }
    };

    return templates[type] || templates.hill_strides;
}

function scaleIntervals(structure: WorkoutStructure, scale: number): WorkoutStructure {
    return {
        ...structure,
        warmup: { ...structure.warmup, duration: Math.round(structure.warmup.duration * scale) },
        main: {
            ...structure.main,
            intervals: structure.main.intervals?.map(i => ({
                ...i,
                reps: Math.max(2, Math.round(i.reps * scale))
            }))
        },
        cooldown: { ...structure.cooldown, duration: Math.round(structure.cooldown.duration * scale) }
    };
}

function formatSessionType(type: SessionType): string {
    const names: Record<SessionType, string> = {
        hill_strides: "Hill Strides",
        threshold_intervals: "LT2 Intervals",
        vo2_hill_repeats: "VO2 Hill Repeats",
        tempo_run: "Tempo Run",
        progression_long: "Progression Long Run",
        race_pace_segments: "Race Pace Segments",
        power_hike_intervals: "Power Hike Intervals",
        course_simulation: "Course Simulation",
        back_to_back: "Back-to-Back Run",
        sharpener: "Sharpener",
        opener: "Opener"
    };
    return names[type] || type;
}
