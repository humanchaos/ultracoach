# UltraCoach Training Plan Architecture

## Executive Summary

UltraCoach uses a **two-tier periodization architecture** that combines long-term planning stability with week-to-week adaptability. This document describes how training plans are created, stored, and modified.

---

## 1. Two-Tier System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TRAINING BLOCK (Macrocycle)                          │
│            Stored in: training_blocks table                             │
│            Lifecycle: Created ONCE per race, immutable until reset      │
│                                                                         │
│    ┌──────────────────────────────────────────────────────────────┐     │
│    │  block_plan (JSONB):                                         │     │
│    │  • totalWeeks: 10                                            │     │
│    │  • weeklyTargets: [45km, 50km, 55km, 50km, ...]             │     │
│    │  • phases: [{name: "Base", weeks: [1,2,3]}, ...]            │     │
│    │  • taperStart: week 9                                        │     │
│    │  • keyWorkouts: ["Long Run", "Tempo", "Intervals"]          │     │
│    └──────────────────────────────────────────────────────────────┘     │
│                                                                         │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│    │ Week 1  │ │ Week 2  │ │ Week 3  │ │ Week 4  │ │  ...    │         │
│    │workouts │ │workouts │ │workouts │ │workouts │ │         │         │
│    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│         │           │           │           │                           │
│         └───────────┴───────────┴───────────┴──────────────────────────┤
│                    WEEKLY WORKOUTS (Microcycle)                         │
│                    Stored in: weekly_workouts table                     │
│                    Lifecycle: Generated when week accessed, then stored │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Training Block (Macrocycle)

### 2.1 Creation Trigger
A training block is created when:
1. User adds an "A-priority" race via the race calendar
2. User explicitly clicks "Generate Training Block" 

### 2.2 Generation Process
```
User adds race → API: /api/training-block/generate → AI generates plan → Stored in DB
```

The AI receives:
- Race date, distance, goal time
- Athlete profile (age, weight, max HR)
- Recent training history (last 30 days of activities)
- Current fitness signals (weekly volume, intensity distribution)

### 2.3 Storage Schema
```sql
CREATE TABLE training_blocks (
    id SERIAL PRIMARY KEY,
    user_strava_id VARCHAR(50) NOT NULL,
    race_id INTEGER REFERENCES races(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    block_plan JSONB NOT NULL,  -- Contains all weekly targets
    status VARCHAR(20) DEFAULT 'active',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 Immutability Policy
- Training blocks are **not automatically modified** once created
- Modifications require explicit user action ("Reset Training Block")
- Version number increments on any change for audit trail

---

## 3. Weekly Workouts (Microcycle)

### 3.1 Generation Logic
When the dashboard loads a week's training plan:

```typescript
// Pseudocode from /api/training-plan/route.ts
async function getWeeklyPlan(blockId, weekNumber) {
    // STEP 1: Check for stored workouts
    const stored = await getStoredWeeklyWorkouts(blockId, weekNumber);
    
    if (stored && stored.length > 0) {
        return { workouts: stored, fromStorage: true };  // ← STABLE
    }
    
    // STEP 2: Generate fresh workouts (only if not stored)
    const fresh = await generateWithAI(blockId, weekNumber);
    
    // STEP 3: Save to database for future stability
    await saveWeeklyWorkouts(blockId, weekNumber, fresh);
    
    return { workouts: fresh, fromStorage: false };
}
```

### 3.2 Storage Schema
```sql
CREATE TABLE weekly_workouts (
    id SERIAL PRIMARY KEY,
    block_id INTEGER REFERENCES training_blocks(id),
    week_number INTEGER NOT NULL,
    workouts JSONB NOT NULL,  -- Array of 7 daily workouts
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(block_id, week_number)  -- One entry per week per block
);
```

### 3.3 Workout Structure
Each daily workout contains:
```json
{
    "day": "Wednesday",
    "type": "Tempo Run",
    "distance_km": 12,
    "duration_min": 70,
    "description": "15 min warmup, 40 min at threshold, 15 min cooldown",
    "intensity": "moderate",
    "hrZone": "Zone 4: 160-170 bpm",
    "targetPace": "5:15-5:30/km",
    "effortLevel": "Comfortably hard - can speak in short phrases",
    "rationale": "Build lactate threshold for race demands",
    "modification": null  // Populated by bio-feedback if adjusted
}
```

---

## 4. Data Flow Diagram

```
                    ┌─────────────────────┐
                    │   User adds race    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Generate Training  │
                    │   Block (AI call)   │
                    └──────────┬──────────┘
                               │
                               ▼
            ┌──────────────────────────────────────┐
            │    training_blocks table             │
            │    (Macrocycle stored once)          │
            └──────────────────┬───────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
   Week 1 request        Week 2 request        Week N request
        │                      │                      │
        ▼                      ▼                      ▼
   ┌─────────┐           ┌─────────┐           ┌─────────┐
   │ Stored? │           │ Stored? │           │ Stored? │
   └────┬────┘           └────┬────┘           └────┬────┘
    Yes │ No              Yes │ No              Yes │ No
        │                      │                      │
   ┌────┴────┐           ┌────┴────┐           ┌────┴────┐
   │  Use    │           │ Generate│           │ Generate│
   │ stored  │           │  + save │           │  + save │
   └─────────┘           └─────────┘           └─────────┘
