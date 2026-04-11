"use client";

import { signOut } from "next-auth/react";
import { ChatInterface, ChatInterfaceRef } from "./chat";
import { WeeklyPlanView } from "./weekly-plan";
import { NextRace } from "./next-race";
import { HeaderControls } from "./header-controls";
import { PreferencesModal } from "./preferences-modal";
import { WelcomeOverlay, useOnboarding } from "./welcome-overlay";
import { CoachHappiness } from "./coach-happiness";
import { BlockCalendar } from "./block-calendar";
import { CoachLog } from "./coach-log";
import { TodayCard } from "./today-card";
import { ProgressChart } from "./progress-chart";
import { useState, useRef, useEffect, useMemo } from "react";

interface Session {
    user: {
        name?: string | null;
        email?: string | null;
        stravaId?: string;
    };
}

interface Activity {
    name: string;
    date: string;
    dateISO?: string;
    distance_km: number;
    pace: string;
    heart_rate?: number;
    type?: string;
}

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
    goal_time?: string;
}

// NEW: Deviation proposal from compliance audit
interface DeviationProposal {
    reason: string;
    currentCompliance: number;
    volumeActual: number;
    volumePlanned: number;
    missedLongRun: boolean;
    hint: string;
}

interface DashboardClientProps {
    session: Session;
    activities: Activity[];
    races: Race[];
    fullContext: string;
    trainingContext: string;
    racesContext: string;
    error: string | null;
    userSignupDate: string | null;
    commitSha?: string;
}

