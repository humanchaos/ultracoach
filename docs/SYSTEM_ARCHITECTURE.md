# UltraCoach Complete System Architecture

## Overview

UltraCoach is an AI-powered endurance running coach that integrates with Strava to provide personalized, periodized training plans. The system uses a two-tier training architecture with three integrity layers to ensure safe, effective training.

---

## System Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15 (App Router), React, TailwindCSS |
| **Backend** | Next.js API Routes, Vercel Serverless |
| **Database** | Vercel Postgres |
| **AI Engine** | Google Gemini 2.0 Flash |
| **Authentication** | NextAuth.js + Strava OAuth |
| **Deployment** | Vercel (myultracoach.vercel.app) |

---

## Core Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UltraCoach                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌───────────────┐     ┌──────────────────┐     ┌─────────────────────┐   │
│   │  Strava API   │────▶│  Activity Sync   │────▶│  Vercel Postgres    │   │
│   │  (OAuth 2.0)  │     │  /api/sync       │     │  (Source of Truth)  │   │
│   └───────────────┘     └──────────────────┘     └──────────┬──────────┘   │
│                                                              │              │
│   ┌───────────────────────────────────────────────────────────┘              │
│   │                                                                         │
│   ▼                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    COACHING INTELLIGENCE                            │   │
│   │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │   │
│   │  │Race Calendar│  │Training Block│  │    Weekly Plan Generation   │ │   │
│   │  │  (Goals)    │──│ (Macrocycle) │──│       (Microcycle)          │ │   │
│   │  └─────────────┘  └──────────────┘  └─────────────────────────────┘ │   │
│   │                           │                      │                   │   │
│   │  ┌────────────────────────┴──────────────────────┴─────────────────┐ │   │
│   │  │              ARCHITECTURAL INTEGRITY LAYERS                     │ │   │
│   │  │  Layer 1: Context Injection (Volume Constraints)                │ │   │
│   │  │  Layer 2: Math Validation (Scalar Correction)                   │ │   │
│   │  │  Layer 3: Drift Detection (Compromised Flag)                    │ │   │
│   │  └─────────────────────────────────────────────────────────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    HOLISTIC COACHING (Life Context)                 │   │
│   │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │   │
│   │  │ user_journal│  │LIFE_LOG Block│  │  Bio-Feedback Modifications │ │   │
│   │  │(sleep/HRV/..)│  │ (AI Extract) │  │  (Downgrade intensity)      │ │   │
│   │  └─────────────┘  └──────────────┘  └─────────────────────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         CHAT INTERFACE                              │   │
│   │  AI Coach (Gemini 2.0 Flash) ←→ Action Blocks (MODIFY_PLAN, etc.)  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Training Plan Architecture

### Tier 1: Training Block (Macrocycle)

**Purpose:** Long-term periodized structure for race preparation  
**Lifecycle:** Created once per race, stored immutably  
**Storage:** `training_blocks` table

```typescript
interface TrainingBlock {
  id: number;
  user_strava_id: string;
  race_id: number;
  start_date: Date;
  end_date: Date;           // Race day
  block_plan: BlockPlan;    // The macro structure
  status: 'active' | 'completed' | 'abandoned' | 'compromised';
}

interface BlockPlan {
  totalWeeks: number;       // e.g., 10
  phases: TrainingPhase[];  // Base, Build, Peak, Taper
  keyWorkouts: string[];    // ["Long Run", "Tempo", "Intervals"]
  notes: string;            // AI-generated philosophy
}

interface TrainingPhase {
  name: string;      // "Base", "Build", "Peak", "Taper"
  weeks: number;     // Duration
  focus: string;     // "Aerobic volume", "Threshold work"
  weeklyKm: number[];// Target km per week [45, 50, 55, 50]
}
```

---

### Tier 2: Weekly Workouts (Microcycle)

**Purpose:** Specific daily workout prescriptions  
**Lifecycle:** Generated on first weekly access, then stored  
**Storage:** `weekly_workouts` table

```typescript
interface DailyWorkout {
  day: string;           // "Monday"
  type: string;          // "Easy Run", "Tempo", "Long Run"
  distance_km?: number;
  duration_min?: number;
  description?: string;
  hrZone?: string;       // "Zone 2: 130-145 bpm"
  targetPace?: string;   // "6:30-7:00/km"
  effortLevel?: string;  // "Conversational"
  rationale?: string;
  modification?: WorkoutModification;  // Bio-feedback adjustment
}
```

---

## Architectural Integrity Layers

### Layer 1: Context Injection

**Problem:** AI generates weeks without knowing macro constraints  
**Solution:** Inject strict volume targets into AI prompt

