# UltraCoach AI Coaching System – External Audit Documentation

*Version: v5.0 Protocol-Driven Engine • Last Updated: January 2026*

## Executive Summary

UltraCoach is an AI-powered mountain ultra-running coaching platform that generates personalized training plans and provides real-time coaching via chat. This document provides full transparency into how training decisions are made.

**Key Architectural Principles:**
- Two-tier architecture: Macro Skeleton (strategic) + Micro Prescription (tactical)
- 4-Gate safety sequence filtering all training decisions
- Data-driven personalization using Strava sync and lactate threshold data
- Deterministic phase templates with AI refinement

---

## 1. Training Plan Architecture

### 1.1 The Two-Tier System

UltraCoach uses a **"Stability by Default"** architecture with two distinct layers:

| Layer | Scope | Generator | Purpose |
|-------|-------|-----------|---------|
| **Macro Skeleton** | 8-24 weeks | Block Generator + AI | Strategic roadmap, phase progression, volume targets |
| **Micro Prescription** | 7 days | AI Coach (Gemini 2.0 Flash) | Tactical execution, readiness adjustments |

**Why Two Tiers?**
- Athletes need consistency to physiologically adapt to predictable stress patterns
- Dynamic adaptation requires real-time response to illness, fatigue, or missed sessions
- Separation prevents "training whiplash" from constantly changing philosophy

### 1.2 Macro Skeleton Generation

**Source File:** `lib/coaching/block-generator.ts`

When an athlete sets a race goal, the system generates a complete training block:

```
1. AI Pass (Gemini): Determines phase sequence and weekly volume targets
2. Deterministic Pass: Applies v10 Methodology templates to every day
```

**Phase Templates (v10 Methodology):**

| Phase | Focus | Weekly Structure |
|-------|-------|------------------|
| **Base** | Aerobic foundation, structural durability | Mon: Rest, Tue: Hill Strides, Wed/Thu: Easy, Fri: Rest, Sat: Medium Long, Sun: Long Run |
| **Build** | Threshold development, VO2max | Mon: Rest, Tue: LT2 Intervals, Wed: Easy, Thu: VO2 Hill Repeats, Fri: Recovery, Sat: Progression Long, Sun: Easy |
| **Specific** | Race simulation, terrain specificity | Mon: Rest, Tue: Race Pace Segments, Wed: Easy, Thu: Power Hike Intervals, Fri: Rest, Sat: Course Simulation, Sun: Back-to-Back |
| **Taper** | Fatigue dissipation, sharpening | Mon: Rest, Tue: Sharpener, Wed: Easy, Thu: Rest, Fri: Opener, Sat: Rest, Sun: Race |

### 1.3 Personalization Variables

While *structure* is templated, *targets* are personalized:

| Variable | Data Source | Application |
|----------|-------------|-------------|
| **Volume (km)** | AI-assigned weekly targets | Daily distances scale proportionally |
| **Vertical (m)** | Race elevation profile | Calculated from Race Vertical Density (m/km) |
| **HR Zones** | Lactate Test (LT1/LT2) or estimates | Zone boundaries for each workout type |
| **Pace** | Strava history (`avgPace`) | Relative pace ranges per workout type |
| **Recovery Protocol** | Workout intensity | Evening recovery suggestions (ice bath, compression, etc.) |

---

## 2. The 4-Gate Safety Sequence

**Every training prescription passes through 4 non-negotiable gates:**

### Gate 0: Risk Flag Check
- **Trigger:** Fever, suspected illness, acute injury
- **Action:** STOP all training immediately

### Gate 1: Readiness Constraint Check
- Applies hard caps from Readiness Profile:
  - Max HR limits
  - Max duration limits
  - No-impact restrictions
- Based on: Systemic, Structural, Energy, and Cognitive dimensions

### Gate 2: Recovery Status Check
- Enforces mandatory recovery windows post-race:

| Race Distance | Acute Recovery | Return to Structure |
|---------------|----------------|---------------------|
| Marathon | 10 days | 14 days |
| 50K | 14 days | 18 days |
| 100K | 21 days | 28 days |
| 100M+ | 35 days | 49 days |

**Recovery Phases:**
- `ACUTE` (Days 0-7): No running, walking only
- `STRUCTURAL` (Days 8-14): 45min max, Zone 1 only
- `SYSTEMIC` (Days 15-21): 60-75min, Zone 1-2
- `REINTEGRATION` (Days 22-28): 90min, Zone 2-3 touches

