import { getUserByStravaId, updateStravaTokens, updateLastFetch } from "./db";

// Custom error class for Strava API failures
export class StravaError extends Error {
    public readonly statusCode: number;
    public readonly isRateLimit: boolean;
    public readonly isServerError: boolean;
    public readonly retryAfterMinutes: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = 'StravaError';
        this.statusCode = statusCode;
        this.isRateLimit = statusCode === 429;
        this.isServerError = statusCode >= 500;
        this.retryAfterMinutes = this.isRateLimit ? 15 : (this.isServerError ? 5 : 0);
    }

    static fromResponse(statusCode: number, responseText?: string): StravaError {
        if (statusCode === 429) {
            return new StravaError(
                "Strava is tired. You've hit the rate limit. Try again in 15 minutes.",
                statusCode
            );
        }
        if (statusCode >= 500) {
            return new StravaError(
                "Strava servers are having issues. Try again in 5 minutes.",
                statusCode
            );
        }
        if (statusCode === 401) {
            return new StravaError(
                "Strava session expired. Please re-authenticate.",
                statusCode
            );
        }
        return new StravaError(
            `Strava API error: ${responseText || `Status ${statusCode}`}`,
            statusCode
        );
    }
}

// Last sync status for debug panel
export interface SyncStatus {
    success: boolean;
    timestamp: Date;
    activitiesCount?: number;
    error?: string;
}

let lastSyncStatus: SyncStatus | null = null;

export function getLastSyncStatus(): SyncStatus | null {
    return lastSyncStatus;
}

// Athlete profile info
export interface AthleteProfile {
    firstName: string;
    lastName: string;
    sex: 'M' | 'F' | null;
    age: number | null;
    weight: number | null; // kg
    city: string | null;
    country: string | null;
}

// Lap data from Strava
export interface Lap {
    lap_index: number;
    name: string;
    distance_km: number;
    elapsed_time_seconds: number;
    moving_time_seconds: number;
    pace: string;               // min/km format
    average_heartrate: number | null;
    max_heartrate: number | null;
    total_elevation_gain: number;
    average_speed: number;      // m/s
}

// HR zone distribution from Strava
export interface HRZoneDistribution {
    zone1_seconds: number;      // Recovery (50-60% max HR)
    zone2_seconds: number;      // Endurance (60-70% max HR)
    zone3_seconds: number;      // Tempo (70-80% max HR)
    zone4_seconds: number;      // Threshold (80-90% max HR)
    zone5_seconds: number;      // VO2max (90-100% max HR)
}

// Per-km/mile split data
export interface Split {
    split_index: number;
    distance_km: number;
    elapsed_time_seconds: number;
    moving_time_seconds: number;
    pace: string;               // min/km format
    elevation_difference: number;
    average_heartrate: number | null;
    average_speed: number;
}

// Strava workout type enum
export type WorkoutType =
    | 'default'      // Regular run
    | 'race'         // Race
    | 'long_run'     // Long run
    | 'workout'      // Structured workout/intervals
    | null;

// Activity format for the coach
export interface RunActivity {
    id: number;                 // Strava activity ID for fetching details
    date: string;               // Display format: "Mon, Dec 30"
    dateISO: string;            // ISO format for accurate parsing
    distance_km: number;
    pace: string;               // min/km format
    duration_minutes: number;
    heart_rate: number | null;
    suffer_score: number | null;
    name: string;
    total_elevation_gain: number | null;
    // Extended data (only for recent activities)
    laps?: Lap[];
    hr_zones?: HRZoneDistribution;
    splits?: Split[];
    average_cadence: number | null;
    workout_type: WorkoutType;
}

// Refresh token if expired
async function refreshTokenIfNeeded(user: {
    strava_id: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
}): Promise<string> {
    // Check if token is expired (with 5 min buffer)
    if (Date.now() < (user.expires_at - 300) * 1000) {
        return user.access_token;
    }

    console.log("Refreshing expired Strava token for user:", user.strava_id);

    const response = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.STRAVA_CLIENT_ID!,
            client_secret: process.env.STRAVA_CLIENT_SECRET!,
            refresh_token: user.refresh_token,
            grant_type: "refresh_token",
        }),
    });

    if (!response.ok) {
        throw new Error("Failed to refresh Strava token");
    }

    const data = await response.json();

    // Update database with new tokens
    await updateStravaTokens(
        user.strava_id,
        data.access_token,
        data.refresh_token,
        data.expires_at
    );

    return data.access_token;
}

