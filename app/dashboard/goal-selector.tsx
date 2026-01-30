"use client";

import { useState, useEffect } from "react";

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
}

interface UserGoal {
    goal_type: string | null;
    target_race_id?: number;
    weekly_mileage_km?: number;
    running_experience?: string;
    injuries_notes?: string;
    recovery_end_date?: string;
    last_race_distance_km?: number;
}

interface GoalSelectorProps {
    races: Race[];
    onGoalChange?: () => void;
    defaultWeeklyMileage?: number;
    defaultExperience?: string;
}

const goalOptions = [
    { value: 'maintain', label: 'Maintain Fitness', icon: '🏔️', description: 'Stay consistent, balanced training' },
    { value: 'get_faster', label: 'Get Faster', icon: '⚡', description: 'Speed work, intervals, tempo runs' },
    { value: 'lose_weight', label: 'Lose Weight', icon: '🔥', description: 'Zone 2 focus, sustainable volume' },
    { value: 'run_longer', label: 'Run Longer', icon: '🏔️', description: 'Build endurance progressively' },
    { value: 'competition', label: 'Race Prep', icon: '🏁', description: 'Periodized race-specific training' },
];

const experienceLevels = [
    { value: 'beginner', label: 'Beginner', description: '< 1 year running' },
    { value: 'intermediate', label: 'Intermediate', description: '1-3 years running' },
    { value: 'advanced', label: 'Advanced', description: '3+ years, regular races' },
    { value: 'elite', label: 'Elite', description: 'Competitive racer' },
];

