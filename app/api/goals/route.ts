import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserGoal, upsertUserGoal, GoalType, ExperienceLevel } from "@/lib/db";

// GET /api/goals - Get user's current goal
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const goal = await getUserGoal(session.user.stravaId);
        return NextResponse.json(goal || { goal_type: null });
    } catch (error) {
        console.error("[Goals API] Error fetching goal:", error);
        return NextResponse.json({ error: "Failed to fetch goal" }, { status: 500 });
    }
}

// POST /api/goals - Set/update user's goal
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();

        // Validate goal type
        const validGoalTypes: GoalType[] = ['maintain', 'get_faster', 'lose_weight', 'run_longer', 'competition'];
        if (!body.goal_type || !validGoalTypes.includes(body.goal_type)) {
            return NextResponse.json(
                { error: "Invalid goal_type. Must be one of: maintain, get_faster, lose_weight, run_longer, competition" },
                { status: 400 }
            );
        }

        // Validate experience level if provided
        const validExperience: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'elite'];
        if (body.running_experience && !validExperience.includes(body.running_experience)) {
            return NextResponse.json(
                { error: "Invalid running_experience. Must be one of: beginner, intermediate, advanced, elite" },
                { status: 400 }
            );
        }

        const goal = await upsertUserGoal({
            user_strava_id: session.user.stravaId,
            goal_type: body.goal_type,
            target_race_id: body.target_race_id,
            target_pace: body.target_pace,
            weekly_mileage_km: body.weekly_mileage_km,
            running_experience: body.running_experience,
            injuries_notes: body.injuries_notes,
        });

        return NextResponse.json(goal);
    } catch (error) {
        console.error("[Goals API] Error setting goal:", error);
        return NextResponse.json({ error: "Failed to set goal" }, { status: 500 });
    }
}
