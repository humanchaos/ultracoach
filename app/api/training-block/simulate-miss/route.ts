import { auth } from "@/lib/auth";
import { getActiveTrainingBlock, getCurrentWeekInBlock, saveTrainingBlock } from "@/lib/db";
import { auditCompliance, applyAdaptations, processLoginDecision, StravaActivity } from "@/lib/coaching/logic";

export const maxDuration = 10;

// POST: Simulate a missed long run for testing adaptive logic
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const block = await getActiveTrainingBlock(session.user.stravaId);
        if (!block) {
            return Response.json({ error: "No active training block" }, { status: 404 });
        }

        const currentWeek = getCurrentWeekInBlock(block);

        // Simulate a week with missed long run - only short easy runs
        const simulatedActivities: StravaActivity[] = [
            { id: 'sim-1', date: new Date(), distance_km: 5, type: 'Run' },
            { id: 'sim-2', date: new Date(), distance_km: 6, type: 'Run' },
            { id: 'sim-3', date: new Date(), distance_km: 4, type: 'Run' },
            // Long run missing!
        ];

        // Run the coaching logic
        const report = auditCompliance(block, simulatedActivities, currentWeek);
        const decision = processLoginDecision(block, simulatedActivities, currentWeek);

        // If modified, save the changes
        if (decision.action === 'modify' && decision.modifiedBlock) {
            // Update the block in DB by saving a new one (which auto-abandons the old)
            await saveTrainingBlock({
                user_strava_id: session.user.stravaId,
                race_id: block.race_id ?? undefined,
                start_date: block.start_date,
                end_date: block.end_date,
                block_plan: decision.modifiedBlock.block_plan,
            });
        }

        console.log("[Simulate Miss] Compliance:", report.compliance, "Action:", decision.action);

        return Response.json({
            success: true,
            compliance: report.compliance,
            missedLongRun: report.missedLongRun,
            action: decision.action,
            message: decision.message,
        });
    } catch (error) {
        console.error("[Simulate Miss] Error:", error);
        return Response.json({ error: "Failed to simulate" }, { status: 500 });
    }
}
