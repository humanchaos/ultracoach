"use client";

import { useState, useEffect } from "react";

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
    race_type: string;
    goal_time?: string;
    priority: 'A' | 'B' | 'C';
    notes?: string;
}

const raceTypes = [
    { value: 'ultra', label: 'Ultra (50k+)', icon: '🏔️' },
    { value: 'marathon', label: 'Marathon', icon: '🏔️' },
    { value: 'half', label: 'Half Marathon', icon: '🏔️' },
    { value: '10k', label: '10K', icon: '⚡' },
    { value: '5k', label: '5K', icon: '🔥' },
    { value: 'other', label: 'Other', icon: '🎯' },
];

const priorityLabels = {
    'A': { label: 'Main Goal', color: 'bg-purple-500', icon: '⭐' },
    'B': { label: 'Tune-up', color: 'bg-blue-500', icon: '🎯' },
    'C': { label: 'Fun Race', color: 'bg-green-500', icon: '🎉' },
};

export function RaceCalendar() {
    const [races, setRaces] = useState<Race[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [loading, setLoading] = useState(true);
    const [generatingBlockId, setGeneratingBlockId] = useState<number | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        date: '',
        distance_km: '',
        race_type: 'marathon',
        goal_time: '',
        priority: 'B' as 'A' | 'B' | 'C',
        notes: '',
    });

    useEffect(() => {
        fetchRaces();
    }, []);

    const fetchRaces = async () => {
        try {
            const res = await fetch('/api/races');
            if (res.ok) {
                const data = await res.json();
                setRaces(data);
            }
        } catch (error) {
            console.error('Failed to fetch races:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/races', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (res.ok) {
                await fetchRaces();
                setIsAdding(false);
                setFormData({
                    name: '',
                    date: '',
                    distance_km: '',
                    race_type: 'marathon',
                    goal_time: '',
                    priority: 'B',
                    notes: '',
                });
            }
        } catch (error) {
            console.error('Failed to add race:', error);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Delete this race?')) return;
        try {
            const res = await fetch(`/api/races?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setRaces(races.filter(r => r.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete race:', error);
        }
    };

    const generateTrainingBlock = async (race: Race) => {
        setGeneratingBlockId(race.id);
        try {
            const res = await fetch('/api/training-block', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ raceId: race.id }),
            });

            if (res.ok) {
                const data = await res.json();
                alert(`Training block created! ${data.block?.totalWeeks || 12} weeks of training planned.`);
            } else {
                const error = await res.json();
                alert(`Failed to generate: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to generate training block:', error);
            alert('Failed to generate training block');
        } finally {
            setGeneratingBlockId(null);
        }
    };

    const getDaysUntil = (dateStr: string) => {
        const raceDate = new Date(dateStr);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diff = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diff;
    };

    const getWeeksUntil = (dateStr: string) => {
        const days = getDaysUntil(dateStr);
        return Math.floor(days / 7);
    };

    return (
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-white flex items-center gap-2 text-sm">
                    <span>🏁</span>
                    Race Calendar
                </h2>
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    className="text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                    {isAdding ? 'Cancel' : '+ Add Race'}
                </button>
            </div>

            {/* Add Race Form */}
            {isAdding && (
                <form onSubmit={handleSubmit} className="mb-4 p-3 bg-slate-700/50 rounded-xl border border-white/10 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="text"
                            placeholder="Race name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="col-span-2 px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40"
                            required
                        />
                        <input
                            type="date"
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
                            required
                        />
                        <input
                            type="number"
                            placeholder="Distance (km)"
                            value={formData.distance_km}
                            onChange={(e) => setFormData({ ...formData, distance_km: e.target.value })}
                            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40"
                            required
                        />
                        <select
                            value={formData.race_type}
                            onChange={(e) => setFormData({ ...formData, race_type: e.target.value })}
                            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
                        >
                            {raceTypes.map(t => (
                                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                            ))}
                        </select>
                        <select
                            value={formData.priority}
                            onChange={(e) => setFormData({ ...formData, priority: e.target.value as 'A' | 'B' | 'C' })}
                            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
                        >
                            <option value="A">⭐ Main Goal</option>
                            <option value="B">🎯 Tune-up</option>
                            <option value="C">🎉 Fun</option>
                        </select>
                        <input
                            type="text"
                            placeholder="Goal time (optional)"
                            value={formData.goal_time}
                            onChange={(e) => setFormData({ ...formData, goal_time: e.target.value })}
                            className="col-span-2 px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40"
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full py-2 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-lg text-sm hover:opacity-90 transition-opacity"
                    >
                        Add Race
                    </button>
                </form>
            )}

            {/* Race List */}
            {loading ? (
                <div className="text-center text-purple-300/50 py-4">Loading...</div>
            ) : races.length === 0 ? (
                <div className="text-center py-6">
                    <div className="text-3xl mb-2">🏁</div>
                    <p className="text-purple-300/60 text-sm">No races scheduled</p>
                    <p className="text-purple-300/40 text-xs mt-1">Add your upcoming races to get personalized training</p>
                </div>
            ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                    {races.map((race) => {
                        const daysUntil = getDaysUntil(race.date);
                        const weeksUntil = getWeeksUntil(race.date);
                        const priority = priorityLabels[race.priority];
                        const raceType = raceTypes.find(t => t.value === race.race_type);

                        return (
                            <div
                                key={race.id}
                                className="p-3 bg-slate-700/30 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors group"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${priority.color} text-white`}>
                                                {priority.icon} {race.priority}
                                            </span>
                                            <span className="font-medium text-white text-sm truncate">
                                                {race.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-[10px] text-purple-300/70">
                                            <span>{raceType?.icon} {race.distance_km}km</span>
                                            <span>•</span>
                                            <span>{new Date(race.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                        </div>
                                        {race.goal_time && (
                                            <div className="text-[10px] text-orange-400 mt-0.5">
                                                Goal: {race.goal_time}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right shrink-0 ml-2">
                                        <div className="text-lg font-black text-purple-400">
                                            {weeksUntil > 0 ? `${weeksUntil}w` : `${daysUntil}d`}
                                        </div>
                                        <div className="text-[9px] text-purple-300/50">
                                            {daysUntil === 0 ? 'TODAY!' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
                                        </div>
                                        <div className="flex flex-col gap-1 mt-1">
                                            {/* Only show Generate Block on first (next) race */}
                                            {races.indexOf(race) === 0 && daysUntil > 7 && (
                                                <button
                                                    onClick={() => generateTrainingBlock(race)}
                                                    disabled={generatingBlockId === race.id}
                                                    className="text-[10px] px-2 py-0.5 rounded bg-gradient-to-r from-purple-500 to-orange-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
                                                >
                                                    {generatingBlockId === race.id ? '⏳ Generating...' : '📋 Generate Block'}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(race.id)}
                                                className="opacity-0 group-hover:opacity-100 text-red-400 text-[10px] transition-opacity"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
