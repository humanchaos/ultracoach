import { NextResponse } from "next/server";
import { SYSTEM_PROMPT, buildDataContext, type Athlete, type StravaActivity, type UpcomingRace } from "@/lib/coaching";
import { validateWeeklyVolume, rescaleWorkouts, checkMacroDrift } from "@/lib/coaching/logic";
import { auth } from "@/lib/auth";
import {
    getActiveTrainingBlock,
    formatBlockForAI,
    getUserRaces,
    getStoredWeeklyWorkouts,
    saveWeeklyWorkouts,
    getCurrentWeekInBlock,
    getBlockTargetsForWeek,
    formatTargetsAsConstraints,
    updateTrainingBlockStatus,
    type DailyWorkout
} from "@/lib/db";

export const maxDuration = 30;

interface DayPlan {
    day: string;
    date: string;
    type: "run" | "rest" | "cross" | "long" | "recovery" | "tempo" | "intervals";
    title: string;
    description: string;
    duration?: string;
    distance_km?: number;
    elevation_m?: number;  // NEW: vertical gain target from training block
    intensity: "easy" | "moderate" | "hard";
    hrZone?: string;       // e.g., "Zone 2 (60-70% max HR)" or "140-150 bpm"
    targetPace?: string;   // e.g., "6:30-7:00/km" or "conversational"
    effortLevel?: string;  // e.g., "RPE 3-4" or "Easy - can hold conversation"
    nutrition?: string;    // e.g., "Eat 2h before. Bring gel for runs >1h"
    recovery?: string;     // NEW: Evening recovery suggestions
    corosZone?: string;    // COROS watch equivalent zone label
    rationale: string;
}

interface TrainingPlanResponse {
    weekPlan: DayPlan[];
    weekSummary: string;
    adjustmentNote?: string;
    fromStorage?: boolean; // New: indicates if plan came from DB
}

// Adapter: Convert incoming activity data to v3 StravaActivity format
function adaptActivities(activities: Array<{
    id?: string;
    name: string;
    date: string;
    dateISO?: string;  // ISO date for accurate parsing (preferred)
    distance_km: number;
    duration_minutes?: number;
    pace?: string;
    heart_rate?: number;
    elevation_gain_m?: number;
    type?: string;
}>): StravaActivity[] {
    return activities
        .map((a, i) => {
            const date = a.dateISO ? new Date(a.dateISO) : parseActivityDate(a.date);
            if (!date) return null;
            return {
                id: a.id || `activity-${i}`,
                name: a.name,
                date,
                distance_km: a.distance_km,
                duration_minutes: a.duration_minutes || 0,
                pace_min_per_km: a.pace ? parsePace(a.pace) : undefined,
                average_hr: a.heart_rate,
                elevation_gain_m: a.elevation_gain_m,
                type: (a.type === "Run" || a.type === "Walk" || a.type === "Hike" ||
                    a.type === "Ride" || a.type === "Swim") ? a.type : "Run" as const,
            };
        })
        .filter((a): a is StravaActivity => a !== null);
}

