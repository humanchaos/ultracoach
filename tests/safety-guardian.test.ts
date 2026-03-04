/**
 * Safety Guardian v2 Tests - SessionContext + Granular Response
 * 
 * Tests:
 * 1. SessionContext building
 * 2. Metric extraction (ACWR, events, filtering)
 * 3. Safety scenarios (Kilometer-Schocker, Wettkampf-Ignoranz, Stumme Erschöpfung)
 * 4. Formatting (feedback, disclaimer, recovery week)
 * 5. generateFinalPlan orchestration
 */

import { describe, it, expect, vi } from 'vitest';
import {
    extractStravaMetrics,
    buildSessionContext,
    generateFinalPlan,
    formatGuardianFeedback,
    formatSafetyDisclaimer,
    type StravaMetrics,
    type SafetyCheckResult,
    type SessionContext,
} from '../lib/coaching/safety-guardian';

// ============================================
// SESSION CONTEXT TESTS
// ============================================

describe('buildSessionContext', () => {
    const now = new Date();

    it('should create a SessionContext with all fields populated', () => {
        const activities = [
            { date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), distance_km: 10, name: 'Run 1' },
            { date: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), distance_km: 15, name: 'Run 2' },
        ];

        const ctx = buildSessionContext(activities, {
            userStravaId: '12345',
            restingHrTrend: '+8bpm',
            sleepScore: 'Fair',
            nextRace: { name: 'UTMB', date: new Date('2026-08-28'), distance_km: 171 },
            trainingPhase: 'BUILD',
            weeklyVolumeTarget_km: 80,
        });

        expect(ctx.userStravaId).toBe('12345');
        expect(ctx.biometrics.restingHrTrend).toBe('+8bpm');
        expect(ctx.biometrics.sleepScore).toBe('Fair');
        expect(ctx.goals.nextRace?.name).toBe('UTMB');
        expect(ctx.goals.trainingPhase).toBe('BUILD');
        expect(ctx.goals.weeklyVolumeTarget_km).toBe(80);
        expect(ctx.stravaMetrics.avgWeeklyDistanceLast4Weeks).toBeGreaterThan(0);
        expect(ctx.createdAt).toBeInstanceOf(Date);
    });

    it('should work with minimal data', () => {
        const ctx = buildSessionContext([]);

        expect(ctx.userStravaId).toBe('unknown');
        expect(ctx.stravaMetrics.avgWeeklyDistanceLast4Weeks).toBe(0);
        expect(ctx.biometrics.restingHrTrend).toBeUndefined();
        expect(ctx.goals.nextRace).toBeUndefined();
    });
});

// ============================================
// METRIC EXTRACTION TESTS
// ============================================

describe('extractStravaMetrics', () => {
    const now = new Date();

    it('should calculate 4-week average and ACWR', () => {
        const activities = [
            { date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), distance_km: 10, name: 'Run 1' },
            { date: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), distance_km: 15, name: 'Run 2' },
            { date: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000), distance_km: 12, name: 'Run 3' },
            { date: new Date(now.getTime() - 22 * 24 * 60 * 60 * 1000), distance_km: 8, name: 'Run 4' },
        ];

        const metrics = extractStravaMetrics(activities);

        // Total: 45km over 4 weeks = 11.25km/week avg
        expect(metrics.avgWeeklyDistanceLast4Weeks).toBeCloseTo(11.3, 1);
        // This week: 10km, avg: 11.25km → ACWR ≈ 0.89
        expect(metrics.acwr).toBeDefined();
        expect(metrics.thisWeekDistance).toBe(10);
    });

    it('should identify major effort (>40km)', () => {
        const activities = [
            { date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), distance_km: 55, name: '50km Ultra' },
            { date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), distance_km: 10, name: 'Easy run' },
        ];

        const metrics = extractStravaMetrics(activities);

        expect(metrics.lastEvent).toBeDefined();
        expect(metrics.lastEvent?.name).toBe('50km Ultra');
        expect(metrics.lastEvent?.distance_km).toBe(55);
        expect(metrics.daysSinceLastEvent).toBe(5);
    });

    it('should filter only running activities', () => {
        const activities = [
            { date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), distance_km: 10, name: 'Run', type: 'Run' },
            { date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), distance_km: 50, name: 'Bike', type: 'Ride' },
        ];

        const metrics = extractStravaMetrics(activities);

        // Only the 10km run should count
        expect(metrics.avgWeeklyDistanceLast4Weeks).toBeCloseTo(2.5, 1);
    });
});

// ============================================
// SCENARIO TESTS
// ============================================

