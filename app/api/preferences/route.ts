import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPreferences, upsertUserPreferences } from "@/lib/db";

// GET - Fetch user preferences
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const preferences = await getUserPreferences(session.user.stravaId as string);
        return NextResponse.json(preferences || {
            training_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
            long_run_day: 'sunday',
            max_weekly_km: 80,
            notes: ''
        });
    } catch (error) {
        console.error("[Preferences API] GET error:", error);
        return NextResponse.json({ error: "Failed to fetch preferences" }, { status: 500 });
    }
}

// POST - Update user preferences
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const stravaId = session.user.stravaId as string;

        const updated = await upsertUserPreferences({
            user_strava_id: stravaId,
            training_days: body.training_days,
            long_run_day: body.long_run_day,
            max_weekly_km: body.max_weekly_km,
            notes: body.notes,
        });

        return NextResponse.json(updated);
    } catch (error) {
        console.error("[Preferences API] POST error:", error);
        return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
    }
}
