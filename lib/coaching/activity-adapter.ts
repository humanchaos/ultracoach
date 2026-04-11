import type { StravaActivity } from "./types";

export interface RawActivity {
    id?: string;
    name: string;
    date: string;
    dateISO?: string;  // ISO date for accurate parsing (preferred)
    distance_km: number;
    duration_minutes?: number;
    pace?: string;
    heart_rate?: number;
    elevation_gain_m?: number;
    type?: string;
}

// Parse activity date - handles "Mon, Dec 29" format by adding current year (fallback)
export function parseActivityDate(dateStr: string): Date | null {
    const currentYear = new Date().getFullYear();
    const match = dateStr.match(/([A-Za-z]+),?\s*([A-Za-z]+)\s+(\d+)/);
    if (match) {
        const monthStr = match[2];
        const day = parseInt(match[3]);
        const months: { [key: string]: number } = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        const month = months[monthStr.toLowerCase().slice(0, 3)];
        if (month !== undefined) return new Date(currentYear, month, day);
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
    console.warn(`[parseActivityDate] Failed to parse date: "${dateStr}" — activity skipped`);
    return null;
}

export function parsePace(paceStr: string): number | undefined {
    const match = paceStr.match(/(\d+):(\d+)/);
    if (match) return parseInt(match[1]) + parseInt(match[2]) / 60;
    return undefined;
}

// Adapter: Convert incoming activity data to StravaActivity format
export function adaptActivities(activities: RawActivity[]): StravaActivity[] {
    return activities
        .map((a, i) => {
            const rawDate = a.dateISO ? new Date(a.dateISO) : null;
            const date = (rawDate && !isNaN(rawDate.getTime())) ? rawDate : parseActivityDate(a.date);
            if (!date) return null;
            return {
                id: a.id || `activity-${i}`,
                name: a.name,
                date,
                distance_km: a.distance_km,
                duration_minutes: a.duration_minutes || 0,
                pace_min_per_km: a.pace ? parsePace(a.pace) : undefined,
                average_hr: a.heart_rate,
                elevation_gain_m: a.elevation_gain_m,
                type: (a.type === "Run" || a.type === "Walk" || a.type === "Hike" ||
                    a.type === "Ride" || a.type === "Swim") ? a.type : "Run" as const,
            };
        })
        .filter((a): a is StravaActivity => a !== null);
}