```

---

## 5. Stability Mechanisms

### 5.1 What Keeps Plans Stable

| Mechanism | Description |
|-----------|-------------|
| **Storage-first retrieval** | Always checks `weekly_workouts` before generating |
| **Block immutability** | Training blocks don't change unless explicitly reset |
| **No auto-regeneration** | Dashboard refresh uses stored data, not fresh AI calls |
| **Version tracking** | `training_blocks.version` increments on any modification |

### 5.2 What Can Cause Plan Changes

| Trigger | Effect |
|---------|--------|
| **New week starts** | Fresh generation for new week (expected behavior) |
| **User clicks "Reset Block"** | Entire block regenerated, all weekly workouts cleared |
| **User clicks "Add Targets"** | Only adds HR/pace to existing workouts (structure preserved) |
| **Bio-feedback modification** | Specific workout updated with `modification` field |
| **Race deleted and re-added** | New block created with new ID → new weekly workouts |

### 5.3 Bio-Feedback Modifications (Holistic Coach)

When wellness data indicates recovery issues:
```typescript
// From /lib/coaching/logic.ts
function calculateReadiness(sleepQuality, stressLevel) {
    if (sleepQuality <= 3 || stressLevel >= 8) {
        return { status: 'compromised', recommendation: 'reduce_intensity' };
    }
    // ...
}
```

Modified workouts are saved with:
```json
{
    "type": "Easy Recovery Run",  // ← Changed from "Tempo Run"
    "modification": {
        "reason": "Poor sleep (3/10) detected",
        "original": "Tempo Run - 12km"
    }
}
```

---

## 6. Week Number Calculation

The current week is calculated relative to block start date:

```typescript
// From /lib/db.ts
function getCurrentWeekInBlock(block) {
    const now = new Date();
    const start = new Date(block.start_date);
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}
```

**Edge case handling:**
- If `currentWeek > totalWeeks`: Returns `totalWeeks` (race week)
- If `currentWeek < 1`: Returns `1`

---

## 7. API Endpoints Reference

| Endpoint | Purpose |
|----------|---------|
| `POST /api/training-block/generate` | Create new training block for race |
| `POST /api/training-plan` | Get weekly workouts (retrieves stored or generates) |
| `POST /api/training-block/reset` | Delete block and regenerate |
| `GET /api/training-block/changelog` | View block version history |
| `POST /api/journal` | Log wellness data (affects future modifications) |

---

## 8. Current Limitations

1. **No automatic realignment**: If block parameters change, stored weekly workouts don't auto-update
2. **Week-level granularity**: Cannot modify individual days without affecting storage
3. **Single active block**: Only one training block active per user at a time

---

## 9. Recommended Audit Queries

```sql
-- View current training block
SELECT id, race_id, start_date, end_date, version, 
       block_plan->'totalWeeks' as total_weeks,
       block_plan->'weeklyTargets' as weekly_targets
FROM training_blocks 
WHERE user_strava_id = 'YOUR_STRAVA_ID' AND status = 'active';

-- View stored workouts for current week
SELECT week_number, workouts, created_at, updated_at
FROM weekly_workouts
WHERE block_id = YOUR_BLOCK_ID
ORDER BY week_number;

-- Check for modifications
SELECT week_number, 
       jsonb_array_elements(workouts)->'modification' as modifications
FROM weekly_workouts
WHERE block_id = YOUR_BLOCK_ID
  AND workouts @> '[{"modification": {}}]';
```

---

## 10. Summary

The UltraCoach training system prioritizes **stability through storage**:

1. **Macrocycle** (Training Block): Generated once, immutable, governs weekly volume targets
2. **Microcycle** (Weekly Workouts): Generated on first access, stored for subsequent retrievals
3. **Modifications**: Tracked with reason, never silently overwritten
4. **Versioning**: All block changes increment version number for audit

The system errs on the side of **plan consistency** — once a workout is stored, it stays unless explicitly changed by user action or bio-feedback intervention.
