import { auth } from "@/lib/auth";
import { getAthleteProfile } from "@/lib/strava";
import { NextResponse } from "next/server";

export async function GET() {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const stravaId = (session.user as { stravaId?: string }).stravaId;
        if (!stravaId) {
            return NextResponse.json({ error: "No Strava ID" }, { status: 400 });
        }

        const profile = await getAthleteProfile(stravaId);

        if (!profile) {
            return NextResponse.json({ error: "Profile not found" }, { status: 404 });
        }

        return NextResponse.json({
            firstName: profile.firstName,
            sex: profile.sex,
            age: profile.age,
            weight: profile.weight,
        });
    } catch (error) {
        console.error("[API] Error fetching athlete profile:", error);
        return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }
}
