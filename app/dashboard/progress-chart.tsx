"use client";

interface WeekData {
    label: string;
    actualKm: number;
    targetKm: number;
    compliance: number;
}

interface ProgressChartProps {
    activities: Array<{
        name: string;
        date: string;
        dateISO?: string;
        distance_km: number;
        pace: string;
        heart_rate?: number;
        type?: string;
    }>;
}

export function ProgressChart({ activities }: ProgressChartProps) {
    const weeks = computeWeekData(activities);

    if (weeks.length === 0) {
        return (
            <div className="rounded-2xl border border-white/10 bg-slate-800/50 p-5">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <span>📈</span> Volume Trend
                </h3>
                <p className="text-purple-300/50 text-xs">Run a few more weeks to see your trend.</p>
            </div>
        );
    }

    // Chart dimensions
    const chartW = 280;
    const chartH = 120;
    const barGap = 6;
    const barW = Math.min(28, (chartW - barGap * (weeks.length + 1)) / weeks.length);
    const maxKm = Math.max(...weeks.map(w => Math.max(w.actualKm, w.targetKm)), 10);
    const scale = (km: number) => (km / maxKm) * (chartH - 20);

    return (
        <div className="rounded-2xl border border-white/10 bg-slate-800/50 p-5 animate-fade-in" id="progress-chart">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <span>📈</span> Weekly Volume
            </h3>

            <svg
                viewBox={`0 0 ${chartW} ${chartH + 22}`}
                width="100%"
                preserveAspectRatio="xMidYMid meet"
                className="overflow-visible"
            >
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                    const y = chartH - frac * (chartH - 20);
                    return (
                        <g key={frac}>
                            <line
                                x1={0} y1={y} x2={chartW} y2={y}
                                stroke="rgba(255,255,255,0.05)"
                                strokeDasharray="3,4"
                            />
                            <text x={chartW + 2} y={y + 3} fontSize="7" fill="rgba(255,255,255,0.25)">
                                {Math.round(maxKm * frac)}
                            </text>
                        </g>
                    );
                })}

                {/* Bars */}
                {weeks.map((week, i) => {
                    const x = barGap + i * (barW + barGap);
                    const barH = scale(week.actualKm);
                    const y = chartH - barH;
                    const targetY = chartH - scale(week.targetKm);

                    // Color based on compliance
                    const fill = week.compliance >= 90
                        ? "url(#barGood)"
                        : week.compliance >= 70
                            ? "url(#barOk)"
                            : "url(#barLow)";

                    return (
                        <g key={i}>
                            {/* Actual bar */}
                            <rect
                                x={x} y={y} width={barW} height={barH}
                                rx={3} fill={fill}
                                opacity={0.9}
                            />
                            {/* Target line */}
                            {week.targetKm > 0 && (
                                <line
                                    x1={x - 2} y1={targetY} x2={x + barW + 2} y2={targetY}
                                    stroke="rgba(255,255,255,0.35)"
                                    strokeWidth={1.5}
                                    strokeDasharray="3,2"
                                />
                            )}
                            {/* km label on bar */}
                            <text
                                x={x + barW / 2} y={y - 4}
                                textAnchor="middle" fontSize="7" fontWeight="600"
                                fill="rgba(255,255,255,0.6)"
                            >
                                {Math.round(week.actualKm)}
                            </text>
                            {/* Week label */}
                            <text
                                x={x + barW / 2} y={chartH + 12}
                                textAnchor="middle" fontSize="7"
                                fill="rgba(255,255,255,0.35)"
                            >
                                {week.label}
                            </text>
                        </g>
                    );
                })}

                {/* Gradient defs */}
                <defs>
                    <linearGradient id="barGood" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                    <linearGradient id="barOk" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#d97706" />
                    </linearGradient>
                    <linearGradient id="barLow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" />
                        <stop offset="100%" stopColor="#b91c1c" />
                    </linearGradient>
                </defs>
            </svg>

            <div className="flex items-center gap-4 mt-3 text-[10px] text-purple-300/50">
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gradient-to-b from-purple-500 to-indigo-500" /> ≥90%
                </span>
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gradient-to-b from-amber-500 to-amber-600" /> 70–89%
                </span>
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gradient-to-b from-red-500 to-red-700" /> &lt;70%
                </span>
                <span>--- target</span>
            </div>
        </div>
    );
}

function computeWeekData(
    activities: ProgressChartProps["activities"]
): WeekData[] {
    const now = new Date();
    const weeks: WeekData[] = [];

    for (let w = 7; w >= 0; w--) {
        const weekStart = getMonday(now, w);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const weekActivities = activities.filter(a => {
            const d = new Date(a.dateISO || a.date);
            return d >= weekStart && d < weekEnd && (!a.type || a.type === 'Run');
        });

        const actualKm = weekActivities.reduce((sum, a) => sum + a.distance_km, 0);

        if (actualKm > 0 || w < 4) {
            weeks.push({
                label: w === 0 ? 'This wk' : w === 1 ? 'Last wk' : `W-${w}`,
                actualKm: Math.round(actualKm * 10) / 10,
                targetKm: 0, // Will be filled by avg
                compliance: 100,
            });
        }
    }

    // Calculate target as rolling 4-week average (pseudo-plan)
    for (let i = 0; i < weeks.length; i++) {
        const start = Math.max(0, i - 3);
        const slice = weeks.slice(start, i + 1);
        const avg = slice.reduce((s, w) => s + w.actualKm, 0) / slice.length;
        weeks[i].targetKm = Math.round(avg * 10) / 10;
        weeks[i].compliance = weeks[i].targetKm > 0
            ? Math.round((weeks[i].actualKm / weeks[i].targetKm) * 100)
            : 100;
    }

    return weeks.filter(w => w.actualKm > 0 || w.label === 'This wk');
}

function getMonday(reference: Date, weeksAgo: number): Date {
    const d = new Date(reference);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff - weeksAgo * 7);
    d.setHours(0, 0, 0, 0);
    return d;
}
