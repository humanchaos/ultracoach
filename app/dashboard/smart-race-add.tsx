"use client";

import { useState } from "react";

interface AvailableDistance {
    name: string;
    km: number;
}

interface RaceMatch {
    name: string;
    date?: string;
    location?: string;
    available_distances?: AvailableDistance[];
    main_distance_km?: number;
    main_elevation_gain_m?: number;  // NEW: elevation from lookup
    main_elevation_loss_m?: number;  // NEW: elevation from lookup
    race_type?: string;
    website?: string;
    description?: string;
    verified_from_website?: boolean;
}

interface RaceSearchResult {
    found: boolean;
    multiple_matches?: boolean;
    races?: RaceMatch[];
    suggestions?: string[];
    verified?: boolean;
}

interface SmartRaceAddProps {
    onRaceAdded: () => void;
    onClose: () => void;
}

// Default distance options when no race-specific ones are available
const DEFAULT_DISTANCES: AvailableDistance[] = [
    { name: '5K', km: 5 },
    { name: '10K', km: 10 },
    { name: 'Half', km: 21.0975 },
    { name: 'Marathon', km: 42.195 },
    { name: '50K', km: 50 },
    { name: '100K', km: 100 },
];

export function SmartRaceAdd({ onRaceAdded, onClose }: SmartRaceAddProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchResult, setSearchResult] = useState<RaceSearchResult | null>(null);
    const [selectedRace, setSelectedRace] = useState<RaceMatch | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    // Editable fields (populated from AI, can be adjusted)
    const [name, setName] = useState("");
    const [date, setDate] = useState("");
    const [distance, setDistance] = useState("");
    const [elevationGain, setElevationGain] = useState("");
    const [elevationLoss, setElevationLoss] = useState("");
    const [raceType, setRaceType] = useState("road");
    const [goalTime, setGoalTime] = useState("");
    const [priority, setPriority] = useState("A");

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        setSearching(true);
        setError("");
        setSearchResult(null);
        setSelectedRace(null);

        try {
            const res = await fetch("/api/race-lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ raceName: searchQuery }),
            });

            const data = await res.json();
            setSearchResult(data);

            // If only one race found, auto-select it
            if (data.found && data.races?.length === 1) {
                selectRace(data.races[0]);
            }
        } catch (err) {
            setError("Failed to search. Try entering details manually.");
            console.error(err);
        } finally {
            setSearching(false);
        }
    };

    const selectRace = (race: RaceMatch) => {
        setSelectedRace(race);
        setName(race.name || searchQuery);
        setDate(race.date || "");
        const mainDist = race.main_distance_km || race.available_distances?.[0]?.km;
        setDistance(mainDist?.toString() || "");
        // Auto-populate elevation from lookup if available
        if (race.main_elevation_gain_m) {
            setElevationGain(race.main_elevation_gain_m.toString());
        }
        if (race.main_elevation_loss_m) {
            setElevationLoss(race.main_elevation_loss_m.toString());
        } else if (race.main_elevation_gain_m) {
            // Default loss to same as gain for point-to-point approximation
            setElevationLoss(race.main_elevation_gain_m.toString());
        }
        setRaceType(race.race_type || "road");
    };

    const handleSave = async () => {
        if (!name || !date || !distance) {
            setError("Please fill in name, date, and distance");
            return;
        }

        setSaving(true);
        try {
            const res = await fetch("/api/races", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    date,
                    distance_km: parseFloat(distance),
                    elevation_gain_m: elevationGain ? parseInt(elevationGain) : null,
                    elevation_loss_m: elevationLoss ? parseInt(elevationLoss) : null,
                    race_type: raceType,
                    goal_time: goalTime || null,
                    priority,
                }),
            });

            if (res.ok) {
                onRaceAdded();
                onClose();
            } else {
                setError("Failed to save race");
            }
        } catch (err) {
            setError("Failed to save race");
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    // Use race-specific distances if available, otherwise use defaults
    const distanceOptions = selectedRace?.available_distances?.length
        ? selectedRace.available_distances
        : DEFAULT_DISTANCES;

    // Check if we need to show race selection
    const showRaceSelection = searchResult?.found &&
        searchResult.races &&
        searchResult.races.length > 1 &&
        !selectedRace;

    // Skip search and enter manually
    const skipToManual = () => {
        setSearchResult({ found: false, races: [] });
        setSelectedRace(null);
    };

    return (
        <div className="space-y-4">
            {/* Search Bar */}
            <div>
                <label className="block text-xs text-purple-300/60 mb-1.5 uppercase tracking-wide">
                    🔍 Search for a race
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        placeholder="e.g. Vienna, UTMB, Lindkogel..."
                        className="flex-1 px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40 focus:border-purple-500/50 outline-none"
                    />
                    <button
                        onClick={handleSearch}
                        disabled={searching || !searchQuery.trim()}
                        className="px-4 py-2 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {searching ? "🔄" : "Find"}
                    </button>
                </div>
                <button
                    onClick={skipToManual}
                    className="text-[10px] text-purple-400 hover:text-purple-300 mt-1.5"
                >
                    Not finding your race? Enter manually →
                </button>
            </div>

            {/* Multiple Races Found - Selection */}
            {showRaceSelection && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                    <div className="text-blue-400 text-sm font-medium mb-2">
                        📋 Found {searchResult.races!.length} races — select one:
                    </div>
                    <div className="space-y-2 max-h-48 overflow-auto">
                        {searchResult.races!.map((race, idx) => (
                            <button
                                key={idx}
                                onClick={() => selectRace(race)}
                                className="w-full text-left p-2 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors group"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm text-white font-medium group-hover:text-purple-300">
                                            {race.name}
                                        </div>
                                        <div className="text-[10px] text-purple-300/60">
                                            {race.location && <span>📍 {race.location}</span>}
                                            {race.available_distances && race.available_distances.length > 0 && (
                                                <span className="ml-2">
                                                    📏 {race.available_distances.map(d => d.name).join(', ')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-purple-400 group-hover:text-white">→</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Selected Race Info */}
            {selectedRace && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                            ✓ {selectedRace.name}
                        </div>
                        {searchResult?.races && searchResult.races.length > 1 && (
                            <button
                                onClick={() => setSelectedRace(null)}
                                className="text-xs text-purple-400 hover:text-purple-300"
                            >
                                Change
                            </button>
                        )}
                    </div>
                    {selectedRace.location && (
                        <div className="text-xs text-emerald-300/70">📍 {selectedRace.location}</div>
                    )}
                    {selectedRace.description && (
                        <div className="text-xs text-purple-300/60 mt-1">{selectedRace.description}</div>
                    )}
                    {selectedRace.website && (
                        <a
                            href={selectedRace.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-purple-400 hover:text-purple-300 mt-1 inline-block"
                        >
                            🔗 Official website
                        </a>
                    )}
                </div>
            )}

            {/* Data Source Badge */}
            {selectedRace && (
                selectedRace.verified_from_website ? (
                    <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
                        <div className="text-green-400 text-xs mb-1">✓ Verified from official website</div>
                        <div className="text-green-300/70 text-[10px]">
                            Date and distances extracted from the official race website. Still worth double-checking!
                        </div>
                    </div>
                ) : (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                        <div className="text-amber-400 text-xs mb-1">⚠️ AI-suggested details</div>
                        <div className="text-amber-300/70 text-[10px]">
                            Could not verify from official website. Dates and distances may be inaccurate. Please verify before adding.
                        </div>
                    </div>
                )
            )}

            {/* Not Found / Suggestions */}
            {searchResult && !searchResult.found && (
                <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl">
                    <div className="text-orange-400 text-sm font-medium mb-1">
                        Race not found in database
                    </div>
                    {searchResult.suggestions && searchResult.suggestions.length > 0 && (
                        <div className="text-xs text-orange-300/70">
                            Did you mean: {searchResult.suggestions.join(", ")}?
                        </div>
                    )}
                    <div className="text-xs text-purple-300/60 mt-1">
                        Enter the details manually below
                    </div>
                </div>
            )}

            {/* Manual / Editable Fields */}
            <div className="border-t border-white/10 pt-4 space-y-3">
                <div className="text-[10px] text-purple-300/50 uppercase tracking-wide">
                    Race Details {selectedRace && "(auto-filled, edit if needed)"}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className="block text-[10px] text-purple-300/60 mb-1">Race Name*</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-[10px] text-purple-300/60 mb-1">Date*</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                        />
                    </div>

                    <div className="col-span-2">
                        <label className="block text-[10px] text-purple-300/60 mb-1">
                            Distance* {selectedRace?.available_distances?.length ? (
                                <span className="text-emerald-400">(from this event)</span>
                            ) : null}
                        </label>
                        {/* Distance buttons */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {distanceOptions.map((d, idx) => {
                                const isSelected = Math.abs(parseFloat(distance) - d.km) < 0.1;
                                return (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setDistance(d.km.toString())}
                                        className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${isSelected
                                            ? 'bg-purple-500 text-white font-bold'
                                            : 'bg-slate-700/50 text-purple-300 hover:bg-slate-700'
                                            }`}
                                    >
                                        {d.name} <span className="opacity-60">({d.km}km)</span>
                                    </button>
                                );
                            })}
                        </div>
                        {/* Custom input */}
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                step="0.1"
                                value={distance}
                                onChange={(e) => setDistance(e.target.value)}
                                placeholder="Custom distance"
                                className="flex-1 px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                            />
                            <span className="text-purple-300/60 text-sm">km</span>
                        </div>
                    </div>

                    {/* Elevation fields - important for mountain races */}
                    <div>
                        <label className="block text-[10px] text-purple-300/60 mb-1">Elevation (for vertical scaling)</label>
                        <div className="flex gap-2">
                            <div className="flex-1 flex items-center gap-2">
                                <input
                                    type="number"
                                    value={elevationGain}
                                    onChange={(e) => setElevationGain(e.target.value)}
                                    placeholder="Gain"
                                    className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                />
                                <span className="text-purple-300/60 text-sm whitespace-nowrap">+m</span>
                            </div>
                            <div className="flex-1 flex items-center gap-2">
                                <input
                                    type="number"
                                    value={elevationLoss}
                                    onChange={(e) => setElevationLoss(e.target.value)}
                                    placeholder="Loss (or same)"
                                    className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                />
                                <span className="text-purple-300/60 text-sm whitespace-nowrap">-m</span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] text-purple-300/60 mb-1">Type</label>
                        <select
                            value={raceType}
                            onChange={(e) => setRaceType(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                        >
                            <option value="road">🛤️ Road</option>
                            <option value="trail">🏔️ Trail</option>
                            <option value="ultra">🦁 Ultra</option>
                            <option value="track">🏟️ Track</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] text-purple-300/60 mb-1">Priority</label>
                        <select
                            value={priority}
                            onChange={(e) => setPriority(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                        >
                            <option value="A">⭐ A Race (Main Goal)</option>
                            <option value="B">🎯 B Race (Tune-up)</option>
                            <option value="C">🏔️ C Race (Fun/Training)</option>
                        </select>
                    </div>

                    <div className="col-span-2">
                        <label className="block text-[10px] text-purple-300/60 mb-1">Goal Time (optional)</label>
                        <input
                            type="text"
                            value={goalTime}
                            onChange={(e) => setGoalTime(e.target.value)}
                            placeholder="e.g. 3:30:00"
                            className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40"
                        />
                    </div>
                </div>
            </div>

            {error && (
                <div className="text-red-400 text-xs">{error}</div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
                <button
                    onClick={onClose}
                    className="flex-1 py-2 bg-slate-700/50 text-purple-300 rounded-lg text-sm hover:bg-slate-700"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSave}
                    disabled={saving || !name || !date || !distance}
                    className="flex-1 py-2 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {saving ? "Saving..." : "Add Race"}
                </button>
            </div>
        </div>
    );
}
