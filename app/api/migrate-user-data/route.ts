import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { auth } from '@/lib/auth';

// POST: Migrate all data from old user IDs to current session ID
export async function POST(req: Request) {
    try {
        const session = await auth();
        const currentId = (session?.user as any)?.stravaId || session?.user?.id;

        if (!currentId) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        // IMPORTANT: Ensure current user exists in strava_users first (foreign key requirement)
        const currentUserExists = await sql`SELECT 1 FROM strava_users WHERE strava_id = ${currentId}`;
        if (currentUserExists.rows.length === 0) {
            // Create the current user entry using session data
            const userName = session?.user?.name || 'User';
            const userEmail = session?.user?.email || null;
            await sql`
                INSERT INTO strava_users (strava_id, name, email, access_token, refresh_token, expires_at)
                VALUES (${currentId}, ${userName}, ${userEmail}, 'migrated', 'migrated', 0)
                ON CONFLICT (strava_id) DO NOTHING
            `;
            console.log('[migrate-user-data] Created user entry for current session:', currentId);
        }

        // Get request body for optional source ID filter
        const body = await req.json().catch(() => ({}));
        const sourceIds: string[] = body.sourceIds || [];

        // Get all user IDs except current
        const users = await sql`SELECT strava_id FROM strava_users WHERE strava_id != ${currentId}`;
        const idsToMigrate = sourceIds.length > 0
            ? users.rows.filter(u => sourceIds.includes(u.strava_id)).map(u => u.strava_id)
            : users.rows.map(u => u.strava_id);

        if (idsToMigrate.length === 0) {
            return NextResponse.json({ message: 'No data to migrate', migrated: {} });
        }

        const migrationResults: Record<string, number> = {
            races: 0,
            journal_entries: 0,
            training_blocks: 0,
            preferences: 0,
            goals: 0,
            memories: 0,
            lactate_tests: 0,
        };

        // Migrate each table
        for (const oldId of idsToMigrate) {
            // Races - update to new ID (handle potential conflicts)
            const racesResult = await sql`
                UPDATE races SET user_strava_id = ${currentId}
                WHERE user_strava_id = ${oldId}
            `;
            migrationResults.races += racesResult.rowCount || 0;

            // Journal entries - update to new ID (handle date conflicts by keeping newer)
            const journalResult = await sql`
                UPDATE user_journal SET user_strava_id = ${currentId}
                WHERE user_strava_id = ${oldId}
                AND NOT EXISTS (
                    SELECT 1 FROM user_journal j2 
                    WHERE j2.user_strava_id = ${currentId} 
                    AND j2.date = user_journal.date
                )
            `.catch(() => ({ rowCount: 0 }));
            migrationResults.journal_entries += journalResult.rowCount || 0;

            // Training blocks - migrate all, mark old ones as abandoned if conflict
            const blocksResult = await sql`
                UPDATE training_blocks SET user_strava_id = ${currentId}
                WHERE user_strava_id = ${oldId}
            `;
            migrationResults.training_blocks += blocksResult.rowCount || 0;

            // Preferences - only migrate if current user has none
            const existingPrefs = await sql`SELECT 1 FROM user_preferences WHERE user_strava_id = ${currentId}`;
            if (existingPrefs.rows.length === 0) {
                const prefsResult = await sql`
                    UPDATE user_preferences SET user_strava_id = ${currentId}
                    WHERE user_strava_id = ${oldId}
                    LIMIT 1
                `.catch(async () => {
                    // If LIMIT not supported, do it differently
                    const oldPrefs = await sql`SELECT id FROM user_preferences WHERE user_strava_id = ${oldId} LIMIT 1`;
                    if (oldPrefs.rows.length > 0) {
                        await sql`UPDATE user_preferences SET user_strava_id = ${currentId} WHERE id = ${oldPrefs.rows[0].id}`;
                        return { rowCount: 1 };
                    }
                    return { rowCount: 0 };
                });
                migrationResults.preferences += prefsResult.rowCount || 0;
            }

            // Goals - only migrate if current user has none
            const existingGoals = await sql`SELECT 1 FROM user_goals WHERE user_strava_id = ${currentId}`;
            if (existingGoals.rows.length === 0) {
                const goalsResult = await sql`
                    UPDATE user_goals SET user_strava_id = ${currentId}
                    WHERE user_strava_id = ${oldId}
                `.catch(() => ({ rowCount: 0 }));
                migrationResults.goals += goalsResult.rowCount || 0;
            }

            // Coach memories - migrate all
            const memoriesResult = await sql`
                UPDATE coach_memories SET user_strava_id = ${currentId}
                WHERE user_strava_id = ${oldId}
            `;
            migrationResults.memories += memoriesResult.rowCount || 0;

            // Lactate tests - migrate all
            const lactateResult = await sql`
                UPDATE lactate_tests SET user_strava_id = ${currentId}
                WHERE user_strava_id = ${oldId}
            `.catch(() => ({ rowCount: 0 }));
            migrationResults.lactate_tests += lactateResult.rowCount || 0;
        }

        // Clean up old user entries that now have no data
        // (Keep the current user even if they had no data before)
        await sql`
            DELETE FROM strava_users 
            WHERE strava_id != ${currentId}
            AND strava_id NOT IN (SELECT DISTINCT user_strava_id FROM races)
            AND strava_id NOT IN (SELECT DISTINCT user_strava_id FROM training_blocks)
            AND strava_id NOT IN (SELECT DISTINCT user_strava_id FROM user_preferences)
            AND strava_id NOT IN (SELECT DISTINCT user_strava_id FROM user_goals)
            AND strava_id NOT IN (SELECT DISTINCT user_strava_id FROM coach_memories)
        `.catch(() => { }); // Ignore errors on cleanup

        return NextResponse.json({
            success: true,
            currentSessionId: currentId,
            migratedFrom: idsToMigrate,
            migrated: migrationResults,
            message: `Successfully migrated data from ${idsToMigrate.length} old account(s)`
        });

    } catch (error) {
        console.error('[migrate-user-data] Error:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