### Gate 3: Mountain Coaching Brain
- Primary stressor: **Vertical** (not distance)
- Calculates phase-specific training blocks using terrain profiles

---

## 3. The 12 Golden Rules

Hard clinical guardrails that cannot be overridden:

1. **The Cardinal Sin:** Never increase Volume AND Intensity in the same week
2. **The Vert Cliff:** Never increase weekly vertical by >15% in a single week
3. **The Descent Tax:** Mandatory flat day after sessions >1000m technical descent
4. **72-Hour Quality Buffer:** Minimum spacing between high-intensity or long-duration sessions
5. **The 48-Hour Long Run Buffer:** 48h rest after any run >2.5 hours
6. **Post-Ultra Bridge:** 2-week tension-building phase before returning to threshold work
7. **The Pain Gate:** Pain >3/10 (sharp/localized) triggers mandatory rest
8. **Sleep Multiplier:** <6h sleep → automatic intensity downgrade (Z1 only)
9. **Taper Sensitivity:** Mandatory 2-week taper for races >42km
10. **Nutritional Integrity:** Mandatory fueling targets for runs >2h
11. **Vertical Progression Floor:** Minimum 3 weeks in Base phase
12. **Cognitive Load Shield:** High life stress → reduced interval count

---

## 4. Heart Rate Zone Personalization

**Source File:** `lib/coaching/hr-zones.ts`

### Zone Calculation Hierarchy

1. **Lab Anchor (Default):** Zones derived from LT1/LT2 lactate test values
2. **Athlete Calibration (Override):** Manual zone adjustments in dashboard
3. **Reset Safety:** Recalculate button restores pure LT1/LT2 model

**Zone Definitions (Personalized):**

| Zone | Definition | Use Case |
|------|------------|----------|
| Z1 (Recovery) | Below 85% of LT1 | Recovery runs |
| Z2 (Easy/Aerobic) | 85%-100% of LT1 | Base building, long runs |
| Z3 (Steady/Tempo) | LT1 to midpoint of LT2 | Tempo runs |
| Z4 (Threshold) | Midpoint to LT2 | Threshold intervals |
| Z5 (VO2max) | Above LT2 | Short intervals, hill repeats |

---

## 5. Chat AI Coaching System

**Source Files:** 
- `lib/coaching/system-prompt-v5.ts` (AI Instructions)
- `app/api/chat/route.ts` (API Endpoint)
- `lib/coaching/data-context.ts` (Data Injection)

### 5.1 System Prompt Philosophy

The v5 engine uses **Protocol Prompting** (130 lines) vs. legacy Textbook Prompting (650+ lines):
- Trusts Gemini 2.0 Flash's inherent coaching knowledge
- Provides 7 Non-Negotiable Safety Rules only
- Focuses on behavioral constraints, not coaching theory

### 5.2 Query Classification

The AI classifies every user message into categories:

| Query Type | Example | Response Protocol |
|------------|---------|-------------------|
| **Analysis** | "Analyze my last run" | Evaluate THAT workout from training log. Recovery phase does NOT restrict analysis. |
| **Prescription** | "What should I do this week" | Apply safety constraints, check recovery status, prescribe training. |
| **Question** | "Why is my HR high on easy runs" | Answer directly using data. |
| **Check-in** | "Legs feel heavy" | Acknowledge, adjust if needed, ask follow-up. |
| **Proactive** | `[SYNC_TRIGGER]` prefix | Automatic workout assessment on Strava sync. |

### 5.3 Data Context Injection

The AI receives these data sections in every chat interaction:

| Section | Content | When Used |
|---------|---------|-----------|
| `## RECOVERY STATUS` | Days post-race, phase, prescription limits | Before prescribing ANY training |
| `## READINESS PROFILE` | Systemic/structural/energy/cognitive status, risk flags | Check for FEVER, INJURY, ILLNESS first |
| `## ATHLETE PROFILE` | Age, HR zones, preferences, experience, injuries | Personalization |
| `## TRAINING LOG` | Recent activities with distance, pace, HR, elevation | For analysis requests |
| `## UPCOMING RACES` | Race details with countdown | For periodization |
| `## COACHING SIGNALS` | Volume trends, compliance, intensity discipline, fatigue | For trend questions only |
| `## TRAINING BLOCK` | Current time, today's date, this week's plan | Continuity and time-awareness |
| `## WELLNESS LOG` | Sleep, stress patterns | Prescription adjustments |

### 5.4 Coaching Signals Calculation

**Source File:** `lib/coaching/signals.ts`