describe('Safety Guardian Scenarios', () => {
    describe('Scenario 1: Kilometer-Schocker (ACWR Violation)', () => {
        it('should create metrics that show dangerous ACWR', () => {
            const now = new Date();
            const activities = [
                { date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), distance_km: 40, name: 'Week 1' },
                { date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), distance_km: 40, name: 'Week 2' },
                { date: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000), distance_km: 40, name: 'Week 3' },
                { date: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000), distance_km: 40, name: 'Week 4' },
            ];

            const metrics = extractStravaMetrics(activities);
            expect(metrics.avgWeeklyDistanceLast4Weeks).toBe(40);

            // Simulated: 75km proposed = 87.5% increase → ACWR >> 1.5
            const testMetrics: StravaMetrics = {
                ...metrics,
                proposedWeeklyDistance: 75,
            };

            const increase = ((testMetrics.proposedWeeklyDistance! - testMetrics.avgWeeklyDistanceLast4Weeks)
                / testMetrics.avgWeeklyDistanceLast4Weeks) * 100;
            expect(increase).toBeGreaterThan(10);
        });
    });

    describe('Scenario 2: Wettkampf-Ignoranz (Post-Race Recovery)', () => {
        it('should detect recent ultra event with daysSince', () => {
            const now = new Date();
            const activities = [
                { date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), distance_km: 50, name: '50km Ultra Marathon' },
                { date: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), distance_km: 10, name: 'Easy run' },
            ];

            const metrics = extractStravaMetrics(activities);
            expect(metrics.lastEvent?.name).toBe('50km Ultra Marathon');
            expect(metrics.daysSinceLastEvent).toBe(2);
        });
    });

    describe('Scenario 3: Stumme Erschöpfung (Overtraining Signals)', () => {
        it('should surface biometric signals in SessionContext', () => {
            const ctx = buildSessionContext(
                [{ date: new Date(), distance_km: 15, name: 'Run' }],
                { restingHrTrend: '+12bpm', sleepScore: 'Poor' }
            );

            expect(ctx.biometrics.restingHrTrend).toBe('+12bpm');
            expect(ctx.biometrics.sleepScore).toBe('Poor');
        });
    });
});

// ============================================
// FORMATTING TESTS
// ============================================

describe('formatGuardianFeedback', () => {
    it('should return empty string for safe results', () => {
        const result: SafetyCheckResult = {
            isSafe: true,
            riskLevel: 'low',
            flaggedSessions: [],
            overallCritique: '',
            adjustmentDirectives: '',
        };

        expect(formatGuardianFeedback(result)).toBe('');
    });

    it('should format unsafe results with riskLevel and flaggedSessions', () => {
        const result: SafetyCheckResult = {
            isSafe: false,
            riskLevel: 'high',
            flaggedSessions: [
                { day: 'Dienstag', reason: 'Intervalle 2 Tage nach Ultra', maxAllowed: 'Zone 1, max 5km' },
                { day: 'Donnerstag', reason: 'Tempo-Run zu früh', maxAllowed: 'Ruhetag' },
            ],
            overallCritique: 'Zu schnelle Rückkehr nach Ultra-Event.',
            adjustmentDirectives: 'Erste Woche nur Zone 1, max 30min.',
        };

        const formatted = formatGuardianFeedback(result);

        expect(formatted).toContain('[SAFETY_OVERRIDE]');
        expect(formatted).toContain('HIGH');
        expect(formatted).toContain('Dienstag');
        expect(formatted).toContain('Zone 1, max 5km');
        expect(formatted).toContain('Zu schnelle Rückkehr');
        expect(formatted).toContain('Safety-First-Modus');
    });
});

describe('formatSafetyDisclaimer', () => {
    it('should return German disclaimer text', () => {
        const disclaimer = formatSafetyDisclaimer();
        expect(disclaimer).toContain('⚠️');
        expect(disclaimer).toContain('Sicherheitscheck');
    });
});

// ============================================
// ORCHESTRATION TESTS
// ============================================

describe('generateFinalPlan', () => {
    it('should return immediately when plan is safe', async () => {
        // Mock: Override fetch for this test
        const originalFetch = global.fetch;
        global.fetch = vi.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                isSafe: true,
                                riskLevel: 'low',
                                flaggedSessions: [],
                                overallCritique: '',
                                adjustmentDirectives: '',
                            }),
                        }],
                    },
                }],
            }),
        });

        const ctx = buildSessionContext([]);
        const result = await generateFinalPlan(
            'Safe plan draft',
            ctx,
            'test-api-key',
            async () => 'regenerated',
        );

        expect(result.finalPlan).toBe('Safe plan draft');
        expect(result.safetyResult.isSafe).toBe(true);
        expect(result.safetyResult.riskLevel).toBe('low');
        expect(result.iterations).toBe(1);
        expect(result.wasRecoveryWeek).toBe(false);

        global.fetch = originalFetch;
    });

    it('should deploy recovery week for persistent high risk', async () => {
        const originalFetch = global.fetch;
        const unsafeResponse = {
            ok: true,
            json: async () => ({
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                isSafe: false,
                                riskLevel: 'high',
                                flaggedSessions: [{ day: 'Montag', reason: 'ACWR > 1.8', maxAllowed: 'Ruhetag' }],
                                overallCritique: 'Extreme Überlastung',
                                adjustmentDirectives: 'Sofort reduzieren',
                            }),
                        }],
                    },
                }],
            }),
        };

        // Both iterations return high risk
        global.fetch = vi.fn()
            .mockResolvedValueOnce(unsafeResponse)
            .mockResolvedValueOnce(unsafeResponse);

        const ctx = buildSessionContext([]);
        const regenerateFn = vi.fn().mockResolvedValue('Revised but still bad plan');

        const result = await generateFinalPlan(
            'Dangerous plan',
            ctx,
            'test-api-key',
            regenerateFn,
        );

        expect(result.wasRecoveryWeek).toBe(true);
        expect(result.finalPlan).toContain('Recovery-Protokoll');
        expect(result.safetyResult.riskLevel).toBe('high');
        expect(result.iterations).toBe(2);
        expect(regenerateFn).toHaveBeenCalledTimes(1);

        global.fetch = originalFetch;
    });
});
