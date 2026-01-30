/**
 * Coaching Signals Calculator
 * 
 * Computes the signals a coach needs to make informed decisions:
 * - Volume compliance (are they hitting targets?)
 * - Intensity accuracy (are easy runs actually easy?)
 * - Fatigue indicators (cardiac drift, performance trends)
 * - Load management (acute vs chronic)
 * 
 * These signals get injected into the AI context so it can coach
 * based on physiological reality, not just activity logs.
 */

import { StravaActivity, Athlete, HRZones, PlannedWorkout } from "./types";
import { calculateHRZones, classifyActivityIntensity } from "./hr-zones";

// ============================================
// TYPES
// ============================================

export interface CoachingSignals {
  // Volume tracking
  volume: {
    thisWeekKm: number;
    lastWeekKm: number;
    fourWeekAvgKm: number;
    weekOverWeekChange: number; // percentage
    trend: "building" | "maintaining" | "declining" | "erratic";
  };

  // Compliance (if we have a plan to compare against)
  compliance: {
    available: boolean;
    volumePercent: number;        // actual/planned volume
    sessionsCompleted: number;
    sessionsPlanned: number;
    rating: "excellent" | "good" | "fair" | "poor";
    missedWorkouts: string[];     // descriptions of what was missed
  };

  // Intensity discipline
  intensity: {
    easyRunsActuallyEasy: number;   // count
    easyRunsTooHard: number;        // count
    intensityAccuracy: number;      // percentage
    consecutiveTooHardDays: number;
    needsIntensityConversation: boolean;
    recentViolations: IntensityViolation[];
  };

  // Fatigue indicators
  fatigue: {
    cardiacDriftAvg: number | null;     // % HR rise during runs
    cardiacDriftTrend: "normal" | "elevated" | "warning";
    performanceTrend: "improving" | "stable" | "declining" | "insufficient_data";
    restingHRTrend: "normal" | "elevated" | "insufficient_data";
    acuteChronicRatio: number | null;   // training load ratio
    fatigueRisk: "low" | "moderate" | "high";
  };

  // Recent major efforts
  recentMajorEfforts: MajorEffort[];

  // Data quality for these signals
  signalQuality: {
    hasHRData: boolean;
    hrDataPercent: number;
    hasPaceData: boolean;
    activityCount: number;
    confidence: "high" | "medium" | "low";
  };
}

export interface IntensityViolation {
  date: Date;
  activityName: string;
  plannedIntensity: string;
  actualIntensity: string;
  avgHR: number;
  zoneTarget: string;
  zoneActual: string;
}

export interface MajorEffort {
  date: Date;
  name: string;
  distanceKm: number;
  type: "ultra" | "marathon" | "long_race" | "big_training_run";
  daysSince: number;
  suggestedRecoveryDays: number;
  recoveryStatus: "still_recovering" | "cleared" | "extended_recovery_recommended";
}

// ============================================
// MAIN CALCULATOR
// ============================================

export function calculateCoachingSignals(
  activities: StravaActivity[],
  athlete: Athlete,
  plannedWorkouts?: PlannedWorkout[] // optional - if we have a plan
): CoachingSignals {
  const zones = calculateHRZones(athlete, activities);
  const runs = activities.filter(a => a.type === "Run");

  return {
    volume: calculateVolumeSignals(runs),
    compliance: calculateComplianceSignals(runs, plannedWorkouts),
    intensity: calculateIntensitySignals(runs, zones, plannedWorkouts),
    fatigue: calculateFatigueSignals(runs, zones, athlete),
    recentMajorEfforts: detectMajorEfforts(runs),
    signalQuality: assessSignalQuality(runs),
  };
}

// ============================================
// VOLUME CALCULATIONS
// ============================================

