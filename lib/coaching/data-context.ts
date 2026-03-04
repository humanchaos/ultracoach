// UltraCoach Data Injection
// Prepares verified facts for the AI coach
// NO constraints, NO overrides — just clean data

import { Athlete, StravaActivity, UpcomingRace, PlannedWorkout } from "./types";
import { calculateCoachingSignals, formatSignalsForPrompt } from "./signals";
import { calculateHRZones, formatHRZonesForPrompt } from "./hr-zones";
import { JournalEntry, formatJournalForAI, DailyWorkout } from "../db";
import { calculateRecoveryState, formatRecoveryStateForPrompt, RecoveryState } from "./recovery-state";
import { analyzeRecentWorkouts, formatWorkoutAnalysisForPrompt } from "./workout-analyzer";

/**
 * Formats athlete data for prompt injection.
 * 
 * Philosophy: Give the AI coach the FACTS. Let them COACH.
 * 
 * We don't calculate "recovery status" and force the AI to follow it.
 * We show the AI "you ran 102km 3 days ago" and trust them to know
 * what that means for training.
 */

// ============================================
// DATA FORMATTING (facts only)
// ============================================

export function formatAthleteProfile(athlete: Athlete): string {
  const lines = [
    `## ATHLETE PROFILE`,
    ``,
    `Name: ${athlete.name}`,
    `Age: ${athlete.age}`,
    `Gender: ${athlete.gender}`,
  ];

  if (athlete.weight_kg) lines.push(`Weight: ${athlete.weight_kg}kg`);
  if (athlete.height_cm) lines.push(`Height: ${athlete.height_cm}cm`);

  // Heart rate data
  if (athlete.maxHR) lines.push(`Max HR: ${athlete.maxHR} bpm`);
  if (athlete.restingHR) lines.push(`Resting HR: ${athlete.restingHR} bpm`);

  // Fitness metrics (from Strava or user-provided)
  if (athlete.vo2max) lines.push(`VO2max: ${athlete.vo2max} ml/kg/min`);
  if (athlete.lactateThreshold) {
    lines.push(`Lactate Threshold HR: ${athlete.lactateThreshold.heartRate} bpm`);
    if (athlete.lactateThreshold.pace) {
      lines.push(`Lactate Threshold Pace: ${formatPace(athlete.lactateThreshold.pace)}/km`);
    }
  }
  if (athlete.ftp) lines.push(`FTP: ${athlete.ftp}W`);

  lines.push(``);
  lines.push(`Experience level: ${athlete.preferences.experienceLevel}`);
  lines.push(`Preferred training days: ${athlete.preferences.preferredDays.join(", ")}`);
  lines.push(`Max weekly volume preference: ${athlete.preferences.maxWeeklyVolume_km}km`);

  if (athlete.preferences.injuries.length > 0) {
    lines.push(`Injuries/considerations: ${athlete.preferences.injuries.join(", ")}`);
  }

  if (athlete.preferences.dietaryRestrictions.length > 0) {
    lines.push(`Dietary: ${athlete.preferences.dietaryRestrictions.join(", ")}`);
  }

  return lines.join('\n');
}

export function formatTrainingLog(activities: StravaActivity[]): string {
  if (activities.length === 0) {
    return `## TRAINING LOG\n\nNo activities recorded.`;
  }

  const sorted = [...activities]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const lines = [
    `## TRAINING LOG`,
    ``,
    `Last ${sorted.length} activities (most recent first):`,
    ``
  ];

  for (const activity of sorted) {
    const date = formatDate(new Date(activity.date));
    const distance = activity.distance_km.toFixed(1);
    const duration = formatDuration(activity.duration_minutes);
    const pace = activity.pace_min_per_km ? formatPace(activity.pace_min_per_km) : null;
    const hr = activity.average_hr ? `${activity.average_hr}bpm avg` : null;
    const elev = activity.elevation_gain_m ? `${activity.elevation_gain_m}m gain` : null;

    const details = [pace, hr, elev].filter(Boolean).join(" | ");

    // Equivalent flat distance for hilly runs  (+100m gain ≈ +1km flat)
    const equivFlat = activity.elevation_gain_m
      ? ` (≈${(activity.distance_km + activity.elevation_gain_m / 100).toFixed(1)}km equiv flat)`
      : '';

    lines.push(`• ${date}: ${activity.name}`);
    lines.push(`  ${distance}km in ${duration}${details ? ` (${details})` : ''}${equivFlat}`);
  }

  // Add summary statistics
  lines.push(``);
  lines.push(`### Recent Volume Summary`);
  lines.push(formatVolumeSummary(sorted));

  return lines.join('\n');
}

