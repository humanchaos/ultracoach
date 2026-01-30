"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface Activity {
    name: string;
    date: string;
    distance_km: number;
    pace?: string;
    heart_rate?: number;
}

interface DayPlan {
    type: "run" | "rest" | "cross" | "long" | "recovery" | "tempo" | "intervals";
    title: string;
    date?: Date;
}

interface CoachHappinessProps {
    activities: Activity[];
    trainingContext: string;
    userSignupDate: string | null;
}

// Get the coach emoji based on happiness score
function getCoachEmoji(score: number): string {
    if (score >= 80) return "😊";
    if (score >= 60) return "🙂";
    if (score >= 40) return "😐";
    if (score >= 20) return "😤";
    return "😡";
}

// Get color gradient based on score
function getBarColor(score: number): string {
    if (score >= 80) return "from-green-500 to-emerald-400";
    if (score >= 60) return "from-lime-500 to-green-400";
    if (score >= 40) return "from-yellow-500 to-amber-400";
    if (score >= 20) return "from-orange-500 to-amber-500";
    return "from-red-500 to-orange-500";
}

// Determine what type of workout an activity likely was
function classifyActivity(activity: Activity): "rest" | "easy" | "moderate" | "hard" | "long" {
    const distance = activity.distance_km;
    const hr = activity.heart_rate;

    if (distance < 1) return "rest"; // Basically no activity
    if (distance >= 25) return "long";
    if (hr && hr > 160) return "hard";
    if (hr && hr > 145) return "moderate";
    return "easy";
}

// Check if activity matches expected plan type
function matchesExpectedPlan(activity: Activity | null, planType: string): { score: number; reason: string } {
    if (planType === "rest") {
        if (!activity || activity.distance_km < 2) {
            return { score: 20, reason: "✓ Respected rest day" };
        } else {
            return { score: -10, reason: "✗ Ran on rest day" };
        }
    }

    if (!activity) {
        if (planType === "rest" || planType === "recovery") {
            return { score: 15, reason: "✓ Rest taken" };
        }
        return { score: -5, reason: "✗ Missed planned workout" };
    }

    const actType = classifyActivity(activity);

    if (planType === "long") {
        if (activity.distance_km >= 20) return { score: 20, reason: "✓ Long run completed" };
        if (activity.distance_km >= 15) return { score: 15, reason: "~ Long run a bit short" };
        return { score: 5, reason: "✗ Long run too short" };
    }

    if (planType === "recovery" || planType === "run") {
        if (actType === "easy" || actType === "moderate") {
            return { score: 20, reason: `✓ Easy run done (${activity.distance_km.toFixed(1)}km)` };
        }
        if (actType === "hard") {
            return { score: 10, reason: "~ Went too hard on easy day" };
        }
        return { score: 15, reason: "✓ Run completed" };
    }

    if (planType === "tempo" || planType === "intervals") {
        if (actType === "hard" || actType === "moderate") {
            return { score: 20, reason: "✓ Quality workout done" };
        }
        return { score: 10, reason: "~ Quality workout may have been too easy" };
    }

    if (planType === "cross") {
        // Any activity counts for cross-training
        return { score: 15, reason: "✓ Cross-training activity" };
    }

    return { score: 10, reason: "Activity logged" };
}

