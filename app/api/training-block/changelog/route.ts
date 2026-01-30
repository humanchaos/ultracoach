import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getActiveTrainingBlock, getPlanChangelog } from "@/lib/db";

// GET - Get changelog for active training block
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const block = await getActiveTrainingBlock(session.user.stravaId);
        if (!block) {
            return NextResponse.json({
                hasBlock: false,
                changelog: [],
            });
        }

        const changelog = await getPlanChangelog(block.id);

        return NextResponse.json({
            hasBlock: true,
            blockId: block.id,
            planVersion: (block as { plan_version?: number }).plan_version || 1,
            changelog: changelog.map(entry => ({
                id: entry.id,
                version: entry.version,
                changeType: entry.change_type,
                reason: entry.reason,
                volumeChangePct: entry.volume_change_pct,
                weekNumber: entry.week_number,
                createdAt: entry.created_at.toISOString(),
            })),
        });

    } catch (error) {
        console.error("[Changelog API] Error:", error);
        return NextResponse.json(
            { error: "Failed to get changelog" },
            { status: 500 }
        );
    }
}