// Parse activity date - handles "Mon, Dec 29" format
function parseActivityDate(dateStr: string): Date | null {
    const currentYear = new Date().getFullYear();
    const match = dateStr.match(/([A-Za-z]+),?\s*([A-Za-z]+)\s+(\d+)/);
    if (match) {
        const monthStr = match[2];
        const day = parseInt(match[3]);
        const months: { [key: string]: number } = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        const month = months[monthStr.toLowerCase().slice(0, 3)];
        if (month !== undefined) return new Date(currentYear, month, day);
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
    console.warn(`[parseActivityDate] Failed to parse date: "${dateStr}" — activity skipped`);
    return null;
}

function parsePace(paceStr: string): number | undefined {
    const match = paceStr.match(/(\d+):(\d+)/);
    if (match) return parseInt(match[1]) + parseInt(match[2]) / 60;
    return undefined;
}

// Adapter: Convert races to v3 format
function adaptRaces(races: Array<{
    id?: number | string;
    name: string;
    date: string;
    distance_km: number;
    goal_time?: string;
    priority?: string;
}>): UpcomingRace[] {
    return races.map(r => ({
        id: String(r.id || r.name),
        name: r.name,
        date: new Date(r.date),
        distance_km: r.distance_km,
        goalTime: r.goal_time,
        priority: (r.priority === "A" || r.priority === "B" || r.priority === "C")
            ? r.priority : "B" as const,
    }));
}

// Create an Athlete from available data
function createAthlete(profile?: {
    name?: string;
    age?: number;
    gender?: string;
    weight_kg?: number;
    height_cm?: number;
    maxHR?: number;
    restingHR?: number;
}, preferences?: {
    preferred_days?: string[];
    max_weekly_volume_km?: number;
    injuries?: string[];
    dietary?: string[];
    experience?: string;
}): Athlete {
    return {
        id: "athlete-1",
        name: profile?.name || "Athlete",
        age: profile?.age || null,  // Don't assume age - AI should ask if needed
        gender: (profile?.gender === "male" || profile?.gender === "female")
            ? profile.gender : "other",
        weight_kg: profile?.weight_kg,
        height_cm: profile?.height_cm,
        maxHR: profile?.maxHR,
        restingHR: profile?.restingHR,
        signupDate: new Date(),
        preferences: {
            preferredDays: preferences?.preferred_days || ["Mon", "Wed", "Fri", "Sun"],
            maxWeeklyVolume_km: preferences?.max_weekly_volume_km || 80,
            injuries: preferences?.injuries || [],
            dietaryRestrictions: preferences?.dietary || [],
            experienceLevel: (preferences?.experience === "beginner" ||
                preferences?.experience === "intermediate" ||
                preferences?.experience === "advanced" ||
                preferences?.experience === "elite")
                ? preferences.experience : "intermediate",
        },
    };
}

// V3 Plan Request - Now requires specific HR zones and pace targets
const PLAN_REQUEST = `
Based on everything you know about this athlete — their training history, upcoming races, current fitness, and what their body needs right now — create a training plan for the next 7 days.

For EVERY running session, you MUST specify:
- Type of session (rest, easy run, long run, tempo, intervals, cross-training)
- Duration and/or distance  
- SPECIFIC heart rate zone (e.g., "Zone 2: 130-145 bpm" or "Zone 4: 165-175 bpm")
- SPECIFIC pace target (e.g., "6:00-6:30/km" or "5:15/km for 5x1km")
- Effort level description (e.g., "Conversational pace" or "Comfortably hard")
- Why this session on this day

Be SPECIFIC with numbers. Athletes need exact targets, not vague guidance.

You MUST respond with ONLY valid JSON in this exact format:
{
  "weekPlan": [
    {
      "day": "Mon",
      "date": "Jan 6",
      "type": "easy",
      "title": "Easy Recovery Run",
      "description": "30 minutes at conversational pace. Keep your heart rate low.",
      "duration": "30 min",
      "distance_km": 5,
      "intensity": "easy",
      "hrZone": "Zone 2: 130-145 bpm (60-70% max HR)",
      "targetPace": "6:30-7:00/km",
      "effortLevel": "Conversational - you should be able to talk easily",
      "rationale": "Active recovery after your long run. Flush out fatigue without adding stress."
    },
    {
      "day": "Tue",
      "date": "Jan 7",
      "type": "tempo",
      "title": "Tempo Run",
      "description": "10 min warmup, 20 min at threshold, 10 min cooldown",
      "duration": "40 min",
      "distance_km": 8,
      "intensity": "moderate",
      "hrZone": "Zone 4: 160-170 bpm (80-90% max HR)",
      "targetPace": "5:15-5:30/km for tempo portion",
      "effortLevel": "Comfortably hard - can speak in short phrases only",
      "rationale": "Build lactate threshold fitness for your upcoming 50K"
    },
    {
      "day": "Wed",
      "date": "Jan 8",
      "type": "rest",
      "title": "Rest Day",
      "description": "Complete rest or light stretching/yoga",
      "duration": null,
      "distance_km": null,
      "intensity": "easy",
      "hrZone": null,
      "targetPace": null,
      "effortLevel": "No running today",
      "rationale": "Recovery after threshold work"
    }
  ],
  "weekSummary": "Build week - 45km total with quality tempo session",
  "adjustmentNote": "Adjust pace down by 10-15 sec/km if feeling fatigued"
}

IMPORTANT: Every run MUST have hrZone, targetPace, and effortLevel filled in with specific numbers!
`;

// Enhancement prompt - preserves workout structure, only adds targets
const ENHANCE_REQUEST = `
I have an existing training plan that needs HR zones, pace targets, and effort descriptions added.
DO NOT change the workout type, duration, distance, or title. Only ADD the missing training targets.

For each workout, fill in ONLY these fields:
- hrZone: Specific heart rate zone (e.g., "Zone 2: 130-145 bpm")
- targetPace: Specific pace target (e.g., "6:00-6:30/km")
- effortLevel: Effort description (e.g., "Conversational - can talk easily")
- rationale: Why this workout (brief explanation)

EXISTING WORKOUTS (preserve structure exactly):
`;

// Convert stored DailyWorkout to DayPlan for UI
// Always calculates dates relative to the CURRENT date (today)
function storedWorkoutsToDayPlan(workouts: DailyWorkout[]): DayPlan[] {
    const dayMap: Record<string, number> = {
        'monday': 0, 'mon': 0,
        'tuesday': 1, 'tue': 1,
        'wednesday': 2, 'wed': 2,
        'thursday': 3, 'thu': 3,
        'friday': 4, 'fri': 4,
        'saturday': 5, 'sat': 5,
        'sunday': 6, 'sun': 6,
    };
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const today = new Date();

    // Find Monday of current week
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    // Sort workouts by day of week and map to correct dates
    const sortedWorkouts = [...workouts].sort((a, b) => {
        const dayA = dayMap[a.day.toLowerCase()] ?? 0;
        const dayB = dayMap[b.day.toLowerCase()] ?? 0;
        return dayA - dayB;
    });

    return sortedWorkouts.map((w) => {
        // Get the day index from the stored day name
        const dayIndex = dayMap[w.day.toLowerCase()] ?? 0;

        const date = new Date(monday);
        date.setDate(monday.getDate() + dayIndex);

        return {
            day: dayNames[dayIndex],
            date: `${monthNames[date.getMonth()]} ${date.getDate()}`,
            type: mapWorkoutType(w.type),
            title: w.type,
            description: w.description || `${w.type} ${w.distance_km ? `- ${w.distance_km}km` : ''}`,
            duration: w.duration_min ? `${w.duration_min} min` : undefined,
            distance_km: w.distance_km,
            elevation_m: w.elevation_m,  // NEW: pass through vertical gain target
            intensity: mapIntensity(w.intensity || w.type),
            hrZone: w.hrZone,
            targetPace: w.targetPace,
            effortLevel: w.effortLevel,
            nutrition: w.nutrition,
            recovery: w.recovery,  // NEW: pass through evening recovery suggestions
            corosZone: w.corosZone || mapCorosZone(w.type),  // Compute on-the-fly for old data
            rationale: w.rationale || `Stored from training block`,
        };
    });
}



function mapWorkoutType(type: string): DayPlan['type'] {
    const lower = type.toLowerCase();
    if (lower.includes('rest')) return 'rest';
    if (lower.includes('long')) return 'long';
    if (lower.includes('tempo') || lower.includes('threshold')) return 'tempo';
    if (lower.includes('interval') || lower.includes('speed')) return 'intervals';
    if (lower.includes('recovery')) return 'recovery';
    if (lower.includes('cross')) return 'cross';
    return 'run';
}

function mapIntensity(input: string): DayPlan['intensity'] {
    const lower = input.toLowerCase();
    if (lower.includes('easy') || lower.includes('zone 2') || lower.includes('recovery')) return 'easy';
    if (lower.includes('hard') || lower.includes('interval') || lower.includes('zone 4') || lower.includes('zone 5')) return 'hard';
    return 'moderate';
}

// Map workout type to COROS watch zone equivalent (for backward compat with old stored data)
function mapCorosZone(type: string): string {
    const t = type.toLowerCase();
    if (t === 'rest') return 'N/A';
    if (t.includes('recovery') || t.includes('back-to-back')) return 'Z1 Recovery · Easy (RPE)';
    if (t.includes('easy') || t === 'long run' || t.includes('medium long')) return 'Z2 Aerobic Endurance · Easy (RPE)';
    if (t.includes('progression') || t.includes('opener')) return 'Z2→Z3 Aerobic End. → Aerobic Pwr · Easy→Moderate (RPE)';
    if (t.includes('tempo')) return 'Z3 Aerobic Power · Moderate (RPE)';
    if (t.includes('lt2') || t.includes('sharpener')) return 'Z4 Threshold · Hard (RPE)';
    if (t.includes('interval') || t.includes('vo2')) return 'Z5 Anaerobic Endurance · Very Hard (RPE)';
    if (t.includes('hill') || t.includes('power hike')) return 'Z3–Z4 Aerobic Pwr–Threshold · Hard (RPE)';
    if (t.includes('simulation') || t.includes('race pace')) return 'Z2–Z3 Aerobic End.–Aerobic Pwr · Moderate (RPE)';
    return 'Z2 Aerobic Endurance · Easy (RPE)';
}

// Normalize AI-generated plan dates to the CURRENT week
// This ensures "Today" appears correctly by recalculating dates from day names
function normalizeWeekPlanDates(weekPlan: DayPlan[]): DayPlan[] {
    const dayMap: Record<string, number> = {
        'monday': 0, 'mon': 0,
        'tuesday': 1, 'tue': 1,
        'wednesday': 2, 'wed': 2,
        'thursday': 3, 'thu': 3,
        'friday': 4, 'fri': 4,
        'saturday': 5, 'sat': 5,
        'sunday': 6, 'sun': 6,
    };
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const today = new Date();
    // Find Monday of current week
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    return weekPlan.map((plan) => {
        const dayIndex = dayMap[plan.day.toLowerCase()] ?? 0;
        const date = new Date(monday);
        date.setDate(monday.getDate() + dayIndex);

        return {
            ...plan,
            day: dayNames[dayIndex],
            date: `${monthNames[date.getMonth()]} ${date.getDate()}`,
        };
    });
}

// Convert DayPlan to DailyWorkout for storage
function dayPlanToStoredWorkouts(plan: DayPlan[]): DailyWorkout[] {
    const fullDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return plan.map((p, i) => ({
        day: fullDays[i] || p.day,
        type: p.title || p.type,
        distance_km: p.distance_km,
        duration_min: p.duration ? parseInt(p.duration) : undefined,
        description: p.description,
        intensity: p.intensity,
        hrZone: p.hrZone,
        targetPace: p.targetPace,
        effortLevel: p.effortLevel,
        nutrition: p.nutrition,
        corosZone: p.corosZone || mapCorosZone(p.title || p.type),
        rationale: p.rationale,
    }));
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {
            trainingContext,
            racesContext,
            preferencesContext,
            currentDate,
            activities,
            races,
            athleteProfile,
            athletePreferences,
            forceRegenerate,
            existingWorkouts,  // For enhance mode
            enhanceOnly,       // Only add HR/pace, don't change structure
        } = body;

        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "API key not configured" }, { status: 500 });
        }

        // ============================================
        // CHECK FOR STORED WORKOUTS FIRST (STABILITY)
        // ============================================
        let blockId: number | null = null;
        let currentWeek: number = 1;
        let blockContext = '';

        let weekTargets: ReturnType<typeof getBlockTargetsForWeek> | null = null;
        let volumeConstraints = '';

        try {
            const session = await auth();
            if (session?.user?.stravaId) {
                const block = await getActiveTrainingBlock(session.user.stravaId);
                if (block) {
                    blockId = block.id;
                    currentWeek = getCurrentWeekInBlock(block);

                    // ============================================
                    // LAYER 3: DRIFT DETECTION - Check if plan is compromised
                    // ============================================
                    if (block.status === 'compromised') {
                        return NextResponse.json({
                            error: 'Plan compromised',
                            message: 'Your training plan has drifted too far from the macro targets. Please regenerate your training block.',
                            needsRegeneration: true,
                        }, { status: 400 });
                    }

                    // Check for drift (skip on first week)
                    if (currentWeek > 1 && activities && activities.length > 0) {
                        const v3Activities = adaptActivities(activities);
                        const driftReport = checkMacroDrift(block, v3Activities, currentWeek);

                        if (driftReport.isDrifted) {
                            console.log(`[Training Plan API] Drift detected: ${driftReport.reason}`);
                            await updateTrainingBlockStatus(block.id, 'compromised');
                            return NextResponse.json({
                                error: 'Plan compromised',
                                message: driftReport.reason,
                                weeklyDeficits: driftReport.weeklyDeficits,
                                needsRegeneration: true,
                            }, { status: 400 });
                        }
                    }

                    // ============================================
                    // LAYER 1: CONTEXT INJECTION - Get strict targets
                    // ============================================
                    weekTargets = getBlockTargetsForWeek(block, currentWeek);
                    volumeConstraints = formatTargetsAsConstraints(weekTargets);
                    console.log(`[Training Plan API] Week ${currentWeek} targets: ${weekTargets.targetVolume}km (${weekTargets.phaseName})`);

                    // Get the race for this block
                    const allRaces = await getUserRaces(session.user.stravaId);
                    const blockRace = allRaces.find(r => r.id === block.race_id);
                    blockContext = formatBlockForAI(block, blockRace);

                    // Check for stored workouts (unless forcing regeneration)
                    if (forceRegenerate) {
                        console.log(`[Training Plan API] Force regenerate requested - skipping stored workouts`);
                    }
                    if (!forceRegenerate) {
                        const storedWorkouts = await getStoredWeeklyWorkouts(block.id, currentWeek);
                        if (storedWorkouts && storedWorkouts.length > 0) {
                            console.log(`[Training Plan API] Using stored workouts for week ${currentWeek}`);
                            const weekPlan = storedWorkoutsToDayPlan(storedWorkouts);
                            return NextResponse.json({
                                weekPlan,
                                weekSummary: `Week ${currentWeek} of ${block.block_plan.totalWeeks} - ${blockRace?.name || 'Training Block'}`,
                                fromStorage: true,
                            });
                        }
                    }

                    console.log(`[Training Plan API] Generating fresh workouts for week ${currentWeek}...`);
                }
            }
        } catch (e) {
            console.error("[Training Plan API] Block fetch error:", e);
        }

        // ============================================
        // GENERATE NEW WORKOUTS (only if not stored)
        // ============================================

        // Build v3 simplified prompt: SYSTEM_PROMPT + dataContext
        const v3Activities = activities ? adaptActivities(activities) : [];
        const v3Races = races ? adaptRaces(races) : [];
        const athlete = createAthlete(athleteProfile, athletePreferences);

        const dataContext = buildDataContext({
            athlete,
            activities: v3Activities,
            races: v3Races,
            lastSyncTime: new Date(),
        });

        // Combine system prompt with data context (v3 architecture)
        const systemPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${dataContext}`;
        console.log("[Training Plan API] Generating with AI (will store for stability)");

        // Build user prompt with current date, block context, and legacy context
        let userPrompt: string;

        if (enhanceOnly && existingWorkouts && existingWorkouts.length > 0) {
            // Enhancement mode: preserve workout structure, only add HR/pace/effort
            console.log(`[Training Plan API] Enhance mode - adding targets to ${existingWorkouts.length} existing workouts`);
            userPrompt = `${ENHANCE_REQUEST}

