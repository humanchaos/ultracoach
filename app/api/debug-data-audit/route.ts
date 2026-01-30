import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { auth } from '@/lib/auth';

// Audit which user IDs have what data - helps diagnose data migration needs
export async function GET() {
    try {
        const session = await auth();
        const currentId = (session?.user as any)?.stravaId || session?.user?.id;

        // Get all user IDs
        const users = await sql`SELECT strava_id, name FROM strava_users`;

        // For each user, count their data
        const userDataCounts = await Promise.all(
            users.rows.map(async (user) => {
                const [races, journal, blocks, preferences, goals, memories, lactate] = await Promise.all([
                    sql`SELECT COUNT(*) as count FROM races WHERE user_strava_id = ${user.strava_id}`,
                    sql`SELECT COUNT(*) as count FROM user_journal WHERE user_strava_id = ${user.strava_id}`.catch(() => ({ rows: [{ count: 0 }] })),
                    sql`SELECT COUNT(*) as count FROM training_blocks WHERE user_strava_id = ${user.strava_id}`,
                    sql`SELECT COUNT(*) as count FROM user_preferences WHERE user_strava_id = ${user.strava_id}`,
                    sql`SELECT COUNT(*) as count FROM user_goals WHERE user_strava_id = ${user.strava_id}`,
                    sql`SELECT COUNT(*) as count FROM coach_memories WHERE user_strava_id = ${user.strava_id}`,
                    sql`SELECT COUNT(*) as count FROM lactate_tests WHERE user_strava_id = ${user.strava_id}`.catch(() => ({ rows: [{ count: 0 }] })),
                ]);

                return {
                    strava_id: user.strava_id,
                    name: user.name,
                    isCurrent: user.strava_id === currentId,
                    data: {
                        races: parseInt(races.rows[0].count),
                        journal_entries: parseInt(journal.rows[0].count),
                        training_blocks: parseInt(blocks.rows[0].count),
                        preferences: parseInt(preferences.rows[0].count),
                        goals: parseInt(goals.rows[0].count),
                        memories: parseInt(memories.rows[0].count),
                        lactate_tests: parseInt(lactate.rows[0].count),
                    },
                    hasData: (
                        parseInt(races.rows[0].count) > 0 ||
                        parseInt(journal.rows[0].count) > 0 ||
                        parseInt(blocks.rows[0].count) > 0 ||
                        parseInt(preferences.rows[0].count) > 0 ||
                        parseInt(goals.rows[0].count) > 0 ||
                        parseInt(memories.rows[0].count) > 0 ||
                        parseInt(lactate.rows[0].count) > 0
                    )
                };
            })
        );

        // Find users with actual data
        const usersWithData = userDataCounts.filter(u => u.hasData);
        const currentUserData = userDataCounts.find(u => u.isCurrent);

        return NextResponse.json({
            currentSessionId: currentId,
            currentUserHasData: currentUserData?.hasData || false,
            currentUserData: currentUserData?.data,
            usersWithData: usersWithData,
            totalUsers: users.rows.length,
            migrationNeeded: usersWithData.length > 0 && !currentUserData?.hasData,
            recommendation: usersWithData.length > 0 && !currentUserData?.hasData
                ? `Migrate data from ${usersWithData.length} old account(s) to current session`
                : 'No migration needed'
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