The system calculates objective coaching signals from Strava data:

| Signal Category | Metrics Calculated |
|-----------------|-------------------|
| **Volume** | This week, last week, 4-week avg, trend (building/maintaining/declining/erratic) |
| **Compliance** | % of planned volume, sessions completed vs planned, missed workouts |
| **Intensity** | Easy runs actually easy, intensity accuracy %, consecutive too-hard days |
| **Fatigue** | Cardiac drift, performance trend, Acute:Chronic Workload Ratio (ACWR) |
| **Major Efforts** | Recent ultras/marathons with recovery status |

---

## 6. Proactive Coaching (Sync-Triggered)

When Strava syncs a new workout, the system automatically:

1. Detects the new activity via `[SYNC_TRIGGER]` prefix
2. Identifies today's prescribed workout from the training block
3. Compares actual vs. planned (type, intensity, volume)
4. Provides brief assessment (<100 words):
   - Workout summary
   - Plan alignment
   - One coaching insight
   - Check-in question

---

## 7. Injury & Biomechanics Module

When an athlete reports pain, the coach activates a specialized protocol:

1. **Hypothesis Check:** Don't accept athlete's suspected cause blindly
2. **Diagnostic Questions:** 1-2 targeted questions + provocative tests
3. **Structural Analysis:** Name the affected structure + explain mechanical cause
4. **Solution (Active > Passive):** 2-3 exercises with:
   - What it targets
   - Why it helps this specific issue
   - How to execute

**Safety:** All prescriptions blocked until pain resolved + medical disclaimer.

---

## 8. Non-Negotiable Safety Rules (v5)

The AI must never violate these:

1. **Pain reported** → Cut volume immediately
2. **Skipped run** → Recalculate the week (never "try harder")
3. **Missing data** → Ask the athlete (never assume)
4. **Volume lock** → Never increase >10% AND intensity in same week
5. **48-hour buffer** → Minimum between Z4/Z5 sessions
6. **72-hour buffer** → Minimum between quality sessions
7. **Illness gate** → No training until 24h symptom-free

---

## 9. Data Integrity Policies

| Policy | Implementation |
|--------|----------------|
| **Zero-Inference Policy** | Only act on explicitly mentioned metrics |
| **Strava Authority** | Biometrics (age, weight, gender) from Strava |
| **Math Validation** | Daily workouts must sum to weekly target ±15% |
| **Lifelog Persistence** | All user-shared context persisted to `user_journal` |

---

## 10. Technical Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                           │
│  Dashboard (weekly-plan.tsx) │ Chat (chat.tsx) │ Calendar   │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                      API LAYER                               │
│  /api/training-plan   │   /api/chat   │   /api/generate-block│
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                   COACHING ENGINE                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ System      │  │ Data Context │  │ Block Generator  │    │
│  │ Prompt v5   │  │ Builder      │  │ (Deterministic)  │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
│         │                │                    │              │
│         ▼                ▼                    ▼              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ Recovery    │  │ Signals      │  │ HR Zones         │    │
│  │ State       │  │ Calculator   │  │ Calculator       │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                    DATA LAYER                                │
│  Vercel Postgres (users, races, training_blocks, journal)   │
│  Strava API (activities, profile)                            │
│  Gemini 2.0 Flash (AI responses)                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 11. Key Source Files Reference

| File | Purpose |
|------|---------|
| `lib/coaching/system-prompt-v5.ts` | AI coaching instructions |
| `lib/coaching/block-generator.ts` | Training block generation (942 lines) |
| `lib/coaching/data-context.ts` | Context injection for AI |
| `lib/coaching/signals.ts` | Coaching signals calculation |
| `lib/coaching/recovery-state.ts` | Post-race recovery tracking |
| `lib/coaching/hr-zones.ts` | Heart rate zone personalization |
| `app/api/chat/route.ts` | Chat API endpoint |
| `app/api/training-plan/route.ts` | Training plan API |

---

## 12. Audit Checklist

For compliance verification, auditors should confirm:

- [ ] All prescriptions pass 4-Gate safety sequence
- [ ] Recovery windows are enforced after major efforts
- [ ] Pain reports trigger immediate training restrictions
- [ ] HR zones are personalized from lab data when available
- [ ] Volume increases never exceed 10% when intensity also increases
- [ ] Analysis requests are answered independently of recovery phase
- [ ] Missing data triggers questions, not assumptions
- [ ] Medical disclaimers accompany injury advice

---

*Document generated for external audit purposes. For questions, contact the development team.*
