"use client";

import { useState, useEffect } from "react";

interface DebugInfo {
    llmModel: string;
    tokenHealth: "healthy" | "expired" | "unknown";
    tokenExpiresAt: number | null;
    lastSync: {
        success: boolean;
        timestamp: string;
        activitiesCount?: number;
        error?: string;
    } | null;
    trainingBlock?: {
        weekInBlock: number;
        totalWeeks: number;
        phaseName: string;
        weekInPhase: number;
        targetKm: number;
        focus: string;
    } | null;
}

export function DebugPanel() {
    const [debugInfo, setDebugInfo] = useState<DebugInfo>({
        llmModel: "gemini-2.0-flash",
        tokenHealth: "unknown",
        tokenExpiresAt: null,
        lastSync: null,
        trainingBlock: null,
    });
    const [collapsed, setCollapsed] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        async function fetchDebugInfo() {
            try {
                const res = await fetch('/api/debug-status');
                if (res.ok) {
                    const data = await res.json();
                    setDebugInfo(data);
                }
            } catch (err) {
                console.error('[DebugPanel] Failed to fetch debug info:', err);
            }
        }
        fetchDebugInfo();
        // Refresh every 60 seconds
        const interval = setInterval(fetchDebugInfo, 60000);
        return () => clearInterval(interval);
    }, []);

    const handleReAuth = () => {
        window.location.href = '/api/auth/signin';
    };

    const handleResetPlan = async () => {
        if (!confirm('Reset your training plan? This will remove the current block and let the coach generate a new one.')) {
            return;
        }
        setActionLoading('reset');
        try {
            const res = await fetch('/api/training-block', { method: 'DELETE' });
            if (res.ok) {
                window.location.reload();
            } else {
                alert('Failed to reset plan');
            }
        } catch (err) {
            console.error('[DebugPanel] Reset failed:', err);
            alert('Failed to reset plan');
        } finally {
            setActionLoading(null);
        }
    };

    const handleSimulateMissedRun = async () => {
        setActionLoading('simulate');
        try {
            const res = await fetch('/api/training-block/simulate-miss', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                alert(`Simulated missed long run.\nCompliance: ${data.compliance}%\nAction: ${data.action}\n${data.message}`);
                window.location.reload();
            } else {
                alert('Failed to simulate - no active training block?');
            }
        } catch (err) {
            console.error('[DebugPanel] Simulate failed:', err);
            alert('Failed to simulate missed run');
        } finally {
            setActionLoading(null);
        }
    };

    if (collapsed) {
        return (
            <button
                onClick={() => setCollapsed(false)}
                className="fixed bottom-4 right-4 bg-slate-800/90 border border-white/10 rounded-lg px-3 py-2 text-xs text-purple-300/60 hover:text-white hover:bg-slate-700 transition-all z-50"
            >
                🔧 Debug
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 bg-slate-800/95 border border-white/20 rounded-xl p-4 shadow-2xl z-50 min-w-[300px] max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    🔧 Debug Panel
                </h4>
                <button
                    onClick={() => setCollapsed(true)}
                    className="text-purple-400 hover:text-white text-lg leading-none"
                >
                    ✕
                </button>
            </div>

            <div className="space-y-3 text-xs">
                {/* Training Block Phase */}
                {debugInfo.trainingBlock && (
                    <div className="bg-gradient-to-r from-purple-500/20 to-orange-500/20 rounded-lg p-3 border border-purple-500/30">
                        <div className="font-bold text-white mb-1">
                            📅 Week {debugInfo.trainingBlock.weekInBlock}/{debugInfo.trainingBlock.totalWeeks}: {debugInfo.trainingBlock.phaseName} Phase
                        </div>
                        <div className="text-purple-300/80 text-[11px]">
                            Week {debugInfo.trainingBlock.weekInPhase} of phase • Target: {debugInfo.trainingBlock.targetKm}km
                        </div>
                        <div className="text-purple-300/60 text-[10px] mt-1">
                            Focus: {debugInfo.trainingBlock.focus}
                        </div>
                    </div>
                )}

                {/* LLM Model */}
                <div className="flex items-center justify-between">
                    <span className="text-purple-300/60">LLM Model:</span>
                    <span className="text-emerald-400 font-mono">{debugInfo.llmModel}</span>
                </div>

                {/* Token Health */}
                <div className="flex items-center justify-between">
                    <span className="text-purple-300/60">Token Health:</span>
                    <div className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${debugInfo.tokenHealth === 'healthy' ? 'bg-emerald-400' :
                            debugInfo.tokenHealth === 'expired' ? 'bg-red-400' : 'bg-yellow-400'
                            }`} />
                        <span className={
                            debugInfo.tokenHealth === 'healthy' ? 'text-emerald-400' :
                                debugInfo.tokenHealth === 'expired' ? 'text-red-400' : 'text-yellow-400'
                        }>
                            {debugInfo.tokenHealth === 'healthy' ? 'Active' :
                                debugInfo.tokenHealth === 'expired' ? 'Expired' : 'Unknown'}
                        </span>
                        {debugInfo.tokenHealth === 'expired' && (
                            <button
                                onClick={handleReAuth}
                                className="ml-2 px-2 py-0.5 bg-red-500 hover:bg-red-400 text-white text-xs rounded"
                            >
                                Re-Auth
                            </button>
                        )}
                    </div>
                </div>

                {/* Token Expiry */}
                {debugInfo.tokenExpiresAt && (
                    <div className="flex items-center justify-between">
                        <span className="text-purple-300/60">Token Expires:</span>
                        <span className="text-purple-300 font-mono">
                            {new Date(debugInfo.tokenExpiresAt * 1000).toLocaleTimeString()}
                        </span>
                    </div>
                )}

                {/* Last Sync Status */}
                <div className="border-t border-white/10 pt-2 mt-2">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-purple-300/60">Last Sync:</span>
                        <span className={debugInfo.lastSync?.success ? 'text-emerald-400' : 'text-red-400'}>
                            {debugInfo.lastSync?.success ? '✓ Success' : '✗ Failed'}
                        </span>
                    </div>
                    {debugInfo.lastSync && (
                        <>
                            <div className="text-purple-300/40 text-[10px]">
                                {debugInfo.lastSync.timestamp}
                            </div>
                            {debugInfo.lastSync.success && debugInfo.lastSync.activitiesCount !== undefined && (
                                <div className="text-purple-300/40 text-[10px]">
                                    {debugInfo.lastSync.activitiesCount} activities synced
                                </div>
                            )}
                            {debugInfo.lastSync.error && (
                                <div className="text-red-400/80 text-[10px] mt-1 bg-red-500/10 rounded p-1">
                                    {debugInfo.lastSync.error}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Debug Actions */}
                <div className="border-t border-white/10 pt-3 mt-2 space-y-2">
                    <div className="text-purple-300/60 text-[10px] uppercase tracking-wide mb-2">Debug Actions</div>
                    <button
                        onClick={handleResetPlan}
                        disabled={actionLoading === 'reset'}
                        className="w-full px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                        {actionLoading === 'reset' ? '⏳ Resetting...' : '🗑 Reset Training Plan'}
                    </button>
                    <button
                        onClick={handleSimulateMissedRun}
                        disabled={actionLoading === 'simulate'}
                        className="w-full px-3 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                        {actionLoading === 'simulate' ? '⏳ Simulating...' : '⚠️ Simulate Missed Long Run'}
                    </button>
                </div>

                {/* Version Info */}
                <div className="border-t border-white/10 pt-2 text-[10px] text-purple-300/30">
                    UltraCoach Alpha • {new Date().toLocaleDateString()}
                </div>
            </div>
        </div>
    );
}