```typescript
// Before AI call:
weekTargets = getBlockTargetsForWeek(block, currentWeek);
volumeConstraints = formatTargetsAsConstraints(weekTargets);

// Injected into prompt:
// "CONSTRAINT 1: Total volume MUST be 50km (±10%)"
// "CONSTRAINT 2: This is Week 5 of 10 — Build phase"
// "CONSTRAINT 3: Must include: Long Run, Tempo, Intervals"
```

---

### Layer 2: Math Validation

**Problem:** LLMs are bad at arithmetic — may output wrong totals  
**Solution:** Validate generated volume, apply scalar correction if needed

```typescript
const validation = validateWeeklyVolume(workouts, targetVolume, tolerance);

if (!validation.isValid) {
    // Apply scalar multiplier to resize all workouts
    finalWorkouts = rescaleWorkouts(workouts, validation.scalarMultiplier);
}
```

---

### Layer 3: Drift Detection

**Problem:** User misses training → system pushes into dangerous intensity  
**Solution:** Detect cumulative deficit, flag block as compromised

```typescript
const drift = checkMacroDrift(block, activities, currentWeek);

if (drift.isDrifted) {
    // Flags block as 'compromised'
    // UI shows: "Plan Broken - Regeneration Required"
}
```

**Trigger:** >20% volume deficit for 2+ consecutive weeks

---

## Holistic Coaching (Life Context)

### Wellness Data Capture

The AI coach extracts wellness mentions from chat and logs them:

```typescript
// User says: "I only slept 4 hours last night"
// AI emits:
```LIFE_LOG
{
  "sleep_quality": 4
}
```

**Tracked fields:**
- `sleep_quality` (1-10)
- `stress_level` (1-10)
- `nutrition_score` (1-10)
- `hrv_status` ("low" | "normal" | "high" | "elevated")
- `tags[]` (alcohol, travel, sick, etc.)

### Bio-Feedback Loop

```typescript
const readiness = calculateReadiness(journalEntries);

if (readiness.shouldDowngrade) {
    // Modify workout: Tempo → Easy Recovery
    // Store modification reason for audit
}
```

---

## Chat Interface & Action Blocks

The AI coach can take actions via structured blocks:

| Block Type | Purpose |
|------------|---------|
| `MODIFY_PLAN` | Change a specific day's workout |
| `LIFE_LOG` | Log wellness data silently |
| `MEMORY_SAVE` | Store user preferences/injuries |

```typescript
// Example MODIFY_PLAN block:
```MODIFY_PLAN
{
  "day": "Wednesday",
  "type": "Easy Recovery Run",
  "duration": "30 min",
  "reason": "Poor sleep detected"
}
```

---

## Database Schema Overview

```sql
-- Core tables
users                  -- Strava-authenticated users
races                  -- User's goal races
training_blocks        -- Macrocycle plans
weekly_workouts        -- Stored microcycle workouts
user_journal           -- Wellness log entries (sleep, HRV, etc.)
athlete_memories       -- Long-term user preferences

-- Key relationships
training_blocks.race_id → races.id
weekly_workouts.block_id → training_blocks.id
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/training-plan` | POST | Get/generate weekly workouts |
| `/api/training-block/generate` | POST | Create new training block |
| `/api/training-block/reset` | POST | Regenerate compromised block |
| `/api/chat` | POST | AI coach conversation |
| `/api/journal` | GET/POST | Wellness data CRUD |
| `/api/sync` | POST | Sync Strava activities |

---

## Stability Guarantees

| Feature | Guarantee |
|---------|-----------|
| **Macro Plan** | Immutable once created (until reset) |
| **Weekly Plan** | Stored after first generation — reused on refresh |
| **Volume** | Validated against macro target (±10%) |
| **Drift** | Detected after 2+ weeks of >20% deficit |
| **Modifications** | Tracked with reason and timestamp |

---

## Deployment

**Production URL:** https://myultracoach.vercel.app  
**Platform:** Vercel (Edge + Serverless)  
**Database:** Vercel Postgres (us-east-1)

---

## File Structure

```
velo/
├── app/
│   ├── api/
│   │   ├── training-plan/route.ts    # Weekly plan generation
│   │   ├── training-block/           # Macro block management
│   │   ├── chat/route.ts             # AI coach interface
│   │   └── journal/route.ts          # Wellness logging
│   └── dashboard/
│       ├── weekly-plan.tsx           # Weekly plan UI
│       └── chat.tsx                  # Chat interface
├── lib/
│   ├── db.ts                         # Database functions
│   ├── coaching/
│   │   ├── logic.ts                  # Compliance, validation, drift
│   │   ├── system-prompt.ts          # AI personality & rules
│   │   └── action-blocks.ts          # Action block parsing
│   └── auth.ts                       # NextAuth config
└── migrations/                       # SQL migrations
```
