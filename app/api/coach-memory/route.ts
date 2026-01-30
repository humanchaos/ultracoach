import { auth } from "@/lib/auth";
import {
    getCoachMemories,
    saveCoachMemory,
    deleteCoachMemory,
    type MemoryType
} from "@/lib/db";

// GET - Retrieve coach memories
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const memories = await getCoachMemories(session.user.stravaId);
        return Response.json({ memories });
    } catch (error) {
        console.error("[Coach Memory GET] Error:", error);
        return Response.json({ error: "Failed to fetch memories" }, { status: 500 });
    }
}

// POST - Save a new memory
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { memory_type, content, extracted_from, expires_in_days } = body;

        if (!memory_type || !content) {
            return Response.json({ error: "memory_type and content are required" }, { status: 400 });
        }

        const validTypes: MemoryType[] = ['feeling', 'injury', 'preference', 'health_note', 'goal'];
        if (!validTypes.includes(memory_type)) {
            return Response.json({ error: "Invalid memory_type" }, { status: 400 });
        }

        // Calculate expiry if specified (e.g., feelings expire after 7 days)
        let expires_at: Date | undefined;
        if (expires_in_days) {
            expires_at = new Date();
            expires_at.setDate(expires_at.getDate() + expires_in_days);
        }

        const memory = await saveCoachMemory({
            user_strava_id: session.user.stravaId,
            memory_type,
            content,
            extracted_from,
            expires_at,
        });

        return Response.json({ memory });
    } catch (error) {
        console.error("[Coach Memory POST] Error:", error);
        return Response.json({ error: "Failed to save memory" }, { status: 500 });
    }
}

// DELETE - Remove a memory
export async function DELETE(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        if (!id) {
            return Response.json({ error: "Memory ID required" }, { status: 400 });
        }

        const deleted = await deleteCoachMemory(parseInt(id), session.user.stravaId);
        return Response.json({ success: deleted });
    } catch (error) {
        console.error("[Coach Memory DELETE] Error:", error);
        return Response.json({ error: "Failed to delete memory" }, { status: 500 });
    }
}
