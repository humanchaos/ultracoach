"use client";

import { useState, useEffect } from "react";

interface ChangelogEntry {
    id: number;
    version: number;
    changeType: string;
    reason: string;
    volumeChangePct: number | null;
    weekNumber: number | null;
    createdAt: string;
}

interface CoachLogProps {
    blockId?: number;
}

export function CoachLog({ blockId }: CoachLogProps) {
    const [expanded, setExpanded] = useState(false);
    const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
    const [planVersion, setPlanVersion] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (expanded && changelog.length === 0) {
            fetchChangelog();
        }
    }, [expanded]);

    const fetchChangelog = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/training-block/changelog");
            if (!response.ok) throw new Error("Failed to fetch");
            const data = await response.json();
            setChangelog(data.changelog || []);
            setPlanVersion(data.planVersion || 1);
        } catch {
            setError("Failed to load changelog");
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });
    };

    const getIcon = (changeType: string) => {
        switch (changeType) {
            case "created":
                return "🎯";
            case "volume_adjusted":
                return "📉";
            case "phase_modified":
                return "🔄";
            case "compliance_adaptation":
                return "⚙️";
            default:
                return "📝";
        }
    };

    const getChangeTypeLabel = (changeType: string) => {
        switch (changeType) {
            case "created":
                return "Plan Created";
            case "volume_adjusted":
                return "Volume Adjusted";
            case "phase_modified":
                return "Phase Modified";
            case "compliance_adaptation":
                return "Adaptation";
            default:
                return changeType;
        }
    };

    if (!blockId) return null;

    return (
        <div className="mt-4">
            {/* Toggle Button */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-2 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg border border-white/10 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="text-lg">📋</span>
                    <span className="text-sm font-medium text-white">
                        Coach&apos;s Log
                    </span>
                    <span className="text-xs text-purple-300/60">
                        v{planVersion} • {changelog.length || "?"} entries
                    </span>
                </div>
                <span className={`text-purple-400 transition-transform ${expanded ? "rotate-180" : ""}`}>
                    ▼
                </span>
            </button>

            {/* Expanded Log */}
            {expanded && (
                <div className="mt-3 p-4 bg-slate-800/50 rounded-xl border border-white/10">
                    {loading && (
                        <div className="flex items-center gap-2 text-gray-400 text-sm">
                            <div className="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full" />
                            Loading...
                        </div>
                    )}

                    {error && (
                        <div className="text-red-400 text-sm">{error}</div>
                    )}

                    {!loading && !error && changelog.length === 0 && (
                        <div className="text-gray-400 text-sm text-center py-4">
                            No changelog entries yet
                        </div>
                    )}

                    {!loading && !error && changelog.length > 0 && (
                        <div className="space-y-3">
                            {changelog.map((entry, idx) => (
                                <div
                                    key={entry.id}
                                    className={`flex items-start gap-3 ${idx !== changelog.length - 1 ? "pb-3 border-b border-white/5" : ""
                                        }`}
                                >
                                    {/* Timeline dot */}
                                    <div className="flex flex-col items-center">
                                        <span className="text-xl">{getIcon(entry.changeType)}</span>
                                        {idx !== changelog.length - 1 && (
                                            <div className="w-0.5 h-full bg-white/10 mt-1" />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-medium text-purple-400">
                                                {formatDate(entry.createdAt)}
                                            </span>
                                            <span className="text-xs px-2 py-0.5 bg-slate-700/50 rounded text-white/80">
                                                {getChangeTypeLabel(entry.changeType)}
                                            </span>
                                            <span className="text-[10px] text-purple-300/40">
                                                v{entry.version}
                                            </span>
                                            {entry.volumeChangePct !== null && entry.volumeChangePct !== 0 && (
                                                <span className={`text-xs font-medium ${entry.volumeChangePct < 0 ? "text-red-400" : "text-green-400"
                                                    }`}>
                                                    {entry.volumeChangePct > 0 ? "+" : ""}{entry.volumeChangePct.toFixed(0)}%
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-300 mt-1 line-clamp-2">
                                            {entry.reason}
                                        </p>
                                        {entry.weekNumber && (
                                            <span className="text-[10px] text-purple-300/40 mt-1 block">
                                                Week {entry.weekNumber}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
