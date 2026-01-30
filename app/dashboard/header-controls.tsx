"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
}

interface Activity {
    name: string;
    date: string;
    distance_km: number;
}

interface HeaderControlsProps {
    races: Race[];
    activities?: Activity[];
    activeBlock?: {
        id: number;
        raceName: string;
        currentWeek: number;
        totalWeeks: number;
        phase: string;
    } | null;
}

// Training phase explanations
const PHASE_INFO: Record<string, { title: string; description: string }> = {
    'Maintain Fitness': {
        title: 'Maintain Mode',
        description: 'No upcoming races. Focus on consistency, enjoyment, and staying injury-free. Great time to try new workouts!'
    },
    'Recovery': {
        title: 'Post-Race Recovery',
        description: 'Your body needs time to repair after the race. No hard training allowed! Easy movement, sleep, and nutrition are your priorities.'
    },
    'General Training': {
        title: 'General Training',
        description: 'Race is still far away. Building general fitness and aerobic base. Working on weaknesses.'
    },
    'Base Building': {
        title: 'Base Building Phase',
        description: 'Early race prep. Building volume and aerobic capacity. Mostly easy runs with some strides.'
    },
    'Build': {
        title: 'Build Phase',
        description: 'Introducing race-specific workouts. Increasing intensity while maintaining volume.'
    },
    'Peak': {
        title: 'Peak Phase',
        description: 'Highest intensity period. Race simulations and sharpening. Protect recovery between hard sessions.'
    },
    'Taper': {
        title: 'Taper Phase',
        description: 'Reducing volume 40-60% while maintaining intensity. Let your body absorb the training!'
    },
    'Race Week': {
        title: 'Race Week!',
        description: 'Easy running only. Stay fresh, sleep well, trust your training!'
    }
};

