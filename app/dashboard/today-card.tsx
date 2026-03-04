"use client";

import { useState, useEffect } from "react";

interface DailyPrescription {
    workoutType: string;
    title: string;
    distanceKm: number;
    hrZone: string;
    reason: string;
    weeklyBudgetKm: number;
    weeklyBudgetUsedKm: number;
    qualitySessionsRemaining: number;
}

interface TodayCardProps {
    activities: Array<{
        name: string;
        date: string;
        dateISO?: string;
        distance_km: number;
        pace: string;
        heart_rate?: number;
        type?: string;
    }>;
    onAskCoach?: (message: string) => void;
}

export function TodayCard({ activities, onAskCoach }: TodayCardProps) {
    const [prescription, setPrescription] = useState<DailyPrescription | null>(null);
    const [loading, setLoading] = useState(true);

    // Derive today's prescription from activity data (client-side)
    useEffect(() => {
        derivePrescription();
    }, [activities]);

    function derivePrescription() {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...

        // Calculate this week's volume from activities
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
        weekStart.setHours(0, 0, 0, 0);

        const thisWeekActivities = activities.filter(a => {
            const d = new Date(a.dateISO || a.date);
            return d >= weekStart && d <= now;
        });

        const thisWeekKm = thisWeekActivities.reduce((sum, a) => sum + a.distance_km, 0);

        // Simple heuristic prescription based on day-of-week pattern
        const templates: Record<number, Partial<DailyPrescription>> = {
            0: { workoutType: "Long Run", title: "Sunday Long Run", hrZone: "Zone 2", distanceKm: 0 },
            1: { workoutType: "Rest", title: "Active Recovery", hrZone: "—", distanceKm: 0 },
            2: { workoutType: "Easy Run", title: "Easy Aerobic", hrZone: "Zone 1–2", distanceKm: 0 },
            3: { workoutType: "Quality", title: "Tempo / Intervals", hrZone: "Zone 3–4", distanceKm: 0 },
            4: { workoutType: "Easy Run", title: "Recovery Jog", hrZone: "Zone 1", distanceKm: 0 },
            5: { workoutType: "Rest", title: "Rest Day", hrZone: "—", distanceKm: 0 },
            6: { workoutType: "Easy Run", title: "Pre-Long Easy", hrZone: "Zone 1–2", distanceKm: 0 },
        };

        const template = templates[dayOfWeek] || templates[2];

        // Estimate weekly budget from 4-week average
        const fourWeeksAgo = new Date(now);
        fourWeeksAgo.setDate(now.getDate() - 28);
        const recentActivities = activities.filter(a => {
            const d = new Date(a.dateISO || a.date);
            return d >= fourWeeksAgo && d <= now;
        });
        const totalFourWeekKm = recentActivities.reduce((sum, a) => sum + a.distance_km, 0);
        const avgWeeklyKm = totalFourWeekKm / 4;
        const weeklyBudgetKm = Math.round(avgWeeklyKm * 1.05); // slight progression

        setPrescription({
            workoutType: template.workoutType!,
            title: template.title!,
            distanceKm: template.distanceKm!,
            hrZone: template.hrZone!,
            reason: template.workoutType === "Rest"
                ? "Recovery is where adaptation happens."
                : `Based on your weekly pattern and ${Math.round(thisWeekKm)}km done so far this week.`,
            weeklyBudgetKm,
            weeklyBudgetUsedKm: Math.round(thisWeekKm * 10) / 10,
            qualitySessionsRemaining: dayOfWeek <= 3 ? 1 : 0,
        });
        setLoading(false);
    }

    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });

    const budgetPercent = prescription
        ? Math.min(100, (prescription.weeklyBudgetUsedKm / Math.max(1, prescription.weeklyBudgetKm)) * 100)
        : 0;

    if (loading) {
        return (
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-purple-900/40 to-indigo-900/40 p-6 animate-shimmer">
                <div className="h-6 w-48 bg-white/10 rounded mb-3" />
                <div className="h-4 w-32 bg-white/10 rounded" />
            </div>
        );
    }

    return (
        <div
            className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-900/30 via-indigo-900/30 to-slate-900/50 p-6 animate-fade-in"
            id="today-card"
        >
            {/* Date + Label */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <p className="text-xs text-purple-300/70 uppercase tracking-wider font-semibold">
                        Today's Focus
                    </p>
                    <p className="text-sm text-purple-200/80 mt-0.5">{today}</p>
                </div>
                <span className="text-3xl">{
                    prescription?.workoutType === 'Rest' ? '😴' :
                        prescription?.workoutType === 'Long Run' ? '🏔️' :
                            prescription?.workoutType === 'Quality' ? '⚡' :
                                '🏃'
                }</span>
            </div>

            {/* Prescription */}
            {prescription && (
                <div className="mb-5">
                    <h3 className="text-xl font-bold text-white mb-1">{prescription.title}</h3>
                    <div className="flex items-center gap-3 text-sm">
                        {prescription.hrZone !== '—' && (
                            <span className="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 rounded-full text-xs font-medium border border-purple-500/20">
                                {prescription.hrZone}
                            </span>
                        )}
                        <span className="text-purple-200/60 text-xs">{prescription.reason}</span>
                    </div>
                </div>
            )}

            {/* Weekly Budget Meter */}
            {prescription && prescription.weeklyBudgetKm > 0 && (
                <div className="mb-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-purple-300/60">Weekly Budget</span>
                        <span className="text-purple-200 font-medium">
                            {prescription.weeklyBudgetUsedKm}km / {prescription.weeklyBudgetKm}km
                        </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${budgetPercent}%`,
                                background: budgetPercent > 90
                                    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                                    : budgetPercent > 70
                                        ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                                        : 'linear-gradient(90deg, #a855f7, #6366f1)',
                            }}
                        />
                    </div>
                    {prescription.qualitySessionsRemaining > 0 && (
                        <p className="text-xs text-indigo-300/60 mt-1.5">
                            {prescription.qualitySessionsRemaining} quality session{prescription.qualitySessionsRemaining > 1 ? 's' : ''} remaining this week
                        </p>
                    )}
                </div>
            )}

            {/* CTA */}
            <button
                onClick={() => onAskCoach?.(
                    prescription?.workoutType === 'Rest'
                        ? "I'm supposed to rest today. What could I do for active recovery?"
                        : `Tell me about today's ${prescription?.title} workout. What pace, HR target, and focus?`
                )}
                className="w-full mt-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 transition-all hover:shadow-lg hover:shadow-purple-500/20"
            >
                Ask Coach About Today →
            </button>
        </div>
    );
}
