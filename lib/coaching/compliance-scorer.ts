// Coach Happiness / Compliance Scorer
// Improved scoring with graduated penalties and individual HR zones

import {
  Athlete,
  StravaActivity,
  PlannedWorkout,
  RecoveryStatus,
  HRZones,
  ComplianceResult,
  CoachHappiness,
} from "./types";

import { calculateHRZones, classifyActivityIntensity, checkIntensityCompliance } from "./hr-zones";
// NOTE: recovery-calculator.ts was removed as v2 legacy code
// Recovery detection is now inlined below

// ============================================
// SCORING CONFIGURATION
// ============================================

const SCORING = {
  // Rest day compliance (graduated)
  restDay: {
    fullRest: { score: 20, note: "✓ Full rest day respected" },
    lightMovement: { score: 15, note: "~ Light movement, acceptable" }, // <3km easy
    shouldHaveRested: { score: -5, note: "✗ Should have rested more" }, // 3-5km
    ignoredRest: { score: -15, note: "✗ Ignored rest day" }, // >5km
  },

  // Easy run compliance (graduated)
  easyRun: {
    completed: { score: 20, note: "✓ Easy run completed" },
    slightlyHard: { score: 12, note: "~ Went slightly too hard" },
    tooHard: { score: 5, note: "✗ Way too hard on easy day" },
    missed: { score: -5, note: "✗ Missed easy run" },
  },

  // Long run compliance (graduated)
  longRun: {
    completed: { score: 25, note: "✓ Long run completed" }, // ≥90% target
    shortened: { score: 18, note: "~ Long run shortened" }, // 70-90% target
    tooShort: { score: 8, note: "✗ Long run too short" }, // <70% target
    missed: { score: -10, note: "✗ Missed long run" },
  },

  // Quality workout compliance
  qualityWorkout: {
    completed: { score: 25, note: "✓ Quality workout completed" },
    modified: { score: 15, note: "~ Modified quality session" },
    missed: { score: -8, note: "✗ Missed quality workout" },
  },

  // Recovery protocol compliance
  recovery: {
    compliant: { score: 20, note: "✓ Respecting recovery protocol" },
    partiallyCompliant: { score: 5, note: "~ Mostly following recovery" },
    nonCompliant: { score: -20, note: "✗ Not following recovery protocol" },
  },

  // Cross-training
  crossTraining: {
    completed: { score: 15, note: "✓ Cross-training completed" },
    missed: { score: 0, note: "- Cross-training missed (optional)" },
  },

  // Bonus: extra activity
  extraActivity: {
    bonus: { score: 5, note: "+ Extra activity logged" },
    warning: { score: -5, note: "~ Unplanned hard effort" },
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function findMatchingActivity(
  activities: StravaActivity[],
  plannedDate: Date
): StravaActivity | null {
  const targetDate = plannedDate.toDateString();

  // Find any run on that day
  const matches = activities.filter(a =>
    new Date(a.date).toDateString() === targetDate && a.type === "Run"
  );

  // Return the longest one if multiple (likely the main workout)
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => a.distance_km > b.distance_km ? a : b);
}

function parseWorkoutDate(workout: PlannedWorkout): Date {
  // Handle various date formats
  const now = new Date();
  const currentYear = now.getFullYear();

  // Try parsing "Jan 6" format
  const match = workout.date.match(/([A-Za-z]+)\s+(\d+)/);
  if (match) {
    const monthStr = match[1];
    const day = parseInt(match[2]);
    const months: { [key: string]: number } = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    const month = months[monthStr.toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      return new Date(currentYear, month, day);
    }
  }

  // Fallback: try direct parse
  return new Date(workout.date);
}

// ============================================
// COMPLIANCE SCORING
// ============================================

function scoreRestDay(
  actual: StravaActivity | null,
  zones: HRZones
): { score: number; note: string; emoji: ComplianceResult["emoji"] } {
  if (!actual || actual.distance_km === 0) {
    return { ...SCORING.restDay.fullRest, emoji: "✓" };
  }

  const intensity = classifyActivityIntensity(actual, zones);

  if (actual.distance_km < 3 && (intensity === "easy" || intensity === "recovery")) {
    return { ...SCORING.restDay.lightMovement, emoji: "~" };
  }

  if (actual.distance_km < 5) {
    return { ...SCORING.restDay.shouldHaveRested, emoji: "✗" };
  }

  return { ...SCORING.restDay.ignoredRest, emoji: "✗" };
}

function scoreEasyRun(
  planned: PlannedWorkout,
  actual: StravaActivity | null,
  zones: HRZones
): { score: number; note: string; emoji: ComplianceResult["emoji"] } {
  if (!actual) {
    return { ...SCORING.easyRun.missed, emoji: "✗" };
  }

  const intensityCheck = checkIntensityCompliance("easy", actual, zones);

  if (intensityCheck.compliant) {
    return { ...SCORING.easyRun.completed, emoji: "✓" };
  }

  if (intensityCheck.severity === "minor") {
    return { ...SCORING.easyRun.slightlyHard, emoji: "~" };
  }

  return { ...SCORING.easyRun.tooHard, emoji: "✗" };
}

function scoreLongRun(
  planned: PlannedWorkout,
  actual: StravaActivity | null,
  zones: HRZones
): { score: number; note: string; emoji: ComplianceResult["emoji"] } {
  if (!actual) {
    return { ...SCORING.longRun.missed, emoji: "✗" };
  }

  const targetDistance = planned.distance_km || 20; // Default target if not specified
  const completionRatio = actual.distance_km / targetDistance;

  if (completionRatio >= 0.9) {
    return { ...SCORING.longRun.completed, emoji: "✓" };
  }

  if (completionRatio >= 0.7) {
    return {
      score: SCORING.longRun.shortened.score,
      note: `${SCORING.longRun.shortened.note} (${actual.distance_km.toFixed(1)}/${targetDistance}km)`,
      emoji: "~"
    };
  }

  return {
    score: SCORING.longRun.tooShort.score,
    note: `${SCORING.longRun.tooShort.note} (${actual.distance_km.toFixed(1)}/${targetDistance}km)`,
    emoji: "✗"
  };
}

function scoreQualityWorkout(
  planned: PlannedWorkout,
  actual: StravaActivity | null,
  zones: HRZones
): { score: number; note: string; emoji: ComplianceResult["emoji"] } {
  if (!actual) {
    return { ...SCORING.qualityWorkout.missed, emoji: "✗" };
  }

  // Quality workouts should show elevated HR
  const intensity = classifyActivityIntensity(actual, zones);

  if (intensity === "hard" || intensity === "max") {
    return { ...SCORING.qualityWorkout.completed, emoji: "✓" };
  }

  if (intensity === "moderate") {
    return { ...SCORING.qualityWorkout.modified, emoji: "~" };
  }

  // Did an easy run instead of quality - partial credit
  return { score: 5, note: "✗ Did easy run instead of quality work", emoji: "✗" };
}

function scoreRecoveryCompliance(
  recoveryStatus: RecoveryStatus,
  actual: StravaActivity | null,
  zones: HRZones
): { score: number; note: string; emoji: ComplianceResult["emoji"] } {
  if (!recoveryStatus.isInRecovery) {
    // Not in recovery, return neutral
    return { score: 0, note: "", emoji: "✓" };
  }

  const phase = recoveryStatus.currentPhase;

  // Complete rest phase
  if (phase === "complete_rest") {
    if (!actual || actual.distance_km < 1) {
      return { ...SCORING.recovery.compliant, emoji: "✓" };
    }
    return { ...SCORING.recovery.nonCompliant, emoji: "✗" };
  }

  // Walking only phase
  if (phase === "walking_only") {
    if (!actual) {
      return { ...SCORING.recovery.compliant, emoji: "✓" };
    }
    if (actual.type !== "Run" || actual.distance_km < 3) {
      return { ...SCORING.recovery.compliant, emoji: "✓" };
    }
    if (actual.distance_km < 5) {
      return { ...SCORING.recovery.partiallyCompliant, emoji: "~" };
    }
    return { ...SCORING.recovery.nonCompliant, emoji: "✗" };
  }

  // Light recovery phase
  if (phase === "light_recovery") {
    if (!actual) {
      return { ...SCORING.recovery.compliant, emoji: "✓" };
    }

    const intensity = classifyActivityIntensity(actual, zones);

    if (actual.distance_km <= 8 && (intensity === "easy" || intensity === "recovery")) {
      return { ...SCORING.recovery.compliant, emoji: "✓" };
    }
    if (actual.distance_km <= 10) {
      return { ...SCORING.recovery.partiallyCompliant, emoji: "~" };
    }
    return { ...SCORING.recovery.nonCompliant, emoji: "✗" };
  }

  // Return to training phase - more lenient
  return { ...SCORING.recovery.compliant, emoji: "✓" };
}

// ============================================
// MAIN SCORING FUNCTION
// ============================================

export function calculateCoachHappiness(
  athlete: Athlete,
  activities: StravaActivity[],
  plannedWorkouts: PlannedWorkout[],
  signupDate: Date
): CoachHappiness {
  const zones = calculateHRZones(athlete, activities);

  // Inline recovery status detection (v2 recovery-calculator was removed)
  const recoveryStatus: RecoveryStatus = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ultraRun = activities.find(a => {
      if (a.distance_km < 42) return false;
      const actDate = new Date(a.date);
      actDate.setHours(0, 0, 0, 0);
      const daysSince = Math.floor((today.getTime() - actDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysSince >= 0 && daysSince <= 21;
    });

    if (!ultraRun) {
      return {
        isInRecovery: false,
        type: "none" as const,
        daysSinceEvent: 0,
        mandatoryRestUntil: today,
        currentPhase: "none" as const,
        allowedActivities: ["all"],
        prohibitedActivities: []
      };
    }

    const actDate = new Date(ultraRun.date);
    actDate.setHours(0, 0, 0, 0);
    const daysSince = Math.floor((today.getTime() - actDate.getTime()) / (1000 * 60 * 60 * 24));
    const recoveryDays = ultraRun.distance_km >= 80 ? 21 : 14;
    const restUntil = new Date(actDate);
    restUntil.setDate(restUntil.getDate() + recoveryDays);

    let currentPhase: "complete_rest" | "walking_only" | "light_recovery" | "return_to_training" | "none" = "return_to_training";
    if (daysSince <= 2) currentPhase = "complete_rest";
    else if (daysSince <= 7) currentPhase = "walking_only";
    else if (daysSince <= 14) currentPhase = "light_recovery";

    return {
      isInRecovery: daysSince < recoveryDays,
      type: (ultraRun.distance_km >= 80 ? "ultra" : "marathon") as "ultra" | "marathon",
      eventName: ultraRun.name,
      eventDistance_km: ultraRun.distance_km,
      eventDate: actDate,
      daysSinceEvent: daysSince,
      mandatoryRestUntil: restUntil,
      currentPhase,
      allowedActivities: currentPhase === "complete_rest" ? ["rest", "stretching"] :
        currentPhase === "walking_only" ? ["walking", "swimming", "yoga"] :
          ["easy_run", "walking", "swimming"],
      prohibitedActivities: currentPhase === "complete_rest" ? ["running", "cycling", "intensity"] :
        currentPhase === "walking_only" ? ["running", "intensity"] : []
    };
  })();

  const complianceDetails: ComplianceResult[] = [];
  let totalScore = 0;
  let maxPossibleScore = 0;

  // Only score days from signup onwards
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  for (const workout of plannedWorkouts) {
    const workoutDate = parseWorkoutDate(workout);

    // Skip future workouts
    if (workoutDate > today) continue;

    // Skip days before signup
    if (workoutDate < signupDate) continue;

    const actual = findMatchingActivity(activities, workoutDate);
    let result: { score: number; note: string; emoji: ComplianceResult["emoji"] };
    let maxScore: number;

    // Score based on workout type
    switch (workout.type) {
      case "rest":
        result = scoreRestDay(actual, zones);
        maxScore = 20;
        break;

      case "recovery":
      case "run":
        if (workout.intensity === "easy") {
          result = scoreEasyRun(workout, actual, zones);
          maxScore = 20;
        } else {
          result = scoreQualityWorkout(workout, actual, zones);
          maxScore = 25;
        }
        break;

      case "long":
        result = scoreLongRun(workout, actual, zones);
        maxScore = 25;
        break;

      case "tempo":
      case "intervals":
        result = scoreQualityWorkout(workout, actual, zones);
        maxScore = 25;
        break;

      case "cross":
        result = actual
          ? { ...SCORING.crossTraining.completed, emoji: "✓" as const }
          : { ...SCORING.crossTraining.missed, emoji: "~" as const };
        maxScore = 15;
        break;

      default:
        result = { score: 0, note: "Unknown workout type", emoji: "~" };
        maxScore = 0;
    }

    // Apply recovery override if athlete is in mandatory recovery
    if (recoveryStatus.isInRecovery) {
      const recoveryResult = scoreRecoveryCompliance(recoveryStatus, actual, zones);
      if (recoveryResult.score !== 0) {
        // Recovery compliance takes precedence
        result = recoveryResult;
        maxScore = 20;
      }
    }

    totalScore += result.score;
    maxPossibleScore += maxScore;

    complianceDetails.push({
      date: workoutDate,
      planned: workout,
      actual,
      score: result.score,
      maxPossibleScore: maxScore,
      note: result.note,
      emoji: result.emoji,
    });
  }

  // Calculate final percentage
  const scorePercent = maxPossibleScore > 0
    ? Math.max(0, Math.min(100, ((totalScore + maxPossibleScore) / (2 * maxPossibleScore)) * 100))
    : 50; // Neutral if no data

  // Determine emoji
  let emoji: CoachHappiness["emoji"];
  if (scorePercent >= 80) emoji = "😊";
  else if (scorePercent >= 60) emoji = "🙂";
  else if (scorePercent >= 40) emoji = "😐";
  else if (scorePercent >= 20) emoji = "😤";
  else emoji = "😡";

  // Calculate trend (compare first half to second half of compliance details)
  let trend: CoachHappiness["trend"] = "stable";
  if (complianceDetails.length >= 6) {
    const mid = Math.floor(complianceDetails.length / 2);
    const firstHalf = complianceDetails.slice(0, mid);
    const secondHalf = complianceDetails.slice(mid);

    const avgFirst = firstHalf.reduce((s, c) => s + c.score, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, c) => s + c.score, 0) / secondHalf.length;

    if (avgSecond > avgFirst + 3) trend = "improving";
    else if (avgSecond < avgFirst - 3) trend = "declining";
  }

  // Generate warnings
  const warnings: string[] = [];
  if (scorePercent < 20) {
    warnings.push("⚠️ I'm close to giving up on you. Let's talk about what's getting in the way of your training.");
  }
  if (complianceDetails.filter(c => c.emoji === "✗").length >= 5) {
    warnings.push("Multiple missed or incorrect workouts. Time to adjust the plan?");
  }
  if (recoveryStatus.isInRecovery && complianceDetails.some(c => c.score < 0)) {
    warnings.push("Recovery protocol violations detected. Your body needs this rest to adapt.");
  }

  // Generate summary
  const recentResults = complianceDetails.slice(-7);
  const goodDays = recentResults.filter(c => c.emoji === "✓").length;
  const summary = `${goodDays}/${recentResults.length} workouts on track this week. ${trend === "improving" ? "Trending up! 📈" :
    trend === "declining" ? "Let's refocus. 📉" :
      "Holding steady."
    }`;

  return {
    score: Math.round(scorePercent),
    emoji,
    trend,
    complianceDetails,
    summary,
    warnings,
  };
}

// ============================================
// EXPORTS FOR UI
// ============================================

export function getHappinessDisplay(happiness: CoachHappiness): {
  emoji: string;
  label: string;
  color: string;
  message: string;
} {
  const displays: { [key: string]: { label: string; color: string } } = {
    "😊": { label: "Crushing it!", color: "#22c55e" },
    "🙂": { label: "On track", color: "#84cc16" },
    "😐": { label: "Room to improve", color: "#eab308" },
    "😤": { label: "Needs attention", color: "#f97316" },
    "😡": { label: "Off course", color: "#ef4444" },
  };

  const display = displays[happiness.emoji];

  return {
    emoji: happiness.emoji,
    label: display.label,
    color: display.color,
    message: happiness.summary,
  };
}
