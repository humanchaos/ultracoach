/**
 * Coaching Feature Flags
 * 
 * Control rollout of v1.2 dynamic coaching architecture.
 * Set these via environment variables or code for gradual migration.
 */

export const COACHING_FLAGS = {
    /**
     * Use new budget-based training blocks (v1.2)
     * - false: Use existing day-specific block-generator.ts
     * - true: Use new budget-based block-generator-v2.ts
     */
    USE_BUDGET_BLOCKS: process.env.COACHING_USE_BUDGET_BLOCKS === 'true',

    /**
     * Enable daily prescription engine
     * - false: Use static weekly workout calendar
     * - true: Generate workouts dynamically via /api/daily-prescription
     */
    USE_DAILY_PRESCRIPTION: process.env.COACHING_USE_DAILY_PRESCRIPTION === 'true',

    /**
     * Show new budget UI components
     * - false: Show traditional calendar view
     * - true: Show budget progress cards + today's prescription
     */
    USE_BUDGET_UI: process.env.COACHING_USE_BUDGET_UI === 'true',
} as const;

/**
 * Check if all v1.2 features are enabled (full rollout)
 */
export function isV12FullyEnabled(): boolean {
    return (
        COACHING_FLAGS.USE_BUDGET_BLOCKS &&
        COACHING_FLAGS.USE_DAILY_PRESCRIPTION &&
        COACHING_FLAGS.USE_BUDGET_UI
    );
}

/**
 * Get current architecture version string
 */
export function getArchitectureVersion(): string {
    if (isV12FullyEnabled()) return 'v1.2 (budget-based)';
    if (COACHING_FLAGS.USE_DAILY_PRESCRIPTION) return 'v1.1 (hybrid)';
    return 'v1.0 (day-specific)';
}
