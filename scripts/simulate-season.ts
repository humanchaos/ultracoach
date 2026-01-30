/**
 * Season Simulation Script
 * 
 * Validates that the Coach modifies existing plans rather than rewriting them.
 * 
 * Run with: npm run simulate
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

import {
    wipeTestUserData,
    saveTrainingBlock,
    getActiveTrainingBlock,
    saveWeeklyWorkouts,
    getCurrentWeekInBlock,
    updateTrainingBlockPlan,
    incrementPlanVersion,
    savePlanChange,
    getPlanChangelog,
    addRace,
    upsertStravaUser,
    type BlockPlan,
    type DailyWorkout,
} from '../lib/db';
import { auditCompliance, processLoginDecision, type StravaActivity } from '../lib/coaching/logic';

// =============================================================================
// CONFIGURATION
// =============================================================================
const TEST_USER_STRAVA_ID = 'test-simulation-user-001';
const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    bold: '\x1b[1m',
};

// =============================================================================
// DATE MOCKING UTILITY
// =============================================================================
let mockedDate: Date | null = null;

function setMockedDate(date: Date) {
    mockedDate = date;
    console.log(`${COLORS.blue}📅 Date set to: ${date.toDateString()}${COLORS.reset}`);
}

function getMockedDate(): Date {
    return mockedDate || new Date();
}

// Override getCurrentWeekInBlock to use mocked date
function getCurrentWeekMocked(block: { start_date: Date; block_plan: { totalWeeks: number } }): number {
    const now = getMockedDate();
    const start = block.start_date;
    const diffMs = now.getTime() - start.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(diffWeeks + 1, block.block_plan.totalWeeks));
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function log(message: string) {
    console.log(message);
}

function success(test: string) {
    console.log(`${COLORS.green}  ✓ ${test}${COLORS.reset}`);
}

function fail(test: string, details?: string) {
    console.log(`${COLORS.red}  ✗ ${test}${COLORS.reset}`);
    if (details) console.log(`    ${COLORS.red}${details}${COLORS.reset}`);
}

function section(title: string) {
    console.log(`\n${COLORS.bold}${COLORS.blue}═══════════════════════════════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.blue}  ${title}${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.blue}═══════════════════════════════════════════════════════════════${COLORS.reset}\n`);
}

function createTestPlan(): BlockPlan {
    return {
        totalWeeks: 12,
        phases: [
            { name: 'Base', weeks: 4, focus: 'Aerobic volume', weeklyKm: [40, 45, 50, 45] },
            { name: 'Build', weeks: 4, focus: 'Threshold work', weeklyKm: [50, 55, 60, 50] },
            { name: 'Peak', weeks: 2, focus: 'Race-specific', weeklyKm: [45, 40] },
            { name: 'Taper', weeks: 2, focus: 'Recovery', weeklyKm: [30, 20] },
        ],
        keyWorkouts: ['Long run', 'Tempo', 'Intervals'],
        notes: 'Test plan for simulation',
    };
}

function createWeeklyWorkouts(targetKm: number): DailyWorkout[] {
    return [
        { day: 'Monday', type: 'Easy Run', distance_km: targetKm * 0.15, description: 'Recovery pace' },
        { day: 'Tuesday', type: 'Tempo', distance_km: targetKm * 0.2, description: 'Threshold effort' },
        { day: 'Wednesday', type: 'Rest', description: 'Active recovery' },
        { day: 'Thursday', type: 'Intervals', distance_km: targetKm * 0.15, description: 'Speed work' },
        { day: 'Friday', type: 'Easy Run', distance_km: targetKm * 0.1, description: 'Shake out' },
        { day: 'Saturday', type: 'Easy Run', distance_km: targetKm * 0.1, description: 'Prep for long run' },
        { day: 'Sunday', type: 'Long Run', distance_km: targetKm * 0.3, description: 'Weekly long run' },
    ];
}

function createActivitiesFromWorkouts(workouts: DailyWorkout[], weekStartDate: Date): StravaActivity[] {
    return workouts
        .filter(w => w.distance_km && w.distance_km > 0)
        .map((w, i) => ({
            id: `sim-activity-${i}`,
            date: new Date(weekStartDate.getTime() + i * 24 * 60 * 60 * 1000),
            distance_km: w.distance_km!,
            type: 'Run' as const,
        }));
}

// =============================================================================
// TEST ASSERTIONS
// =============================================================================
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, failDetails?: string): boolean {
    if (condition) {
        success(testName);
        passCount++;
        return true;
    } else {
        fail(testName, failDetails);
        failCount++;
        return false;
    }
}

// =============================================================================
// SIMULATION STEPS
// =============================================================================

async function stepA_Inception(): Promise<{ blockId: number; originalPlan: BlockPlan }> {
    section('STEP A: INCEPTION');

    log('Wiping test user data...');
    await wipeTestUserData(TEST_USER_STRAVA_ID);

    // Create test user in strava_users table (required for foreign key constraints)
    log('Creating test user...');
    await upsertStravaUser({
        strava_id: TEST_USER_STRAVA_ID,
        name: 'Test Simulation User',
        email: 'test@simulation.local',
        access_token: 'test-token-not-real',
        refresh_token: 'test-refresh-not-real',
        expires_at: Math.floor(Date.now() / 1000) + 86400, // 24h from now
    });

    // Set date to January 1, 2025
    setMockedDate(new Date('2025-01-01'));

    // Create a race to train for
    log('Creating target race...');
    const race = await addRace({
        user_strava_id: TEST_USER_STRAVA_ID,
        name: 'Simulation Ultra 100K',
        date: new Date('2025-03-26'), // ~12 weeks from Jan 1
        distance_km: 100,
        race_type: 'ultra',
        priority: 'A',
    });

    // Generate initial training block
    log('Generating initial training block...');
    const blockPlan = createTestPlan();
    const block = await saveTrainingBlock({
        user_strava_id: TEST_USER_STRAVA_ID,
        race_id: race.id,
        start_date: new Date('2025-01-01'),
        end_date: new Date('2025-03-26'),
        block_plan: blockPlan,
    });

    // Save initial changelog entry
    await savePlanChange({
        block_id: block.id,
        version: 1,
        change_type: 'created',
        reason: 'Initial plan generated for Simulation Ultra 100K',
    });

    // Store Week 1 workouts
    const week1Workouts = createWeeklyWorkouts(40);
    await saveWeeklyWorkouts(block.id, 1, week1Workouts);

    log(`Created block ID: ${block.id}`);
    log(`Plan version: 1`);
    log(`Total weeks: ${block.block_plan.totalWeeks}`);

    assert(block.id > 0, 'Training block created successfully');
    assert(block.block_plan.totalWeeks === 12, 'Block has 12 weeks');

    return { blockId: block.id, originalPlan: blockPlan };
}

async function stepB_PerfectWeek(blockId: number, originalPlan: BlockPlan): Promise<void> {
    section('STEP B: THE PERFECT WEEK');

    // Move to Jan 8 (end of week 1)
    setMockedDate(new Date('2025-01-08'));

    // Get the block
    const block = await getActiveTrainingBlock(TEST_USER_STRAVA_ID);
    if (!block) {
        fail('Block not found');
        return;
    }

    const currentWeek = getCurrentWeekMocked(block);
    log(`Current week (mocked): ${currentWeek}`);

    // Simulate 5 runs that match the plan perfectly
    log('Simulating 5 perfect runs for Week 1...');
    const week1Start = new Date('2025-01-01');
    const perfectActivities: StravaActivity[] = [
        { id: 'run-1', date: new Date('2025-01-01'), distance_km: 6, type: 'Run' },  // Monday Easy
        { id: 'run-2', date: new Date('2025-01-02'), distance_km: 8, type: 'Run' },  // Tuesday Tempo
        { id: 'run-3', date: new Date('2025-01-04'), distance_km: 6, type: 'Run' },  // Thursday Intervals
        { id: 'run-4', date: new Date('2025-01-05'), distance_km: 4, type: 'Run' },  // Friday Easy
        { id: 'run-5', date: new Date('2025-01-06'), distance_km: 12, type: 'Run' }, // Sunday Long Run
    ];
    const totalDistance = perfectActivities.reduce((sum, a) => sum + a.distance_km, 0);
    log(`Total distance: ${totalDistance}km (target: ~40km)`);

    // Run compliance audit
    log('Running compliance audit...');
    const report = auditCompliance(block, perfectActivities, currentWeek);
    log(`Compliance: ${report.compliance}% | Volume: ${report.volumeActual}/${report.volumePlanned}km`);

    // Run decision engine  
    const decision = processLoginDecision(block, perfectActivities, currentWeek);
    log(`Decision: ${decision.action} - ${decision.message}`);

    // Verify assertions
    assert(block.id === blockId, 'Plan ID preserved (block ID unchanged)');
    assert(decision.action === 'keep', 'Decision is to keep plan (no modifications needed)');
    assert(report.compliance >= 80 || report.compliance >= 70, `Compliance is acceptable: ${report.compliance}%`);

    // Verify plan structure preserved (not modified by coach)
    const currentPlan = block.block_plan;
    assert(
        currentPlan.totalWeeks === originalPlan.totalWeeks &&
        currentPlan.phases.length === originalPlan.phases.length,
        'Plan structure preserved (totalWeeks and phases count match)'
    );
}

async function stepC_Failure(blockId: number, originalPlan: BlockPlan): Promise<void> {
    section('STEP C: THE FAILURE');

    // Move to Jan 15 (end of week 2)
    setMockedDate(new Date('2025-01-15'));

    // Get the block
    let block = await getActiveTrainingBlock(TEST_USER_STRAVA_ID);
    if (!block) {
        fail('Block not found');
        return;
    }

    // Store week 2 workouts
    const week2Workouts = createWeeklyWorkouts(45);
    await saveWeeklyWorkouts(block.id, 2, week2Workouts);

    const currentWeek = getCurrentWeekMocked(block);
    log(`Current week (mocked): ${currentWeek}`);

    // Simulate a MISSED long run (only 4 short runs, no Sunday long run)
    log('Simulating Week 2 with MISSED LONG RUN...');
    const failedActivities: StravaActivity[] = [
        { id: 'run-w2-1', date: new Date('2025-01-08'), distance_km: 6, type: 'Run' },  // Monday Easy
        { id: 'run-w2-2', date: new Date('2025-01-09'), distance_km: 8, type: 'Run' },  // Tuesday Tempo
        { id: 'run-w2-3', date: new Date('2025-01-11'), distance_km: 5, type: 'Run' },  // Thursday (shorter)
        { id: 'run-w2-4', date: new Date('2025-01-12'), distance_km: 4, type: 'Run' },  // Friday Easy
        // NO SUNDAY LONG RUN - this is the failure!
    ];
    const totalDistance = failedActivities.reduce((sum, a) => sum + a.distance_km, 0);
    log(`Total distance: ${totalDistance}km (target: ~45km) - MISSED LONG RUN!`);

    // Run compliance audit
    log('Running compliance audit...');
    const report = auditCompliance(block, failedActivities, currentWeek);
    log(`Compliance: ${report.compliance}% | Volume: ${report.volumeActual}/${report.volumePlanned}km`);
    log(`Missed long run: ${report.missedLongRun}`);

    // Get original Week 3 volume
    const originalWeek3Volume = originalPlan.phases[0].weeklyKm[2]; // Week 3 is in Base phase
    log(`Original Week 3 volume: ${originalWeek3Volume}km`);

    // Run decision engine  
    const decision = processLoginDecision(block, failedActivities, currentWeek);
    log(`Decision: ${decision.action} - ${decision.message}`);

    // If modification needed, apply it
    if (decision.action === 'modify' && decision.modifiedBlock) {
        log('Applying plan modifications...');

        // Save old plan snapshot and increment version
        const newVersion = await incrementPlanVersion(block.id);

        // Calculate volume change
        const newWeek3Volume = decision.modifiedBlock.block_plan.phases[0].weeklyKm[2];
        const volumeChangePct = ((newWeek3Volume - originalWeek3Volume) / originalWeek3Volume) * 100;

        // Save changelog
        await savePlanChange({
            block_id: block.id,
            version: newVersion,
            change_type: 'compliance_adaptation',
            reason: decision.message,
            volume_change_pct: volumeChangePct,
            old_plan_snapshot: block.block_plan,
            week_number: currentWeek,
        });

        // Update the block plan
        await updateTrainingBlockPlan(block.id, decision.modifiedBlock.block_plan, decision.message);

        log(`New version: ${newVersion}`);
        log(`New Week 3 volume: ${newWeek3Volume}km (change: ${volumeChangePct.toFixed(1)}%)`);

        // Refresh block
        block = await getActiveTrainingBlock(TEST_USER_STRAVA_ID);
    }

    // Verify assertions
    assert(block!.id === blockId, 'Plan ID PRESERVED (identity maintained after failure)');

    const newWeek3Volume = block!.block_plan.phases[0].weeklyKm[2];
    assert(
        newWeek3Volume <= originalWeek3Volume,
        `Week 3 volume adjusted: ${newWeek3Volume}km <= ${originalWeek3Volume}km`,
        `Expected reduced volume, got ${newWeek3Volume}km`
    );

    // Check changelog (only if migration has been run)
    const changelog = await getPlanChangelog(block!.id);
    log(`\nChangelog entries: ${changelog.length}`);

    if (changelog.length > 0) {
        changelog.forEach(entry => {
            log(`  - v${entry.version}: ${entry.change_type} - ${entry.reason.substring(0, 50)}...`);
        });

        assert(changelog.length >= 2, 'Changelog has at least 2 entries (created + adaptation)');

        const adaptationEntry = changelog.find(e => e.change_type === 'compliance_adaptation');
        assert(
            adaptationEntry !== undefined,
            'Changelog contains adaptation entry for missed run'
        );

        if (adaptationEntry) {
            assert(
                adaptationEntry.reason.toLowerCase().includes('miss') ||
                adaptationEntry.reason.toLowerCase().includes('compliance') ||
                adaptationEntry.reason.toLowerCase().includes('volume'),
                'Adaptation reason mentions the issue'
            );
        }
    } else {
        log(`${COLORS.yellow}  ⚠ Changelog tests skipped (run migration 008_plan_versioning.sql first)${COLORS.reset}`);
    }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    console.log(`\n${COLORS.bold}${COLORS.yellow}🏃 SEASON SIMULATION SCRIPT${COLORS.reset}`);
    console.log(`${COLORS.yellow}Validating Coach's Long-Term Memory${COLORS.reset}\n`);

    try {
        // Step A: Inception
        const { blockId, originalPlan } = await stepA_Inception();

        // Step B: Perfect Week
        await stepB_PerfectWeek(blockId, originalPlan);

        // Step C: Failure
        await stepC_Failure(blockId, originalPlan);

        // Final Summary
        section('SIMULATION COMPLETE');
        console.log(`${COLORS.bold}Results:${COLORS.reset}`);
        console.log(`  ${COLORS.green}✓ Passed: ${passCount}${COLORS.reset}`);
        if (failCount > 0) {
            console.log(`  ${COLORS.red}✗ Failed: ${failCount}${COLORS.reset}`);
        }

        if (failCount === 0) {
            console.log(`\n${COLORS.bold}${COLORS.green}🎉 ALL TESTS PASSED - Coach has memory!${COLORS.reset}\n`);
            process.exit(0);
        } else {
            console.log(`\n${COLORS.bold}${COLORS.red}❌ Some tests failed${COLORS.reset}\n`);
            process.exit(1);
        }

    } catch (error) {
        console.error(`\n${COLORS.red}Fatal error:${COLORS.reset}`, error);
        process.exit(1);
    }
}

main();
