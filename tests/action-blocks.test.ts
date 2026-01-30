/**
 * Action Block Parser Tests
 * TDD: Red phase - write failing tests first
 * 
 * Following strict TDD per agent behavior protocol:
 * 1. Write test (this file)
 * 2. Run test → must FAIL
 * 3. Implement code → test PASS
 */

import { describe, it, expect } from 'vitest';
import {
    parseActionBlocks,
    validateRaceAdd,
    validateRaceDelete,
    validateProfileUpdate,
    validateGoalSet,
    validateLifeLog,
    ActionBlock,
    RaceAddPayload,
    ProfileUpdatePayload,
    GoalSetPayload,
    LifeLogPayload,
} from '../lib/coaching/action-blocks';

describe('parseActionBlocks', () => {
    it('extracts a single RACE_ADD block', () => {
        const response = `I'll add that race to your calendar.

\`\`\`RACE_ADD
{
  "name": "Salzburg Marathon",
  "date": "2026-04-18",
  "distance_km": 42.2,
  "race_type": "marathon",
  "priority": "A"
}
\`\`\`

Good luck with training!`;

        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('RACE_ADD');
        expect(blocks[0].payload).toEqual({
            name: 'Salzburg Marathon',
            date: '2026-04-18',
            distance_km: 42.2,
            race_type: 'marathon',
            priority: 'A',
        });
    });

    it('extracts multiple blocks from one response', () => {
        const response = `Noted! I've updated your plan and saved this to memory.

\`\`\`PLAN_MODIFICATION
{
  "day": "Sunday",
  "updates": { "duration_min": 60 }
}
\`\`\`

\`\`\`MEMORY_SAVE
{
  "memory_type": "feeling",
  "content": "Feeling tired this week"
}
\`\`\``;

        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(2);
        expect(blocks[0].type).toBe('PLAN_MODIFICATION');
        expect(blocks[1].type).toBe('MEMORY_SAVE');
    });

    it('returns empty array when no blocks present', () => {
        const response = 'Just some regular coaching advice without any action blocks.';
        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(0);
    });

    it('ignores malformed JSON blocks', () => {
        const response = `Here's a broken block:

\`\`\`RACE_ADD
{ invalid json here }
\`\`\`

And a valid one:

\`\`\`GOAL_SET
{
  "goal_type": "get_faster"
}
\`\`\``;

        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('GOAL_SET');
    });

    it('extracts PROFILE_UPDATE block', () => {
        const response = `I've noted your weight change.

\`\`\`PROFILE_UPDATE
{
  "weight_kg": 78
}
\`\`\``;

        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('PROFILE_UPDATE');
        expect(blocks[0].payload).toEqual({ weight_kg: 78 });
    });

    it('extracts RACE_DELETE block', () => {
        const response = `I've removed that race.

\`\`\`RACE_DELETE
{
  "race_id": 123,
  "confirmed": true
}
\`\`\``;

        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('RACE_DELETE');
    });

    it('extracts LIFE_LOG block', () => {
        const response = `I've noted your wellness data.

\`\`\`LIFE_LOG
{
  "sleep_quality": 4,
  "stress_level": 7
}
\`\`\``;

        const blocks = parseActionBlocks(response);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('LIFE_LOG');
        expect(blocks[0].payload).toEqual({
            sleep_quality: 4,
            stress_level: 7,
        });
    });
});

describe('validateRaceAdd', () => {
    it('accepts valid race payload', () => {
        const payload = {
            name: 'Salzburg Marathon',
            date: '2026-04-18',
            distance_km: 42.2,
            race_type: 'marathon',
            priority: 'A',
        };
        const result = validateRaceAdd(payload);
        expect(result).not.toBeNull();
        expect(result?.name).toBe('Salzburg Marathon');
    });

    it('rejects payload missing required fields', () => {
        const payload = {
            name: 'Salzburg Marathon',
            // missing date, distance_km, race_type
        };
        const result = validateRaceAdd(payload);
        expect(result).toBeNull();
    });

    it('rejects invalid race_type', () => {
        const payload = {
            name: 'Fun Run',
            date: '2026-05-01',
            distance_km: 5,
            race_type: 'invalid_type',
        };
        const result = validateRaceAdd(payload);
        expect(result).toBeNull();
    });

    it('rejects invalid priority', () => {
        const payload = {
            name: 'Fun Run',
            date: '2026-05-01',
            distance_km: 5,
            race_type: '5k',
            priority: 'X', // invalid
        };
        const result = validateRaceAdd(payload);
        expect(result).toBeNull();
    });

    it('accepts payload with optional goal_time', () => {
        const payload = {
            name: 'Marathon',
            date: '2026-04-18',
            distance_km: 42.2,
            race_type: 'marathon',
            goal_time: '3:30:00',
        };
        const result = validateRaceAdd(payload);
        expect(result).not.toBeNull();
        expect(result?.goal_time).toBe('3:30:00');
    });
});

