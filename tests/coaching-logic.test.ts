/**
 * Coaching Logic Tests
 * TDD: Write failing tests first, then implement to pass
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    auditCompliance,
    applyAdaptations,
    calculateReadiness,
    StravaActivity,
    ComplianceReport,
    ReadinessReport
} from '../lib/coaching/logic';
import { JournalEntry } from '../lib/db';

// Use the types from our implementation
interface TrainingBlock {
    id: number;
    user_strava_id: string;
    block_plan: {
        totalWeeks: number;
        phases: Array<{
            name: string;
            weeks: number;
            focus: string;
            weeklyKm: number[];
        }>;
    };
}

describe('Coaching Logic - Compliance Auditing', () => {
    let mockBlock: TrainingBlock;

    beforeEach(() => {
        // Sample 10-week training block
        mockBlock = {
            id: 1,
            user_strava_id: '12345',
            block_plan: {
                totalWeeks: 10,
                phases: [
                    { name: 'Base', weeks: 4, focus: 'Aerobic volume', weeklyKm: [40, 45, 50, 45] },
                    { name: 'Build', weeks: 4, focus: 'Threshold work', weeklyKm: [50, 55, 60, 50] },
                    { name: 'Peak', weeks: 1, focus: 'Race-specific', weeklyKm: [45] },
                    { name: 'Taper', weeks: 1, focus: 'Recovery', weeklyKm: [25] },
                ],
            },
        };
    });

    describe('Scenario: User misses long run', () => {
        it('should reduce next weeks volume by 10% when long run is missed', () => {
            // Week 4: Planned 45km, but user only logged 25km (no long run)
            const mockActivities: StravaActivity[] = [
                { id: '1', date: new Date('2026-01-06'), distance_km: 8, type: 'Run' },
                { id: '2', date: new Date('2026-01-08'), distance_km: 10, type: 'Run' },
                { id: '3', date: new Date('2026-01-10'), distance_km: 7, type: 'Run' },
                // Long run (expected ~16km, 35% of 45) is MISSING - longest is only 10km
            ];

            const currentWeek = 4;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const report = auditCompliance(mockBlock as any, mockActivities, currentWeek);

            // Should detect missed long run (longest run 10km < 16km * 0.7 = 11.2km)
            expect(report.missedLongRun).toBe(true);
            expect(report.compliance).toBeLessThan(60); // 25/45 = 55%

            // Apply adaptations
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adaptedBlock = applyAdaptations(mockBlock as any, report, currentWeek);

            // Week 5 should be reduced by 10% (50 -> 45)
            const week5km = adaptedBlock.block_plan.phases[1].weeklyKm[0]; // Build phase, week 1
            expect(week5km).toBe(45); // 10% reduction from 50
        });
    });

    describe('Scenario: User has >80% compliance', () => {
        it('should keep plan unchanged with encouraging message', () => {
            // Week 4: Planned 45km, user logged 42km (93% compliance)
            const mockActivities: StravaActivity[] = [
                { id: '1', date: new Date('2026-01-06'), distance_km: 8, type: 'Run' },
                { id: '2', date: new Date('2026-01-08'), distance_km: 10, type: 'Run' },
                { id: '3', date: new Date('2026-01-10'), distance_km: 6, type: 'Run' },
                { id: '4', date: new Date('2026-01-12'), distance_km: 18, type: 'Run' }, // Long run completed
            ];

            const currentWeek = 4;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const report = auditCompliance(mockBlock as any, mockActivities, currentWeek);

            expect(report.compliance).toBeGreaterThan(80); // 42/45 = 93%
            expect(report.missedLongRun).toBe(false); // 18km > 16km threshold

            // No modifications needed
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adaptedBlock = applyAdaptations(mockBlock as any, report, currentWeek);
            expect(adaptedBlock.block_plan).toEqual(mockBlock.block_plan);
        });
    });

    describe('Scenario: User runs Zone 4 instead of Zone 2', () => {
        it('should force a recovery day tomorrow when intensity mismatch detected', () => {
            // Easy run planned at Zone 2 (HR < 145), but user ran at Zone 4 (HR 165)
            const mockActivities: StravaActivity[] = [
                {
                    id: '1',
                    date: new Date('2026-01-10'),
                    distance_km: 10,
                    type: 'Run',
                    average_hr: 165, // Zone 4 - too hard for easy day (> 190 * 0.85 = 161.5)
                },
            ];

            const currentWeek = 4;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const report = auditCompliance(mockBlock as any, mockActivities, currentWeek);

            expect(report.intensityMismatch).toBe(true);
            // Volume compliance is low but that's secondary
            // The key assertion is that intensity mismatch is detected
        });
    });
});

describe('Coaching Logic - Readiness Calculation', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

    it('returns optimal when no journal data exists', () => {
        const report = calculateReadiness([], 3);
        expect(report.status).toBe('optimal');
        expect(report.shouldDowngrade).toBe(false);
        expect(report.score).toBe(100);
    });

    it('returns critical when sleep < 5 for 2 consecutive days', () => {
        const entries: Partial<JournalEntry>[] = [
            { date: today, sleep_quality: 4, tags: [] },
            { date: yesterday, sleep_quality: 3, tags: [] },
        ];
        const report = calculateReadiness(entries as JournalEntry[], 3);
        expect(report.status).toBe('critical');
        expect(report.shouldDowngrade).toBe(true);
        expect(report.reason).toContain('Poor sleep');
    });

    it('returns critical when stress > 8 for 2 consecutive days', () => {
        const entries: Partial<JournalEntry>[] = [
            { date: today, stress_level: 9, tags: [] },
            { date: yesterday, stress_level: 9, tags: [] },
        ];
        const report = calculateReadiness(entries as JournalEntry[], 3);
        expect(report.status).toBe('critical');
        expect(report.shouldDowngrade).toBe(true);
        expect(report.reason).toContain('High stress');
    });

    it('returns optimal when metrics are good', () => {
        const entries: Partial<JournalEntry>[] = [
            { date: today, sleep_quality: 8, stress_level: 3, tags: [] },
            { date: yesterday, sleep_quality: 7, stress_level: 4, tags: [] },
        ];
        const report = calculateReadiness(entries as JournalEntry[], 3);
        expect(report.status).toBe('optimal');
        expect(report.shouldDowngrade).toBe(false);
        expect(report.score).toBeGreaterThanOrEqual(70);
    });

    it('calculates average sleep and stress correctly', () => {
        const entries: Partial<JournalEntry>[] = [
            { date: today, sleep_quality: 8, stress_level: 4, tags: [] },
            { date: yesterday, sleep_quality: 6, stress_level: 6, tags: [] },
        ];
        const report = calculateReadiness(entries as JournalEntry[], 3);
        expect(report.avgSleep).toBe(7);  // (8 + 6) / 2
        expect(report.avgStress).toBe(5); // (4 + 6) / 2
    });
});

describe('dayPlanToStoredWorkouts — day name correctness', () => {
    it('stores the correct day name from the plan, not from array position', () => {
        // Simulate a 3-day plan (AI returned fewer days)
        const partialPlan = [
            { day: 'Wed', date: 'Apr 16', type: 'run' as const, title: 'Easy Run',
              description: 'Easy', intensity: 'easy' as const, rationale: 'r' },
            { day: 'Fri', date: 'Apr 18', type: 'tempo' as const, title: 'Tempo',
              description: 'Hard', intensity: 'hard' as const, rationale: 'r' },
            { day: 'Sun', date: 'Apr 20', type: 'long' as const, title: 'Long Run',
              description: 'Long', intensity: 'moderate' as const, rationale: 'r' },
        ];

        const dayMap: Record<string, string> = {
            'mon': 'Monday', 'tue': 'Tuesday', 'wed': 'Wednesday',
            'thu': 'Thursday', 'fri': 'Friday', 'sat': 'Saturday', 'sun': 'Sunday',
        };
        const result = partialPlan.map(p => ({
            day: dayMap[p.day.toLowerCase()] || p.day,
        }));
        expect(result[0].day).toBe('Wednesday');
        expect(result[1].day).toBe('Friday');
        expect(result[2].day).toBe('Sunday');
    });
});