// Calculate overall coach happiness from recent activity adherence
function calculateHappiness(activities: Activity[], trainingContext: string, userSignupDate: string | null): {
    score: number;
    breakdown: { day: string; score: number; reason: string; excluded?: boolean }[];
    trend: "up" | "down" | "stable";
} {
    const breakdown: { day: string; score: number; reason: string; excluded?: boolean }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();

    // Parse user signup date - only score days from this date onwards
    let signupDate: Date | null = null;
    if (userSignupDate) {
        signupDate = new Date(userSignupDate);
        signupDate.setHours(0, 0, 0, 0);
    }

    // Helper to parse activity date format "Mon, Jan 5" or "Sat, Jan 4" to Date
    const parseActivityDate = (dateStr: string): Date | null => {
        try {
            // Parse "Mon, Jan 5" format by adding current year
            const parsed = new Date(`${dateStr}, ${currentYear}`);
            if (!isNaN(parsed.getTime())) {
                parsed.setHours(0, 0, 0, 0);
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    };

    // Find the most recent race (ultra/marathon >42km)
    let raceActivity: Activity | null = null;
    let raceDate: Date | null = null;

    for (const a of activities) {
        if (a.distance_km >= 42) {
            const parsed = parseActivityDate(a.date);
            if (parsed) {
                raceActivity = a;
                raceDate = parsed;
                break; // First one found is most recent
            }
        }
    }

    // Recovery plan: what's expected each day AFTER the race
    // Day 0 = race day, Day 1 = first recovery day, etc.
    // NOTE: This is for UI compliance scoring ONLY - not for overriding AI coaching decisions.
    // The AI coach makes its own recovery recommendations based on activity data.
    const recoveryPlan: Record<number, { expected: string; label: string }> = {
        0: { expected: "race", label: "🎉 Race day!" },
        1: { expected: "rest", label: "Day 1: Complete rest" },
        2: { expected: "rest", label: "Day 2: Complete rest" },
        3: { expected: "walk", label: "Day 3: Gentle walk only" },
        4: { expected: "walk", label: "Day 4: Short walk" },
        5: { expected: "recovery", label: "Day 5: Light movement" },
        6: { expected: "recovery", label: "Day 6: Easy activity" },
        7: { expected: "recovery", label: "Day 7: Test jog if ready" },
    };

    // Check last 5 days (more relevant window)
    for (let i = 0; i < 5; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        checkDate.setHours(0, 0, 0, 0);

        // Find activity for this day using proper date parsing
        const dayActivity = activities.find(a => {
            const actDate = parseActivityDate(a.date);
            return actDate && actDate.getTime() === checkDate.getTime();
        });

        const dayName = i === 0 ? "Today" : i === 1 ? "Yesterday" :
            checkDate.toLocaleDateString('en-US', { weekday: 'short' });

        // Calculate which recovery day this is
        let recoveryDay = -1;
        if (raceDate) {
            recoveryDay = Math.floor((checkDate.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));
        }

        // If this day is before user signup OR before the race (for recovery context), mark as excluded
        const isBeforeSignup = signupDate && checkDate.getTime() < signupDate.getTime();

        if (isBeforeSignup) {
            breakdown.push({
                day: dayName,
                score: 0, // Excluded from scoring - before user signed up
                reason: "📋 Before signup",
                excluded: true
            });
            continue;
        }

        // If no race found or day is before race (for recovery context only)
        if (!raceDate || recoveryDay < 0) {
            // Day is after signup but before race, or no race - show actual activity
            if (dayActivity) {
                const name = dayActivity.name.length > 15 ? dayActivity.name.slice(0, 15) + '...' : dayActivity.name;
                breakdown.push({
                    day: dayName,
                    score: 15, // Positive score for any activity after signup
                    reason: `✓ ${name} (${dayActivity.distance_km.toFixed(1)}km)`
                });
            } else {
                breakdown.push({
                    day: dayName,
                    score: 15, // Rest is also fine when not in recovery
                    reason: "✓ Rest day"
                });
            }
            continue;
        }

        // Race day - show with actual Strava data!
        if (recoveryDay === 0 && raceActivity) {
            const name = raceActivity.name.length > 18 ? raceActivity.name.slice(0, 18) + '...' : raceActivity.name;
            breakdown.push({
                day: dayName,
                score: 20,
                reason: `🎉 ${name} (${raceActivity.distance_km.toFixed(0)}km)`
            });
            continue;
        }

        // Get expected activity for this recovery day
        const plan = recoveryPlan[recoveryDay] || { expected: "easy", label: `Day ${recoveryDay}: Gradual return` };

        // Assess compliance
        if (plan.expected === "rest") {
            if (!dayActivity || dayActivity.distance_km < 2) {
                breakdown.push({ day: dayName, score: 20, reason: "✓ Rested properly" });
            } else {
                breakdown.push({ day: dayName, score: -10, reason: `✗ Ran on rest day (${dayActivity.distance_km.toFixed(1)}km)` });
            }
        } else if (plan.expected === "walk") {
            if (!dayActivity || dayActivity.distance_km < 5) {
                breakdown.push({ day: dayName, score: 18, reason: "✓ Light day" });
            } else {
                breakdown.push({ day: dayName, score: 5, reason: "~ Did more than walking" });
            }
        } else if (plan.expected === "recovery") {
            if (!dayActivity || dayActivity.distance_km < 8) {
                breakdown.push({ day: dayName, score: 18, reason: "✓ Easy recovery" });
            } else if (dayActivity.distance_km < 15) {
                breakdown.push({ day: dayName, score: 15, reason: "✓ Moderate activity OK" });
            } else {
                breakdown.push({ day: dayName, score: 5, reason: "~ Too much too soon" });
            }
        } else {
            // Default - any activity is fine
            breakdown.push({ day: dayName, score: 15, reason: dayActivity ? "✓ Activity logged" : "✓ Rest taken" });
        }
    }

    // Calculate total score - ONLY count days from race onwards (exclude pre-plan days)
    const scoredDays = breakdown.filter(b => !b.excluded);

    if (scoredDays.length === 0) {
        // No plan days yet - show 100% as starting point
        return { score: 100, breakdown, trend: "stable" as const };
    }

    const totalPoints = scoredDays.reduce((sum, b) => sum + b.score, 0);
    const maxPossible = scoredDays.length * 20;
    const minPossible = scoredDays.length * -10;

    const normalized = Math.round(((totalPoints - minPossible) / (maxPossible - minPossible)) * 100);
    const score = Math.max(0, Math.min(100, normalized));

    // Calculate trend
    const firstHalf = scoredDays.slice(0, 2).reduce((s, b) => s + b.score, 0);
    const secondHalf = scoredDays.slice(2, 4).reduce((s, b) => s + b.score, 0);
    const trend = firstHalf > secondHalf + 10 ? "up" : firstHalf < secondHalf - 10 ? "down" : "stable";

    return { score, breakdown, trend };
}

export function CoachHappiness({ activities, trainingContext, userSignupDate }: CoachHappinessProps) {
    const [showTooltip, setShowTooltip] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
    const barRef = useRef<HTMLDivElement>(null);

    const { score, breakdown, trend } = calculateHappiness(activities, trainingContext, userSignupDate);
    const emoji = getCoachEmoji(score);
    const barColor = getBarColor(score);

    useEffect(() => {
        if (showTooltip && barRef.current) {
            const rect = barRef.current.getBoundingClientRect();
            setTooltipPos({
                top: rect.bottom + 8,
                left: Math.max(10, rect.left - 100)
            });
        }
    }, [showTooltip]);

    const trendIcon = trend === "up" ? "📈" : trend === "down" ? "📉" : "➡️";

    const tooltipContent = showTooltip ? createPortal(
        <>
            <div
                className="fixed inset-0"
                style={{ zIndex: 99998 }}
                onClick={() => setShowTooltip(false)}
            />
            <div
                className="fixed w-64 bg-slate-800 border border-white/20 rounded-xl shadow-2xl p-4"
                style={{
                    zIndex: 99999,
                    top: tooltipPos.top,
                    left: tooltipPos.left
                }}
            >
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">{emoji}</span>
                    <div>
                        <div className="font-bold text-white">Coach Satisfaction</div>
                        <div className="text-xs text-purple-300/60">{score}% {trendIcon}</div>
                    </div>
                </div>

                <div className="space-y-1.5 mb-3">
                    {breakdown.map((b, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-purple-300/70">{b.day}</span>
                            <span className={b.score >= 15 ? "text-green-400" : b.score >= 0 ? "text-yellow-400" : "text-red-400"}>
                                {b.reason}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="text-[10px] text-purple-300/40 border-t border-white/10 pt-2">
                    💡 Follow the weekly plan to keep coach happy!
                </div>

                <div className="text-[10px] text-red-400/70 mt-2 italic">
                    ⚠️ Drop below 20% and the coach will leave you — he&apos;s got better athletes to train.
                </div>
            </div>
        </>,
        document.body
    ) : null;

    return (
        <div className="flex items-center gap-2">
            <div
                ref={barRef}
                onClick={() => setShowTooltip(!showTooltip)}
                className="flex items-center gap-1.5 bg-slate-800/80 border border-white/10 rounded-lg px-2 py-1 cursor-pointer hover:border-purple-500/50 transition-colors"
                title="Coach Happiness - Click for details"
            >
                <span className="text-sm">{emoji}</span>
                <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                        style={{ width: `${score}%` }}
                    />
                </div>
                <span className="text-[10px] text-purple-300/60 font-medium w-7">{score}%</span>
            </div>
            {tooltipContent}
        </div>
    );
}
