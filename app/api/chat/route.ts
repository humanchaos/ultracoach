import { SYSTEM_PROMPT_V4, SYSTEM_PROMPT_V5, buildDataContext, calculateRecoveryState, formatRecoveryStateForPrompt, type Athlete, type StravaActivity, type UpcomingRace } from "@/lib/coaching";
import { adaptActivities } from "@/lib/coaching/activity-adapter";
import { getDefaultVolumeByExperience } from '@/lib/coaching/athlete-defaults';
import { buildSessionContext, generateFinalPlan, formatSafetyDisclaimer, type SafetyCheckResult, type SessionContext } from "@/lib/coaching/safety-guardian";
import { interpretLifelog, formatReadinessForContext } from "@/lib/lifelog";
import { auth } from "@/lib/auth";
import { getRecentJournal, formatJournalForAI, upsertJournalEntry, getActiveTrainingBlock, getCurrentWeekInBlock, formatBlockForAIv2, getRaceById, getLactateTest, logSafetyCheck } from "@/lib/db";

export const maxDuration = 45; // Increased to accommodate Safety Guardian loop

// Adapter: Convert races to v3 format
function adaptRaces(races: Array<{
    id?: number | string;
    name: string;
    date: string;
    distance_km: number;
    elevation_gain_m?: number;
    elevation_loss_m?: number;
    goal_time?: string;
    priority?: string;
}>): UpcomingRace[] {
    return races.map(r => ({
        id: String(r.id || r.name),
        name: r.name,
        date: new Date(r.date),
        distance_km: r.distance_km,
        elevation_gain_m: r.elevation_gain_m,
        elevation_loss_m: r.elevation_loss_m,
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
            maxWeeklyVolume_km: preferences?.max_weekly_volume_km ?? getDefaultVolumeByExperience(
                    preferences?.experience
                ),
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

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {
            messages,
            activities,
            races,
            athleteProfile,
            athletePreferences,
            trainingContext,  // This contains lactate data, preferences, etc. from page.tsx
        } = body;

        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        console.log("[Chat API v10] Received", messages.length, "messages");

        if (!apiKey) {
            return new Response(
                JSON.stringify({ error: "Gemini API key not configured" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        // Build v10 data context with coaching signals
        const v3Activities = activities ? adaptActivities(activities) : [];
        const v3Races = races ? adaptRaces(races) : [];
        const athlete = createAthlete(athleteProfile, athletePreferences);

        // DEBUG: Log ALL activities being processed
        console.log("[Chat API v10] 📋 ALL ACTIVITIES RECEIVED:", v3Activities.length);
        v3Activities.forEach((a, i) => {
            const dateStr = a.date instanceof Date ? a.date.toISOString().split('T')[0] : String(a.date);
            console.log(`  [${i}] ${dateStr} - ${a.name} (${a.distance_km}km)`);
        });

        // DEBUG: Show activities from last 14 days specifically
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const recentActivities = v3Activities.filter(a => {
            const actDate = a.date instanceof Date ? a.date : new Date(a.date);
            return actDate >= twoWeeksAgo;
        });
        console.log(`[Chat API v10] 📅 Activities in last 14 days: ${recentActivities.length}`);
        recentActivities.forEach(a => {
            const dateStr = a.date instanceof Date ? a.date.toISOString().split('T')[0] : String(a.date);
            console.log(`  - ${dateStr}: ${a.name} (${a.distance_km}km)`);
        });

        // Get the latest user message for lifelog interpretation
        const latestMessage = messages[messages.length - 1]?.content || "";

        // TWO-PASS ARCHITECTURE: Run interpreter + recovery state in parallel
        const [lifelogResult, recoveryState] = await Promise.all([
            interpretLifelog(latestMessage),
            Promise.resolve(calculateRecoveryState({
                activities: v3Activities,
                races: v3Races,
                athleteAge: athleteProfile?.age,
            })),
        ]);

        console.log("[Chat API v10] Two-pass results:", {
            hasLifelog: !!lifelogResult,
            recoveryPhase: recoveryState.phase,
            inRecoveryWindow: recoveryState.inRecoveryWindow,
        });

        // PERSIST LIFELOG DATA: Save extracted readiness data to journal for long-term pattern analysis
        // LIFELOG v2: Only persist if this is a life update (not a question)
        if (lifelogResult && lifelogResult.is_life_update && lifelogResult.mentions?.length > 0) {
            try {
                const session = await auth();
                if (session?.user?.stravaId) {
                    const profile = lifelogResult.readiness_profile;

                    // Convert readiness statuses to numeric scores (OPTIMAL=9, REDUCED=5, COMPROMISED=2, UNKNOWN=null)
                    const statusToScore = (status: string): number | undefined => {
                        switch (status) {
                            case 'OPTIMAL': return 9;
                            case 'REDUCED': return 5;
                            case 'COMPROMISED': return 2;
                            default: return undefined;
                        }
                    };

                    // Build custom_data with ALL mentions - nothing gets lost
                    const customData: Record<string, unknown> = {
                        // v2: Store all mentions with categories
                        mentions: lifelogResult.mentions,
                        // Full readiness profile for trend analysis
                        full_readiness_profile: profile ? {
                            systemic_load: profile.systemic_load,
                            structural_integrity: profile.structural_integrity,
                            energy_availability: profile.energy_availability,
                            cognitive_bandwidth: profile.cognitive_bandwidth,
                        } : null,
                        // Constraints and flags for quick queries
                        hard_constraints: lifelogResult.hard_constraints,
                        risk_flags: lifelogResult.risk_flags,
                        recommended_checkin: lifelogResult.recommended_checkin,
                        // Metadata
                        interpretation_version: 'v2.0',
                        raw_message: latestMessage.substring(0, 1000),
                        input_language: lifelogResult.raw_input_language,
                    };

                    // Derive scores from readiness profile if available
                    const sleepScore = profile ? statusToScore(profile.energy_availability?.status || 'UNKNOWN') : undefined;
                    const stressScore = profile?.cognitive_bandwidth?.status === 'COMPROMISED' ? 9 :
                        profile?.cognitive_bandwidth?.status === 'REDUCED' ? 6 :
                            profile?.cognitive_bandwidth?.status === 'OPTIMAL' ? 2 : undefined;

                    await upsertJournalEntry({
                        user_strava_id: session.user.stravaId,
                        date: new Date(),
                        sleep_quality: sleepScore,
                        stress_level: stressScore,
                        notes: lifelogResult.mentions.map(m => `${m.item}${m.detail ? `: ${m.detail}` : ''}`).join(', '),
                        tags: lifelogResult.risk_flags || [],
                        custom_data: customData,
                    });

                    console.log('[Chat API] 📝 Lifelog v2: Saved', lifelogResult.mentions.length, 'mentions to journal');
                }
            } catch (saveError) {
                console.warn('[Chat API] Could not save lifelog to journal:', saveError);
            }
        }

        // DEBUG: ALWAYS log recovery state for diagnosis
        console.log(`[Chat API] ⚡ RECOVERY STATE: phase=${recoveryState.phase}, inWindow=${recoveryState.inRecoveryWindow}, days=${recoveryState.daysSinceEffort || 'N/A'}`);

        if (recoveryState.inRecoveryWindow) {
            console.log("[Chat API v10] 🔴 ACTIVE RECOVERY:", {
                effortName: recoveryState.effortName,
                effortType: recoveryState.effortType,
                effortDate: recoveryState.effortDate,
                daysSinceEffort: recoveryState.daysSinceEffort,
                phase: recoveryState.phase,
                signalOverrides: recoveryState.signalOverrides,
            });
        } else {
            console.log("[Chat API v10] ✅ NOT IN RECOVERY WINDOW - normal training mode");
        }

        // DEBUG: Log activities that could trigger recovery detection (>40km runs)
        const potentialMajorEfforts = v3Activities.filter(a => a.distance_km >= 40);
        if (potentialMajorEfforts.length > 0) {
            console.log("[Chat API v10] 📊 Potential major efforts in activities:",
                potentialMajorEfforts.map(a => ({
                    name: a.name,
                    date: a.date instanceof Date ? a.date.toISOString() : String(a.date),
                    distance_km: a.distance_km,
                }))
            );
        }

        // BUILD CONTEXT (order matters for v10 gate sequence!)
        const contextSections: string[] = [];

        // 1. RECOVERY STATUS (Gate 2 input) - FIRST
        contextSections.push(formatRecoveryStateForPrompt(recoveryState));

        // 2. READINESS PROFILE (Gate 0-1 input) - SECOND
        if (lifelogResult) {
            contextSections.push(formatReadinessForContext(lifelogResult));
        }

        // 3. Base data context (athlete profile, training log, races, coaching signals)
        // Fetch active training block for workout analysis AND full context
        let trainingBlockData = undefined;
        let trainingBlockContext = '';
        try {
            const session = await auth();
            if (session?.user?.stravaId) {
                const block = await getActiveTrainingBlock(session.user.stravaId);
                if (block) {
                    // Get the race for this block (if any)
                    const race = block.race_id ? await getRaceById(block.race_id) : undefined;

                    // Format the full block context for the AI
                    trainingBlockContext = formatBlockForAIv2(block, race || undefined);
                    console.log(`[Chat API v10] 📊 Loaded training block context (week ${getCurrentWeekInBlock(block)})`);
                    console.log(`[Chat API v10] 📋 TODAY marker present:`, trainingBlockContext.includes('← TODAY'));
                    console.log(`[Chat API v10] 📋 TODAY'S PRESCRIBED WORKOUT present:`, trainingBlockContext.includes('TODAY\'S PRESCRIBED WORKOUT'));


                    // Also pass to buildDataContext for workout analysis
                    if (block.weekly_workouts) {
                        trainingBlockData = {
                            weeklyWorkouts: block.weekly_workouts,
                            startDate: block.start_date,
                            currentWeek: getCurrentWeekInBlock(block),
                        };
                    }
                }
            }
        } catch (blockError) {
            console.warn('[Chat API v10] Could not load training block:', blockError);
        }

        const dataContext = buildDataContext({
            athlete,
            activities: v3Activities,
            races: v3Races,
            lastSyncTime: new Date(),
            trainingBlock: trainingBlockData,
        });
        contextSections.push(dataContext);

        // 3b. Add training block context (phase, prescribed workouts, etc.)
        if (trainingBlockContext) {
            contextSections.push(trainingBlockContext);
        }

        // 4. Extra context from dashboard (memories, lactate, etc.) if available
        if (trainingContext) {
            contextSections.push(`## ADDITIONAL CONTEXT FROM DASHBOARD\n\n${trainingContext}`);
        }

        // 5. LIFELOG HISTORY (for pattern analysis - last 90 days)
        try {
            const session = await auth();
            if (session?.user?.stravaId) {
                const journalEntries = await getRecentJournal(session.user.stravaId, 90);
                const journalContext = formatJournalForAI(journalEntries);
                if (journalContext) {
                    contextSections.push(journalContext);
                    console.log(`[Chat API v10] Loaded ${journalEntries.length} journal entries for context`);
                }
            }
        } catch (journalError) {
            console.warn('[Chat API v10] Could not load journal history:', journalError);
        }

        // 6. PERSONALIZED HR ZONES (from saved lactate test data)
        try {
            const session = await auth();
            if (session?.user?.stravaId) {
                const lactateTest = await getLactateTest(session.user.stravaId);
                if (lactateTest && (lactateTest.z1_hr || lactateTest.aerobic_threshold_hr)) {
                    const zoneContext = `## PERSONALIZED HR ZONES (from lab test data)

**IMPORTANT: Always use these exact zone values when prescribing workouts.**

${lactateTest.z1_hr ? `- Zone 1 (Recovery): ${lactateTest.z1_hr} bpm` : ''}
${lactateTest.z2_hr ? `- Zone 2 (Aerobic): ${lactateTest.z2_hr} bpm` : ''}
${lactateTest.z3_hr ? `- Zone 3 (Tempo): ${lactateTest.z3_hr} bpm` : ''}
${lactateTest.z4_hr ? `- Zone 4 (Threshold): ${lactateTest.z4_hr} bpm` : ''}
${lactateTest.z5_hr ? `- Zone 5 (VO2max): ${lactateTest.z5_hr} bpm` : ''}
${lactateTest.aerobic_threshold_hr ? `- LT1 (Aerobic Threshold): ${lactateTest.aerobic_threshold_hr} bpm` : ''}
${lactateTest.anaerobic_threshold_hr ? `- LT2 (Anaerobic Threshold): ${lactateTest.anaerobic_threshold_hr} bpm` : ''}
${lactateTest.max_hr ? `- Max HR: ${lactateTest.max_hr} bpm` : ''}`;
                    contextSections.push(zoneContext);
                    console.log(`[Chat API v10] Loaded personalized HR zones: Z2=${lactateTest.z2_hr || 'calculated'}`);
                }
            }
        } catch (lactateError) {
            console.warn('[Chat API v10] Could not load lactate data:', lactateError);
        }

        const finalContext = contextSections.join('\n\n---\n\n');

        // Select prompt version (v5 is default, set PROMPT_VERSION=v4 to rollback)
        const promptVersion = process.env.PROMPT_VERSION || 'v5';
        const activePrompt = promptVersion === 'v4' ? SYSTEM_PROMPT_V4 : SYSTEM_PROMPT_V5;

        // Combine system prompt with data context
        const systemPrompt = `${activePrompt}\n\n---\n\n${finalContext}`;
        console.log(`[Chat API] Using prompt ${promptVersion}`);
        console.log("[Chat API] Context includes recovery:", finalContext.includes("RECOVERY STATUS"));
        console.log("[Chat API] Context includes readiness:", finalContext.includes("READINESS PROFILE"));
        console.log("[Chat API] Context includes training block:", finalContext.includes("## TRAINING BLOCK"));

        // Convert messages to Gemini format
        const contents = messages
            .filter((m: { role: string }) => m.role !== "system")
            .map((m: { role: string; content: string }) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));

        // Call Gemini API with gemini-2.0-flash (free tier)
        const requestPayload = {
            contents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.7,
                topP: 0.9,
                maxOutputTokens: 1000, // Cost Guard: Cap at 1000 tokens per message
            },
        };

        // Cost Guard: Log payload size and warn if too large
        const payloadJson = JSON.stringify(requestPayload);
        const payloadSizeKb = payloadJson.length / 1024;
        console.log(`[Chat API] Payload size: ${payloadSizeKb.toFixed(1)}kb`);
        if (payloadSizeKb > 50) {
            console.warn(`[Chat API] ⚠️ LARGE PAYLOAD WARNING: ${payloadSizeKb.toFixed(1)}kb exceeds 50kb threshold!`);
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payloadJson,
            }
        );

        const data = await response.json();
        console.log("[Chat API] Gemini response status:", response.status);

        if (!response.ok) {
            console.error("[Chat API] Gemini error:", data);
            return new Response(
                JSON.stringify({ error: data.error?.message || "Gemini API error" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        let coachResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated";

        // ============ SAFETY GUARDIAN v2: SessionContext + Orchestration ============

        // Get user session for logging
        let userStravaId: string | undefined;
        try {
            const session = await auth();
            userStravaId = session?.user?.stravaId;
        } catch { /* ignore auth errors for logging */ }

        // Build SessionContext — Single Source of Truth for Coach & Guardian
        const nextRace = v3Races.length > 0 ? {
            name: v3Races[0].name,
            date: v3Races[0].date,
            distance_km: v3Races[0].distance_km,
        } : undefined;

        const sessionContext: SessionContext = buildSessionContext(
            v3Activities.map(a => ({
                date: a.date,
                distance_km: a.distance_km,
                name: a.name,
                type: a.type,
                average_hr: a.average_hr,
            })),
            {
                userStravaId: userStravaId || 'unknown',
                restingHrTrend: athleteProfile?.restingHrTrend,
                sleepScore: lifelogResult?.readiness_profile?.energy_availability?.status === 'COMPROMISED' ? 'Poor'
                    : lifelogResult?.readiness_profile?.energy_availability?.status === 'REDUCED' ? 'Fair'
                        : lifelogResult?.readiness_profile?.energy_availability?.status === 'OPTIMAL' ? 'Good'
                            : undefined,
                nextRace,
                trainingPhase: trainingContext?.trainingPhase,
                weeklyVolumeTarget_km: athletePreferences?.max_weekly_volume_km,
            }
        );

        console.log(`[Safety Guardian v2] SessionContext built: ACWR=${sessionContext.stravaMetrics.acwr?.toFixed(2)}, sleep=${sessionContext.biometrics.sleepScore}`);

        // Regeneration function: calls Coach AI again with Guardian feedback
        const regenerateFn = async (feedback: string): Promise<string> => {
            const regenerateContents = [
                ...contents,
                { role: 'model', parts: [{ text: coachResponse }] },
                { role: 'user', parts: [{ text: feedback }] },
            ];

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: regenerateContents,
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: {
                            temperature: 0.6,
                            topP: 0.85,
                            maxOutputTokens: 1000,
                        },
                    }),
                }
            );

            if (!response.ok) throw new Error('Regeneration failed');
            const regenData = await response.json();
            return regenData.candidates?.[0]?.content?.parts?.[0]?.text || coachResponse;
        };

        // Run adversarial orchestration loop
        const guardianResult = await generateFinalPlan(
            coachResponse,
            sessionContext,
            apiKey,
            regenerateFn,
            userStravaId ? async (entry) => {
                try {
                    await logSafetyCheck({
                        user_strava_id: userStravaId!,
                        coach_draft: entry.coach_draft,
                        guardian_response: entry.guardian_response,
                        iteration_number: entry.iteration_number,
                        final_plan_approved: entry.final_plan_approved,
                        strava_context: sessionContext.stravaMetrics,
                    });
                } catch (logError) {
                    console.warn('[Safety Guardian] Failed to log to DB:', logError);
                }
            } : undefined
        );

        const finalResponse = guardianResult.finalPlan;
        console.log(`[Safety Guardian v2] Result: iterations=${guardianResult.iterations}, riskLevel=${guardianResult.safetyResult.riskLevel}, recoveryWeek=${guardianResult.wasRecoveryWeek}`);

        // Return as streaming format that our client expects
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`0:"${finalResponse.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"\n`));
                controller.close();
            },
        });

        return new Response(stream, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
    } catch (error) {
        console.error("[Chat API] Error:", error);
        return new Response(
            JSON.stringify({ error: "Failed to process chat request" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