export function GoalSelector({ races, onGoalChange, defaultWeeklyMileage = 30, defaultExperience = 'intermediate' }: GoalSelectorProps) {
    const [goal, setGoal] = useState<UserGoal | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [showProfile, setShowProfile] = useState(false);

    // Form state - use Strava-detected defaults
    const [selectedGoal, setSelectedGoal] = useState<string>('');
    const [selectedRace, setSelectedRace] = useState<number | null>(null);
    const [weeklyMileage, setWeeklyMileage] = useState(defaultWeeklyMileage);
    const [experience, setExperience] = useState(defaultExperience);
    const [injuries, setInjuries] = useState('');

    useEffect(() => {
        fetchGoal();
    }, []);

    // Update defaults when Strava data arrives
    useEffect(() => {
        if (!goal?.weekly_mileage_km) {
            setWeeklyMileage(defaultWeeklyMileage);
        }
        if (!goal?.running_experience) {
            setExperience(defaultExperience);
        }
    }, [defaultWeeklyMileage, defaultExperience, goal]);

    const fetchGoal = async () => {
        try {
            const res = await fetch('/api/goals');
            if (res.ok) {
                const data = await res.json();
                setGoal(data);
                if (data.goal_type) {
                    setSelectedGoal(data.goal_type);
                    setSelectedRace(data.target_race_id);
                    setWeeklyMileage(data.weekly_mileage_km || defaultWeeklyMileage);
                    setExperience(data.running_experience || defaultExperience);
                    setInjuries(data.injuries_notes || '');
                }
            }
        } catch (error) {
            console.error('Failed to fetch goal:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveGoal = async () => {
        if (!selectedGoal) return;

        setSaving(true);
        try {
            const res = await fetch('/api/goals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal_type: selectedGoal,
                    target_race_id: selectedGoal === 'competition' ? selectedRace : null,
                    weekly_mileage_km: weeklyMileage,
                    running_experience: experience,
                    injuries_notes: injuries || null,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                setGoal(data);
                setIsExpanded(false);
                setShowProfile(false);
                onGoalChange?.();
            }
        } catch (error) {
            console.error('Failed to save goal:', error);
        } finally {
            setSaving(false);
        }
    };

    const currentGoalOption = goalOptions.find(g => g.value === goal?.goal_type);

    // Check if in recovery
    const isInRecovery = goal?.recovery_end_date && new Date(goal.recovery_end_date) > new Date();
    const recoveryDaysLeft = isInRecovery
        ? Math.ceil((new Date(goal.recovery_end_date!).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    if (loading) {
        return (
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
                <div className="text-center text-purple-300/50 py-2">Loading...</div>
            </div>
        );
    }

    return (
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-white flex items-center gap-2 text-sm">
                    <span>🎯</span>
                    My Goal
                </h2>
                {goal?.goal_type && !isExpanded && (
                    <button
                        onClick={() => setIsExpanded(true)}
                        className="text-[10px] text-purple-400 hover:text-purple-300"
                    >
                        Change
                    </button>
                )}
            </div>

            {/* Recovery Mode Banner */}
            {isInRecovery && (
                <div className="mb-3 p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-xl">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🧘</span>
                        <div>
                            <div className="text-sm font-semibold text-emerald-300">Recovery Mode</div>
                            <div className="text-xs text-emerald-200/70">
                                {recoveryDaysLeft} days left after {goal?.last_race_distance_km}km race
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Current Goal Display */}
            {goal?.goal_type && !isExpanded && (
                <div
                    className="p-3 bg-gradient-to-r from-purple-500/20 to-orange-500/20 rounded-xl border border-purple-500/30 cursor-pointer hover:border-purple-500/50 transition-colors"
                    onClick={() => setIsExpanded(true)}
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-lg">
                            {currentGoalOption?.icon || '🎯'}
                        </div>
                        <div>
                            <div className="font-semibold text-white text-sm">
                                {currentGoalOption?.label || 'Set a goal'}
                            </div>
                            <div className="text-[10px] text-purple-300/70">
                                {currentGoalOption?.description}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Goal Selection (Expanded) */}
            {(!goal?.goal_type || isExpanded) && (
                <div className="space-y-3">
                    {/* Goal Type Pills */}
                    <div className="grid grid-cols-2 gap-2">
                        {goalOptions.map((option) => (
                            <button
                                key={option.value}
                                onClick={() => setSelectedGoal(option.value)}
                                className={`p-2.5 rounded-xl border text-left transition-all ${selectedGoal === option.value
                                    ? 'bg-purple-500/20 border-purple-500/50'
                                    : 'bg-slate-700/30 border-white/5 hover:border-white/20'
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-base">{option.icon}</span>
                                    <span className="text-xs font-medium text-white">{option.label}</span>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Race Selection for Competition */}
                    {selectedGoal === 'competition' && (
                        <div>
                            <label className="block text-[10px] text-purple-300/60 mb-1 uppercase tracking-wide">Target Race</label>
                            <select
                                value={selectedRace || ''}
                                onChange={(e) => setSelectedRace(parseInt(e.target.value) || null)}
                                className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                            >
                                <option value="">Select a race...</option>
                                {races.map((race) => (
                                    <option key={race.id} value={race.id}>
                                        {race.name} ({race.distance_km}km) - {new Date(race.date).toLocaleDateString()}
                                    </option>
                                ))}
                            </select>
                            {races.length === 0 && (
                                <p className="text-[10px] text-orange-400 mt-1">Add a race first in the calendar above</p>
                            )}
                        </div>
                    )}

                    {/* Profile Toggle */}
                    <button
                        onClick={() => setShowProfile(!showProfile)}
                        className="w-full text-left text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                        {showProfile ? '▼' : '▶'} My Profile
                    </button>

                    {/* Profile Fields */}
                    {showProfile && (
                        <div className="space-y-2 p-3 bg-slate-700/30 rounded-xl">
                            <div>
                                <label className="block text-[10px] text-purple-300/60 mb-1">Weekly Mileage (km)</label>
                                <input
                                    type="number"
                                    value={weeklyMileage}
                                    onChange={(e) => setWeeklyMileage(parseInt(e.target.value) || 0)}
                                    className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-purple-300/60 mb-1">Experience Level</label>
                                <select
                                    value={experience}
                                    onChange={(e) => setExperience(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
                                >
                                    {experienceLevels.map((level) => (
                                        <option key={level.value} value={level.value}>
                                            {level.label} - {level.description}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] text-purple-300/60 mb-1">Injuries / Notes</label>
                                <textarea
                                    value={injuries}
                                    onChange={(e) => setInjuries(e.target.value)}
                                    placeholder="Any injuries, limitations, or preferences..."
                                    className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40 resize-none"
                                    rows={2}
                                />
                            </div>
                        </div>
                    )}

                    {/* Save Button */}
                    <div className="flex gap-2">
                        {isExpanded && goal?.goal_type && (
                            <button
                                onClick={() => setIsExpanded(false)}
                                className="flex-1 py-2 bg-slate-700/50 text-purple-300 rounded-lg text-sm hover:bg-slate-700 transition-colors"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={handleSaveGoal}
                            disabled={!selectedGoal || saving || (selectedGoal === 'competition' && !selectedRace && races.length > 0)}
                            className="flex-1 py-2 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {saving ? 'Saving...' : 'Set Goal'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
