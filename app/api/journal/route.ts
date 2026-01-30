import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { upsertJournalEntry, getRecentJournal, JournalEntry } from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();

        // Parse date or use today
        const date = body.date ? new Date(body.date) : new Date();

        const entry = await upsertJournalEntry({
            user_strava_id: session.user.stravaId,
            date,
            sleep_quality: body.sleep_quality,
            stress_level: body.stress_level,
            nutrition_score: body.nutrition_score,
            hrv_status: body.hrv_status,
            notes: body.notes,
            tags: body.tags || [],
            custom_data: body.custom_data,
        });

        console.log('[Journal] Saved entry:', {
            date: entry.date,
            sleep: entry.sleep_quality,
            stress: entry.stress_level,
            nutrition: entry.nutrition_score,
        });

        return NextResponse.json({ success: true, entry });
    } catch (error) {
        console.error('[Journal] Error saving entry:', error);
        return NextResponse.json(
            { error: 'Failed to save journal entry' },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const days = parseInt(searchParams.get('days') || '7');

        const entries = await getRecentJournal(session.user.stravaId, days);

        return NextResponse.json({ entries });
    } catch (error) {
        console.error('[Journal] Error fetching entries:', error);
        return NextResponse.json(
            { error: 'Failed to fetch journal entries' },
            { status: 500 }
        );
    }
}
