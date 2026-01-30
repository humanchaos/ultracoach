/**
 * Training Phase Calculator
 * Single source of truth for training phase calculation across the app.
 * 
 * Used by: header-controls.tsx, next-race.tsx, db.ts (formatGoalForAI)
 */

export type TrainingPhaseType =
    | "recovery"
    | "maintain"
    | "general"
    | "base"
    | "build"
    | "peak"
    | "taper"
    | "race_week";

export interface Race {
    id?: number;
    name: string;
    date: string;
    distance_km: number;
    goal_time?: string;
    priority?: 'A' | 'B' | 'C';
}

export interface Activity {
    name: string;
    date: string;
    distance_km: number;
    pace?: string;
    heart_rate?: number;
}

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

/**
 * Calculate the current training phase based on races and recent activities.
 * 
 * Priority order:
 * 1. Recovery from recent ultra/marathon (from activities OR race calendar)
 * 2. Race-specific periodization (base → build → peak → taper → race week)
 * 3. General training / maintain fitness
 */
export function calculateTrainingPhase(
    races: Race[],
    activities: Activity[] = []
): TrainingPhase {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // STEP 1: Check activities for recent ultra-distance runs (>42km)
    // This catches races that weren't added to the race calendar
    const recentUltraRuns = activities.filter(a => {
        if (a.distance_km < 42) return false;
        const activityDate = new Date(a.date);
        activityDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysSince >= 0 && daysSince <= 21;
    });

    for (const run of recentUltraRuns) {
        const runDate = new Date(run.date);
        runDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - runDate.getTime()) / (1000 * 60 * 60 * 24));
        const recoveryDays = getRecoveryDays(run.distance_km);

        if (daysSince < recoveryDays) {
            return {
                phase: "recovery",
                label: "Recovery",
                icon: "🛌",
                color: "text-rose-400",
                recentRace: run,
                recoveryDaysLeft: recoveryDays - daysSince
            };
        }
    }

    // STEP 2: Check race calendar for recent races requiring recovery
    if (races.length === 0) {
        return {
            phase: "maintain",
            label: "Maintain Fitness",
            icon: "🏔️",
            color: "text-emerald-400"
        };
    }

    const sortedRaces = [...races].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const recentRaces = sortedRaces.filter(r => {
        const raceDate = new Date(r.date);
        raceDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysSince >= 0 && daysSince <= 21;
    });

    for (const race of recentRaces.reverse()) {
        const raceDate = new Date(race.date);
        raceDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));
        const recoveryDays = getRecoveryDays(race.distance_km);

        if (daysSince < recoveryDays) {
            return {
                phase: "recovery",
                label: "Recovery",
                icon: "🛌",
                color: "text-rose-400",
                recentRace: race,
                recoveryDaysLeft: recoveryDays - daysSince
            };
        }
    }

    // STEP 3: Check for upcoming races and determine periodization phase
    const nextRace = sortedRaces.find(r => new Date(r.date) >= today);

    if (!nextRace) {
        return {
            phase: "maintain",
            label: "Maintain Fitness",
            icon: "🏔️",
            color: "text-emerald-400"
        };
    }

    const raceDate = new Date(nextRace.date);
    const daysUntil = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weeksUntil = Math.floor(daysUntil / 7);
    const raceSpecificWeeks = getRaceSpecificWeeks(nextRace.distance_km);

    // Too far out for race-specific training
    if (weeksUntil > raceSpecificWeeks) {
        return {
            phase: "general",
            label: "General Training",
            icon: "💪",
            color: "text-blue-400",
            weeksUntil,
            daysUntil,
            nextRace
        };
    }

    // Determine periodization phase
    if (daysUntil <= 7) {
        return {
            phase: "race_week",
            label: "Race Week",
            icon: "🔥",
            color: "text-orange-400",
            weeksUntil,
            daysUntil,
            nextRace
        };
    } else if (weeksUntil <= 2) {
        return {
            phase: "taper",
            label: "Taper",
            icon: "🧘",
            color: "text-green-400",
            weeksUntil,
            daysUntil,
            nextRace
        };
    } else if (weeksUntil <= Math.floor(raceSpecificWeeks * 0.3)) {
        return {
            phase: "peak",
            label: "Peak",
            icon: "⚡",
            color: "text-purple-400",
            weeksUntil,
            daysUntil,
            nextRace
        };
    } else if (weeksUntil <= Math.floor(raceSpecificWeeks * 0.7)) {
        return {
            phase: "build",
            label: "Build",
            icon: "📈",
            color: "text-blue-400",
            weeksUntil,
            daysUntil,
            nextRace
        };
    }

    return {
        phase: "base",
        label: "Base Building",
        icon: "🏗️",
        color: "text-cyan-400",
        weeksUntil,
        daysUntil,
        nextRace
    };
}

/**
 * Get recovery days needed based on race distance
 */
function getRecoveryDays(distanceKm: number): number {
    if (distanceKm >= 80) return 21;
    if (distanceKm >= 50) return 14;
    if (distanceKm >= 42) return 14;
    if (distanceKm >= 21) return 10;
    if (distanceKm >= 10) return 5;
    return 3;
}

/**
 * Get race-specific training weeks based on distance
 */
function getRaceSpecificWeeks(distanceKm: number): number {
    if (distanceKm >= 80) return 20;
    if (distanceKm >= 42) return 16;
    if (distanceKm >= 21) return 12;
    if (distanceKm >= 10) return 8;
    return 6;
}
