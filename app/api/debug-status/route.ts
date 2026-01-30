import { auth } from "@/lib/auth";
import { getUserByStravaId, getActiveTrainingBlock, getCurrentWeekInBlock } from "@/lib/db";
import { getLastSyncStatus } from "@/lib/strava";
import { getCurrentPhaseInfo } from "@/lib/coaching/logic";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({
                llmModel: "gemini-2.0-flash",
                tokenHealth: "unknown",
                tokenExpiresAt: null,
                lastSync: null,
                trainingBlock: null,
            });
        }

        const user = await getUserByStravaId(session.user.stravaId);
        const syncStatus = getLastSyncStatus();

        // Get training block info
        const block = await getActiveTrainingBlock(session.user.stravaId);
        let trainingBlockInfo = null;
        if (block) {
            const currentWeek = getCurrentWeekInBlock(block);
            const phaseInfo = getCurrentPhaseInfo(block, currentWeek);
            trainingBlockInfo = {
                weekInBlock: phaseInfo.weekInBlock,
                totalWeeks: phaseInfo.totalWeeksInBlock,
                phaseName: phaseInfo.phaseName,
                weekInPhase: phaseInfo.weekInPhase,
                targetKm: phaseInfo.targetKm,
                focus: phaseInfo.focus,
            };
        }

        // Check token health
        const now = Math.floor(Date.now() / 1000);
        const tokenHealth = user
            ? (user.expires_at > now ? "healthy" : "expired")
            : "unknown";

        return Response.json({
            llmModel: "gemini-2.0-flash",
            tokenHealth,
            tokenExpiresAt: user?.expires_at || null,
            lastSync: syncStatus ? {
                success: syncStatus.success,
                timestamp: syncStatus.timestamp.toISOString(),
                activitiesCount: syncStatus.activitiesCount,
                error: syncStatus.error,
            } : null,
            trainingBlock: trainingBlockInfo,
        });
    } catch (error) {
        console.error("[Debug Status] Error:", error);
        return Response.json({
            llmModel: "gemini-2.0-flash",
            tokenHealth: "unknown",
            tokenExpiresAt: null,
            lastSync: null,
            trainingBlock: null,
        });
    }
}