export function DashboardClient({
    session,
    activities,
    races,
    fullContext,
    trainingContext,
    racesContext,
    error,
    userSignupDate,
    commitSha,
}: DashboardClientProps) {
    const [refreshKey, setRefreshKey] = useState(0);
    const [showPreferences, setShowPreferences] = useState(false);
    const [activeBlock, setActiveBlock] = useState<{
        id: number;
        raceName: string;
        currentWeek: number;
        totalWeeks: number;
        phase: string;
    } | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [fullBlock, setFullBlock] = useState<any>(null);
    const [auditMessage, setAuditMessage] = useState<string | null>(null);
    // NEW: State for deviation proposal (user must confirm)
    const [deviationProposal, setDeviationProposal] = useState<DeviationProposal | null>(null);
    const [isApplyingAdaptation, setIsApplyingAdaptation] = useState(false);
    const chatRef = useRef<ChatInterfaceRef>(null);
    const { showOnboarding, completeOnboarding, startOnboarding } = useOnboarding();

    // Fetch active training block status with retry
    useEffect(() => {
        const fetchActiveBlock = async (retryCount = 0) => {
            try {
                const res = await fetch('/api/training-block');
                if (res.ok) {
                    const data = await res.json();
                    if (data.block) {
                        setActiveBlock({
                            id: data.block.id,
                            raceName: data.block.raceName || 'Race',
                            currentWeek: data.block.currentWeek || 1,
                            totalWeeks: data.block.totalWeeks || 12,
                            phase: data.block.currentPhase || 'Build',
                        });
                        // Store full block for calendar
                        setFullBlock(data.block);
                    } else {
                        setActiveBlock(null);
                        setFullBlock(null);
                    }
                } else if (res.status === 504 && retryCount < 2) {
                    // Retry on timeout (cold start)
                    console.log(`[Dashboard] Retrying block fetch (attempt ${retryCount + 2})...`);
                    setTimeout(() => fetchActiveBlock(retryCount + 1), 1000);
                }
            } catch (error) {
                console.error('[Dashboard] Failed to fetch active block:', error);
                // Retry on network error
                if (retryCount < 2) {
                    setTimeout(() => fetchActiveBlock(retryCount + 1), 1000);
                }
            }
        };
        fetchActiveBlock();
    }, [refreshKey]);

    // Derive current week's workouts from block data → single source of truth for WeeklyPlanView
    const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const currentWeekDayPlans = useMemo(() => {
        if (!fullBlock?.weekly_workouts || !activeBlock) return undefined;
        const weekKey = String(activeBlock.currentWeek);
        const workouts = fullBlock.weekly_workouts[weekKey];
        if (!workouts || workouts.length === 0) return undefined;

        // Compute the Monday of the current block week
        const blockStart = new Date(fullBlock.start_date);
        blockStart.setHours(0, 0, 0, 0);
        const dow = blockStart.getDay();
        const daysSinceMonday = dow === 0 ? 6 : dow - 1;
        const firstMonday = new Date(blockStart);
        firstMonday.setDate(firstMonday.getDate() - daysSinceMonday);
        const weekMonday = new Date(firstMonday);
        weekMonday.setDate(weekMonday.getDate() + (activeBlock.currentWeek - 1) * 7);

        // Map to DayPlan format (matching weekly-plan.tsx interface)
        return DAY_NAMES.map((dayName, idx) => {
            const workout = workouts.find((w: { day: string }) => w.day === dayName);
            const dayDate = new Date(weekMonday);
            dayDate.setDate(dayDate.getDate() + idx);
            const dateStr = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            if (!workout || workout.type?.toLowerCase() === 'rest') {
                return {
                    day: dayName.slice(0, 3).toUpperCase(),
                    date: dateStr,
                    type: 'rest' as const,
                    title: 'Rest',
                    description: workout?.description || 'Full rest day',
                    intensity: 'easy' as const,
                    rationale: 'Recovery from training load',
                };
            }

            // Map block workout type to DayPlan type
            const typeMap: Record<string, string> = {
                'Long Run': 'long', 'Easy Run': 'run', 'Easy': 'run',
                'Recovery': 'recovery', 'Tempo': 'tempo', 'Intervals': 'intervals',
                'Cross-Training': 'cross', 'Hills': 'run', 'Fartlek': 'intervals',
            };
            const intensityMap: Record<string, string> = {
                'Long Run': 'moderate', 'Easy Run': 'easy', 'Easy': 'easy',
                'Recovery': 'easy', 'Tempo': 'hard', 'Intervals': 'hard',
                'Cross-Training': 'easy', 'Hills': 'hard', 'Fartlek': 'moderate',
            };

            return {
                day: dayName.slice(0, 3).toUpperCase(),
                date: dateStr,
                type: (typeMap[workout.type] || 'run') as "run" | "rest" | "cross" | "long" | "recovery" | "tempo" | "intervals",
                title: workout.type || 'Workout',
                description: workout.description || '',
                distance_km: workout.distance_km,
                elevation_m: workout.elevation_m,
                duration: workout.duration_min ? `${workout.duration_min} min` : undefined,
                intensity: (intensityMap[workout.type] || 'moderate') as "easy" | "moderate" | "hard",
                hrZone: workout.hrZone,
                targetPace: workout.targetPace,
                effortLevel: workout.effortLevel,
                rationale: `Week ${activeBlock.currentWeek} - ${activeBlock.phase} phase`,
            };
        });
    }, [fullBlock, activeBlock]);

    const currentWeekSummary = useMemo(() => {
        if (!activeBlock || !fullBlock) return undefined;
        return `Week ${activeBlock.currentWeek} of ${activeBlock.totalWeeks} - ${fullBlock.raceName || 'Race'} · ${activeBlock.phase} phase`;
    }, [activeBlock, fullBlock]);

    // Run compliance audit on mount (if block exists and audit is due)
    useEffect(() => {
        const runComplianceAudit = async () => {
            try {
                // First check if audit is due
                const statusRes = await fetch('/api/training-block/adapt');
                if (!statusRes.ok) return;

                const status = await statusRes.json();
                if (!status.hasBlock || !status.auditDue) {
                    console.log('[Dashboard] Compliance audit not due');
                    return;
                }

                console.log('[Dashboard] Running compliance audit...');

                // Run the audit with current activities
                const auditRes = await fetch('/api/training-block/adapt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ activities }),
                });

                if (auditRes.ok) {
                    const result = await auditRes.json();
                    console.log('[Dashboard] Audit result:', result);

                    // NEW: Handle proposal-based flow
                    if (result.action === 'propose_modification' && result.deviationDetected) {
                        // Show deviation banner - user must confirm to apply changes
                        setDeviationProposal({
                            reason: result.message,
                            currentCompliance: result.proposal.currentCompliance,
                            volumeActual: result.proposal.volumeActual,
                            volumePlanned: result.proposal.volumePlanned,
                            missedLongRun: result.proposal.missedLongRun,
                            hint: result.hint,
                        });
                    } else if (result.action === 'modified') {
                        // User confirmed a previous proposal
                        setAuditMessage(result.message);
                        setRefreshKey(k => k + 1);
                        setTimeout(() => setAuditMessage(null), 10000);
                    }
                }
            } catch (error) {
                console.error('[Dashboard] Compliance audit failed:', error);
            }
        };

        // Only run if we have activities
        if (activities.length > 0) {
            runComplianceAudit();
        }
    }, []); // Run once on mount

    // Handle user confirming adaptation
    const handleConfirmAdaptation = async () => {
        setIsApplyingAdaptation(true);
        try {
            const res = await fetch('/api/training-block/adapt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activities, confirmAdaptation: true }),
            });

            if (res.ok) {
                const result = await res.json();
                setDeviationProposal(null);
                if (result.adaptationApplied) {
                    setAuditMessage('Plan adapted to match your current training.');
                    setRefreshKey(k => k + 1);
                    setTimeout(() => setAuditMessage(null), 10000);
                }
            }
        } catch (error) {
            console.error('[Dashboard] Failed to apply adaptation:', error);
        } finally {
            setIsApplyingAdaptation(false);
        }
    };

    // Handle user dismissing the deviation proposal (keep current plan)
    const handleDismissProposal = () => {
        setDeviationProposal(null);
        // Don't modify anything - macro plan stays as-is
    };

    const handleRacesChange = () => {
        // Refresh the page to get updated race data
        window.location.reload();
    };

    // Handle when user clicks a day in the weekly plan
    const handleDayClick = (dayInfo: { dayName: string; date: string; title: string; description: string }) => {
        const prompt = `Tell me more about ${dayInfo.dayName}'s planned workout: "${dayInfo.title}". ${dayInfo.description}. What exactly should I do, what pace, and what should I focus on?`;
        chatRef.current?.sendMessage(prompt);
    };


    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col overflow-auto">

            {/* Welcome Overlay for first-time users */}
            {showOnboarding && (
                <WelcomeOverlay
                    userName={session.user.name || ''}
                    onComplete={completeOnboarding}
                />
            )}

            {/* Compliance Audit Notification (after user confirms) */}
            {auditMessage && (
                <div className="bg-gradient-to-r from-emerald-500/20 to-green-500/20 border-b border-emerald-500/30 px-6 py-3">
                    <div className="max-w-[1600px] mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-xl">✅</span>
                            <div>
                                <span className="text-emerald-200 font-medium">Plan Updated: </span>
                                <span className="text-emerald-100/80">{auditMessage}</span>
                            </div>
                        </div>
                        <button
                            onClick={() => setAuditMessage(null)}
                            className="text-emerald-300 hover:text-white transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {/* Deviation Proposal Banner - User must confirm before changes */}
            {deviationProposal && (
                <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b border-amber-500/30 px-6 py-4">
                    <div className="max-w-[1600px] mx-auto">
                        <div className="flex items-start gap-4">
                            <span className="text-2xl">⚠️</span>
                            <div className="flex-1">
                                <h3 className="text-amber-200 font-semibold mb-1">
                                    Training Deviation Detected
                                </h3>
                                <p className="text-amber-100/80 text-sm mb-3">
                                    {deviationProposal.hint}
                                </p>
                                <div className="flex items-center gap-6 text-xs text-amber-200/70 mb-4">
                                    <span>
                                        📊 Compliance: <strong className="text-amber-100">{deviationProposal.currentCompliance}%</strong>
                                    </span>
                                    <span>
                                        📏 Volume: <strong className="text-amber-100">{deviationProposal.volumeActual}km</strong> / {deviationProposal.volumePlanned}km planned
                                    </span>
                                    {deviationProposal.missedLongRun && (
                                        <span className="text-orange-300">⚡ Long run missed</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleConfirmAdaptation}
                                        disabled={isApplyingAdaptation}
                                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg transition-colors text-sm disabled:opacity-50"
                                    >
                                        {isApplyingAdaptation ? 'Adapting...' : 'Adapt Plan to Match'}
                                    </button>
                                    <button
                                        onClick={handleDismissProposal}
                                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-amber-200 rounded-lg transition-colors text-sm"
                                    >
                                        Keep Current Plan
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={handleDismissProposal}
                                className="text-amber-300 hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header with Training Mode & Races */}
            <header className="bg-slate-900/80 backdrop-blur-md border-b border-white/10 px-6 py-3 shrink-0">
                <div className="max-w-[1600px] mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xl">🏔️</span>
                            <h1 className="text-lg font-black text-white tracking-tight">
                                Ultra<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-orange-400">Coach</span>
                            </h1>
                        </div>
                        {/* Training Mode Indicator */}
                        <HeaderControls races={races} activities={activities} activeBlock={activeBlock} />
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Coach Happiness Bar */}
                        <CoachHappiness activities={activities} trainingContext={fullContext} userSignupDate={userSignupDate} />
                        {/* Help Button - Replay Tour */}
                        <button
                            onClick={startOnboarding}
                            className="text-purple-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                            title="Show App Tour"
                        >
                            ❓
                        </button>
                        {/* Settings Button */}
                        <button
                            onClick={() => setShowPreferences(true)}
                            className="text-purple-400 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                            title="Coach Memory & Preferences"
                        >
                            ⚙️
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold">
                                {session.user.name?.charAt(0) || "U"}
                            </div>
                            <span className="text-sm text-purple-200 font-medium hidden sm:block">
                                {session.user.name}
                            </span>
                        </div>
                        {commitSha && (
                            <span className="text-xs text-purple-500/60 font-mono hidden sm:block" title="Deployed commit">
                                {commitSha}
                            </span>
                        )}
                        <button
                            onClick={() => signOut({ callbackUrl: "/dashboard" })}
                            className="text-sm text-purple-400 hover:text-white transition-colors"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            </header>

            {/* Preferences Modal */}
            {showPreferences && (
                <PreferencesModal
                    onClose={() => setShowPreferences(false)}
                    onSave={() => window.location.reload()}
                />
            )}

            {/* Weekly Plan - Full Width at Top */}
            <div className="px-6 py-4 border-b border-white/5">

                <div className="max-w-[1600px] mx-auto">
                    <WeeklyPlanView
                        key={refreshKey}
                        trainingContext={trainingContext}
                        racesContext={racesContext}
                        activities={activities}
                        races={races}
                        blockWorkouts={currentWeekDayPlans}
                        weekSummaryOverride={currentWeekSummary}
                        onWorkoutsSaved={() => {
                            // Refresh block data to update calendar with new workouts
                            setRefreshKey(prev => prev + 1);
                        }}
                    />
                    {/* Training Block Calendar - shows when active block exists */}
                    {fullBlock && fullBlock.block_plan && (
                        <>
                            <BlockCalendar
                                block={fullBlock}
                                currentWeek={activeBlock?.currentWeek || 1}
                            />
                            <CoachLog blockId={fullBlock.id} />
                        </>
                    )}
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 min-h-0 max-w-[1600px] mx-auto w-full px-6 py-4">
                <div className="flex flex-col lg:flex-row gap-4 h-full">
                    {/* Left Column - Next Race & Recent Runs */}
                    <div className="lg:w-80 shrink-0 flex flex-col gap-4 overflow-auto">
                        {/* Today's Card - Hero */}
                        <TodayCard
                            activities={activities}
                            onAskCoach={(msg) => chatRef.current?.sendMessage(msg)}
                        />

                        {/* Next Race */}
                        <NextRace races={races} onRacesChange={handleRacesChange} hasActiveBlock={!!activeBlock} />

                        {/* Weekly Progress Chart */}
                        <ProgressChart activities={activities} />

                        {/* Recent Runs */}
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 p-4 flex-1">
                            <h2 className="font-bold text-white mb-3 flex items-center gap-2 text-sm">
                                <span>📊</span>
                                Recent Runs
                            </h2>
                            {error ? (
                                <p className="text-red-400 text-sm">{error}</p>
                            ) : activities.length === 0 ? (
                                <p className="text-purple-300/60 text-sm">No recent runs found</p>
                            ) : (
                                <div className="space-y-2">
                                    {activities.slice(0, 6).map((activity, i) => (
                                        <div
                                            key={i}
                                            className="p-2.5 bg-slate-700/50 rounded-xl hover:bg-slate-700 transition-colors border border-white/5"
                                        >
                                            <div className="font-medium text-white text-xs truncate">
                                                {activity.name}
                                            </div>
                                            <div className="text-[10px] text-purple-300/80 mt-0.5">
                                                {activity.date} • {activity.distance_km}km @ {activity.pace}/km
                                            </div>
                                            {activity.heart_rate && (
                                                <div className="text-[10px] text-orange-400">
                                                    ❤️ {activity.heart_rate} bpm
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column - Chat Interface */}
                    <div className="flex-1 min-h-0 min-w-0">
                        <ChatInterface
                            ref={chatRef}
                            key={refreshKey}
                            trainingContext={fullContext}
                            activities={activities}
                            races={races}
                        />
                    </div>
                </div>
            </div>

        </div>
    );
}


