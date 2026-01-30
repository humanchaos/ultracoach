import { auth } from "@/lib/auth";
import { getStravaData } from "@/lib/strava";
import { getUserRaces } from "@/lib/db";
import { calculateRecoveryState, formatRecoveryStateForPrompt } from "@/lib/coaching/recovery-state";
import { StravaActivity, UpcomingRace } from "@/lib/coaching/types";

export async function GET() {
    const session = await auth();
    if (!session?.user?.stravaId) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    try {
        const stravaId = session.user.stravaId as string;

        // Fetch data
        const [activities, races] = await Promise.all([
            getStravaData(stravaId),
            getUserRaces(stravaId),
        ]);

        // Convert to v3 format
        const v3Activities: StravaActivity[] = activities.map((a, i) => ({
            id: `activity-${i}`,
            name: a.name,
            date: new Date(a.dateISO || a.date),
            distance_km: a.distance_km,
            duration_minutes: a.duration_minutes || 0,
            type: "Run" as const,
        }));

        const v3Races: UpcomingRace[] = races.map(r => ({
            id: String(r.id),
            name: r.name,
            date: new Date(r.date),
            distance_km: r.distance_km,
            priority: "B" as const,
        }));

        // Calculate recovery state
        const recoveryState = calculateRecoveryState({
            activities: v3Activities,
            races: v3Races,
        });

        // Find major efforts (>40km)
        const majorEfforts = v3Activities.filter(a => a.distance_km >= 40);

        return new Response(JSON.stringify({
            activitiesCount: v3Activities.length,
            majorEfforts: majorEfforts.map(a => ({
                name: a.name,
                date: a.date instanceof Date ? a.date.toISOString() : String(a.date),
                distance_km: a.distance_km,
            })),
            recoveryState: {
                inRecoveryWindow: recoveryState.inRecoveryWindow,
                phase: recoveryState.phase,
                effortName: recoveryState.effortName,
                effortType: recoveryState.effortType,
                effortDate: recoveryState.effortDate,
                daysSinceEffort: recoveryState.daysSinceEffort,
                signalOverrides: recoveryState.signalOverrides,
            },
            formattedPrompt: formatRecoveryStateForPrompt(recoveryState),
            recentActivities: v3Activities.slice(0, 10).map(a => ({
                name: a.name,
                date: a.date instanceof Date ? a.date.toISOString().split('T')[0] : String(a.date),
                distance_km: a.distance_km,
            })),
        }, null, 2), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error"
        }), { status: 500 });
    }
}
