import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    getActiveTrainingBlock,
    getCurrentWeekInBlock,
    formatBlockForAIv2,
    getRaceById
} from "@/lib/db";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const block = await getActiveTrainingBlock(session.user.stravaId);

        if (!block) {
            return NextResponse.json({
                error: "No active training block",
                stravaId: session.user.stravaId
            }, { status: 404 });
        }

        const currentWeek = getCurrentWeekInBlock(block);
        const race = block.race_id ? await getRaceById(block.race_id) : undefined;
        const blockContext = formatBlockForAIv2(block, race || undefined);

        // Get today's info
        const today = new Date();
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayName = dayNames[today.getDay()];

        // Get this week's workouts
        const thisWeekWorkouts = block.weekly_workouts?.[currentWeek.toString()];

        // Find today's workout
        const todayWorkout = thisWeekWorkouts?.find(
            w => w.day.toLowerCase() === todayName.toLowerCase()
        );

        return NextResponse.json({
            debug: {
                today: {
                    date: today.toISOString(),
                    dayName: todayName,
                    dayIndex: today.getDay(),
                },
                block: {
                    id: block.id,
                    startDate: block.start_date,
                    endDate: block.end_date,
                    status: block.status,
                    currentWeek,
                    totalWeeks: block.block_plan.totalWeeks,
                },
                weeklyWorkouts: {
                    availableWeeks: Object.keys(block.weekly_workouts || {}),
                    thisWeekKey: currentWeek.toString(),
                    thisWeekWorkoutsCount: thisWeekWorkouts?.length || 0,
                    thisWeekWorkouts: thisWeekWorkouts || null,
                    todayWorkout: todayWorkout || null,
                },
            },
            blockContext,
        });
    } catch (error) {
        console.error("[Debug Coach Context] Error:", error);
        return NextResponse.json({
            error: "Failed to get debug info",
            details: String(error)
        }, { status: 500 });
    }
}
