import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { auth } from '@/lib/auth';

// POST: Clean up old user accounts, keeping only the current session user
// This removes duplicate accounts created from authentication issues
// Use { force: true } to also delete accounts with orphaned data
export async function POST(req: Request) {
    try {
        const session = await auth();
        const currentId = (session?.user as any)?.stravaId || session?.user?.id;

        if (!currentId) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const forceCleanup = body.force === true;

        // Get all user IDs except current
        const users = await sql`SELECT strava_id, name FROM strava_users WHERE strava_id != ${currentId}`;
        const oldUserIds = users.rows.map(u => u.strava_id);

        if (oldUserIds.length === 0) {
            return NextResponse.json({
                message: 'No old accounts to clean up',
                currentUser: currentId,
                deletedAccounts: 0
            });
        }

        // Check what data each account has
        const dataCheck = await Promise.all(oldUserIds.map(async (oldId) => {
            const [races, blocks, prefs, goals, memories, journal, lactate] = await Promise.all([
                sql`SELECT COUNT(*) as count FROM races WHERE user_strava_id = ${oldId}`,
                sql`SELECT COUNT(*) as count FROM training_blocks WHERE user_strava_id = ${oldId}`,
                sql`SELECT COUNT(*) as count FROM user_preferences WHERE user_strava_id = ${oldId}`,
                sql`SELECT COUNT(*) as count FROM user_goals WHERE user_strava_id = ${oldId}`,
                sql`SELECT COUNT(*) as count FROM coach_memories WHERE user_strava_id = ${oldId}`,
                sql`SELECT COUNT(*) as count FROM user_journal WHERE user_strava_id = ${oldId}`.catch(() => ({ rows: [{ count: 0 }] })),
                sql`SELECT COUNT(*) as count FROM lactate_tests WHERE user_strava_id = ${oldId}`.catch(() => ({ rows: [{ count: 0 }] })),
            ]);

            return {
                id: oldId,
                hasData: (
                    parseInt(races.rows[0].count) > 0 ||
                    parseInt(blocks.rows[0].count) > 0 ||
                    parseInt(prefs.rows[0].count) > 0 ||
                    parseInt(goals.rows[0].count) > 0 ||
                    parseInt(memories.rows[0].count) > 0 ||
                    parseInt(journal.rows[0].count) > 0 ||
                    parseInt(lactate.rows[0].count) > 0
                ),
                dataCounts: {
                    races: parseInt(races.rows[0].count),
                    blocks: parseInt(blocks.rows[0].count),
                    prefs: parseInt(prefs.rows[0].count),
                    goals: parseInt(goals.rows[0].count),
                    memories: parseInt(memories.rows[0].count),
                    journal: parseInt(journal.rows[0].count),
                    lactate: parseInt(lactate.rows[0].count),
                }
            };
        }));

        const safeToDelete = dataCheck.filter(d => !d.hasData).map(d => d.id);
        const accountsWithData = dataCheck.filter(d => d.hasData);

        let deletedCount = 0;
        let deletedDataCounts = { races: 0, blocks: 0, prefs: 0, goals: 0, memories: 0, journal: 0, lactate: 0 };

        // Delete safe accounts (no data)
        for (const oldId of safeToDelete) {
            await sql`DELETE FROM strava_users WHERE strava_id = ${oldId}`;
            deletedCount++;
        }

        // If force cleanup, also delete accounts with orphaned data
        if (forceCleanup && accountsWithData.length > 0) {
            for (const account of accountsWithData) {
                // Delete orphaned data first (foreign key constraint)
                await sql`DELETE FROM races WHERE user_strava_id = ${account.id}`.catch(() => { });
                await sql`DELETE FROM training_blocks WHERE user_strava_id = ${account.id}`.catch(() => { });
                await sql`DELETE FROM user_preferences WHERE user_strava_id = ${account.id}`.catch(() => { });
                await sql`DELETE FROM user_goals WHERE user_strava_id = ${account.id}`.catch(() => { });
                await sql`DELETE FROM coach_memories WHERE user_strava_id = ${account.id}`.catch(() => { });
                await sql`DELETE FROM user_journal WHERE user_strava_id = ${account.id}`.catch(() => { });
                await sql`DELETE FROM lactate_tests WHERE user_strava_id = ${account.id}`.catch(() => { });

                // Then delete the user
                await sql`DELETE FROM strava_users WHERE strava_id = ${account.id}`;
                deletedCount++;

                // Track what was deleted
                deletedDataCounts.races += account.dataCounts.races;
                deletedDataCounts.blocks += account.dataCounts.blocks;
                deletedDataCounts.prefs += account.dataCounts.prefs;
                deletedDataCounts.goals += account.dataCounts.goals;
                deletedDataCounts.memories += account.dataCounts.memories;
                deletedDataCounts.journal += account.dataCounts.journal;
                deletedDataCounts.lactate += account.dataCounts.lactate;
            }
        }

        return NextResponse.json({
            success: true,
            currentUser: currentId,
            deletedAccounts: deletedCount,
            deletedIds: forceCleanup
                ? [...safeToDelete, ...accountsWithData.map(a => a.id)]
                : safeToDelete,
            skippedAccountsWithData: forceCleanup ? [] : accountsWithData.map(a => a.id),
            orphanedDataDeleted: forceCleanup ? deletedDataCounts : null,
            message: deletedCount > 0
                ? `Cleaned up ${deletedCount} old account(s)${forceCleanup ? ' (including orphaned data)' : ''}`
                : 'No accounts to clean up'
        });

    } catch (error) {
        console.error('[cleanup-accounts] Error:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

// GET: Show current state of accounts
export async function GET() {
    try {
        const session = await auth();
        const currentId = (session?.user as any)?.stravaId || session?.user?.id;

        const users = await sql`SELECT strava_id, name, created_at FROM strava_users ORDER BY created_at DESC`;

        return NextResponse.json({
            authenticated: !!session?.user,
            currentSessionId: currentId,
            totalAccounts: users.rows.length,
            accounts: users.rows.map(u => ({
                id: u.strava_id,
                name: u.name,
                isCurrent: u.strava_id === currentId,
                createdAt: u.created_at
            }))
        });
    } catch (error) {
        return NextResponse.json({
            error: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
