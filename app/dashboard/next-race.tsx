"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SmartRaceAdd } from "./smart-race-add";

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
    race_type?: string;
    goal_time?: string;
    priority?: string;
}

interface NextRaceProps {
    races: Race[];
    onRacesChange?: () => void;
    hasActiveBlock?: boolean;
}

// Modal component that uses Portal
function AddRaceModal({ onClose, onRaceAdded }: { onClose: () => void; onRaceAdded: () => void }) {
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        modalRef.current?.focus();
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const modalContent = (
        <div
            ref={modalRef}
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: 99999 }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            tabIndex={-1}
        >
            <div className="absolute inset-0 bg-black/80" />
            <div className="relative bg-slate-800 rounded-2xl border border-white/20 p-5 w-full max-w-md max-h-[85vh] overflow-auto shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">🔍 Add a Race</h3>
                    <button
                        onClick={onClose}
                        className="text-purple-400 hover:text-white text-2xl leading-none p-2 hover:bg-white/10 rounded-lg transition-colors"
                        title="Close (Esc)"
                    >
                        ✕
                    </button>
                </div>
                <p className="text-xs text-purple-300/60 mb-4">
                    Press <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-purple-300">Esc</kbd> or click outside to close
                </p>
                <SmartRaceAdd
                    onRaceAdded={onRaceAdded}
                    onClose={onClose}
                />
            </div>
        </div>
    );

    if (typeof window !== 'undefined') {
        return createPortal(modalContent, document.body);
    }
    return null;
}

