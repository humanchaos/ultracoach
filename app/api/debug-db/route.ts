import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
    const userId = '41fff581-6d1f-4f8e-99c7-7e4a2167c238';

    try {
        // Check preferences for this user (correct column name)
        const prefs = await sql`SELECT * FROM user_preferences WHERE user_strava_id = ${userId}`;

        // Check races for this user
        const races = await sql`SELECT * FROM races WHERE user_strava_id = ${userId}`;

        // Check active training block
        const activeBlock = await sql`SELECT id, status, created_at FROM training_blocks WHERE user_strava_id = ${userId} AND status = 'active'`;

        return NextResponse.json({
            userId,
            hasPreferences: prefs.rows.length > 0,
            preferences: prefs.rows,
            hasRaces: races.rows.length > 0,
            races: races.rows,
            hasActiveBlock: activeBlock.rows.length > 0,
            activeBlocks: activeBlock.rows,
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