// Format pace from m/s to min/km
function formatPace(speedMs: number): string {
    if (speedMs <= 0) return "N/A";
    const paceSeconds = 1000 / speedMs;
    const minutes = Math.floor(paceSeconds / 60);
    const seconds = Math.round(paceSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Map Strava workout_type number to our WorkoutType
function mapWorkoutType(stravaType: number | undefined): WorkoutType {
    if (!stravaType) return 'default';
    switch (stravaType) {
        case 1: return 'race';
        case 2: return 'long_run';
        case 3: return 'workout';  // Structured workout/intervals
        default: return 'default';
    }
}


// Fetch and format Strava activities
export async function getStravaData(stravaId: string): Promise<RunActivity[]> {
    // Get user from database
    const user = await getUserByStravaId(stravaId);
    if (!user) {
        throw new Error("User not found in database");
    }

    console.log("[Strava] Token expires_at:", user.expires_at, "Now:", Math.floor(Date.now() / 1000));

    // Refresh token if needed
    const accessToken = await refreshTokenIfNeeded({
        strava_id: user.strava_id,
        access_token: user.access_token,
        refresh_token: user.refresh_token,
        expires_at: user.expires_at,
    });

    console.log("[Strava] Fetching activities with token:", accessToken.substring(0, 10) + "...");

    // Fetch last 30 activities
    const response = await fetch(
        "https://www.strava.com/api/v3/athlete/activities?per_page=30",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }
    );

    // Circuit Breaker: Handle 429 and 500 errors gracefully
    if (!response.ok) {
        const errorText = await response.text();
        console.error("[Strava API] Error:", response.status, errorText);

        const error = StravaError.fromResponse(response.status, errorText);
        lastSyncStatus = {
            success: false,
            timestamp: new Date(),
            error: error.message,
        };
        throw error;
    }

    const activities = await response.json();

    // Update last fetch timestamp
    await updateLastFetch(stravaId);

    // Filter to runs only and map to format with activity ID
    const runs: RunActivity[] = activities
        .filter((activity: { type: string }) => activity.type === "Run")
        .map(
            (activity: {
                id: number;
                start_date: string;
                distance: number;
                average_speed: number;
                moving_time: number;
                average_heartrate?: number;
                suffer_score?: number;
                name: string;
                total_elevation_gain?: number;
                average_cadence?: number;
                workout_type?: number;
            }) => ({
                id: activity.id,
                date: new Date(activity.start_date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                }),
                dateISO: activity.start_date,
                distance_km: Math.round((activity.distance / 1000) * 100) / 100,
                pace: formatPace(activity.average_speed),
                duration_minutes: Math.round(activity.moving_time / 60),
                heart_rate: activity.average_heartrate
                    ? Math.round(activity.average_heartrate)
                    : null,
                suffer_score: activity.suffer_score || null,
                name: activity.name,
                total_elevation_gain: activity.total_elevation_gain
                    ? Math.round(activity.total_elevation_gain)
                    : null,
                average_cadence: activity.average_cadence
                    ? Math.round(activity.average_cadence * 2)  // Strava stores as steps/2
                    : null,
                workout_type: mapWorkoutType(activity.workout_type),
            })
        );

    // Fetch detailed data for the 5 most recent runs (rate limit friendly)
    const recentRuns = runs.slice(0, 5);
    console.log(`[Strava] Fetching detailed data for ${recentRuns.length} recent activities...`);

    for (const run of recentRuns) {
        try {
            // Fetch laps, detailed activity (for splits), and HR zones in parallel
            const [lapsResponse, detailedResponse, zonesResponse] = await Promise.all([
                fetch(`https://www.strava.com/api/v3/activities/${run.id}/laps`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }),
                fetch(`https://www.strava.com/api/v3/activities/${run.id}`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }),
                fetch(`https://www.strava.com/api/v3/activities/${run.id}/zones`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }),
            ]);

            // Process laps
            if (lapsResponse.ok) {
                const lapsData = await lapsResponse.json();
                run.laps = lapsData.map((lap: {
                    lap_index: number;
                    name: string;
                    distance: number;
                    elapsed_time: number;
                    moving_time: number;
                    average_speed: number;
                    average_heartrate?: number;
                    max_heartrate?: number;
                    total_elevation_gain?: number;
                }) => ({
                    lap_index: lap.lap_index,
                    name: lap.name,
                    distance_km: Math.round((lap.distance / 1000) * 100) / 100,
                    elapsed_time_seconds: lap.elapsed_time,
                    moving_time_seconds: lap.moving_time,
                    pace: formatPace(lap.average_speed),
                    average_heartrate: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
                    max_heartrate: lap.max_heartrate ? Math.round(lap.max_heartrate) : null,
                    total_elevation_gain: lap.total_elevation_gain || 0,
                    average_speed: lap.average_speed,
                }));
            }

            // Process detailed activity (for splits)
            if (detailedResponse.ok) {
                const detailedData = await detailedResponse.json();

                // Get splits (metric = km)
                if (detailedData.splits_metric) {
                    run.splits = detailedData.splits_metric.map((split: {
                        split: number;
                        distance: number;
                        elapsed_time: number;
                        moving_time: number;
                        average_speed: number;
                        elevation_difference: number;
                        average_heartrate?: number;
                    }) => ({
                        split_index: split.split,
                        distance_km: Math.round((split.distance / 1000) * 100) / 100,
                        elapsed_time_seconds: split.elapsed_time,
                        moving_time_seconds: split.moving_time,
                        pace: formatPace(split.average_speed),
                        elevation_difference: split.elevation_difference || 0,
                        average_heartrate: split.average_heartrate ? Math.round(split.average_heartrate) : null,
                        average_speed: split.average_speed,
                    }));
                }
            }

            // Process HR zones
            if (zonesResponse.ok) {
                const zonesData = await zonesResponse.json();
                // Find heart rate distribution
                const hrDistribution = zonesData.find((z: { type: string }) => z.type === 'heartrate');
                if (hrDistribution?.distribution_buckets) {
                    const buckets = hrDistribution.distribution_buckets;
                    run.hr_zones = {
                        zone1_seconds: buckets[0]?.time || 0,
                        zone2_seconds: buckets[1]?.time || 0,
                        zone3_seconds: buckets[2]?.time || 0,
                        zone4_seconds: buckets[3]?.time || 0,
                        zone5_seconds: buckets[4]?.time || 0,
                    };
                }
            }

            console.log(`[Strava] Fetched details for activity ${run.id} (${run.name}): ${run.laps?.length || 0} laps, ${run.splits?.length || 0} splits, zones: ${run.hr_zones ? 'yes' : 'no'}`);
        } catch (detailError) {
            console.error(`[Strava] Error fetching details for activity ${run.id}:`, detailError);
        }
    }

    // Track successful sync
    lastSyncStatus = {
        success: true,
        timestamp: new Date(),
        activitiesCount: runs.length,
    };

    return runs;
}

