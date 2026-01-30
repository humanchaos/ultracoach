import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserRaces, addRace, deleteRace } from "@/lib/db";

// GET /api/races - Get all upcoming races for the user
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const races = await getUserRaces(session.user.stravaId);
        return NextResponse.json(races);
    } catch (error) {
        console.error("[Races API] Error fetching races:", error);
        return NextResponse.json({ error: "Failed to fetch races" }, { status: 500 });
    }
}

// POST /api/races - Add a new race
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();

        // Validate required fields
        if (!body.name || !body.date || !body.distance_km || !body.race_type) {
            return NextResponse.json(
                { error: "Missing required fields: name, date, distance_km, race_type" },
                { status: 400 }
            );
        }

        const race = await addRace({
            user_strava_id: session.user.stravaId,
            name: body.name,
            date: new Date(body.date),
            distance_km: parseFloat(body.distance_km),
            elevation_gain_m: body.elevation_gain_m ? parseInt(body.elevation_gain_m) : undefined,
            elevation_loss_m: body.elevation_loss_m ? parseInt(body.elevation_loss_m) : undefined,
            race_type: body.race_type,
            goal_time: body.goal_time,
            priority: body.priority || 'B',
            notes: body.notes,
        });

        return NextResponse.json(race, { status: 201 });
    } catch (error) {
        console.error("[Races API] Error adding race:", error);
        return NextResponse.json({ error: "Failed to add race" }, { status: 500 });
    }
}

// DELETE /api/races - Delete a race
export async function DELETE(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const raceId = searchParams.get("id");

        if (!raceId) {
            return NextResponse.json({ error: "Race ID required" }, { status: 400 });
        }

        const deleted = await deleteRace(parseInt(raceId), session.user.stravaId);

        if (!deleted) {
            return NextResponse.json({ error: "Race not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[Races API] Error deleting race:", error);
        return NextResponse.json({ error: "Failed to delete race" }, { status: 500 });
    }
}
