import { auth } from "@/lib/auth";
import { getUserRaces, getActiveTrainingBlock, updateTrainingBlockStatus, getLactateTest } from "@/lib/db";
import { generateTrainingBlock, type LactateData } from "@/lib/coaching/block-generator";
import { getStravaData, getAthleteProfile, type RunActivity } from "@/lib/strava";
import type { StravaActivity } from "@/lib/coaching/types";

export const maxDuration = 30;

// Convert RunActivity to StravaActivity for recovery state calculation
function convertToStravaActivity(activity: RunActivity): StravaActivity {
    return {
        id: `strava_${activity.dateISO}`,
        name: activity.name,
        date: new Date(activity.dateISO),
        distance_km: activity.distance_km,
        duration_minutes: activity.duration_minutes,
        pace_min_per_km: parsePace(activity.pace),
        average_hr: activity.heart_rate ?? undefined,
        type: 'Run',
    };
}

function parsePace(pace: string): number | undefined {
    const match = pace.match(/(\d+):(\d+)/);
    if (match) {
        return parseInt(match[1]) + parseInt(match[2]) / 60;
    }
    return undefined;
}

// GET: Get active training block for user
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const block = await getActiveTrainingBlock(session.user.stravaId);

        if (block) {
            // CRITICAL: Recalculate totalWeeks based on actual dates (single source of truth)
            const now = new Date();
            const raceDate = new Date(block.end_date);
            const startDate = new Date(block.start_date);

            // Calculate actual weeks from start to race
            const msFromStartToRace = raceDate.getTime() - startDate.getTime();
            const actualTotalWeeks = Math.max(1, Math.ceil(msFromStartToRace / (7 * 24 * 60 * 60 * 1000)));

            // Calculate current week
            const msFromStart = now.getTime() - startDate.getTime();
            const currentWeek = Math.max(1, Math.min(
                Math.ceil(msFromStart / (7 * 24 * 60 * 60 * 1000)),
                actualTotalWeeks
            ));

            // Update the block plan totalWeeks if it doesn't match
            if (block.block_plan.totalWeeks !== actualTotalWeeks) {
                console.log(`[Training Block GET] Correcting totalWeeks: stored ${block.block_plan.totalWeeks} → actual ${actualTotalWeeks}`);
                block.block_plan.totalWeeks = actualTotalWeeks;
            }

            // Also return calculated currentWeek and totalWeeks at top level for easy access
            return Response.json({
                block: {
                    ...block,
                    currentWeek,
                    totalWeeks: actualTotalWeeks,
                }
            });
        }

        return Response.json({ block });
    } catch (error) {
        console.error("[Training Block GET] Error:", error);
        return Response.json({ error: "Failed to fetch training block" }, { status: 500 });
    }
}


// POST: Generate a new training block for a race
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { raceId, currentFitness, preferences } = body;

        if (!raceId) {
            return Response.json({ error: "raceId required" }, { status: 400 });
        }

        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            return Response.json({ error: "API key not configured" }, { status: 500 });
        }

        // Get the race
        const races = await getUserRaces(session.user.stravaId);
        const race = races.find(r => r.id === raceId);
        if (!race) {
            return Response.json({ error: "Race not found" }, { status: 404 });
        }

        // Check if a block already exists for this race
        const existingBlock = await getActiveTrainingBlock(session.user.stravaId);
        if (existingBlock && existingBlock.race_id === raceId) {
            return Response.json({
                error: "A training block already exists for this race. Delete the existing block first to regenerate.",
                existingBlock: true
            }, { status: 409 });
        }

        // Default fitness if not provided
        const fitness = currentFitness || {
            weeklyKm: 40,
            longestRun: 20,
            avgPace: "6:00",
        };

        // STEP 2: Fetch activities for recovery detection
        let activities: StravaActivity[] = [];
        let athleteAge: number | undefined;

        try {
            // Get recent runs from Strava
            const runActivities = await getStravaData(session.user.stravaId);
            activities = runActivities.map(convertToStravaActivity);
            console.log(`[Training Block POST] Fetched ${activities.length} activities for recovery check`);

            // Get athlete profile for age
            const profile = await getAthleteProfile(session.user.stravaId);
            athleteAge = profile?.age ?? undefined;
        } catch (stravaError) {
            console.warn("[Training Block POST] Could not fetch Strava data for recovery:", stravaError);
            // Continue without recovery context
        }

        // Fetch lactate test data for personalized HR zones
        let lactateData: LactateData | undefined;
        try {
            const lactateTest = await getLactateTest(session.user.stravaId);
            if (lactateTest) {
                lactateData = {
                    aerobic_threshold_hr: lactateTest.aerobic_threshold_hr ?? undefined,
                    anaerobic_threshold_hr: lactateTest.anaerobic_threshold_hr ?? undefined,
                    max_hr: lactateTest.max_hr ?? undefined,
                    // Include saved custom zones
                    z1_hr: lactateTest.z1_hr ?? undefined,
                    z2_hr: lactateTest.z2_hr ?? undefined,
                    z3_hr: lactateTest.z3_hr ?? undefined,
                    z4_hr: lactateTest.z4_hr ?? undefined,
                    z5_hr: lactateTest.z5_hr ?? undefined,
                };
                console.log(`[Training Block POST] Using lactate data: LT1=${lactateData.aerobic_threshold_hr}bpm, LT2=${lactateData.anaerobic_threshold_hr}bpm, zones=${lactateData.z2_hr ? 'custom' : 'calculated'}`);
            }
        } catch (lactateError) {
            console.warn("[Training Block POST] Could not fetch lactate data:", lactateError);
        }

        // Generate the block with recovery context and lactate data
        const { blockPlan, auditSummary } = await generateTrainingBlock({
            stravaId: session.user.stravaId,
            race,
            currentFitness: fitness,
            preferences,
            apiKey,
            activities,      // For recovery detection
            athleteAge,      // For age-adjusted recovery
            lactateData,     // NEW: For personalized HR zones
        });

        console.log(`[Training Block POST] Generated: ${race.name} | AUDIT: ${JSON.stringify(auditSummary)}`);
        return Response.json({ success: true, blockPlan, auditSummary });
    } catch (error) {
        console.error("[Training Block POST] Error:", error);
        return Response.json({ error: "Failed to generate training block" }, { status: 500 });
    }
}

// DELETE: Reset/abandon active training block
export async function DELETE() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const block = await getActiveTrainingBlock(session.user.stravaId);
        if (!block) {
            return Response.json({ error: "No active block" }, { status: 404 });
        }

        await updateTrainingBlockStatus(block.id, 'abandoned');
        console.log("[Training Block DELETE] Abandoned block:", block.id);
        return Response.json({ success: true });
    } catch (error) {
        console.error("[Training Block DELETE] Error:", error);
        return Response.json({ error: "Failed to reset training block" }, { status: 500 });
    }
}