// Fetch athlete profile (age, gender, weight)
export async function getAthleteProfile(stravaId: string): Promise<AthleteProfile | null> {
    try {
        const user = await getUserByStravaId(stravaId);
        if (!user) return null;

        const accessToken = await refreshTokenIfNeeded({
            strava_id: user.strava_id,
            access_token: user.access_token,
            refresh_token: user.refresh_token,
            expires_at: user.expires_at,
        });

        const response = await fetch("https://www.strava.com/api/v3/athlete", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) return null;

        const athlete = await response.json();

        // Calculate age from birthday if available
        let age: number | null = null;
        if (athlete.birthday) {
            const birthDate = new Date(athlete.birthday);
            const today = new Date();
            age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
        }

        return {
            firstName: athlete.firstname || '',
            lastName: athlete.lastname || '',
            sex: athlete.sex === 'M' ? 'M' : athlete.sex === 'F' ? 'F' : null,
            age,
            weight: athlete.weight || null,
            city: athlete.city || null,
            country: athlete.country || null,
        };
    } catch (error) {
        console.error("[Strava] Error fetching athlete profile:", error);
        return null;
    }
}

// Format lap time from seconds to mm:ss
function formatLapTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Analyze lap structure to identify workout pattern
function analyzeLapStructure(laps: Lap[]): string {
    if (!laps || laps.length <= 1) return "";

    // Identify work vs recovery laps based on HR and duration
    const workLaps: Lap[] = [];
    const recoveryLaps: Lap[] = [];

    for (const lap of laps) {
        const durationMin = lap.moving_time_seconds / 60;
        // Skip warmup/cooldown laps (first and last if they're different)
        if (lap.lap_index === 1 || lap.lap_index === laps.length) continue;

        // Classify based on duration pattern (work intervals tend to be longer)
        if (durationMin >= 3) {
            workLaps.push(lap);
        } else {
            recoveryLaps.push(lap);
        }
    }

    if (workLaps.length === 0) return "";

    // Calculate averages for work laps
    const avgWorkTime = workLaps.reduce((sum, l) => sum + l.moving_time_seconds, 0) / workLaps.length;
    const avgWorkHR = workLaps.filter(l => l.average_heartrate).reduce((sum, l) => sum + (l.average_heartrate || 0), 0) /
        workLaps.filter(l => l.average_heartrate).length;

    const avgRecoveryTime = recoveryLaps.length > 0
        ? recoveryLaps.reduce((sum, l) => sum + l.moving_time_seconds, 0) / recoveryLaps.length
        : 0;
    const avgRecoveryHR = recoveryLaps.filter(l => l.average_heartrate).length > 0
        ? recoveryLaps.filter(l => l.average_heartrate).reduce((sum, l) => sum + (l.average_heartrate || 0), 0) /
        recoveryLaps.filter(l => l.average_heartrate).length
        : 0;

    // Format the summary
    let summary = `  └ Intervals: ${workLaps.length}×${formatLapTime(avgWorkTime)}`;
    if (avgWorkHR) summary += ` @ ${Math.round(avgWorkHR)}bpm`;
    if (recoveryLaps.length > 0 && avgRecoveryTime > 0) {
        summary += ` with ${formatLapTime(avgRecoveryTime)} recovery`;
        if (avgRecoveryHR) summary += ` (${Math.round(avgRecoveryHR)}bpm)`;
    }

    return summary;
}