// Calculate training mode automatically from race calendar AND recent activities
function getTrainingMode(races: Race[], activities: Activity[] = []): {
    label: string;
    icon: string;
    color: string;
    weeksUntil?: number;
    daysUntil?: number;
    nextRace?: Race;
    recentRace?: Race | { name: string; date: string; distance_km: number };
    recoveryDaysLeft?: number;
} {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // FIRST: Check activities for recent ultra-distance runs (>42km)
    // This catches races that weren't added to the race calendar
    const recentUltraRuns = activities.filter(a => {
        if (a.distance_km < 42) return false; // Only check marathon+ distances
        const activityDate = new Date(a.date);
        activityDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysSince >= 0 && daysSince <= 21;
    });

    // Check if any recent ultra run requires recovery
    for (const run of recentUltraRuns) {
        const runDate = new Date(run.date);
        runDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - runDate.getTime()) / (1000 * 60 * 60 * 24));

        let recoveryDays = 14;
        if (run.distance_km >= 80) recoveryDays = 21;
        else if (run.distance_km >= 50) recoveryDays = 14;
        else if (run.distance_km >= 42) recoveryDays = 14;

        if (daysSince < recoveryDays) {
            return {
                label: 'Recovery',
                icon: '🛌',
                color: 'text-rose-400',
                recentRace: { name: run.name, date: run.date, distance_km: run.distance_km },
                recoveryDaysLeft: recoveryDays - daysSince
            };
        }
    }

    // If no races, check if we need recovery from activities first (already done above)
    if (races.length === 0) {
        return {
            label: 'Maintain Fitness',
            icon: '🏔️',
            color: 'text-emerald-400'
        };
    }

    const sortedRaces = [...races].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // CHECK FOR RECENT RACES REQUIRING RECOVERY
    const recentRaces = sortedRaces.filter(r => {
        const raceDate = new Date(r.date);
        raceDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysSince >= 0 && daysSince <= 21;
    });

    // Find the most recent race that still needs recovery
    for (const race of recentRaces.reverse()) {
        const raceDate = new Date(race.date);
        raceDate.setHours(0, 0, 0, 0);
        const daysSince = Math.floor((today.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));

        // Determine recovery period based on distance
        let recoveryDays = 5; // Default for short races
        if (race.distance_km >= 80) recoveryDays = 21;
        else if (race.distance_km >= 50) recoveryDays = 14;
        else if (race.distance_km >= 42) recoveryDays = 14;
        else if (race.distance_km >= 21) recoveryDays = 10;
        else if (race.distance_km >= 10) recoveryDays = 5;
        else recoveryDays = 3;

        // If still within recovery period
        if (daysSince < recoveryDays) {
            const recoveryDaysLeft = recoveryDays - daysSince;
            return {
                label: 'Recovery',
                icon: '🛌',
                color: 'text-rose-400',
                recentRace: race,
                recoveryDaysLeft
            };
        }
    }

    // No recent race requiring recovery - check for upcoming races
    const nextRace = sortedRaces.find(r => new Date(r.date) >= today);

    if (!nextRace) {
        return {
            label: 'Maintain Fitness',
            icon: '🏔️',
            color: 'text-emerald-400'
        };
    }

    const raceDate = new Date(nextRace.date);
    const daysUntil = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weeksUntil = Math.floor(daysUntil / 7);

    let raceSpecificWeeks = 12;
    if (nextRace.distance_km >= 80) raceSpecificWeeks = 20;
    else if (nextRace.distance_km >= 42) raceSpecificWeeks = 16;
    else if (nextRace.distance_km >= 21) raceSpecificWeeks = 12;
    else if (nextRace.distance_km >= 10) raceSpecificWeeks = 8;
    else raceSpecificWeeks = 6;

    if (weeksUntil > raceSpecificWeeks) {
        return {
            label: 'General Training',
            icon: '💪',
            color: 'text-blue-400',
            weeksUntil,
            daysUntil,
            nextRace
        };
    }

    let phase = 'Base Building';
    let phaseIcon = '🏗️';
    let phaseColor = 'text-cyan-400';

    if (daysUntil <= 7) {
        phase = 'Race Week';
        phaseIcon = '🔥';
        phaseColor = 'text-orange-400';
    } else if (weeksUntil <= 2) {
        phase = 'Taper';
        phaseIcon = '🧘';
        phaseColor = 'text-green-400';
    } else if (weeksUntil <= Math.floor(raceSpecificWeeks * 0.3)) {
        phase = 'Peak';
        phaseIcon = '⚡';
        phaseColor = 'text-purple-400';
    } else if (weeksUntil <= Math.floor(raceSpecificWeeks * 0.7)) {
        phase = 'Build';
        phaseIcon = '📈';
        phaseColor = 'text-blue-400';
    }

    return {
        label: phase,
        icon: phaseIcon,
        color: phaseColor,
        weeksUntil,
        daysUntil,
        nextRace
    };
}

