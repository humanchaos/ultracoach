"use client";

import { useState, useMemo, useEffect } from "react";

interface DailyWorkout {
    day: string;
    type: string;
    distance_km?: number;
    duration_min?: number;
    elevation_m?: number;  // Target vertical gain in meters
    description?: string;
    intensity?: string;
    hrZone?: string;
    targetPace?: string;
    effortLevel?: string;
}

interface TrainingPhase {
    name: string;
    weeks: number;
    focus: string;
    weeklyKm: number[];
}

interface BlockPlan {
    totalWeeks: number;
    phases: TrainingPhase[];
    keyWorkouts: string[];
    notes: string;
}

interface BlockCalendarProps {
    block: {
        id: number;
        race_id: number;
        raceName?: string;
        block_plan: BlockPlan;
        weekly_workouts?: Record<string, DailyWorkout[]>;
        start_date: string;
        end_date: string;
    };
    currentWeek: number;
}

// Phase colors for visual distinction
const PHASE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    'Base': { bg: 'bg-blue-500/20', border: 'border-blue-500/50', text: 'text-blue-400', dot: 'bg-blue-500' },
    'Build': { bg: 'bg-cyan-500/20', border: 'border-cyan-500/50', text: 'text-cyan-400', dot: 'bg-cyan-500' },
    'Peak': { bg: 'bg-purple-500/20', border: 'border-purple-500/50', text: 'text-purple-400', dot: 'bg-purple-500' },
    'Taper': { bg: 'bg-green-500/20', border: 'border-green-500/50', text: 'text-green-400', dot: 'bg-green-500' },
};

// Workout type colors
const WORKOUT_COLORS: Record<string, string> = {
    'Long Run': 'bg-purple-500',
    'Tempo': 'bg-orange-500',
    'Intervals': 'bg-red-500',
    'Easy': 'bg-blue-400',
    'Easy Run': 'bg-blue-400',
    'Recovery': 'bg-green-400',
    'Rest': 'bg-slate-600',
    'Cross-Training': 'bg-teal-500',
    'Hills': 'bg-amber-500',
    'Fartlek': 'bg-pink-500',
};

const getPhaseColor = (phaseName: string) => {
    for (const [key, value] of Object.entries(PHASE_COLORS)) {
        if (phaseName.toLowerCase().includes(key.toLowerCase())) {
            return value;
        }
    }
    return { bg: 'bg-slate-500/20', border: 'border-slate-500/50', text: 'text-slate-400', dot: 'bg-slate-500' };
};

const getWorkoutColor = (type: string): string => {
    for (const [key, color] of Object.entries(WORKOUT_COLORS)) {
        if (type.toLowerCase().includes(key.toLowerCase())) {
            return color;
        }
    }
    return 'bg-slate-500';
};

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MAP: Record<string, number> = {
    'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3,
    'Friday': 4, 'Saturday': 5, 'Sunday': 6
};

