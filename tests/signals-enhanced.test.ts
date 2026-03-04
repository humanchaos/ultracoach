/**
 * Enhanced Signals Tests
 * 
 * Tests for new coaching signal features:
 * 1. Cross-training aerobic equivalents
 * 2. Elevation-aware volume
 * 3. "Ready to progress" signal
 */

import { describe, it, expect } from 'vitest';
import { calculateCoachingSignals } from '@/lib/coaching/signals';
import type { StravaActivity, Athlete } from '@/lib/coaching/types';

// Helper: create a basic athlete
function makeAthlete(overrides: Partial<Athlete> = {}): Athlete {
    return {
        name: 'Test Runner',
        maxHR: 190,
        restingHR: 50,
        weeklyTarget: 60,
        thresholdPace: 4.5,
        ...overrides,
    } as Athlete;
}

// Helper: create an activity N days ago
function makeActivity(
    daysAgo: number,
    overrides: Partial<StravaActivity> = {}
): StravaActivity {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
        id: `act-${daysAgo}`,
        name: `Run ${daysAgo}d ago`,
        type: 'Run',
        date,
        distance_km: 10,
        duration_minutes: 60,
        pace_min_per_km: 6.0,
        ...overrides,
    } as StravaActivity;
}

describe('Cross-training aerobic equivalents', () => {
    it('should give cycling 0.3x credit', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, { type: 'Ride', distance_km: 30, name: 'Bike ride' }),
            makeActivity(2, { type: 'Run', distance_km: 10, name: 'Easy run' }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);

        // Cycling 30km × 0.3 = 9km equivalent
        expect(signals.volume.crossTrainingKm).toBeCloseTo(9.0, 0);
    });

    it('should give swimming 0.4x credit', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, { type: 'Swim', distance_km: 3, name: 'Pool' }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);

        // Swimming 3km × 0.4 = 1.2km equivalent
        expect(signals.volume.crossTrainingKm).toBeCloseTo(1.2, 1);
    });

    it('should give hiking 0.8x credit', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, { type: 'Hike', distance_km: 15, name: 'Mountain hike' }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);

        // Hiking 15km × 0.8 = 12km equivalent
        expect(signals.volume.crossTrainingKm).toBeCloseTo(12.0, 0);
    });

    it('should not count unknown activity types', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, { type: 'Yoga' as StravaActivity['type'], distance_km: 5, name: 'Yoga' }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);
        expect(signals.volume.crossTrainingKm).toBe(0);
    });
});

describe('Elevation-aware volume', () => {
    it('should add +1km per 100m elevation gain', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, {
                distance_km: 10,
                elevation_gain_m: 500,
                name: 'Mountain trail run',
            }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);

        // 10km + 500m/100 = 15km equivalent flat
        expect(signals.volume.equivalentFlatKm).toBeCloseTo(15.0, 0);
        expect(signals.volume.thisWeekElevationM).toBe(500);
    });

    it('should handle zero elevation gracefully', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, { distance_km: 10, elevation_gain_m: 0 }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);
        expect(signals.volume.equivalentFlatKm).toBeCloseTo(10.0, 0);
        expect(signals.volume.thisWeekElevationM).toBe(0);
    });

    it('should handle missing elevation data', () => {
        const athlete = makeAthlete();
        const activities = [
            makeActivity(1, { distance_km: 10 }),
        ];

        const signals = calculateCoachingSignals(activities, athlete);
        // With no elevation data, equivalent flat should equal actual
        expect(signals.volume.equivalentFlatKm).toBeCloseTo(10.0, 0);
    });
});

describe('Ready to progress signal', () => {
    it('should return false with no planned workouts', () => {
        const athlete = makeAthlete();
        const activities = [makeActivity(1), makeActivity(3), makeActivity(5)];

        const signals = calculateCoachingSignals(activities, athlete);
        expect(signals.readyToProgress).toBe(false);
    });

    it('should return false with fewer than 3 weeks of data', () => {
        const athlete = makeAthlete();
        const activities = [makeActivity(1), makeActivity(8)];

        const signals = calculateCoachingSignals(activities, athlete, []);
        expect(signals.readyToProgress).toBe(false);
    });
});
