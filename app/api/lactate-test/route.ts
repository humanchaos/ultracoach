import { auth } from "@/lib/auth";
import { getLactateTest, saveLactateTest } from "@/lib/db";

// GET - Retrieve lactate test data
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const test = await getLactateTest(session.user.stravaId);
        return Response.json({ test });
    } catch (error) {
        console.error("[Lactate Test GET] Error:", error);
        return Response.json({ error: "Failed to fetch lactate test" }, { status: 500 });
    }
}

// POST - Save lactate test data
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            test_date,
            aerobic_threshold_hr,
            aerobic_threshold_pace,
            anaerobic_threshold_hr,
            anaerobic_threshold_pace,
            max_hr,
            vo2max,
            source,
            raw_pdf_data,
            notes,
            z1_hr,
            z2_hr,
            z3_hr,
            z4_hr,
            z5_hr,
        } = body;

        if (!test_date) {
            return Response.json({ error: "test_date is required" }, { status: 400 });
        }

        const test = await saveLactateTest({
            user_strava_id: session.user.stravaId,
            test_date: new Date(test_date),
            aerobic_threshold_hr: aerobic_threshold_hr ? parseInt(aerobic_threshold_hr) : undefined,
            aerobic_threshold_pace,
            anaerobic_threshold_hr: anaerobic_threshold_hr ? parseInt(anaerobic_threshold_hr) : undefined,
            anaerobic_threshold_pace,
            max_hr: max_hr ? parseInt(max_hr) : undefined,
            vo2max: vo2max ? parseFloat(vo2max) : undefined,
            source: source || 'manual',
            raw_pdf_data,
            notes,
            z1_hr,
            z2_hr,
            z3_hr,
            z4_hr,
            z5_hr,
        });

        return Response.json({ test });
    } catch (error) {
        console.error("[Lactate Test POST] Error:", error);
        return Response.json({ error: "Failed to save lactate test" }, { status: 500 });
    }
}