// Format HR zone distribution as a summary string
function formatHRZones(zones: HRZoneDistribution): string {
    const total = zones.zone1_seconds + zones.zone2_seconds + zones.zone3_seconds + zones.zone4_seconds + zones.zone5_seconds;
    if (total === 0) return "";

    const pct = (s: number) => Math.round((s / total) * 100);
    const parts: string[] = [];
    if (zones.zone1_seconds > 0) parts.push(`Z1: ${pct(zones.zone1_seconds)}%`);
    if (zones.zone2_seconds > 0) parts.push(`Z2: ${pct(zones.zone2_seconds)}%`);
    if (zones.zone3_seconds > 0) parts.push(`Z3: ${pct(zones.zone3_seconds)}%`);
    if (zones.zone4_seconds > 0) parts.push(`Z4: ${pct(zones.zone4_seconds)}%`);
    if (zones.zone5_seconds > 0) parts.push(`Z5: ${pct(zones.zone5_seconds)}%`);

    return parts.join(', ');
}

// Analyze splits for pacing patterns
function analyzeSplits(splits: Split[]): string {
    if (!splits || splits.length < 3) return "";

    // Compare first half vs second half paces
    const midpoint = Math.floor(splits.length / 2);
    const firstHalfAvg = splits.slice(0, midpoint).reduce((sum, s) => sum + s.average_speed, 0) / midpoint;
    const secondHalfAvg = splits.slice(midpoint).reduce((sum, s) => sum + s.average_speed, 0) / (splits.length - midpoint);

    const paceDiff = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

    if (paceDiff > 3) return "negative split (faster 2nd half)";
    if (paceDiff < -5) return "positive split (faded)";
    return "even pacing";
}

