// HR Zones Calculator
// Calculates personalized heart rate zones
// Prevents using fixed thresholds that don't fit individual athletes

import { Athlete, StravaActivity, HRZones } from "./types";

// Minimal lactate test shape needed for zone calculation
export interface LactateZoneInput {
  z1_hr?: string | null;
  z2_hr?: string | null;
  z3_hr?: string | null;
  z4_hr?: string | null;
  z5_hr?: string | null;
  max_hr?: number | null;
}

// Parse "104-126" → { min: 104, max: 126 }
function parseZoneString(s: string | null | undefined): { min: number; max: number } | null {
  if (!s) return null;
  const [a, b] = s.split('-').map(Number);
  if (!isFinite(a) || !isFinite(b)) return null;
  return { min: a, max: b };
}

// Build HRZones directly from saved lab test zones — no estimates needed
function buildLactateZones(lactate: LactateZoneInput): HRZones | null {
  const z1 = parseZoneString(lactate.z1_hr);
  const z2 = parseZoneString(lactate.z2_hr);
  const z3 = parseZoneString(lactate.z3_hr);
  const z4 = parseZoneString(lactate.z4_hr);
  const z5 = parseZoneString(lactate.z5_hr);

  // Need at least 4 zones to be useful; zone5 max anchors to max_hr
  if (!z1 || !z2 || !z3 || !z4) return null;

  const maxHR = lactate.max_hr ?? (z5?.max ?? z4.max + 10);
  const z5Final = z5 ?? { min: z4.max, max: maxHR };

  return {
    method: "lactate_anchored",
    maxHR,
    restingHR: 0, // not used in lactate-anchored model
    zones: {
      zone1: { ...z1, name: "Recovery" },
      zone2: { ...z2, name: "Easy/Aerobic" },
      zone3: { ...z3, name: "Tempo" },
      zone4: { ...z4, name: "Threshold" },
      zone5: { ...z5Final, name: "VO2max" },
    },
  };
}

// Fallback: Age-based max HR estimation
function estimateMaxHR(age: number): number {
  // Tanaka formula (more accurate than 220-age)
  return Math.round(208 - 0.7 * age);
}

// Estimate resting HR if not provided (conservative default)
const DEFAULT_RESTING_HR = 60;

// Try to detect max HR from activity data
function detectMaxHRFromActivities(activities: StravaActivity[]): number | null {
  const maxHRValues = activities
    .filter(a => a.max_hr && a.max_hr > 100) // Filter out bad data
    .map(a => a.max_hr!);

  if (maxHRValues.length < 3) return null; // Not enough data

  // Take 95th percentile to avoid outliers
  maxHRValues.sort((a, b) => b - a);
  const idx = Math.floor(maxHRValues.length * 0.05);
  return maxHRValues[idx];
}

// Try to estimate resting HR from easy activity data
function detectRestingHRFromActivities(activities: StravaActivity[]): number | null {
  // Look at easy/recovery runs for minimum average HR
  const easyRuns = activities.filter(a => {
    // Heuristic: slow pace likely = easy effort
    return a.pace_min_per_km && a.pace_min_per_km > 6 && a.average_hr;
  });

  if (easyRuns.length < 3) return null;

  const avgHRs = easyRuns.map(a => a.average_hr!).sort((a, b) => a - b);
  // Resting HR is typically ~40-50 BPM below easy running HR
  const lowestEasyHR = avgHRs[Math.floor(avgHRs.length * 0.1)];
  return Math.max(40, lowestEasyHR - 45); // Rough estimate
}