${JSON.stringify(existingWorkouts, null, 2)}

TODAY'S DATE: ${currentDate}

Return the SAME workouts with hrZone, targetPace, effortLevel, and rationale added.
Keep day, date, type, title, duration, distance_km, and intensity EXACTLY the same.
Respond with ONLY valid JSON: { "weekPlan": [...], "weekSummary": "..." }`;
        } else {
            // Normal mode: generate full plan with volume constraints
            userPrompt = `${PLAN_REQUEST}

TODAY'S DATE: ${currentDate}

${volumeConstraints ? `--- VOLUME CONSTRAINTS (MANDATORY) ---\n${volumeConstraints}\n\n` : ""}${blockContext ? `--- TRAINING BLOCK (MUST FOLLOW) ---\n${blockContext}\n` : ""}
${trainingContext ? `--- ADDITIONAL TRAINING CONTEXT ---\n${trainingContext}\n` : ""}
${racesContext ? `--- ADDITIONAL RACE CONTEXT ---\n${racesContext}\n` : ""}
${preferencesContext ? `--- ADDITIONAL PREFERENCES ---\n${preferencesContext}\n` : ""}`;
        }

        // Call Gemini API - use temperature 0 for more deterministic results
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: enhanceOnly ? 0.1 : 0.3, // Lower temp for enhancement
                        topP: 0.9,
                        maxOutputTokens: 2048,
                    },
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("[Training Plan API] Gemini error:", data);
            return NextResponse.json({ error: data.error?.message || "Gemini API error" }, { status: 500 });
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            return NextResponse.json({ error: "No response from AI" }, { status: 500 });
        }

        // Parse the JSON response
        let plan: TrainingPlanResponse;
        try {
            plan = JSON.parse(text);
        } catch {
            // Try to extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                plan = JSON.parse(jsonMatch[0]);
            } else {
                console.error("[Training Plan API] Failed to parse JSON:", text);
                return NextResponse.json({ error: "Invalid AI response format" }, { status: 500 });
            }
        }

        // ============================================
        // LAYER 2: VOLUME VALIDATION
        // ============================================
        let finalPlan = plan;

        if (weekTargets && plan.weekPlan && plan.weekPlan.length > 0) {
            const tolerance = weekTargets.isRecoveryWeek ? 5 : 10;
            const validation = validateWeeklyVolume(plan.weekPlan, weekTargets.targetVolume, tolerance);

            console.log(`[Training Plan API] Volume validation: target=${weekTargets.targetVolume}km, actual=${validation.actualVolume}km, deviation=${validation.deviation}%`);

            if (!validation.isValid) {
                console.log(`[Training Plan API] Volume deviation exceeds ${tolerance}% tolerance - applying scalar correction`);

                // Apply scalar to resize all workouts
                if (validation.scalarMultiplier) {
                    const rescaledWorkouts = rescaleWorkouts(plan.weekPlan, validation.scalarMultiplier);
                    finalPlan = {
                        ...plan,
                        weekPlan: rescaledWorkouts,
                        adjustmentNote: `Volume auto-corrected from ${validation.actualVolume}km to ~${weekTargets.targetVolume}km to match macro plan.`,
                    };

                    const revalidation = validateWeeklyVolume(rescaledWorkouts, weekTargets.targetVolume, tolerance);
                    console.log(`[Training Plan API] After rescale: ${revalidation.actualVolume}km (deviation: ${revalidation.deviation}%)`);
                }
            }
        }

        // ============================================
        // NORMALIZE DATES AND SAVE WORKOUTS TO DB
        // ============================================
        // Normalize AI dates to current week (so "Today" shows correctly)
        const normalizedPlan = {
            ...finalPlan,
            weekPlan: normalizeWeekPlanDates(finalPlan.weekPlan),
        };

        if (blockId && normalizedPlan.weekPlan && normalizedPlan.weekPlan.length > 0) {
            try {
                const workoutsToStore = dayPlanToStoredWorkouts(normalizedPlan.weekPlan);
                await saveWeeklyWorkouts(blockId, currentWeek, workoutsToStore);
                console.log(`[Training Plan API] Saved workouts for block ${blockId}, week ${currentWeek}`);
            } catch (saveError) {
                console.error("[Training Plan API] Failed to save workouts:", saveError);
                // Don't fail the request, just log
            }
        }

        return NextResponse.json({
            ...normalizedPlan,
            fromStorage: false,
        });
    } catch (error) {
        console.error("[Training Plan API] Error:", error);
        return NextResponse.json({ error: "Failed to generate training plan" }, { status: 500 });
    }
}
