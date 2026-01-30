import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
    getActiveTrainingBlock,
    getCurrentWeekInBlock,
    saveWeeklyWorkouts,
    getStoredWeeklyWorkouts,
    getBlockTargetsForWeek,
    type DailyWorkout
} from '@/lib/db';
import { validateWeeklyVolume } from '@/lib/coaching/logic';

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { dayName, updates } = body;

        if (!dayName || !updates) {
            return NextResponse.json({ error: 'dayName and updates required' }, { status: 400 });
        }

        // Get active block
        const block = await getActiveTrainingBlock(session.user.stravaId);
        if (!block) {
            return NextResponse.json({ error: 'No active training block' }, { status: 404 });
        }

        const currentWeek = getCurrentWeekInBlock(block);

        // Get current workouts for this week
        let workouts = await getStoredWeeklyWorkouts(block.id, currentWeek);

        if (!workouts || workouts.length === 0) {
            return NextResponse.json({ error: 'No workouts stored for current week' }, { status: 404 });
        }

        // Find and update the specific day
        const dayIndex = workouts.findIndex(w =>
            w.day.toLowerCase().startsWith(dayName.toLowerCase().slice(0, 3))
        );

        if (dayIndex === -1) {
            return NextResponse.json({ error: `Day "${dayName}" not found in current week` }, { status: 404 });
        }

        // Store original for volume comparison
        const originalWorkout = workouts[dayIndex];

        // Apply updates (only modify provided fields)
        const updatedWorkout: DailyWorkout = {
            ...workouts[dayIndex],
            ...updates,
        };

        workouts[dayIndex] = updatedWorkout;

        // ============================================
        // VOLUME VALIDATION (Architectural Integrity)
        // ============================================
        const weekTargets = getBlockTargetsForWeek(block, currentWeek);
        const tolerance = weekTargets.isRecoveryWeek ? 5 : 10;
        const validation = validateWeeklyVolume(workouts, weekTargets.targetVolume, tolerance);

        let volumeWarning: string | undefined;

        if (!validation.isValid) {
            const originalVolume = workouts.reduce((sum, w, i) => {
                if (i === dayIndex) {
                    return sum + (originalWorkout.distance_km || 0);
                }
                return sum + (w.distance_km || 0);
            }, 0);

            console.log(`[Modify Workout] Volume warning: modification changes ${originalVolume}km → ${validation.actualVolume}km (target: ${weekTargets.targetVolume}km)`);

            volumeWarning = `⚠️ This modification changes weekly volume to ${validation.actualVolume}km (${validation.deviation > 0 ? '+' : ''}${validation.deviation}% from target ${weekTargets.targetVolume}km). Consider compensating on another day.`;
        }

        // Save updated workouts (even with warning - let coach decide)
        await saveWeeklyWorkouts(block.id, currentWeek, workouts);

        console.log(`[Modify Workout] Updated ${dayName}:`, updatedWorkout);

        return NextResponse.json({
            success: true,
            updatedWorkout,
            message: `Updated ${dayName}'s workout`,
            volumeWarning,
            volumeValidation: {
                targetVolume: weekTargets.targetVolume,
                actualVolume: validation.actualVolume,
                deviation: validation.deviation,
                isWithinTolerance: validation.isValid,
            }
        });
    } catch (error) {
        console.error('[Modify Workout] Error:', error);
        return NextResponse.json({ error: 'Failed to modify workout' }, { status: 500 });
    }
}
