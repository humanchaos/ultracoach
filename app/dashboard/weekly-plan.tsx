"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

interface WorkoutModification {
    triggered_by: 'sleep' | 'stress' | 'injury' | 'general';
    original_workout: string;
    original_type?: string;
    reason: string;
    modified_at: string;
}

interface DayPlan {
    day: string;
    date: string;
    type: "run" | "rest" | "cross" | "long" | "recovery" | "tempo" | "intervals";
    title: string;
    description: string;
    duration?: string;
    distance_km?: number;
    elevation_m?: number;  // NEW: vertical gain target
    intensity: "easy" | "moderate" | "hard";
    hrZone?: string;       // e.g., "Zone 2: 130-145 bpm"
    targetPace?: string;   // e.g., "6:30-7:00/km"
    effortLevel?: string;  // e.g., "Conversational"
    nutrition?: string;    // e.g., "Eat 2h before. Bring gel for runs >1h"
    recovery?: string;     // NEW: Evening recovery suggestions
    corosZone?: string;    // COROS watch equivalent zone label
    rationale: string;
    modification?: WorkoutModification; // Bio-feedback adjustment
}

interface Activity {
    name: string;
    date: string;
    dateISO?: string;
    distance_km: number;
    pace?: string;
    heart_rate?: number;
}

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
    goal_time?: string;
}

interface WeeklyPlanProps {
    trainingContext: string;
    racesContext: string;
    activities?: Activity[];
    races?: Race[];
    onWorkoutsSaved?: () => void;
    blockWorkouts?: DayPlan[];  // Pre-loaded from training block (single source of truth)
    weekSummaryOverride?: string; // Summary from training block
    blockDataLoading?: boolean;  // True while parent is still fetching block data — prevents premature AI plan generation
}

function parsePlanDate(dateStr: string): Date {
    const currentYear = new Date().getFullYear();

    // Clean up the date string - remove day names like "Monday", "Mon,"
    const cleaned = dateStr.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*[,\s]*/i, '').trim();

    // Try to match "Jan 6", "January 6", etc.
    const match = cleaned.match(/([A-Za-z]+)\s+(\d+)/);
    if (match) {
        const months: Record<string, number> = {
            jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
            apr: 3, april: 3, may: 4, jun: 5, june: 5,
            jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
            oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
        };
        const monthKey = match[1].toLowerCase();
        const month = months[monthKey] ?? months[monthKey.slice(0, 3)];
        if (month !== undefined) {
            const day = parseInt(match[2]);
            const result = new Date(currentYear, month, day);
            return result;
        }
    }

    // Fallback to native parsing
    const fallback = new Date(dateStr);
    console.warn(`[parsePlanDate] Fallback parsing for: "${dateStr}" -> ${fallback.toDateString()}`);
    return fallback;
}

function getDayStatus(dateStr: string): "past" | "today" | "future" {
    const planDate = parsePlanDate(dateStr);
    const today = new Date();
    planDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (planDate.getTime() === today.getTime()) return "today";
    if (planDate < today) return "past";
    return "future";
}

// ─── Actual vs Planned helpers ────────────────────────────────────────────

interface DayActuals {
    totalKm: number;
    avgHR: number | null;
    count: number;
    activities: Activity[];
}

function getActualsForDay(dateStr: string, activities: Activity[]): DayActuals | null {
    const planDate = parsePlanDate(dateStr);
    if (!planDate || isNaN(planDate.getTime())) return null;
    planDate.setHours(0, 0, 0, 0);

    const matched = activities.filter(a => {
        const raw = a.dateISO ? new Date(a.dateISO) : new Date(a.date);
        if (isNaN(raw.getTime())) return false;
        raw.setHours(0, 0, 0, 0);
        return raw.getTime() === planDate.getTime();
    });

    if (matched.length === 0) return null;

    const totalKm = matched.reduce((sum, a) => sum + a.distance_km, 0);
    const withHR = matched.filter(a => a.heart_rate && a.heart_rate > 0);
    const avgHR = withHR.length > 0
        ? Math.round(withHR.reduce((sum, a) => sum + a.heart_rate!, 0) / withHR.length)
        : null;

    return { totalKm: Math.round(totalKm * 10) / 10, avgHR, count: matched.length, activities: matched };
}

