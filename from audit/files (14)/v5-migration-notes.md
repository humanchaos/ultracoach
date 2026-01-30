# System Prompt v5 Migration Notes

## What Changed

| v4 | v5 | Rationale |
|----|----|-----------| 
| 650 lines, 17 sections | ~120 lines, 7 sections | Gemini already knows coaching. Stop teaching it. |
| Coaching textbook (Sections 5-13) | Removed entirely | Move to data context or trust Gemini's knowledge |
| Multiple "CRITICAL" patches | Single clear hierarchy | Query handling → Safety → Everything else |
| Workout library tables | Removed | Gemini knows workouts. Prescribe naturally. |
| Vertical scaling formulas | Removed | Gemini can calculate. Data context provides race elevation. |
| Phase-specific limits | Moved to data context | Inject limits situationally, not as memorized rules |

## What Was Removed (and Why)

### Section 5: Recovery Protocol (v4 lines 188-280)
**Removed.** The 4-phase recovery timeline (ACUTE/STRUCTURAL/SYSTEMIC/REINTEGRATION) should be injected via `## RECOVERY STATUS` in the data context, with the specific limits for the CURRENT phase only.

**Data context should say:**
```
## RECOVERY STATUS
Phase: STRUCTURAL (Day 8 post-102km ultra)
Prescription limits: Z1 only, max 45min, no intensity
Analysis: Unrestricted - can discuss any past workout
```

### Sections 6-10: Mountain Coaching Rules
**Removed.** Vertical scaling, downhill periodization, uphill zone adjustments, race simulation protocols.

Gemini knows this. If you want specific behavior, encode it in the data:
```
## UPCOMING RACES
Eiger Ultra Trail [A-priority]
Distance: 101km | Elevation: +6700m / -6700m (66m/km)
→ High vertical density. Prescriptions should include power hiking and descent work.
```

### Section 11: Periodization
**Removed.** Base/Build/Peak/Taper rules.

The `## TRAINING BLOCK` section already tells Gemini what phase you're in. Trust it to periodize appropriately.

### Section 12: Golden Safety Rules
**Condensed to 7 rules.** The rest (descent tax, eccentric buffer, pole consistency) are good coaching but not "non-negotiable." Gemini will apply them naturally.

### Section 13: Workout Library
**Removed entirely.** Gemini doesn't need a lookup table for A1/B2/C3 workouts. Just prescribe: "45min easy Z1" or "4x6min uphill @ threshold."

### Sections 15-17: Actions, Scenarios, Uncertainty
**Condensed.** Actions table kept but slimmed. Scenarios reduced to bullet points. Uncertainty handling simplified.

---

## What Needs to Change in Data Context

### 1. Recovery Status (already exists, enhance it)

Add explicit scope instruction:
```typescript
// In recovery-state.ts formatRecoveryStateForPrompt()

return `## RECOVERY STATUS
Phase: ${phase} (Day ${daysSince} post-${raceName})
${prescriptionLimits}

**SCOPE:** These limits apply to PRESCRIPTIONS only. Analysis of past workouts is unrestricted.
`;
```

### 2. Most Recent Workout Highlight (NEW)

Add to top of context for "recent training" queries:
```typescript
// In data-context.ts, new function

export function formatRecentWorkoutHighlight(activity: StravaActivity): string {
  return `## 🎯 MOST RECENT WORKOUT
**For "recent training" queries, focus here.**

${activity.name} — ${formatDate(activity.date)}
${activity.distance_km}km in ${formatDuration(activity.duration_minutes)}
Pace: ${formatPace(activity.pace_min_per_km)}/km | HR: ${activity.average_hr}bpm | Elev: +${activity.elevation_gain_m}m

---
`;
}
```

### 3. Coaching Signals (reduce prominence)

The signals section is too loud. Either:
- Move it below the training log
- Add a header: `## COACHING SIGNALS (for trend questions only)`
- Or generate it conditionally based on query type

### 4. Race Context (enhance)

Add coaching hints inline:
```typescript
// When formatting race

if (race.elevation_gain_m / race.distance_km > 50) {
  lines.push(`→ High vertical density. Include power hiking and descent-specific work.`);
}
```

---

## Testing the v5 Prompt

### Test Case 1: "Analyze my most recent training"
**Expected:** Describes yesterday's workout (pace, HR, elevation), maybe compares to similar efforts. Does NOT mention recovery phase limits or prescribe anything.

### Test Case 2: "What should I do this week?"
**Expected:** Checks recovery status, applies limits, gives short daily breakdown with relative days.

### Test Case 3: "My HR was high yesterday, why?"
**Expected:** Answers the question (fatigue, heat, stress, cumulative load), maybe asks follow-up. Does NOT dump 4-week volume analysis.

### Test Case 4: "Give me a plan for Eiger"
**Expected:** Asks intake questions (current volume, long run, availability) before generating anything.

---

## Rollback Plan

If v5 causes issues:
1. Keep v4 as `SYSTEM_PROMPT_V4_BACKUP`
2. A/B test with a flag: `const PROMPT_VERSION = process.env.PROMPT_VERSION || 'v5'`
3. Log which version is active for debugging

The riskiest change is removing the workout library and periodization rules. If Gemini starts prescribing weird workouts, that's the first thing to add back.