function calculateVolumeSignals(runs: StravaActivity[]): CoachingSignals["volume"] {
  const now = new Date();

  // Get runs by week
  const thisWeekRuns = getRunsInWeek(runs, now, 0);
  const lastWeekRuns = getRunsInWeek(runs, now, 1);
  const week2Runs = getRunsInWeek(runs, now, 2);
  const week3Runs = getRunsInWeek(runs, now, 3);

  const thisWeekKm = sumDistance(thisWeekRuns);
  const lastWeekKm = sumDistance(lastWeekRuns);
  const fourWeekAvgKm = (thisWeekKm + lastWeekKm + sumDistance(week2Runs) + sumDistance(week3Runs)) / 4;

  const weekOverWeekChange = lastWeekKm > 0
    ? ((thisWeekKm - lastWeekKm) / lastWeekKm) * 100
    : 0;

  // Determine trend
  const volumes = [thisWeekKm, lastWeekKm, sumDistance(week2Runs), sumDistance(week3Runs)];
  const trend = determineTrend(volumes);

  return {
    thisWeekKm: round(thisWeekKm, 1),
    lastWeekKm: round(lastWeekKm, 1),
    fourWeekAvgKm: round(fourWeekAvgKm, 1),
    weekOverWeekChange: round(weekOverWeekChange, 0),
    trend,
  };
}