export function BlockCalendar({ block, currentWeek }: BlockCalendarProps) {
    const [expanded, setExpanded] = useState(true);
    const [viewMode, setViewMode] = useState<'grid' | 'phases'>('grid');
    // Defer today's date to client-only — avoids SSR/client hydration mismatch (#418)
    // Server renders null → no date-dependent classes → hydration succeeds → useEffect fires
    const [clientToday, setClientToday] = useState<Date | null>(null);
    const plan = block.block_plan;

    // Build week-to-phase mapping
    const weekPhaseMap = useMemo(() => {
        const map: Record<number, { phase: TrainingPhase; weekInPhase: number }> = {};
        let weekNum = 1;
        for (const phase of plan.phases) {
            for (let i = 0; i < phase.weeks; i++) {
                map[weekNum] = { phase, weekInPhase: i + 1 };
                weekNum++;
            }
        }
        return map;
    }, [plan.phases]);

    // Get the start date and calculate dates for each day
    const startDate = useMemo(() => new Date(block.start_date), [block.start_date]);

    // Get the Monday of the week containing the start date
    const startMonday = useMemo(() => {
        const date = new Date(block.start_date);
        date.setHours(0, 0, 0, 0);
        // getDay() returns 0 for Sunday, 1 for Monday, etc.
        const dayOfWeek = date.getDay();
        // Convert to Monday-based: Mon=0, Tue=1, ..., Sun=6
        const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        date.setDate(date.getDate() - daysSinceMonday);
        return date;
    }, [block.start_date]);

    // Get the race date for marking
    const raceDate = useMemo(() => {
        const date = new Date(block.end_date);
        date.setHours(0, 0, 0, 0);
        return date;
    }, [block.end_date]);

    // Build calendar grid data
    const calendarData = useMemo(() => {
        const weeks: Array<{
            weekNum: number;
            phase: TrainingPhase;
            weekInPhase: number;
            targetKm: number;
            actualKm: number;
            hasWorkouts: boolean;
            days: Array<{
                date: Date;
                workout: DailyWorkout | null;
                isRaceDay: boolean;
            }>;
        }> = [];

        for (let week = 1; week <= plan.totalWeeks; week++) {
            const phaseInfo = weekPhaseMap[week];
            if (!phaseInfo) continue; // week falls outside all defined phases
            const weekWorkouts = (block.weekly_workouts || {})[week.toString()] || [];
            const hasWorkouts = weekWorkouts.length > 0;

            // Calculate actual dates for this week starting from the aligned Monday
            const weekStartDate = new Date(startMonday);
            weekStartDate.setDate(weekStartDate.getDate() + (week - 1) * 7);

            const days = DAYS_OF_WEEK.map((_, dayIndex) => {
                const dayDate = new Date(weekStartDate);
                dayDate.setDate(dayDate.getDate() + dayIndex);
                dayDate.setHours(0, 0, 0, 0);

                // Find workout for this day
                const dayName = Object.keys(DAY_MAP).find(name => DAY_MAP[name] === dayIndex) || '';
                const workout = weekWorkouts.find(w => w.day === dayName) || null;

                // Check if this is race day
                const isRaceDay = dayDate.getTime() === raceDate.getTime();

                return { date: dayDate, workout, isRaceDay };
            });

            // Calculate actual km from workouts instead of using pre-set targets
            const actualKm = weekWorkouts.reduce((sum, w) => sum + (w.distance_km || 0), 0);
            const targetKm = phaseInfo.phase.weeklyKm[phaseInfo.weekInPhase - 1] || 0;

            weeks.push({
                weekNum: week,
                phase: phaseInfo.phase,
                weekInPhase: phaseInfo.weekInPhase,
                targetKm,
                actualKm: Math.round(actualKm), // Use calculated sum from workouts
                hasWorkouts,
                days,
            });
        }

        return weeks;
    }, [plan.totalWeeks, weekPhaseMap, block.weekly_workouts, startMonday, raceDate]);

    // Group weeks by month for display
    const monthGroups = useMemo(() => {
        const groups: Array<{
            monthLabel: string;
            weeks: typeof calendarData;
        }> = [];

        let currentMonth = '';
        let currentGroup: typeof calendarData = [];

        for (const week of calendarData) {
            const monthLabel = week.days[0].date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            if (monthLabel !== currentMonth) {
                if (currentGroup.length > 0) {
                    groups.push({ monthLabel: currentMonth, weeks: currentGroup });
                }
                currentMonth = monthLabel;
                currentGroup = [week];
            } else {
                currentGroup.push(week);
            }
        }

        if (currentGroup.length > 0) {
            groups.push({ monthLabel: currentMonth, weeks: currentGroup });
        }

        return groups;
    }, [calendarData]);

    // Set client today after hydration — null during SSR so date-dependent classes don't mismatch
    useEffect(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        setClientToday(t);
    }, []);

    if (!plan || !plan.phases) {
        return null;
    }

    return (
        <div className="mt-4">
            {/* Toggle Button */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg border border-white/10 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className="text-xl">📅</span>
                    <span className="text-sm font-medium text-white">
                        Training Calendar
                    </span>
                    <span className="text-xs text-purple-300/60">
                        {plan.totalWeeks} weeks • {plan.phases.length} phases
                    </span>
                </div>
                <span className={`text-purple-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
                    ▼
                </span>
            </button>

            {/* Expanded Calendar */}
            {expanded && (
                <div className="mt-3 bg-slate-800/50 rounded-xl border border-white/10">


                    {/* View Mode Toggle - Sticky Header */}
                    <div className="p-3 border-b border-white/10 flex items-center justify-between shrink-0 sticky top-0 bg-slate-800/95 backdrop-blur-sm z-10 rounded-t-xl">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'grid'
                                    ? 'bg-purple-500/30 text-purple-300'
                                    : 'text-purple-300/60 hover:text-purple-300'
                                    }`}
                            >
                                Calendar Grid
                            </button>
                            <button
                                onClick={() => setViewMode('phases')}
                                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'phases'
                                    ? 'bg-purple-500/30 text-purple-300'
                                    : 'text-purple-300/60 hover:text-purple-300'
                                    }`}
                            >
                                Phase Overview
                            </button>
                        </div>

                        {/* Regenerate button - visible at top */}
                        <button
                            onClick={async () => {
                                if (confirm('Regenerate the entire training plan? This will delete the current plan and create a new one with all weeks populated.')) {
                                    try {
                                        await fetch(`/api/training-block?blockId=${block.id}`, {
                                            method: 'DELETE',
                                        });
                                        alert('Block deleted. Click "Create Training Plan" on your race to generate a new complete plan.');
                                        window.location.reload();
                                    } catch {
                                        alert('Failed to regenerate block');
                                    }
                                }
                            }}
                            className="text-[10px] text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 px-2 py-1 rounded transition-colors border border-purple-500/30"
                        >
                            🔄 Regenerate Plan
                        </button>

                        {/* Legend */}
                        <div className="flex gap-3 text-[10px]">
                            <div className="flex items-center gap-1">
                                <span className="text-sm">🏁</span>
                                <span className="text-amber-300 font-medium">Race</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-purple-500" />
                                <span className="text-purple-300/60">Long</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-orange-500" />
                                <span className="text-purple-300/60">Tempo</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-blue-400" />
                                <span className="text-purple-300/60">Easy</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-slate-600" />
                                <span className="text-purple-300/60">Rest</span>
                            </div>
                        </div>
                    </div>

                    {viewMode === 'grid' ? (
                        /* Month-by-Month Calendar Grid */
                        <div className="divide-y divide-white/5">
                            {monthGroups.map((monthGroup, monthIdx) => (
                                <div key={monthIdx} className="p-4">
                                    {/* Month Header */}
                                    <h3 className="text-sm font-semibold text-white mb-3">
                                        {monthGroup.monthLabel}

                                    </h3>

                                    {/* Week Headers */}

                                    <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-1 mb-1">
                                        <div className="text-[10px] text-purple-300/40"></div>
                                        {DAYS_OF_WEEK.map(day => (
                                            <div key={day} className="text-[10px] text-purple-300/40 text-center">
                                                {day}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Week Rows */}
                                    {monthGroup.weeks.map((week) => {
                                        const isCurrentWeek = week.weekNum === currentWeek;
                                        const phaseColor = getPhaseColor(week.phase.name);

                                        return (
                                            <div
                                                key={week.weekNum}
                                                className={`grid grid-cols-[60px_repeat(7,1fr)] gap-1 mb-1 ${isCurrentWeek ? 'ring-1 ring-orange-400/50 rounded-lg' : ''
                                                    }`}
                                            >
                                                {/* Week Label */}
                                                <div className={`flex flex-col items-center justify-center px-1 py-2 rounded-l-lg ${phaseColor.bg}`}>
                                                    <span className="text-[10px] text-purple-300/60">W{week.weekNum}</span>
                                                    <span className={`text-xs font-bold ${phaseColor.text}`}>
                                                        {week.actualKm || week.targetKm}km
                                                    </span>
                                                    {isCurrentWeek && (
                                                        <span className="text-[8px] text-orange-400 font-medium">NOW</span>
                                                    )}
                                                </div>

                                                {/* Day Cells */}
                                                {week.days.map((day, dayIdx) => {
                                                    const isToday = clientToday ? day.date.toDateString() === clientToday.toDateString() : false;
                                                    const isPast = clientToday ? day.date < clientToday : false;
                                                    const isRaceDay = day.isRaceDay;

                                                    return (
                                                        <div
                                                            key={dayIdx}
                                                            className={`
                                                                relative min-h-[52px] p-1 rounded-md border
                                                                ${isRaceDay
                                                                    ? 'border-amber-400 border-2 bg-gradient-to-br from-amber-500/20 to-orange-500/20 ring-2 ring-amber-400/50'
                                                                    : isToday
                                                                        ? 'border-orange-400 bg-orange-400/10'
                                                                        : 'border-white/5 bg-slate-700/20'
                                                                }
                                                                ${isPast && !isRaceDay ? 'opacity-60' : ''}
                                                            `}
                                                            title={isRaceDay ? `🏁 RACE DAY - ${block.raceName}` : (day.workout?.description || day.workout?.type || 'No workout')}
                                                        >
                                                            {/* Race Day Flag */}
                                                            {isRaceDay && (
                                                                <div className="absolute -top-2 -right-1 text-lg" title="Race Day!">
                                                                    🏁
                                                                </div>
                                                            )}

                                                            {/* Date Number */}
                                                            <span className={`text-[10px] ${isRaceDay
                                                                ? 'text-amber-300 font-bold'
                                                                : isToday
                                                                    ? 'text-orange-400 font-bold'
                                                                    : 'text-purple-300/40'
                                                                }`}>
                                                                {day.date.getDate()}
                                                            </span>

                                                            {isRaceDay ? (
                                                                <div className="mt-1 text-center">
                                                                    <div className="text-[10px] font-bold text-amber-300 uppercase tracking-wide">
                                                                        🏁 Race Day
                                                                    </div>
                                                                    <div className="text-[10px] text-amber-200 font-semibold leading-tight mt-0.5" title={block.raceName}>
                                                                        {block.raceName}
                                                                    </div>
                                                                </div>
                                                            ) : day.workout ? (
                                                                <div className="mt-1">
                                                                    <div className={`
                                                                        w-full h-1.5 rounded-full 
                                                                        ${getWorkoutColor(day.workout.type)}
                                                                    `} />
                                                                    <div className="text-[9px] leading-tight text-white/80 mt-0.5 truncate">
                                                                        {day.workout.type}
                                                                    </div>
                                                                    {day.workout.distance_km && (
                                                                        <div className="text-[8px] text-purple-300/60">
                                                                            {day.workout.distance_km}km
                                                                            {day.workout.elevation_m && (
                                                                                <span className="text-green-400/70 ml-1">+{day.workout.elevation_m}m</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : !week.hasWorkouts && (
                                                                <div className="mt-1 opacity-30">
                                                                    <div className="w-full h-1.5 rounded-full bg-slate-600/50 border border-dashed border-slate-500/30" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* Phase Overview (Original View) */
                        <div className="p-4 space-y-4">
                            {plan.phases.map((phase, phaseIdx) => {
                                const colors = getPhaseColor(phase.name);
                                const phaseStartWeek = plan.phases.slice(0, phaseIdx).reduce((sum, p) => sum + p.weeks, 1);

                                return (
                                    <div key={phaseIdx} className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold ${colors.text} uppercase tracking-wide`}>
                                                {phase.name}
                                            </span>
                                            <span className="text-[10px] text-purple-300/50">
                                                ({phase.weeks} weeks)
                                            </span>
                                            <span className="text-[10px] text-purple-300/40 italic">
                                                {phase.focus}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            {Array.from({ length: phase.weeks }, (_, weekIdx) => {
                                                const weekNum = phaseStartWeek + weekIdx;
                                                const isCurrentWeek = weekNum === currentWeek;

                                                // Calculate actual km from weekly_workouts (single source of truth)
                                                const weekWorkouts = (block.weekly_workouts || {})[weekNum.toString()] || [];
                                                const actualKm = Math.round(weekWorkouts.reduce((sum, w) => sum + (w.distance_km || 0), 0));

                                                return (
                                                    <div
                                                        key={weekIdx}
                                                        className={`
                                                            flex flex-col items-center justify-center
                                                            w-16 h-14 rounded-lg border
                                                            ${colors.bg} ${colors.border}
                                                            ${isCurrentWeek ? 'ring-2 ring-orange-400 ring-offset-1 ring-offset-slate-900' : ''}
                                                        `}
                                                    >
                                                        <span className="text-[10px] text-purple-300/60 uppercase">
                                                            W{weekNum}
                                                        </span>
                                                        <span className={`text-sm font-bold ${isCurrentWeek ? 'text-orange-400' : 'text-white'}`}>
                                                            {actualKm}km
                                                        </span>
                                                        {isCurrentWeek && (
                                                            <span className="text-[8px] text-orange-400 font-medium">
                                                                NOW
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                    </div>
                                );
                            })}

                            {/* Summary Footer */}
                            <div className="pt-3 border-t border-white/10 space-y-2">
                                {plan.keyWorkouts && plan.keyWorkouts.length > 0 && (
                                    <div className="text-[10px] text-purple-300/60">
                                        <span className="font-medium text-purple-300/80">Key workouts:</span>{' '}
                                        {plan.keyWorkouts.join(' • ')}
                                    </div>
                                )}
                                {plan.notes && (
                                    <div className="text-[10px] text-purple-300/50 italic">
                                        {plan.notes}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Delete Block Button */}
                    <div className="p-3 border-t border-white/10 flex justify-end shrink-0 gap-2">
                        <button
                            onClick={async () => {
                                if (confirm('Delete this training block? This cannot be undone.')) {
                                    try {
                                        const res = await fetch(`/api/training-block?blockId=${block.id}`, {
                                            method: 'DELETE',
                                        });
                                        if (res.ok) {
                                            window.location.reload();
                                        } else {
                                            alert('Failed to delete block');
                                        }
                                    } catch {
                                        alert('Failed to delete block');
                                    }
                                }
                            }}
                            className="text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded transition-colors"
                        >
                            🗑️ Delete Block
                        </button>
                        <button
                            onClick={async () => {
                                if (confirm('Regenerate the entire training plan? This will delete the current plan and create a new one with all weeks populated.')) {
                                    try {
                                        await fetch(`/api/training-block?blockId=${block.id}`, {
                                            method: 'DELETE',
                                        });
                                        alert('Block deleted. Click "Create Training Plan" on your race to generate a new complete plan.');
                                        window.location.reload();
                                    } catch {
                                        alert('Failed to regenerate block');
                                    }
                                }
                            }}
                            className="text-[10px] text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 px-2 py-1 rounded transition-colors"
                        >
                            🔄 Regenerate Full Plan
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