export function formatUpcomingRaces(races: UpcomingRace[]): string {
  if (races.length === 0) {
    return `## UPCOMING RACES\n\nNo races scheduled.`;
  }

  const sorted = [...races]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const lines = [
    `## UPCOMING RACES`,
    ``
  ];

  const today = new Date();

  for (const race of sorted) {
    const raceDate = new Date(race.date);
    const daysUntil = Math.floor((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weeksUntil = Math.floor(daysUntil / 7);

    lines.push(`### ${race.name} [${race.priority}-priority]`);
    lines.push(`Date: ${formatDate(raceDate)} (${daysUntil} days / ${weeksUntil} weeks away)`);
    lines.push(`Distance: ${race.distance_km}km`);

    // Add elevation profile if available
    if (race.elevation_gain_m || race.elevation_loss_m) {
      const gain = race.elevation_gain_m || 0;
      const loss = race.elevation_loss_m || gain; // Default to gain if loss not specified
      const vertDensity = race.distance_km > 0 ? Math.round(gain / race.distance_km) : 0;
      lines.push(`Elevation: +${gain}m / -${loss}m (${vertDensity}m/km)`);
    }

    if (race.terrain) lines.push(`Terrain: ${race.terrain}`);
    if (race.goalTime) lines.push(`Goal time: ${race.goalTime}`);
    lines.push(``);
  }

  return lines.join('\n');
}

export function formatVolumeSummary(activities: StravaActivity[]): string {
  const now = new Date();
  const runs = activities.filter(a => a.type === "Run");
  const nonRuns = activities.filter(a => a.type !== "Run");

  // Calculate weekly volumes for the last 4 weeks
  const weeks: { start: Date; end: Date; volume: number; count: number; crossTrainKm: number; elevationM: number }[] = [];

  for (let i = 0; i < 4; i++) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - (i * 7));
    weekEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const weekRuns = runs.filter(a => {
      const d = new Date(a.date);
      return d >= weekStart && d <= weekEnd;
    });

    const weekNonRuns = nonRuns.filter(a => {
      const d = new Date(a.date);
      return d >= weekStart && d <= weekEnd;
    });

    const crossTrainKm = weekNonRuns.reduce((sum, a) => {
      const multiplier = a.type === "Ride" ? 0.3 : a.type === "Swim" ? 0.4 : a.type === "Hike" ? 0.8 : 0;
      return sum + a.distance_km * multiplier;
    }, 0);

    const elevationM = weekRuns.reduce((sum, a) => sum + (a.elevation_gain_m || 0), 0);

    weeks.push({
      start: weekStart,
      end: weekEnd,
      volume: weekRuns.reduce((sum, a) => sum + a.distance_km, 0),
      count: weekRuns.length,
      crossTrainKm,
      elevationM,
    });
  }

  const lines: string[] = [];

  weeks.forEach((week, i) => {
    const label = i === 0 ? "This week" : i === 1 ? "Last week" : `${i + 1} weeks ago`;
    const crossNote = week.crossTrainKm > 0 ? ` + ${week.crossTrainKm.toFixed(1)}km cross-train equiv` : '';
    const elevNote = week.elevationM > 0 ? ` | ${week.elevationM}m vert` : '';
    lines.push(`${label}: ${week.volume.toFixed(1)}km running${crossNote} across ${week.count} runs${elevNote}`);
  });

  // Find longest run in past 30 days
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentRuns = runs.filter(a => new Date(a.date) >= thirtyDaysAgo);
  if (recentRuns.length > 0) {
    const longest = recentRuns.reduce((max, a) => a.distance_km > max.distance_km ? a : max);
    lines.push(``);
    lines.push(`Longest run (30 days): ${longest.distance_km.toFixed(1)}km on ${formatDate(new Date(longest.date))}`);
  }

  return lines.join('\n');
}