export function HeaderControls({ races, activities = [], activeBlock }: HeaderControlsProps) {
    const [showTooltip, setShowTooltip] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const trainingMode = getTrainingMode(races, activities);

    // If there's an active training block, use its phase info
    const displayPhase = activeBlock ? activeBlock.phase : trainingMode.label;
    const displayWeeks = activeBlock ? `${activeBlock.currentWeek}/${activeBlock.totalWeeks}` : (trainingMode.weeksUntil ? `${trainingMode.weeksUntil}w` : '');
    const hasActiveBlock = !!activeBlock;

    const phaseInfo = PHASE_INFO[displayPhase] || PHASE_INFO[trainingMode.label] || {
        title: displayPhase,
        description: 'Training phase based on your race calendar.'
    };

    useEffect(() => {
        if (showTooltip && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setTooltipPos({
                top: rect.bottom + 8,
                left: rect.left
            });
        }
    }, [showTooltip]);

    // Format race date
    const formatRaceDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const tooltipContent = showTooltip ? createPortal(
        <>
            <div
                className="fixed inset-0"
                style={{ zIndex: 99998 }}
                onClick={() => setShowTooltip(false)}
            />
            <div
                className="fixed w-80 bg-slate-800 border border-white/20 rounded-xl shadow-2xl p-4"
                style={{
                    zIndex: 99999,
                    top: tooltipPos.top,
                    left: tooltipPos.left
                }}
            >
                {/* Phase Header */}
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{trainingMode.icon}</span>
                    <span className={`font-bold ${trainingMode.color}`}>
                        {phaseInfo.title}
                    </span>
                </div>

                {/* Race-specific info */}
                {trainingMode.recentRace ? (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 mb-3">
                        <div className="text-xs text-rose-300 uppercase tracking-wide mb-1">
                            🎉 Recovering from
                        </div>
                        <div className="font-bold text-white">
                            {trainingMode.recentRace.name}
                        </div>
                        <div className="text-sm text-purple-300/80 mt-1">
                            {trainingMode.recentRace.distance_km}km completed • {formatRaceDate(trainingMode.recentRace.date)}
                        </div>
                        <div className="text-sm font-medium mt-2 text-rose-400">
                            🛌 {trainingMode.recoveryDaysLeft} days of recovery left
                        </div>
                    </div>
                ) : trainingMode.nextRace ? (
                    <div className="bg-slate-700/50 rounded-lg p-3 mb-3">
                        <div className="text-xs text-purple-300/60 uppercase tracking-wide mb-1">
                            Training for
                        </div>
                        <div className="font-bold text-white">
                            {trainingMode.nextRace.name}
                        </div>
                        <div className="text-sm text-purple-300/80 mt-1">
                            {trainingMode.nextRace.distance_km}km • {formatRaceDate(trainingMode.nextRace.date)}
                        </div>
                        <div className={`text-sm font-medium mt-2 ${trainingMode.color}`}>
                            ⏱️ {trainingMode.weeksUntil}w {trainingMode.daysUntil! % 7}d to go
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-700/50 rounded-lg p-3 mb-3 text-center">
                        <div className="text-purple-300/60 text-sm">No races scheduled</div>
                        <div className="text-xs text-purple-300/40 mt-1">
                            Add a race in the sidebar to start training!
                        </div>
                    </div>
                )}

                {/* Phase description */}
                <p className="text-sm text-purple-300/70 mb-2">
                    {phaseInfo.description}
                </p>

                <div className="text-[10px] text-purple-300/40 border-t border-white/10 pt-2 mt-2">
                    💡 Manage races in the sidebar "Next Race" section
                </div>
            </div>
        </>,
        document.body
    ) : null;

    return (
        <div className="flex items-center gap-3">
            <button
                ref={buttonRef}
                onClick={() => setShowTooltip(!showTooltip)}
                className={`flex items-center gap-2 bg-slate-800/80 border ${hasActiveBlock ? 'border-green-500/50 ring-1 ring-green-500/30' : 'border-white/10'} rounded-lg px-3 py-1.5 ${hasActiveBlock ? 'text-green-400' : trainingMode.color} hover:border-purple-500/50 transition-colors cursor-pointer`}
            >
                {/* Active block checkmark */}
                {hasActiveBlock && <span className="text-green-400">✓</span>}
                <span>{hasActiveBlock ? '📋' : trainingMode.icon}</span>
                <div className="text-sm font-medium">
                    {displayPhase}
                </div>
                {/* Show week progress for active block, or recovery/weeks for heuristic */}
                {hasActiveBlock ? (
                    <span className="text-xs opacity-70">
                        {displayWeeks}
                    </span>
                ) : trainingMode.recoveryDaysLeft !== undefined ? (
                    <span className="text-xs opacity-70">
                        {trainingMode.recoveryDaysLeft}d
                    </span>
                ) : trainingMode.weeksUntil !== undefined && (
                    <span className="text-xs opacity-70">
                        {trainingMode.weeksUntil}w
                    </span>
                )}
            </button>
            {tooltipContent}
        </div>
    );
}