// Format activities for AI context
export function formatActivitiesForAI(activities: RunActivity[]): string {
    if (activities.length === 0) {
        return "No recent running activities found.";
    }

    const lines = activities.map((a) => {
        // Base activity line with workout type prefix if significant
        const typePrefix = a.workout_type === 'race' ? '🏁 ' :
            a.workout_type === 'workout' ? '⚡ ' :
                a.workout_type === 'long_run' ? '🏃 ' : '';

        let line = `- ${a.date}: ${typePrefix}${a.name} | ${a.distance_km}km @ ${a.pace}/km | ${a.duration_minutes}min`;
        if (a.heart_rate) line += ` | HR: ${a.heart_rate}bpm`;
        if (a.average_cadence) line += ` | Cadence: ${a.average_cadence}spm`;
        if (a.total_elevation_gain) line += ` | Vert: +${a.total_elevation_gain}m`;
        if (a.suffer_score) line += ` | Effort: ${a.suffer_score}`;

        // Extended data for recent activities
        const details: string[] = [];

        // Add lap structure analysis
        if (a.laps && a.laps.length > 1) {
            const lapSummary = analyzeLapStructure(a.laps);
            if (lapSummary) details.push(lapSummary.trim());
        }

        // Add HR zone distribution
        if (a.hr_zones) {
            const zonesSummary = formatHRZones(a.hr_zones);
            if (zonesSummary) details.push(`  └ HR Zones: ${zonesSummary}`);
        }

        // Add pacing analysis
        if (a.splits && a.splits.length >= 3) {
            const pacingAnalysis = analyzeSplits(a.splits);
            if (pacingAnalysis) details.push(`  └ Pacing: ${pacingAnalysis}`);
        }

        if (details.length > 0) {
            line += '\n' + details.join('\n');
        }

        return line;
    });

    return `## Recent Training Log (${activities.length} runs)\n\n${lines.join("\n")}`;
}

// Calculate average weekly mileage from recent activities
export function calculateWeeklyMileage(activities: RunActivity[]): number {
    if (activities.length === 0) return 0;

    // Get activities from the last 4 weeks
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    let totalKm = 0;
    let weeksWithData = 0;
    const weeklyTotals: { [week: number]: number } = {};

    activities.forEach(activity => {
        // Parse the date - it's in format "Mon, Jan 5"
        const activityDate = new Date(activity.date + ", " + new Date().getFullYear());
        if (activityDate > fourWeeksAgo) {
            const weekNum = Math.floor((new Date().getTime() - activityDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
            weeklyTotals[weekNum] = (weeklyTotals[weekNum] || 0) + activity.distance_km;
            totalKm += activity.distance_km;
        }
    });

    weeksWithData = Object.keys(weeklyTotals).length || 1;
    return Math.round(totalKm / weeksWithData);
}

// Determine experience level based on activity patterns
export function inferExperienceLevel(activities: RunActivity[]): 'beginner' | 'intermediate' | 'advanced' | 'elite' {
    if (activities.length === 0) return 'beginner';

    const weeklyKm = calculateWeeklyMileage(activities);
    const hasLongRuns = activities.some(a => a.distance_km > 20);
    const hasSpeedWork = activities.some(a => {
        // Check for faster paces (under 5:00/km average might indicate intervals/tempo)
        const paceMatch = a.pace.match(/(\d+):(\d+)/);
        if (paceMatch) {
            const paceMinutes = parseInt(paceMatch[1]) + parseInt(paceMatch[2]) / 60;
            return paceMinutes < 5;
        }
        return false;
    });

    if (weeklyKm >= 80 || activities.some(a => a.distance_km > 50)) return 'elite';
    if (weeklyKm >= 50 && hasLongRuns && hasSpeedWork) return 'advanced';
    if (weeklyKm >= 25 || hasLongRuns) return 'intermediate';
    return 'beginner';
}