export function formatDataAvailability(athlete: Athlete, activities: StravaActivity[]): string {
  const lines = [
    `## DATA AVAILABILITY`,
    ``
  ];

  // What we have
  const hasHR = activities.some(a => a.average_hr);
  const hasElevation = activities.some(a => a.elevation_gain_m);
  const hasPace = activities.some(a => a.pace_min_per_km);

  lines.push(`Available from Strava:`);
  lines.push(`• ${activities.length} activities`);
  lines.push(`• Heart rate data: ${hasHR ? 'Yes' : 'No'}`);
  lines.push(`• Elevation data: ${hasElevation ? 'Yes' : 'No'}`);
  lines.push(`• Pace data: ${hasPace ? 'Yes' : 'No'}`);

  lines.push(``);
  lines.push(`Not available (ask if relevant):`);
  lines.push(`• Sleep data`);
  lines.push(`• Nutrition/hydration`);
  lines.push(`• Strength training (unless logged)`);
  lines.push(`• Subjective feel / RPE`);
  if (!athlete.vo2max) lines.push(`• VO2max`);
  if (!athlete.lactateThreshold) lines.push(`• Lactate threshold`);

  return lines.join('\n');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs === 0) return `${mins}min`;
  return `${hrs}h${mins > 0 ? ` ${mins}min` : ''}`;
}

// ============================================
// MAIN EXPORT: Build complete data context
// ============================================

export interface TrainingBlockData {
  weeklyWorkouts: Record<string, DailyWorkout[]>;
  startDate: Date;
  currentWeek: number;
}

export interface DataContext {
  athlete: Athlete;
  activities: StravaActivity[];
  races: UpcomingRace[];
  lastSyncTime: Date | null;
  plannedWorkouts?: PlannedWorkout[]; // Optional - for compliance tracking
  journalEntries?: JournalEntry[];     // Optional - wellness data (last 7-30 days)
  trainingBlock?: TrainingBlockData;   // Optional - for workout analysis
}

export function buildDataContext(input: DataContext): string {
  const { athlete, activities, races, lastSyncTime, plannedWorkouts, journalEntries, trainingBlock } = input;

  // STEP 1: Calculate recovery state FIRST
  // This determines if we're in post-race recovery and which signals should be suppressed
  const recoveryState = calculateRecoveryState({
    activities,
    races,
    athleteAge: athlete.age || undefined,
    highLifeStress: false, // TODO: Could pull from journal
    extremeRaceConditions: false, // TODO: Could pull from race metadata
  });

  // STEP 2: Calculate coaching signals (knowing recovery context)
  const signals = calculateCoachingSignals(activities, athlete, plannedWorkouts);

  // Calculate HR zones
  const zones = calculateHRZones(athlete, activities);

  // Format journal (wellness) data
  const journalContext = journalEntries ? formatJournalForAI(journalEntries) : '';

  // STEP 3: Analyze recent workouts against the plan (if training block available)
  let workoutAnalysisContext = '';
  if (trainingBlock && trainingBlock.weeklyWorkouts && Object.keys(trainingBlock.weeklyWorkouts).length > 0) {
    const analyses = analyzeRecentWorkouts(
      activities,
      trainingBlock.weeklyWorkouts,
      trainingBlock.startDate,
      7 // Look back 7 days
    );
    workoutAnalysisContext = formatWorkoutAnalysisForPrompt(analyses);
  }

  const sections = [
    `# ATHLETE DATA`,
    ``,
    `Data as of: ${lastSyncTime ? formatDate(lastSyncTime) : 'Unknown'}`,
    ``,
    // CRITICAL: Recovery status goes FIRST, before any other signals
    formatRecoveryStateForPrompt(recoveryState),
    ``,
    formatAthleteProfile(athlete),
    ``,
    formatUpcomingRaces(races),
    ``,
    // HR Zones (personalized)
    formatHRZonesForPrompt(zones),
    ``,
    // Coaching signals (compliance, fatigue, intensity) - SUPPRESSED appropriately if in recovery
    formatSignalsForPrompt(signals, recoveryState.signalOverrides),
    ``,
    // Workout analysis (comparison of actual vs planned)
    workoutAnalysisContext,
    ``,
    // Wellness/Journal data (sleep, stress, nutrition)
    journalContext,
    ``,
    formatTrainingLog(activities),
    ``,
    formatDataAvailability(athlete, activities),
  ];

  return sections.join('\n');
}

// Export RecoveryState type for use in other modules
export type { RecoveryState };