describe('validateRaceDelete', () => {
    it('accepts delete with confirmation', () => {
        const payload = { race_id: 123, confirmed: true };
        const result = validateRaceDelete(payload);
        expect(result).not.toBeNull();
        expect(result?.race_id).toBe(123);
    });

    it('rejects delete without confirmation', () => {
        const payload = { race_id: 123, confirmed: false };
        const result = validateRaceDelete(payload);
        expect(result).toBeNull();
    });

    it('rejects delete missing race_id', () => {
        const payload = { confirmed: true };
        const result = validateRaceDelete(payload);
        expect(result).toBeNull();
    });
});

describe('validateProfileUpdate', () => {
    it('accepts valid weight update', () => {
        const payload = { weight_kg: 78 };
        const result = validateProfileUpdate(payload);
        expect(result).not.toBeNull();
        expect(result?.weight_kg).toBe(78);
    });

    it('rejects empty update', () => {
        const payload = {};
        const result = validateProfileUpdate(payload);
        expect(result).toBeNull();
    });

    it('rejects invalid weight (negative)', () => {
        const payload = { weight_kg: -10 };
        const result = validateProfileUpdate(payload);
        expect(result).toBeNull();
    });

    it('rejects invalid weight (too high)', () => {
        const payload = { weight_kg: 500 };
        const result = validateProfileUpdate(payload);
        expect(result).toBeNull();
    });
});

describe('validateGoalSet', () => {
    it('accepts valid goal_type', () => {
        const payload = { goal_type: 'get_faster' };
        const result = validateGoalSet(payload);
        expect(result).not.toBeNull();
        expect(result?.goal_type).toBe('get_faster');
    });

    it('rejects invalid goal_type', () => {
        const payload = { goal_type: 'invalid_goal' };
        const result = validateGoalSet(payload);
        expect(result).toBeNull();
    });

    it('accepts goal with running_experience', () => {
        const payload = {
            goal_type: 'competition',
            running_experience: 'advanced',
        };
        const result = validateGoalSet(payload);
        expect(result).not.toBeNull();
        expect(result?.running_experience).toBe('advanced');
    });

    it('rejects invalid running_experience', () => {
        const payload = {
            goal_type: 'competition',
            running_experience: 'pro', // invalid
        };
        const result = validateGoalSet(payload);
        expect(result).toBeNull();
    });
});

describe('validateLifeLog', () => {
    it('accepts valid sleep score', () => {
        const payload = { sleep_quality: 7 };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.sleep_quality).toBe(7);
    });

    it('accepts multiple metrics', () => {
        const payload = {
            sleep_quality: 4,
            stress_level: 8,
            nutrition_score: 6,
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.sleep_quality).toBe(4);
        expect(result?.stress_level).toBe(8);
        expect(result?.nutrition_score).toBe(6);
    });

    it('rejects score below 1', () => {
        const payload = { sleep_quality: 0 };
        const result = validateLifeLog(payload);
        expect(result).toBeNull();
    });

    it('rejects score above 10', () => {
        const payload = { stress_level: 11 };
        const result = validateLifeLog(payload);
        expect(result).toBeNull();
    });

    it('rejects non-integer scores', () => {
        const payload = { sleep_quality: 7.5 };
        const result = validateLifeLog(payload);
        expect(result).toBeNull();
    });

    it('rejects empty payload', () => {
        const payload = {};
        const result = validateLifeLog(payload);
        expect(result).toBeNull();
    });

    it('accepts tags array', () => {
        const payload = {
            sleep_quality: 3,
            tags: ['alcohol', 'travel'],
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.tags).toEqual(['alcohol', 'travel']);
    });

    it('accepts notes', () => {
        const payload = {
            stress_level: 9,
            notes: 'Big deadline at work',
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.notes).toBe('Big deadline at work');
    });

    // New flexible logging tests
    it('accepts notes-only payload (no numeric metrics)', () => {
        const payload = {
            notes: 'Rough day at work, feeling drained',
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.notes).toBe('Rough day at work, feeling drained');
    });

    it('accepts tags with notes but no metrics', () => {
        const payload = {
            notes: 'Traveling for business',
            tags: ['travel', 'work_stress'],
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.tags).toEqual(['travel', 'work_stress']);
    });

    it('accepts custom_data only', () => {
        const payload = {
            custom_data: {
                event: 'project_deadline',
                mood: 'anxious',
            },
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.custom_data).toEqual({
            event: 'project_deadline',
            mood: 'anxious',
        });
    });

    it('accepts hrv_status without other metrics', () => {
        const payload = {
            hrv_status: 'low',
            notes: 'HRV reading from Whoop',
        };
        const result = validateLifeLog(payload);
        expect(result).not.toBeNull();
        expect(result?.hrv_status).toBe('low');
    });

    it('rejects invalid hrv_status', () => {
        const payload = {
            hrv_status: 'medium', // invalid
        };
        const result = validateLifeLog(payload);
        expect(result).toBeNull();
    });
});