export function calculateHRZones(
  athlete: Athlete,
  activities: StravaActivity[],
  lactate?: LactateZoneInput | null
): HRZones {
  // Priority 1: lab-measured lactate zones (most accurate)
  if (lactate) {
    const lactateZones = buildLactateZones(lactate);
    if (lactateZones) return lactateZones;
  }

  let maxHR: number;
  let restingHR: number;
  let method: HRZones["method"];

  // Priority 2: athlete-defined maxHR + restingHR > detected from data > age-estimated
  if (athlete.maxHR && athlete.restingHR) {
    maxHR = athlete.maxHR;
    restingHR = athlete.restingHR;
    method = "athlete_defined";
  } else {
    const detectedMax = detectMaxHRFromActivities(activities);
    const detectedResting = detectRestingHRFromActivities(activities);

    // Use detected data first, then age-based estimate (default to 35 if age unknown)
    maxHR = athlete.maxHR || detectedMax || estimateMaxHR(athlete.age ?? 35);
    restingHR = athlete.restingHR || detectedResting || DEFAULT_RESTING_HR;
    method = detectedMax ? "karvonen" : "estimated";
  }

  // Karvonen formula for zone calculation
  const hrReserve = maxHR - restingHR;

  function zoneHR(minPercent: number, maxPercent: number): { min: number; max: number } {
    return {
      min: Math.round(restingHR + hrReserve * minPercent),
      max: Math.round(restingHR + hrReserve * maxPercent),
    };
  }

  return {
    method,
    maxHR,
    restingHR,
    zones: {
      zone1: { ...zoneHR(0.50, 0.60), name: "Recovery" },
      zone2: { ...zoneHR(0.60, 0.70), name: "Easy/Aerobic" },
      zone3: { ...zoneHR(0.70, 0.80), name: "Tempo" },
      zone4: { ...zoneHR(0.80, 0.90), name: "Threshold" },
      zone5: { ...zoneHR(0.90, 1.00), name: "VO2max" },
    },
  };
}

// Classify an activity's intensity based on personalized zones
export function classifyActivityIntensity(
  activity: StravaActivity,
  zones: HRZones
): "recovery" | "easy" | "moderate" | "hard" | "max" | "unknown" {
  if (!activity.average_hr) return "unknown";

  const hr = activity.average_hr;

  if (hr <= zones.zones.zone1.max) return "recovery";
  if (hr <= zones.zones.zone2.max) return "easy";
  if (hr <= zones.zones.zone3.max) return "moderate";
  if (hr <= zones.zones.zone4.max) return "hard";
  return "max";
}

// Format for prompt injection
export function formatHRZonesForPrompt(zones: HRZones): string {
  const methodNote = zones.method === "lactate_anchored"
    ? "Anchored to lab lactate test — LT1/LT2 measured thresholds (most accurate)"
    : zones.method === "athlete_defined"
      ? "Based on athlete's configured values"
      : zones.method === "estimated"
        ? "Estimated from age (recommend athlete performs max HR test for accuracy)"
        : "Calculated from training data";

  const lines = [
    `HEART RATE ZONES (${methodNote}):`,
    `- Max HR: ${zones.maxHR} bpm`,
    `- Resting HR: ${zones.restingHR} bpm`,
    ``,
    `Zone 1 (Recovery):     ${zones.zones.zone1.min}-${zones.zones.zone1.max} bpm`,
    `Zone 2 (Easy/Aerobic): ${zones.zones.zone2.min}-${zones.zones.zone2.max} bpm`,
    `Zone 3 (Tempo):        ${zones.zones.zone3.min}-${zones.zones.zone3.max} bpm`,
    `Zone 4 (Threshold):    ${zones.zones.zone4.min}-${zones.zones.zone4.max} bpm`,
    `Zone 5 (VO2max):       ${zones.zones.zone5.min}-${zones.maxHR} bpm`,
    ``,
    `When prescribing workouts, reference these SPECIFIC zones for this athlete.`,
    `Example: "Easy run in Zone 2 (${zones.zones.zone2.min}-${zones.zones.zone2.max} bpm)"`,
  ];

  return lines.join('\n');
}

// Check if athlete went too hard on an easy day
export function checkIntensityCompliance(
  planned: "easy" | "moderate" | "hard",
  actual: StravaActivity,
  zones: HRZones
): { compliant: boolean; message: string; severity: "ok" | "minor" | "major" } {
  if (!actual.average_hr) {
    return { compliant: true, message: "No HR data to verify", severity: "ok" };
  }

  const actualIntensity = classifyActivityIntensity(actual, zones);

  const intensityOrder = ["recovery", "easy", "moderate", "hard", "max"];
  const plannedIdx = intensityOrder.indexOf(planned === "easy" ? "easy" : planned === "moderate" ? "moderate" : "hard");
  const actualIdx = intensityOrder.indexOf(actualIntensity);

  if (actualIdx <= plannedIdx) {
    return { compliant: true, message: "Intensity as planned or easier", severity: "ok" };
  }

  const diff = actualIdx - plannedIdx;
  if (diff === 1) {
    return {
      compliant: false,
      message: `Slightly too hard: planned ${planned}, actual was ${actualIntensity} (avg HR ${actual.average_hr})`,
      severity: "minor"
    };
  }

  return {
    compliant: false,
    message: `Significantly too hard: planned ${planned}, actual was ${actualIntensity} (avg HR ${actual.average_hr})`,
    severity: "major",
  };
}