type CompletionStatus = 'done' | 'partial' | 'missed' | 'none';

function getCompletionStatus(day: DayPlan, actuals: DayActuals | null, isPast: boolean): CompletionStatus {
    if (!isPast) return 'none';

    const isRestDay = day.type === 'rest';

    if (isRestDay) {
        // Rest day: no activity = followed plan (done), any running = overreaching (partial)
        if (!actuals) return 'done';
        const ranKm = actuals.activities.filter(a => !a.name?.toLowerCase().includes('walk')).reduce((s, a) => s + a.distance_km, 0);
        return ranKm > 1 ? 'partial' : 'done';
    }

    if (!actuals) return 'missed';

    if (day.distance_km && day.distance_km > 0) {
        const ratio = actuals.totalKm / day.distance_km;
        if (ratio >= 0.85) return 'done';
        if (ratio >= 0.45) return 'partial';
        return 'missed';
    }

    // No distance target — any activity counts
    return 'done';
}

const COMPLETION_STYLES: Record<CompletionStatus, { border: string; bg: string; badge: string; badgeColor: string }> = {
    done:    { border: 'border-emerald-500/50', bg: 'bg-emerald-900/15',  badge: '✓', badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    partial: { border: 'border-amber-500/50',   bg: 'bg-amber-900/10',    badge: '~', badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    missed:  { border: 'border-red-500/30',     bg: 'bg-red-900/10',      badge: '✗', badgeColor: 'bg-red-500/20 text-red-400 border-red-500/30' },
    none:    { border: 'border-white/10',        bg: 'bg-slate-800/50',    badge: '',  badgeColor: '' },
};

// ─────────────────────────────────────────────────────────────────────────────

export function WeeklyPlanView({ trainingContext, racesContext, activities, races, onWorkoutsSaved, blockWorkouts, weekSummaryOverride, blockDataLoading }: WeeklyPlanProps) {
    const [plan, setPlan] = useState<DayPlan[]>([]);
    const [weekSummary, setWeekSummary] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedDay, setSelectedDay] = useState<DayPlan | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
    const [fromStorage, setFromStorage] = useState(false); // Track if plan is from DB
    // Client-side date to avoid hydration mismatch
    const [clientToday, setClientToday] = useState<Date | null>(null);
    // Track if we've already loaded to prevent multiple fetches
    const [hasLoaded, setHasLoaded] = useState(false);

    // Build date→activities index once per activities change (js-index-maps)
    // Key: "YYYY-MM-DD", value: array of activities on that date
    const activitiesByDate = useMemo(() => {
        const map = new Map<string, Activity[]>();
        for (const a of (activities || [])) {
            const raw = a.dateISO ? new Date(a.dateISO) : new Date(a.date);
            if (isNaN(raw.getTime())) continue;
            const key = raw.toISOString().slice(0, 10); // "YYYY-MM-DD"
            const bucket = map.get(key);
            if (bucket) bucket.push(a);
            else map.set(key, [a]);
        }
        return map;
    }, [activities]);

    // Fast actuals lookup using the pre-built index
    const getActuals = (dateStr: string): DayActuals | null => {
        const planDate = parsePlanDate(dateStr);
        if (!planDate || isNaN(planDate.getTime())) return null;
        const key = planDate.toISOString().slice(0, 10);
        const matched = activitiesByDate.get(key);
        if (!matched || matched.length === 0) return null;

        const totalKm = Math.round(matched.reduce((s, a) => s + a.distance_km, 0) * 10) / 10;
        const withHR = matched.filter(a => a.heart_rate && a.heart_rate > 0);
        const avgHR = withHR.length > 0
            ? Math.round(withHR.reduce((s, a) => s + a.heart_rate!, 0) / withHR.length)
            : null;
        return { totalKm, avgHR, count: matched.length, activities: matched };
    };

    useEffect(() => {
        // Set client date only after hydration
        setClientToday(new Date());
    }, []);

    useEffect(() => {
        // Block workouts available — always use them (covers initial load AND prop updates after re-fetch)
        if (blockWorkouts && blockWorkouts.length > 0) {
            setPlan(blockWorkouts);
            setWeekSummary(weekSummaryOverride || '');
            setFromStorage(true);
            setIsLoading(false);
            setHasLoaded(true);
            return;
        }
        // Wait for parent block fetch to settle before deciding to generate via AI
        // This prevents firing an AI call that gets wasted when blockWorkouts arrive shortly after
        if (blockDataLoading) return;
        // No block workouts and block fetch is done → generate via AI (only once)
        if (!hasLoaded) {
            generatePlan();
            setHasLoaded(true);
        }
    }, [hasLoaded, blockWorkouts, blockDataLoading]);

    const generatePlan = async (mode: 'normal' | 'force' | 'enhance' = 'normal') => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/training-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    trainingContext,
                    racesContext,
                    currentDate: new Date().toLocaleDateString("en-US", {
                        weekday: "short", month: "short", day: "numeric"
                    }),
                    activities: activities || [],
                    races: races || [],
                    forceRegenerate: mode === 'force',
                    // Pass existing workouts for enhancement (adds HR/pace without changing structure)
                    existingWorkouts: mode === 'enhance' ? plan : undefined,
                    enhanceOnly: mode === 'enhance',
                }),
            });

            const data = await response.json();

            // Handle compromised block (drift detection triggered)
            if (!response.ok && data.needsRegeneration) {
                setError(`⚠️ Plan Broken: ${data.message || 'Your training plan has drifted too far from the macro targets.'} Please regenerate your training block.`);
                setIsLoading(false);
                return;
            }

            if (!response.ok) throw new Error("Failed");

            setPlan(data.weekPlan || []);
            setWeekSummary(data.weekSummary || "");
            setFromStorage(data.fromStorage || false);
            // Notify parent that workouts were saved/loaded
            if (onWorkoutsSaved && !data.fromStorage) {
                onWorkoutsSaved();
            }
        } catch {
            setError("Failed to generate plan");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDayClick = (day: DayPlan, event: React.MouseEvent) => {
        if (selectedDay?.day === day.day) {
            setSelectedDay(null);
            setTooltipPos(null);
        } else {
            setSelectedDay(day);
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setTooltipPos({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
        }
    };

    const getIcon = (type: string, title?: string) => {
        // Check title for better matching
        const t = (title || "").toLowerCase();
        const typ = type.toLowerCase();

        // Title-based matching first (more specific)
        if (t.includes("swim")) return "🏊";
        if (t.includes("walk") && !t.includes("power")) return "🚶";
        if (t.includes("stretch") || t.includes("yoga") || t.includes("mobility")) return "🧘";
        if (t.includes("rest") || t.includes("complete re") || t.includes("off")) return "😴";
        if (t.includes("recovery")) return "💆";
        if (t.includes("tempo")) return "⚡";
        if (t.includes("interval") || t.includes("speed") || t.includes("repeat")) return "🔥";
        if (t.includes("bike") || t.includes("cycle")) return "🚴";

        // Mountain/Hill/Flat detection - most specific terrain matching
        if (t.includes("power hike") || t.includes("powerhike")) return "🧗";
        if (t.includes("hike")) return "🥾";
        if (t.includes("mountain") || t.includes("alpine") || t.includes("trail")) return "🏔️";
        if (t.includes("hill") || t.includes("uphill") || t.includes("climb") || t.includes("vert")) return "⛰️";
        if (t.includes("long run") || t.includes("long:")) return "🏔️";
        if (t.includes("easy") || t.includes("flat") || t.includes("recovery run") || t.includes("shakeout") || t.includes("shuffle")) return "🏃";

        // Type-based fallback
        const icons: Record<string, string> = {
            rest: "😴", recovery: "💆", run: "🏃", long: "🏔️",
            tempo: "⚡", intervals: "🔥", cross: "🏊"
        };
        return icons[typ] || "🏃";
    };

    // Get modification badge based on trigger type
    const getModificationBadge = (modification: WorkoutModification) => {
        const badges: Record<string, { icon: string; color: string; label: string }> = {
            sleep: { icon: '🛌', color: 'bg-purple-500/30 border-purple-400/50', label: 'Sleep' },
            stress: { icon: '⚡', color: 'bg-yellow-500/30 border-yellow-400/50', label: 'Stress' },
            injury: { icon: '⚠️', color: 'bg-orange-500/30 border-orange-400/50', label: 'Injury' },
            general: { icon: '🔄', color: 'bg-gray-500/30 border-gray-400/50', label: 'Adjusted' },
        };
        return badges[modification.triggered_by] || badges.general;
    };

    if (isLoading) {
        return (
            <div className="flex items-center gap-3 py-6 justify-center text-gray-400 text-sm">
                <div className="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full" />
                Coach is analyzing your training...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-6 text-red-400">
                {error} <button onClick={() => generatePlan()} className="underline ml-2">Retry</button>
            </div>
        );
    }

    return (
        <>
            {/* Week Summary */}
            {weekSummary && (
                <div className="flex items-center gap-2 mb-3">
                    <p className="text-sm text-gray-400">{weekSummary}</p>
                    {fromStorage && (
                        <>
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                ✓ Stable
                            </span>
                            <button
                                onClick={() => generatePlan('enhance')}
                                className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full hover:bg-purple-500/30 transition-colors"
                                title="Add HR zones and pace targets (keeps workout structure)"
                            >
                                ⚡ Add Targets
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* 7-Day Row - Matching page style */}
            <div className="flex gap-2">
                {plan.map((day, i) => {
                    // Use clientToday for date comparison to avoid hydration mismatch
                    const getStatus = (): "past" | "today" | "future" => {
                        if (!clientToday) return "future"; // Default during SSR
                        const planDate = parsePlanDate(day.date);
                        const today = new Date(clientToday);
                        planDate.setHours(0, 0, 0, 0);
                        today.setHours(0, 0, 0, 0);

                        if (planDate.getTime() === today.getTime()) return "today";
                        if (planDate < today) return "past";
                        return "future";
                    };
                    const status = getStatus();
                    const isPast = status === "past";
                    const isToday = status === "today";
                    const isSelected = selectedDay?.day === day.day;

                    // Planned vs actual — only after clientToday is set (avoids hydration mismatch)
                    // On server render clientToday is null → actuals=null → no extra DOM nodes
                    const actuals = (clientToday && (isPast || isToday)) ? getActuals(day.date) : null;
                    const completion = getCompletionStatus(day, actuals, isPast);
                    const cs = COMPLETION_STYLES[completion];

                    return (
                        <button
                            key={i}
                            onClick={(e) => handleDayClick(day, e)}
                            suppressHydrationWarning
                            className={`
                                flex-1 relative rounded-xl border p-4 text-center transition-all
                                ${cs.bg} ${cs.border}
                                ${isToday ? "ring-2 ring-purple-500/60" : ""}
                                ${isSelected ? "brightness-110" : "hover:brightness-110"}
                            `}
                        >
                            {/* Today Badge */}
                            {isToday && (
                                <span suppressHydrationWarning className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-purple-500 text-[10px] font-bold px-2 py-0.5 rounded-full text-white uppercase tracking-wide">
                                    Today
                                </span>
                            )}

                            {/* Completion badge (top-left, past days only) */}
                            {completion !== 'none' && (
                                <span className={`absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${cs.badgeColor}`}>
                                    {cs.badge}
                                </span>
                            )}

                            {/* Day Name */}
                            <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isPast ? "text-gray-500" : "text-gray-400"}`}>
                                {day.day}
                            </div>

                            {/* Icon */}
                            <div className={`text-2xl mb-2 ${isPast && completion === 'missed' ? "grayscale opacity-40" : ""}`}>
                                {getIcon(day.type, day.title)}
                            </div>

                            {/* Title */}
                            <div className={`text-sm font-medium ${isPast && completion === 'missed' ? "text-gray-600" : isPast ? "text-gray-400" : "text-white"}`}>
                                {day.title.length > 12 ? day.title.slice(0, 11) + "…" : day.title}
                            </div>

                            {/* Planned distance */}
                            {day.distance_km && (
                                <div className={`text-sm font-bold mt-1 ${isPast && completion === 'missed' ? "text-gray-600" : isPast ? "text-gray-500 line-through decoration-gray-600" : "text-purple-300"}`}>
                                    {day.distance_km}km
                                </div>
                            )}

                            {/* Actual distance overlay (past days) */}
                            {actuals && actuals.totalKm > 0 && (
                                <div className={`text-xs font-bold mt-0.5 ${completion === 'done' ? 'text-emerald-400' : completion === 'partial' ? 'text-amber-400' : 'text-gray-400'}`}>
                                    {actuals.count > 1 ? `${actuals.count}× ` : ''}{actuals.totalKm}km
                                    {actuals.avgHR && <span className="text-[9px] font-normal opacity-70 ml-1">{actuals.avgHR}bpm</span>}
                                </div>
                            )}

                            {/* Duration + Elevation - secondary (future days only to keep card clean) */}
                            {!isPast && (day.duration || day.elevation_m) && (
                                <div className="text-[10px] mt-0.5 flex items-center gap-1 justify-center text-gray-500">
                                    {day.duration && <span>{day.duration}</span>}
                                    {day.elevation_m && (
                                        <span className="text-green-400 font-medium">↑{day.elevation_m}m</span>
                                    )}
                                </div>
                            )}

                            {/* Modification Badge */}
                            {day.modification && (
                                <div
                                    className={`absolute -top-2 -right-2 ${getModificationBadge(day.modification).color} border rounded-full p-1 text-xs cursor-help`}
                                    title={`Original: ${day.modification.original_workout}. Adjusted due to: ${day.modification.reason}`}
                                >
                                    {getModificationBadge(day.modification).icon}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Tooltip Portal */}
            {selectedDay && tooltipPos && typeof document !== "undefined" && createPortal(
                <div
                    className="fixed bg-slate-800 border border-white/10 rounded-xl p-4 shadow-2xl max-w-sm z-[99999] animate-in fade-in zoom-in-95 duration-150"
                    style={{ left: tooltipPos.x, top: tooltipPos.y, transform: "translateX(-50%)" }}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{getIcon(selectedDay.type, selectedDay.title)}</span>
                        <h4 className="font-semibold text-white">{selectedDay.title}</h4>
                        <span className="ml-auto text-xs text-gray-400">{selectedDay.day}, {selectedDay.date}</span>
                    </div>
                    <p className="text-sm text-gray-300 mb-3">{selectedDay.description}</p>

                    {/* Training Targets */}
                    {(selectedDay.hrZone || selectedDay.targetPace || selectedDay.effortLevel || selectedDay.elevation_m || selectedDay.corosZone) && (
                        <div className="bg-slate-700/50 rounded-lg p-3 mb-3 space-y-1.5">
                            {selectedDay.hrZone && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-red-400">❤️</span>
                                    <span className="text-gray-400">HR:</span>
                                    <span className="text-white font-medium">{selectedDay.hrZone}</span>
                                </div>
                            )}
                            {selectedDay.targetPace && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-blue-400">⏱️</span>
                                    <span className="text-gray-400">Pace:</span>
                                    <span className="text-white font-medium">{selectedDay.targetPace}</span>
                                </div>
                            )}
                            {selectedDay.effortLevel && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-yellow-400">💪</span>
                                    <span className="text-gray-400">Effort:</span>
                                    <span className="text-white font-medium">{selectedDay.effortLevel}</span>
                                </div>
                            )}
                            {selectedDay.elevation_m && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-green-400">⛰️</span>
                                    <span className="text-gray-400">Vert:</span>
                                    <span className="text-green-300 font-medium">+{selectedDay.elevation_m}m</span>
                                </div>
                            )}
                            {selectedDay.corosZone && selectedDay.corosZone !== 'N/A' && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-cyan-400">⌚</span>
                                    <span className="text-gray-400">COROS:</span>
                                    <span className="text-cyan-300 font-medium">{selectedDay.corosZone}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Nutrition */}
                    {selectedDay.nutrition && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2.5 mb-3">
                            <div className="flex items-start gap-2 text-sm">
                                <span className="text-green-400">🍎</span>
                                <span className="text-green-200">{selectedDay.nutrition}</span>
                            </div>
                        </div>
                    )}

                    {/* Evening Recovery */}
                    {selectedDay.recovery && (
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 mb-3">
                            <div className="flex items-start gap-2 text-sm">
                                <span className="text-blue-400">🌙</span>
                                <div>
                                    <span className="text-blue-300 font-medium text-xs">Evening Recovery:</span>
                                    <p className="text-blue-200 mt-0.5">{selectedDay.recovery}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Actual vs Planned — shown for past days */}
                    {(() => {
                        const tooltipActuals = getActuals(selectedDay.date);
                        const tooltipStatus = getCompletionStatus(
                            selectedDay,
                            tooltipActuals,
                            getDayStatus(selectedDay.date) === 'past'
                        );
                        if (tooltipStatus === 'none') return null;
                        const statusConfig = {
                            done:    { label: 'Completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                            partial: { label: 'Partial',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
                            missed:  { label: 'Missed',    color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' },
                            none:    { label: '',          color: '',                 bg: '' },
                        }[tooltipStatus];
                        return (
                            <div className={`border rounded-lg p-3 mb-3 ${statusConfig.bg}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Actual vs Planned</span>
                                    <span className={`text-xs font-bold ${statusConfig.color}`}>{statusConfig.label}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="text-gray-500">
                                        <div className="text-[10px] uppercase tracking-wide mb-0.5">Planned</div>
                                        <div className="font-medium text-gray-300">
                                            {selectedDay.type === 'rest' ? 'Rest' : selectedDay.distance_km ? `${selectedDay.distance_km}km` : '—'}
                                        </div>
                                        {selectedDay.elevation_m && (
                                            <div className="text-[10px] text-gray-500">↑{selectedDay.elevation_m}m</div>
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wide mb-0.5 text-gray-500">Actual</div>
                                        {tooltipActuals ? (
                                            <>
                                                <div className={`font-bold ${statusConfig.color}`}>
                                                    {tooltipActuals.count > 1 ? `${tooltipActuals.count} activities` : tooltipActuals.totalKm > 0 ? `${tooltipActuals.totalKm}km` : 'Activity logged'}
                                                </div>
                                                {tooltipActuals.count > 1 && tooltipActuals.totalKm > 0 && (
                                                    <div className="text-[10px] text-gray-400">{tooltipActuals.totalKm}km total</div>
                                                )}
                                                {tooltipActuals.avgHR && (
                                                    <div className="text-[10px] text-orange-400">avg {tooltipActuals.avgHR} bpm</div>
                                                )}
                                            </>
                                        ) : (
                                            <div className="text-gray-600 font-medium">Nothing logged</div>
                                        )}
                                    </div>
                                </div>
                                {/* List individual activities for multi-segment days */}
                                {tooltipActuals && tooltipActuals.count > 1 && (
                                    <div className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
                                        {tooltipActuals.activities.map((a, i) => (
                                            <div key={i} className="flex justify-between text-[10px] text-gray-500">
                                                <span className="truncate max-w-[120px]">{a.name}</span>
                                                <span className="text-gray-400 shrink-0 ml-2">{a.distance_km}km{a.heart_rate ? ` · ${a.heart_rate}bpm` : ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    <p className="text-xs text-gray-500">
                        <span className="text-gray-400 font-medium">Why: </span>
                        {selectedDay.rationale}
                    </p>
                    <button
                        onClick={() => { setSelectedDay(null); setTooltipPos(null); }}
                        className="absolute top-2 right-2 text-gray-500 hover:text-white text-sm"
                    >
                        ✕
                    </button>
                </div>,
                document.body
            )}
        </>
    );
}