export function NextRace({ races, onRacesChange, hasActiveBlock }: NextRaceProps) {
    const [showAddRace, setShowAddRace] = useState(false);
    const [generatingBlock, setGeneratingBlock] = useState(false);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter to only future races and sort by date
    const futureRaces = races
        .filter(r => new Date(r.date) >= today)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const nextRace = futureRaces[0];

    const handleDeleteRace = async (raceId: number) => {
        if (!confirm('Delete this race?')) return;
        try {
            await fetch(`/api/races?id=${raceId}`, { method: 'DELETE' });
            onRacesChange?.();
        } catch (error) {
            console.error('Failed to delete race:', error);
        }
    };

    const generateTrainingBlock = async (race: Race) => {
        setGeneratingBlock(true);
        try {
            const res = await fetch('/api/training-block', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ raceId: race.id }),
            });

            if (res.ok) {
                const data = await res.json();
                alert(`✅ Training block created! ${data.block?.totalWeeks || 12} weeks planned for ${race.name}`);
                onRacesChange?.(); // Refresh to show updated state
            } else {
                const error = await res.json();
                alert(`Failed to generate: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to generate training block:', error);
            alert('Failed to generate training block');
        } finally {
            setGeneratingBlock(false);
        }
    };

    if (!nextRace) {
        return (
            <>
                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-bold text-white flex items-center gap-2 text-sm">
                            <span>🏁</span>
                            Races
                        </h2>
                        <button
                            onClick={() => setShowAddRace(true)}
                            className="text-purple-400 hover:text-white text-lg hover:bg-white/10 rounded-lg w-7 h-7 flex items-center justify-center transition-colors"
                            title="Add a race"
                        >
                            +
                        </button>
                    </div>
                    <div className="text-center py-4">
                        <div className="text-3xl mb-2">🎯</div>
                        <p className="text-white font-medium text-sm mb-1">No races yet</p>
                        <p className="text-purple-300/50 text-xs mb-3 max-w-[200px] mx-auto">
                            Add a race to unlock personalized training phases
                        </p>
                        <button
                            onClick={() => setShowAddRace(true)}
                            className="bg-gradient-to-r from-purple-500 to-orange-500 hover:opacity-90 text-white font-medium px-4 py-2 rounded-lg text-sm transition-opacity"
                        >
                            🏁 Add Your First Race
                        </button>
                    </div>
                </div>

                {showAddRace && (
                    <AddRaceModal
                        onClose={() => setShowAddRace(false)}
                        onRaceAdded={() => {
                            setShowAddRace(false);
                            onRacesChange?.();
                        }}
                    />
                )}
            </>
        );
    }

    const raceDate = new Date(nextRace.date);
    const daysUntil = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weeksUntil = Math.floor(daysUntil / 7);
    const remainingDays = daysUntil % 7;

    // Determine training phase based on distance-appropriate prep windows
    const distanceKm = nextRace.distance_km;
    let optimalPrepWeeks = 12;
    if (distanceKm >= 80) optimalPrepWeeks = 20;
    else if (distanceKm >= 42) optimalPrepWeeks = 16;
    else if (distanceKm >= 21) optimalPrepWeeks = 12;
    else if (distanceKm >= 10) optimalPrepWeeks = 8;
    else optimalPrepWeeks = 6;

    let phase = 'General Training';
    let phaseColor = 'text-blue-400';

    if (weeksUntil > optimalPrepWeeks) {
        phase = 'General Training';
        phaseColor = 'text-blue-400';
    } else if (daysUntil <= 7) {
        phase = 'Race Week!';
        phaseColor = 'text-orange-400';
    } else if (weeksUntil <= 2) {
        phase = 'Taper';
        phaseColor = 'text-green-400';
    } else if (weeksUntil <= Math.floor(optimalPrepWeeks * 0.3)) {
        phase = 'Peak Phase';
        phaseColor = 'text-purple-400';
    } else if (weeksUntil <= Math.floor(optimalPrepWeeks * 0.7)) {
        phase = 'Build Phase';
        phaseColor = 'text-cyan-400';
    } else {
        phase = 'Base Building';
        phaseColor = 'text-blue-400';
    }

    return (
        <>
            <div className="bg-gradient-to-br from-slate-800/50 to-purple-900/20 backdrop-blur-sm rounded-2xl border border-purple-500/20 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-white flex items-center gap-2 text-sm">
                        <span>🏁</span>
                        Next Race
                    </h2>
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold ${phaseColor} bg-slate-800/50 px-2 py-0.5 rounded-full`}>
                            {phase}
                        </span>
                        <button
                            onClick={() => setShowAddRace(true)}
                            className="text-purple-400 hover:text-white hover:bg-white/10 rounded-lg w-6 h-6 flex items-center justify-center transition-colors text-lg"
                            title="Add another race"
                        >
                            +
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Countdown */}
                    <div className="text-center shrink-0">
                        <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-purple-400 to-orange-400">
                            {weeksUntil}
                        </div>
                        <div className="text-[10px] text-purple-300/60 font-medium uppercase">
                            {weeksUntil === 1 ? 'week' : 'weeks'}
                        </div>
                        {remainingDays > 0 && (
                            <div className="text-[9px] text-purple-300/40">
                                +{remainingDays}d
                            </div>
                        )}
                    </div>

                    {/* Race Info */}
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white text-sm truncate">
                            {nextRace.name}
                        </div>
                        <div className="text-xs text-purple-300/70 mt-0.5">
                            {nextRace.distance_km}km • {raceDate.toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            })}
                        </div>
                        {nextRace.goal_time && (
                            <div className="text-[10px] text-orange-400 mt-1">
                                🎯 Goal: {nextRace.goal_time}
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1 items-end shrink-0">
                        {/* Generate Block button - only if 2+ weeks away AND no active block */}
                        {weeksUntil >= 2 && !hasActiveBlock && (
                            <button
                                onClick={() => generateTrainingBlock(nextRace)}
                                disabled={generatingBlock}
                                className="text-[10px] px-2 py-1 rounded bg-gradient-to-r from-purple-500 to-orange-500 text-white font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                            >
                                {generatingBlock ? '⏳ Creating...' : '📋 Generate Block'}
                            </button>
                        )}
                        {/* Show "Block Active" indicator with Reset option */}
                        {hasActiveBlock && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] px-2 py-1 rounded bg-green-500/20 text-green-400 font-medium border border-green-500/30">
                                    ✓ Block Active
                                </span>
                                <button
                                    onClick={async () => {
                                        if (confirm('Reset your training block? This will delete the current plan and allow you to generate a new one.')) {
                                            try {
                                                await fetch('/api/training-block', { method: 'DELETE' });
                                                onRacesChange?.();
                                            } catch {
                                                alert('Failed to reset block');
                                            }
                                        }
                                    }}
                                    className="text-[10px] text-orange-400/70 hover:text-orange-400 transition-colors"
                                    title="Reset training block"
                                >
                                    🔄 Reset
                                </button>
                            </div>
                        )}
                        {/* Delete race button */}
                        <button
                            onClick={() => handleDeleteRace(nextRace.id)}
                            className="text-red-400/50 hover:text-red-400 text-[10px] transition-colors"
                            title="Delete race"
                        >
                            🗑️ Delete Race
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                {weeksUntil <= optimalPrepWeeks && weeksUntil > 0 && (
                    <div className="mt-3">
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-purple-500 to-orange-500 rounded-full transition-all"
                                style={{ width: `${Math.max(5, 100 - (weeksUntil / optimalPrepWeeks) * 100)}%` }}
                            />
                        </div>
                        <div className="text-[9px] text-purple-300/50 mt-1 text-right">
                            {daysUntil} days to race
                        </div>
                    </div>
                )}

                {/* Other upcoming races */}
                {futureRaces.length > 1 && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                        <div className="text-[10px] text-purple-300/50 mb-1">Also coming up:</div>
                        {futureRaces.slice(1).map(race => {
                            const rd = new Date(race.date);
                            const days = Math.ceil((rd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                            return (
                                <div key={race.id} className="text-[10px] text-purple-300/60 flex justify-between items-center group">
                                    <span className="truncate">{race.name}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="shrink-0">{Math.floor(days / 7)}w</span>
                                        <button
                                            onClick={() => handleDeleteRace(race.id)}
                                            className="opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400 transition-opacity"
                                            title="Delete"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {showAddRace && (
                <AddRaceModal
                    onClose={() => setShowAddRace(false)}
                    onRaceAdded={() => {
                        setShowAddRace(false);
                        onRacesChange?.();
                    }}
                />
            )}
        </>
    );
}