function getRunsInWeek(runs: StravaActivity[], reference: Date, weeksAgo: number): StravaActivity[] {
  const weekStart = getWeekStart(reference);
  weekStart.setDate(weekStart.getDate() - (weeksAgo * 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  return runs.filter(r => {
    const d = new Date(r.date);
    return d >= weekStart && d < weekEnd;
  });
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumDistance(runs: StravaActivity[]): number {
  return runs.reduce((sum, r) => sum + r.distance_km, 0);
}

function determineTrend(volumes: number[]): CoachingSignals["volume"]["trend"] {
  if (volumes.length < 2) return "maintaining";

  const [current, prev1, prev2, prev3] = volumes;

  // Check for consistent building (each week higher than next)
  if (current > prev1 && prev1 > prev2) return "building";

  // Check for consistent decline
  if (current < prev1 && prev1 < prev2) return "declining";

  // Check for erratic (big swings)
  const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const variance = volumes.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / volumes.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev > avg * 0.3) return "erratic";

  return "maintaining";
}

// ============================================
// COMPLIANCE CALCULATIONS
// ============================================

function calculateComplianceSignals(
  runs: StravaActivity[],
  plannedWorkouts?: PlannedWorkout[]
): CoachingSignals["compliance"] {
  if (!plannedWorkouts || plannedWorkouts.length === 0) {
    return {
      available: false,
      volumePercent: 0,
      sessionsCompleted: 0,
      sessionsPlanned: 0,
      rating: "fair",
      missedWorkouts: [],
    };
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Filter to this week's plan and runs
  const thisWeekPlan = plannedWorkouts.filter(w => {
    const d = new Date(w.date);
    return d >= sevenDaysAgo && d <= now && w.type !== "rest";
  });

  const thisWeekRuns = runs.filter(r => {
    const d = new Date(r.date);
    return d >= sevenDaysAgo && d <= now;
  });

  const sessionsPlanned = thisWeekPlan.length;
  const sessionsCompleted = Math.min(thisWeekRuns.length, sessionsPlanned);

  // Calculate planned volume
  const plannedVolume = thisWeekPlan.reduce((sum, w) => sum + (w.distance_km || 0), 0);
  const actualVolume = sumDistance(thisWeekRuns);
  const volumePercent = plannedVolume > 0 ? (actualVolume / plannedVolume) * 100 : 100;

  // Find missed workouts
  const missedWorkouts: string[] = [];
  for (const planned of thisWeekPlan) {
    const planDate = new Date(planned.date);
    if (planDate > now) continue; // Not due yet

    const matchingRun = thisWeekRuns.find(r => {
      const runDate = new Date(r.date);
      return Math.abs(runDate.getTime() - planDate.getTime()) < 24 * 60 * 60 * 1000;
    });

    if (!matchingRun) {
      missedWorkouts.push(`${planned.day}: ${planned.title}`);
    }
  }

  // Determine rating
  let rating: CoachingSignals["compliance"]["rating"];
  if (volumePercent >= 90 && missedWorkouts.length === 0) {
    rating = "excellent";
  } else if (volumePercent >= 75) {
    rating = "good";
  } else if (volumePercent >= 50) {
    rating = "fair";
  } else {
    rating = "poor";
  }

  return {
    available: true,
    volumePercent: round(volumePercent, 0),
    sessionsCompleted,
    sessionsPlanned,
    rating,
    missedWorkouts,
  };
}

// ============================================
// INTENSITY CALCULATIONS
// ============================================

function calculateIntensitySignals(
  runs: StravaActivity[],
  zones: HRZones,
  plannedWorkouts?: PlannedWorkout[]
): CoachingSignals["intensity"] {
  const runsWithHR = runs.filter(r => r.average_hr);
  const recentRuns = runsWithHR.filter(r => {
    const d = new Date(r.date);
    const daysAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 14;
  });

  if (recentRuns.length === 0) {
    return {
      easyRunsActuallyEasy: 0,
      easyRunsTooHard: 0,
      intensityAccuracy: 100,
      consecutiveTooHardDays: 0,
      needsIntensityConversation: false,
      recentViolations: [],
    };
  }

  // Classify each run
  const violations: IntensityViolation[] = [];
  let easyRunsActuallyEasy = 0;
  let easyRunsTooHard = 0;

  for (const run of recentRuns) {
    const intensity = classifyActivityIntensity(run, zones);

    // Check if this was supposed to be easy
    const plannedEasy = isPlannedEasy(run, plannedWorkouts);

    // If no plan, use heuristics: long slow runs should be easy
    const shouldBeEasy = plannedEasy ?? (run.distance_km > 15 || run.pace_min_per_km && run.pace_min_per_km > 5.5);

    if (shouldBeEasy) {
      if (intensity === "easy" || intensity === "recovery") {
        easyRunsActuallyEasy++;
      } else if (intensity === "moderate" || intensity === "hard" || intensity === "max") {
        easyRunsTooHard++;
        violations.push({
          date: new Date(run.date),
          activityName: run.name,
          plannedIntensity: "easy",
          actualIntensity: intensity,
          avgHR: run.average_hr!,
          zoneTarget: `Z1-Z2 (${zones.zones.zone1.min}-${zones.zones.zone2.max})`,
          zoneActual: getZoneName(run.average_hr!, zones),
        });
      }
    }
  }

  const totalChecked = easyRunsActuallyEasy + easyRunsTooHard;
  const intensityAccuracy = totalChecked > 0
    ? (easyRunsActuallyEasy / totalChecked) * 100
    : 100;

  // Check for consecutive too-hard days
  const consecutiveTooHardDays = countConsecutiveHardDays(recentRuns, zones);

  // Flag for conversation if pattern emerges
  const needsIntensityConversation = easyRunsTooHard >= 3 || consecutiveTooHardDays >= 3;

  return {
    easyRunsActuallyEasy,
    easyRunsTooHard,
    intensityAccuracy: round(intensityAccuracy, 0),
    consecutiveTooHardDays,
    needsIntensityConversation,
    recentViolations: violations.slice(0, 5), // Most recent 5
  };
}

function isPlannedEasy(run: StravaActivity, planned?: PlannedWorkout[]): boolean | null {
  if (!planned) return null;

  const runDate = new Date(run.date);
  const matching = planned.find(p => {
    const planDate = new Date(p.date);
    return Math.abs(runDate.getTime() - planDate.getTime()) < 24 * 60 * 60 * 1000;
  });

  if (!matching) return null;
  return matching.intensity === "easy" || matching.type === "recovery" || matching.type === "long";
}

function getZoneName(hr: number, zones: HRZones): string {
  if (hr <= zones.zones.zone1.max) return "Z1";
  if (hr <= zones.zones.zone2.max) return "Z2";
  if (hr <= zones.zones.zone3.max) return "Z3";
  if (hr <= zones.zones.zone4.max) return "Z4";
  return "Z5";
}

function countConsecutiveHardDays(runs: StravaActivity[], zones: HRZones): number {
  const sorted = [...runs].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  let consecutive = 0;
  for (const run of sorted) {
    const intensity = classifyActivityIntensity(run, zones);
    if (intensity === "moderate" || intensity === "hard" || intensity === "max") {
      consecutive++;
    } else {
      break;
    }
  }
  return consecutive;
}

// ============================================
// FATIGUE CALCULATIONS
// ============================================

function calculateFatigueSignals(
  runs: StravaActivity[],
  zones: HRZones,
  athlete: Athlete
): CoachingSignals["fatigue"] {
  const runsWithHR = runs.filter(r => r.average_hr && r.duration_minutes > 20);

  // Cardiac drift estimation
  // We don't have split data, so we estimate based on avg HR vs expected for pace
  const cardiacDriftAvg = estimateCardiacDrift(runsWithHR, zones);

  let cardiacDriftTrend: CoachingSignals["fatigue"]["cardiacDriftTrend"] = "normal";
  if (cardiacDriftAvg !== null) {
    if (cardiacDriftAvg > 15) cardiacDriftTrend = "warning";
    else if (cardiacDriftAvg > 10) cardiacDriftTrend = "elevated";
  }

  // Performance trend: are they getting faster at same HR?
  const performanceTrend = calculatePerformanceTrend(runsWithHR, zones, athlete);

  // Resting HR trend (if we have data)
  const restingHRTrend = "insufficient_data" as const; // Would need morning HR data

  // Acute:Chronic workload ratio
  const acuteChronicRatio = calculateACRatio(runs);

  // Overall fatigue risk
  let fatigueRisk: CoachingSignals["fatigue"]["fatigueRisk"] = "low";
  if (cardiacDriftTrend === "warning" || performanceTrend === "declining") {
    fatigueRisk = "high";
  } else if (cardiacDriftTrend === "elevated" || (acuteChronicRatio && acuteChronicRatio > 1.5)) {
    fatigueRisk = "moderate";
  }

  return {
    cardiacDriftAvg: cardiacDriftAvg !== null ? round(cardiacDriftAvg, 1) : null,
    cardiacDriftTrend,
    performanceTrend,
    restingHRTrend,
    acuteChronicRatio: acuteChronicRatio !== null ? round(acuteChronicRatio, 2) : null,
    fatigueRisk,
  };
}

function estimateCardiacDrift(runs: StravaActivity[], zones: HRZones): number | null {
  // Focus on longer easy runs where drift is most apparent
  const longEasyRuns = runs.filter(r => {
    const intensity = classifyActivityIntensity(r, zones);
    return (intensity === "easy" || intensity === "recovery") && r.duration_minutes > 45;
  });

  if (longEasyRuns.length < 2) return null;

  // Without split data, we use a proxy: compare HR relative to pace
  // Higher HR for same pace = more drift/fatigue
  const hrPaceRatios: number[] = [];
  for (const run of longEasyRuns) {
    if (run.pace_min_per_km && run.average_hr) {
      // Normalize: HR per unit pace (lower is better)
      const ratio = run.average_hr / run.pace_min_per_km;
      hrPaceRatios.push(ratio);
    }
  }

  if (hrPaceRatios.length < 2) return null;

  // Compare recent (last 2) vs older (2 before that)
  const recent = hrPaceRatios.slice(0, 2);
  const older = hrPaceRatios.slice(2, 4);

  if (older.length === 0) return null;

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

  // Return percentage change (positive = more HR needed = more fatigue)
  return ((recentAvg - olderAvg) / olderAvg) * 100;
}

function calculatePerformanceTrend(
  runs: StravaActivity[],
  zones: HRZones,
  athlete: Athlete
): CoachingSignals["fatigue"]["performanceTrend"] {
  // Look at pace at similar HR over time
  const runsWithData = runs.filter(r => r.average_hr && r.pace_min_per_km);

  if (runsWithData.length < 4) return "insufficient_data";

  // Filter to Zone 2-3 runs for comparison
  const comparableRuns = runsWithData.filter(r => {
    const hr = r.average_hr!;
    return hr >= zones.zones.zone2.min && hr <= zones.zones.zone3.max;
  });

  if (comparableRuns.length < 4) return "insufficient_data";

  // Sort by date, newest first
  comparableRuns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Compare recent 2 runs vs older 2 runs
  const recent = comparableRuns.slice(0, 2);
  const older = comparableRuns.slice(-2);

  const recentPace = recent.reduce((sum, r) => sum + r.pace_min_per_km!, 0) / 2;
  const olderPace = older.reduce((sum, r) => sum + r.pace_min_per_km!, 0) / 2;

  const diff = recentPace - olderPace; // Positive = getting slower

  if (diff < -0.15) return "improving"; // >9 sec/km faster
  if (diff > 0.15) return "declining";  // >9 sec/km slower
  return "stable";
}

function calculateACRatio(runs: StravaActivity[]): number | null {
  // Acute = last 7 days, Chronic = last 28 days average
  const now = new Date();

  const acuteRuns = runs.filter(r => {
    const daysAgo = (now.getTime() - new Date(r.date).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7;
  });

  const chronicRuns = runs.filter(r => {
    const daysAgo = (now.getTime() - new Date(r.date).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 28;
  });

  if (chronicRuns.length < 7) return null;

  const acuteLoad = sumDistance(acuteRuns);
  const chronicLoad = sumDistance(chronicRuns) / 4; // Weekly average

  if (chronicLoad === 0) return null;

  return acuteLoad / chronicLoad;
}

// ============================================
// MAJOR EFFORT DETECTION
// ============================================

function detectMajorEfforts(runs: StravaActivity[]): MajorEffort[] {
  const now = new Date();
  const efforts: MajorEffort[] = [];

  for (const run of runs) {
    const daysSince = Math.floor((now.getTime() - new Date(run.date).getTime()) / (1000 * 60 * 60 * 24));

    // Only look at last 30 days
    if (daysSince > 30) continue;

    let type: MajorEffort["type"] | null = null;
    let suggestedRecoveryDays = 0;

    // Classify the effort
    if (run.distance_km >= 80) {
      type = "ultra";
      suggestedRecoveryDays = 21;
    } else if (run.distance_km >= 42) {
      type = "marathon";
      suggestedRecoveryDays = 14;
    } else if (run.distance_km >= 30) {
      // Check if it's a race (name often contains "race", "marathon", etc.)
      const isRace = /race|marathon|ultra|50k|100k|trail/i.test(run.name);
      if (isRace) {
        type = "long_race";
        suggestedRecoveryDays = 10;
      } else {
        type = "big_training_run";
        suggestedRecoveryDays = 3;
      }
    }

    if (type) {
      let recoveryStatus: MajorEffort["recoveryStatus"];
      if (daysSince < suggestedRecoveryDays * 0.5) {
        recoveryStatus = "still_recovering";
      } else if (daysSince < suggestedRecoveryDays) {
        recoveryStatus = "cleared"; // But should still be careful
      } else {
        recoveryStatus = "cleared";
      }

      efforts.push({
        date: new Date(run.date),
        name: run.name,
        distanceKm: run.distance_km,
        type,
        daysSince,
        suggestedRecoveryDays,
        recoveryStatus,
      });
    }
  }

  // Sort by date, most recent first
  efforts.sort((a, b) => b.date.getTime() - a.date.getTime());

  return efforts;
}

// ============================================
// SIGNAL QUALITY ASSESSMENT
// ============================================

function assessSignalQuality(runs: StravaActivity[]): CoachingSignals["signalQuality"] {
  const recentRuns = runs.filter(r => {
    const daysAgo = (Date.now() - new Date(r.date).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 14;
  });

  const hasHR = recentRuns.filter(r => r.average_hr).length;
  const hasPace = recentRuns.filter(r => r.pace_min_per_km).length;

  const hrDataPercent = recentRuns.length > 0 ? (hasHR / recentRuns.length) * 100 : 0;

  let confidence: CoachingSignals["signalQuality"]["confidence"];
  if (recentRuns.length >= 6 && hrDataPercent >= 80) {
    confidence = "high";
  } else if (recentRuns.length >= 3 && hrDataPercent >= 50) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    hasHRData: hasHR > 0,
    hrDataPercent: round(hrDataPercent, 0),
    hasPaceData: hasPace > 0,
    activityCount: recentRuns.length,
    confidence,
  };
}

// ============================================
// FORMATTING FOR PROMPT INJECTION
// ============================================

/**
 * Signal overrides during recovery - prevents contradictory messaging to AI
 */
export interface SignalOverrides {
  suppressAcwrWarnings: boolean;
  suppressIntensityViolations: boolean;
  suppressVolumeWarnings: boolean;
  reframeAllSignals: boolean;
  overrideReason: string | null;
}

export function formatSignalsForPrompt(
  signals: CoachingSignals,
  overrides?: SignalOverrides
): string {
  const lines: string[] = [
    `## COACHING SIGNALS`,
    ``,
    `Data confidence: ${signals.signalQuality.confidence.toUpperCase()} (${signals.signalQuality.activityCount} activities, ${signals.signalQuality.hrDataPercent}% with HR)`,
    ``,
  ];

  // If we're in recovery, add explicit context
  if (overrides?.reframeAllSignals && overrides.overrideReason) {
    lines.push(`**⚠️ RECOVERY CONTEXT ACTIVE:** ${overrides.overrideReason}`);
    lines.push(`All signals below should be interpreted through recovery lens. Low volume/ACWR is EXPECTED and CORRECT.`);
    lines.push(``);
  }

  // Volume
  lines.push(`### Volume`);
  lines.push(`This week: ${signals.volume.thisWeekKm}km`);
  lines.push(`Last week: ${signals.volume.lastWeekKm}km`);
  lines.push(`4-week avg: ${signals.volume.fourWeekAvgKm}km`);
  lines.push(`Week-over-week: ${signals.volume.weekOverWeekChange > 0 ? '+' : ''}${signals.volume.weekOverWeekChange}%`);

  // During recovery, reframe declining/erratic trends positively
  if (overrides?.suppressVolumeWarnings && (signals.volume.trend === 'declining' || signals.volume.trend === 'erratic')) {
    lines.push(`Trend: ${signals.volume.trend} ✓ (expected during recovery)`);
  } else {
    lines.push(`Trend: ${signals.volume.trend}`);
  }
  lines.push(``);

  // Compliance (if available)
  if (signals.compliance.available) {
    lines.push(`### Compliance`);
    lines.push(`Volume: ${signals.compliance.volumePercent}% of planned`);
    lines.push(`Sessions: ${signals.compliance.sessionsCompleted}/${signals.compliance.sessionsPlanned}`);

    // During recovery, don't flag low compliance as a problem
    if (overrides?.suppressVolumeWarnings && signals.compliance.rating === 'poor') {
      lines.push(`Rating: LOW COMPLIANCE ✓ (expected during recovery - do NOT increase load)`);
    } else {
      lines.push(`Rating: ${signals.compliance.rating.toUpperCase()}`);
    }
    if (signals.compliance.missedWorkouts.length > 0 && !overrides?.suppressVolumeWarnings) {
      lines.push(`Missed: ${signals.compliance.missedWorkouts.join(', ')}`);
    }
    lines.push(``);
  }

  // Intensity
  lines.push(`### Intensity Discipline`);
  lines.push(`Easy runs executed correctly: ${signals.intensity.easyRunsActuallyEasy}/${signals.intensity.easyRunsActuallyEasy + signals.intensity.easyRunsTooHard}`);
  lines.push(`Intensity accuracy: ${signals.intensity.intensityAccuracy}%`);

  // SUPPRESS intensity warnings during recovery - elevated HR on easy runs is NORMAL post-ultra
  if (!overrides?.suppressIntensityViolations) {
    if (signals.intensity.needsIntensityConversation) {
      lines.push(`⚠️ PATTERN: ${signals.intensity.easyRunsTooHard} easy runs were too hard in past 2 weeks`);
      lines.push(`Consider: threshold miscalibration, pacing discipline, or external factors (heat, stress)`);
    }
    if (signals.intensity.recentViolations.length > 0) {
      lines.push(`Recent violations:`);
      for (const v of signals.intensity.recentViolations.slice(0, 3)) {
        lines.push(`  - ${formatShortDate(v.date)}: ${v.activityName} - planned ${v.plannedIntensity}, was ${v.actualIntensity} (${v.avgHR}bpm = ${v.zoneActual})`);
      }
    }
  } else if (signals.intensity.easyRunsTooHard > 0) {
    // During recovery, explain why HR might be elevated
    lines.push(`Note: ${signals.intensity.easyRunsTooHard} runs showed elevated HR - this is NORMAL post-major-effort (parasympathetic suppression, cardiac fatigue)`);
    lines.push(`Do NOT interpret as "training too hard" - interpret as "still recovering"`);
  }
  lines.push(``);

  // Fatigue
  lines.push(`### Fatigue Indicators`);
  lines.push(`Fatigue risk: ${signals.fatigue.fatigueRisk.toUpperCase()}`);
  if (signals.fatigue.cardiacDriftAvg !== null) {
    lines.push(`Cardiac drift proxy: ${signals.fatigue.cardiacDriftAvg > 0 ? '+' : ''}${signals.fatigue.cardiacDriftAvg}% (${signals.fatigue.cardiacDriftTrend})`);
  }
  lines.push(`Performance trend: ${signals.fatigue.performanceTrend}`);

  // CRITICAL: Suppress ACWR "detraining risk" warning during recovery
  if (signals.fatigue.acuteChronicRatio !== null) {
    if (overrides?.suppressAcwrWarnings) {
      // During recovery, low ACWR is GOOD, not a problem
      if (signals.fatigue.acuteChronicRatio < 0.8) {
        lines.push(`Acute:Chronic ratio: ${signals.fatigue.acuteChronicRatio} ✓ (low load is CORRECT during recovery - do NOT prescribe more volume)`);
      } else {
        lines.push(`Acute:Chronic ratio: ${signals.fatigue.acuteChronicRatio} (recovery mode)`);
      }
    } else {
      lines.push(`Acute:Chronic ratio: ${signals.fatigue.acuteChronicRatio} ${signals.fatigue.acuteChronicRatio > 1.5 ? '⚠️ elevated' : signals.fatigue.acuteChronicRatio < 0.8 ? '(detraining risk)' : '(optimal range)'}`);
    }
  }
  lines.push(``);

  // Major efforts
  if (signals.recentMajorEfforts.length > 0) {
    lines.push(`### Recent Major Efforts`);
    for (const effort of signals.recentMajorEfforts) {
      const status = effort.recoveryStatus === "still_recovering"
        ? `⚠️ still recovering (day ${effort.daysSince}/${effort.suggestedRecoveryDays})`
        : `✓ cleared`;
      lines.push(`- ${formatShortDate(effort.date)}: ${effort.name} (${effort.distanceKm}km ${effort.type}) - ${status}`);
    }
    lines.push(``);
  }

  return lines.join('\n');
}

// ============================================
// HELPERS
// ============================================

function round(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
