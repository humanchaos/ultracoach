import { describe, it, expect } from 'vitest';
import { calculateRecoveryState } from '../lib/coaching/recovery-state';
import type { StravaActivity } from '../lib/coaching/types';

function mkActivity(daysAgo: number, distanceKm: number, name = 'Run'): StravaActivity {
    return {
        id: `act-${daysAgo}`,
        name,
        date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        distance_km: distanceKm,
        duration_minutes: distanceKm * 6,
        type: 'Run',
    };
}

describe('findMostRecentMajorEffort — sort guarantee', () => {
    it('picks the MOST RECENT major effort even when activities arrive out of order', () => {
        // Old marathon 60 days ago, recent 50K 5 days ago — arrived in reverse order
        const activities = [
            mkActivity(60, 42, 'Old Marathon'),   // older, arrives first
            mkActivity(5, 52, 'Recent 50K'),       // newer, arrives second
        ];

        const state = calculateRecoveryState({ activities });

        expect(state.inRecoveryWindow).toBe(true);
        expect(state.effortName).toBe('Recent 50K');
        expect(state.effortType).toBe('50K');
        expect(state.daysSinceEffort).toBe(5);
    });

    it('returns CLEARED when the only major effort is outside all recovery windows', () => {
        // 50K recovery window (adjustedStructured) = 18 days.
        // 90 days >> 18 days → daysSince > adjustedStructured → CLEARED.
        // Source: RECOVERY_WINDOWS['50K'].structured = 18 in recovery-state.ts.
        const activities = [mkActivity(90, 50, 'Old 50K')];
        const state = calculateRecoveryState({ activities });
        expect(state.inRecoveryWindow).toBe(false);
        expect(state.phase).toBe('CLEARED');
    });
});
