import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { auth } from '@/lib/auth';

export async function GET() {
    try {
        const session = await auth();

        // Get session user info
        const sessionInfo = session?.user ? {
            id: session.user.id,
            stravaId: (session.user as any).stravaId,
            name: session.user.name,
            email: session.user.email,
        } : null;

        // Get stored users
        const users = await sql`SELECT strava_id, name FROM strava_users`;

        // Get stored training blocks
        const blocks = await sql`SELECT id, user_strava_id, status FROM training_blocks`;

        return NextResponse.json({
            authenticated: !!session?.user,
            sessionUser: sessionInfo,
            storedUsers: users.rows,
            storedBlocks: blocks.rows.map(b => ({ id: b.id, user_strava_id: b.user_strava_id, status: b.status })),
            mismatchInfo: {
                sessionId: sessionInfo?.stravaId || sessionInfo?.id,
                storedIds: users.rows.map(u => u.strava_id),
            }
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
