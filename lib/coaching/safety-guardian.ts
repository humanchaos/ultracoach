/**
 * Safety Guardian v2 - Adversarial AI for Training Plan Validation
 * 
 * v2 Enhancements:
 * - SessionContext: Single Source of Truth shared by Coach and Guardian
 * - Granular response: riskLevel, flaggedSessions, adjustmentDirectives
 * - Auto Recovery-Week fail-safe for persistent high risk
 * 
 * Key safety checks:
 * 1. ACWR: Flag if weekly volume increases >10% vs. 4-week average
 * 2. Post-Race Recovery: Flag intensity within 48h of ultras (>25km)
 * 3. Overtraining Signals: Flag if resting HR trend is elevated or sleep is poor
 */

// ============================================
// SESSION CONTEXT - Single Source of Truth
// ============================================

export interface SessionContext {
    /** Athlete identity */
    userStravaId: string;

    /** Strava-derived training metrics */
    stravaMetrics: StravaMetrics;

    /** Biometric signals */
    biometrics: {
        restingHrTrend?: string;      // e.g., "+12bpm", "-5bpm"
        sleepScore?: 'Good' | 'Fair' | 'Poor';
        hrVariability?: string;       // e.g., "declining"
    };

    /** User goals & race context */
    goals: {
        nextRace?: {
            name: string;
            date: Date;
            distance_km: number;
        };
        trainingPhase?: string;       // e.g., "BASE", "BUILD", "PEAK", "TAPER"
        weeklyVolumeTarget_km?: number;
    };

    /** Snapshot timestamp */
    createdAt: Date;
}

export interface StravaMetrics {
    avgWeeklyDistanceLast4Weeks: number;
    proposedWeeklyDistance?: number;
    thisWeekDistance?: number;
    acwr?: number;                    // Acute:Chronic Workload Ratio
    lastEvent?: {
        name: string;
        distance_km: number;
        date: Date;
    };
    daysSinceLastEvent?: number;
    recentActivities?: Array<{
        date: Date;
        distance_km: number;
        type: string;
        average_hr?: number;
    }>;
}

// ============================================
// GRANULAR GUARDIAN RESPONSE
// ============================================

export type RiskLevel = 'low' | 'medium' | 'high';

export interface FlaggedSession {
    day: string;                      // e.g., "Dienstag", "Long Run"
    reason: string;                   // Why this session is flagged
    maxAllowed: string;               // e.g., "Zone 2, max 8km"
}

export interface SafetyCheckResult {
    isSafe: boolean;
    riskLevel: RiskLevel;
    flaggedSessions: FlaggedSession[];
    overallCritique: string;
    adjustmentDirectives: string;
    rawResponse?: string;
}

export interface SafetyCheckInput {
    coachDraft: string;
    sessionContext: SessionContext;
}

// ============================================
// GUARDIAN SYSTEM PROMPT (v2 - Granular)
// ============================================

const GUARDIAN_SYSTEM_PROMPT = `Du bist der UltraCoach Safety Guardian v2. Deine einzige Aufgabe ist es, Trainingspläne auf Risiken zu prüfen. Du agierst als konservativer Sportmediziner und erfahrener Ultramarathon-Coach. Dein Ziel ist es, Übertraining und Verletzungen (wie Stressfrakturen oder Burnout) zu verhindern.

## PRÜFREGELN

1. **ACWR-Check (Acute:Chronic Workload Ratio)**
   - Berechne: geplante Wochendistanz / Durchschnitt der letzten 4 Wochen
   - Sicher: 0.8–1.3 | Warnung: 1.3–1.5 | Gefahr: >1.5
   - Steigerung >10% pro Woche = medium Risk, >25% = high Risk

2. **Post-Race Recovery**
   - Nach Ultra-Events (>50km): Mindestens 7-14 Tage reduzierte Intensität
   - Nach langen Läufen (>25km): Mindestens 48h nur Zone 1-2
   - Flagge jede Session, die diese Regel verletzt

3. **Übertraining-Signale**
   - Erhöhte Ruhe-HF (Trend >5bpm): medium Risk, >10bpm: high Risk
   - Schlechter Schlaf-Score ("Poor"): senke erlaubte Intensität um eine Zone
   - Kombination aus erhöhter HF + schlechtem Schlaf = high Risk

## ANTWORTFORMAT

**KRITISCH**: Antworte ausschließlich im JSON-Format. Kein Text vor oder nach dem JSON.

{
  "isSafe": boolean,
  "riskLevel": "low" | "medium" | "high",
  "flaggedSessions": [
    { "day": "Wochentag oder Session-Name", "reason": "Warum geflaggt", "maxAllowed": "Was stattdessen erlaubt wäre" }
  ],
  "overallCritique": "Zusammenfassung der identifizierten Risiken",
  "adjustmentDirectives": "Konkrete Anweisungen zur Plananpassung"
}

Wenn der Plan sicher ist:
{
  "isSafe": true,
  "riskLevel": "low",
  "flaggedSessions": [],
  "overallCritique": "",
  "adjustmentDirectives": ""
}`;

// ============================================
// RECOVERY WEEK TEMPLATE (Fail-safe)
// ============================================

const RECOVERY_WEEK_TEMPLATE = `⚠️ **Automatische Sicherheits-Intervention**

Dein ursprünglicher Plan wurde vom Safety Guardian als **hohes Risiko** eingestuft und konnte auch nach Überarbeitung nicht sicher gemacht werden. Zum Schutz vor Übertraining wird automatisch eine Recovery-Woche verordnet:

**Diese Woche: Recovery-Protokoll**

**Montag:** Ruhetag 🛌
**Dienstag:** 30min Zone 1 Shuffle (max 6:30/km)
**Mittwoch:** Ruhetag oder leichtes Yoga/Stretching
**Donnerstag:** 25min Zone 1 Easy Run
**Freitag:** Ruhetag 🛌
**Samstag:** 40min Zone 1-2 Easy Run (max Puls: LT1 - 10bpm)
**Sonntag:** Ruhetag oder leichte Wanderung

*Gesamtvolumen: ~15-20km. Nächste Woche wird neu bewertet.*

---
🛡️ *Diese Recovery-Woche wurde automatisch vom Safety Guardian verordnet, weil dein Trainingsplan ein persistentes Überlastungsrisiko aufwies.*`;

// ============================================
// BUILD SESSION CONTEXT
// ============================================

/**
 * Build a SessionContext from available data — single source of truth for Coach & Guardian
 */
export function buildSessionContext(
    activities: Array<{
        date: Date;
        distance_km: number;
        name: string;
        type?: string;
        average_hr?: number;
    }>,
    options?: {
        userStravaId?: string;
        restingHrTrend?: string;
        sleepScore?: 'Good' | 'Fair' | 'Poor';
        nextRace?: { name: string; date: Date; distance_km: number };
        trainingPhase?: string;
        weeklyVolumeTarget_km?: number;
    }
): SessionContext {
    const stravaMetrics = extractStravaMetrics(activities);

    return {
        userStravaId: options?.userStravaId || 'unknown',
        stravaMetrics,
        biometrics: {
            restingHrTrend: options?.restingHrTrend,
            sleepScore: options?.sleepScore,
        },
        goals: {
            nextRace: options?.nextRace,
            trainingPhase: options?.trainingPhase,
            weeklyVolumeTarget_km: options?.weeklyVolumeTarget_km,
        },
        createdAt: new Date(),
    };
}

// ============================================
// MAIN SAFETY CHECK
// ============================================

/**
 * Main safety check function - calls Gemini 1.5 Flash for fast validation
 */
export async function runSafetyCheck(
    input: SafetyCheckInput,
    apiKey: string
): Promise<SafetyCheckResult> {
    const { coachDraft, sessionContext } = input;

    const contextForGuardian = buildGuardianContext(sessionContext, coachDraft);

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: contextForGuardian }],
                    }],
                    systemInstruction: { parts: [{ text: GUARDIAN_SYSTEM_PROMPT }] },
                    generationConfig: {
                        temperature: 0.2,
                        topP: 0.8,
                        maxOutputTokens: 800, // Increased for granular response
                    },
                }),
            }
        );

        if (!response.ok) {
            console.error('[Safety Guardian] API error:', response.status);
            return createFailSafeResult('Guardian API error');
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return parseGuardianResponse(text);
    } catch (error) {
        console.error('[Safety Guardian] Error:', error);
        return createFailSafeResult('Guardian exception');
    }
}

// ============================================
// ORCHESTRATION: generateFinalPlan
// ============================================

/**
 * Full adversarial orchestration loop with fail-safe Recovery-Week
 * Returns the final approved plan or a recovery week if persistently unsafe
 */
export async function generateFinalPlan(
    initialDraft: string,
    sessionContext: SessionContext,
    apiKey: string,
    regenerateFn: (feedback: string) => Promise<string>,
    logFn?: (entry: {
        coach_draft: string;
        guardian_response: SafetyCheckResult;
        iteration_number: number;
        final_plan_approved: boolean;
    }) => Promise<void>
): Promise<{ finalPlan: string; safetyResult: SafetyCheckResult; iterations: number; wasRecoveryWeek: boolean }> {
    const MAX_ITERATIONS = 2;
    let currentDraft = initialDraft;
    let safetyResult: SafetyCheckResult = createFailSafeResult('Not yet checked');
    let guardianFailed = false;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        try {
            console.log(`[Safety Guardian] Iteration ${iteration + 1}/${MAX_ITERATIONS}`);

            safetyResult = await runSafetyCheck(
                { coachDraft: currentDraft, sessionContext },
                apiKey
            );

            console.log(`[Safety Guardian] Result: isSafe=${safetyResult.isSafe}, riskLevel=${safetyResult.riskLevel}`);
            if (safetyResult.flaggedSessions.length > 0) {
                console.log(`[Safety Guardian] Flagged ${safetyResult.flaggedSessions.length} sessions`);
            }

            // Log to database
            if (logFn) {
                try {
                    await logFn({
                        coach_draft: currentDraft.substring(0, 5000),
                        guardian_response: safetyResult,
                        iteration_number: iteration + 1,
                        final_plan_approved: safetyResult.isSafe,
                    });
                } catch (logError) {
                    console.warn('[Safety Guardian] Failed to log:', logError);
                }
            }

            if (safetyResult.isSafe) {
                console.log('[Safety Guardian] ✅ Plan approved');
                return { finalPlan: currentDraft, safetyResult, iterations: iteration + 1, wasRecoveryWeek: false };
            }

            // Not safe — regenerate if we have iterations left
            if (iteration < MAX_ITERATIONS - 1) {
                console.log('[Safety Guardian] ⚠️ Plan flagged, regenerating with feedback...');
                const feedback = formatGuardianFeedback(safetyResult);
                currentDraft = await regenerateFn(feedback);
                console.log('[Safety Guardian] Regenerated plan received');
            }
        } catch (guardianError) {
            console.error('[Safety Guardian] Error:', guardianError);
            guardianFailed = true;
            break;
        }
    }

    // FAIL-SAFE: Guardian failed entirely
    if (guardianFailed) {
        return {
            finalPlan: currentDraft + formatSafetyDisclaimer(),
            safetyResult,
            iterations: 0,
            wasRecoveryWeek: false,
        };
    }

    // FAIL-SAFE: Persistent high risk after max iterations → auto Recovery Week
    if (safetyResult.riskLevel === 'high') {
        console.log('[Safety Guardian] 🚨 Persistent HIGH risk — deploying Recovery Week');
        return {
            finalPlan: RECOVERY_WEEK_TEMPLATE,
            safetyResult,
            iterations: MAX_ITERATIONS,
            wasRecoveryWeek: true,
        };
    }

    // Medium risk after max iterations — return the revised draft with a note
    console.log('[Safety Guardian] ⚠️ Medium risk persists, returning revised draft');
    return {
        finalPlan: currentDraft,
        safetyResult,
        iterations: MAX_ITERATIONS,
        wasRecoveryWeek: false,
    };
}

// ============================================
// CONTEXT BUILDERS
// ============================================

/**
 * Build context string for the Guardian using SessionContext
 */
function buildGuardianContext(ctx: SessionContext, coachDraft: string): string {
    const m = ctx.stravaMetrics;
    const lines: string[] = [
        '## SESSION-KONTEXT (Snapshot)',
        '',
        `Erstellt: ${ctx.createdAt.toISOString()}`,
        `Athlet: ${ctx.userStravaId}`,
        '',
        '### Trainingsmetriken',
        `Durchschnittliche Wochenkilometer (letzte 4 Wochen): ${m.avgWeeklyDistanceLast4Weeks} km`,
    ];

    if (m.thisWeekDistance !== undefined) {
        lines.push(`Aktuelle Woche bisher: ${m.thisWeekDistance} km`);
    }

    if (m.acwr !== undefined) {
        lines.push(`ACWR (Acute:Chronic): ${m.acwr.toFixed(2)}`);
    }

    if (m.proposedWeeklyDistance) {
        const increase = m.avgWeeklyDistanceLast4Weeks > 0
            ? ((m.proposedWeeklyDistance - m.avgWeeklyDistanceLast4Weeks) / m.avgWeeklyDistanceLast4Weeks) * 100
            : 0;
        lines.push(`Geplante Wochenkilometer: ${m.proposedWeeklyDistance} km (${increase > 0 ? '+' : ''}${increase.toFixed(1)}%)`);
    }

    if (m.lastEvent) {
        lines.push('');
        lines.push('### Letztes größeres Event');
        lines.push(`- Name: ${m.lastEvent.name}`);
        lines.push(`- Distanz: ${m.lastEvent.distance_km} km`);
        lines.push(`- Datum: ${m.lastEvent.date.toISOString().split('T')[0]}`);
        if (m.daysSinceLastEvent !== undefined) {
            lines.push(`- Tage seit Event: ${m.daysSinceLastEvent}`);
        }
    }

    // Biometrics
    const bio = ctx.biometrics;
    if (bio.restingHrTrend || bio.sleepScore) {
        lines.push('');
        lines.push('### Biometrische Signale');
        if (bio.restingHrTrend) lines.push(`Ruhe-HF Trend: ${bio.restingHrTrend}`);
        if (bio.sleepScore) lines.push(`Schlaf-Score: ${bio.sleepScore}`);
        if (bio.hrVariability) lines.push(`HRV Trend: ${bio.hrVariability}`);
    }

    // Goals
    const goals = ctx.goals;
    if (goals.nextRace || goals.trainingPhase) {
        lines.push('');
        lines.push('### Ziele & Phase');
        if (goals.trainingPhase) lines.push(`Trainingsphase: ${goals.trainingPhase}`);
        if (goals.nextRace) {
            lines.push(`Nächstes Rennen: ${goals.nextRace.name} (${goals.nextRace.distance_km}km, ${goals.nextRace.date.toISOString().split('T')[0]})`);
        }
        if (goals.weeklyVolumeTarget_km) lines.push(`Wochenvolumen-Ziel: ${goals.weeklyVolumeTarget_km} km`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## TRAININGSPLAN-ENTWURF DES COACHES');
    lines.push('');
    lines.push(coachDraft);

    return lines.join('\n');
}

// ============================================
// METRIC EXTRACTION
// ============================================

/**
 * Extract key metrics from Strava activities for SessionContext
 */
export function extractStravaMetrics(
    activities: Array<{
        date: Date;
        distance_km: number;
        name: string;
        type?: string;
        average_hr?: number;
    }>
): StravaMetrics {
    const now = new Date();

    // Acute window: last 7 days (rolling)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Chronic window: days 8–35 (the 4 prior complete weeks, NOT overlapping with acute)
    const thirtyFiveDaysAgo = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

    const toDate = (d: Date | string): Date => d instanceof Date ? d : new Date(d);
    const isRun = (a: { type?: string }) => !a.type || a.type === 'Run';

    // Acute: this rolling week
    const acuteRuns = activities.filter(a => {
        const d = toDate(a.date);
        return isRun(a) && d >= sevenDaysAgo && d <= now;
    });
    const thisWeekDistance = acuteRuns.reduce((sum, a) => sum + a.distance_km, 0);

    // Chronic: the 4 weeks BEFORE the acute window — divided by 4
    const chronicRuns = activities.filter(a => {
        const d = toDate(a.date);
        return isRun(a) && d >= thirtyFiveDaysAgo && d < sevenDaysAgo;
    });
    const chronicTotal = chronicRuns.reduce((sum, a) => sum + a.distance_km, 0);
    const avgWeeklyDistance = chronicTotal / 4;  // always /4 regardless of data density

    // ACWR: guard against division by zero
    const acwr = avgWeeklyDistance > 0
        ? Math.round((thisWeekDistance / avgWeeklyDistance) * 100) / 100
        : undefined;

    // Find last major effort (>40km) across all activities, sorted newest first
    const sorted = [...activities].sort(
        (a, b) => toDate(b.date).getTime() - toDate(a.date).getTime()
    );
    const lastMajorEvent = sorted.find(a => a.distance_km >= 40);
    const daysSinceEvent = lastMajorEvent
        ? Math.floor((now.getTime() - toDate(lastMajorEvent.date).getTime()) / (24 * 60 * 60 * 1000))
        : undefined;

    // Recent runs for context (last 35 days)
    const allRecentRuns = activities.filter(a => {
        const d = toDate(a.date);
        return isRun(a) && d >= thirtyFiveDaysAgo && d <= now;
    });

    return {
        avgWeeklyDistanceLast4Weeks: Math.round(avgWeeklyDistance * 10) / 10,
        proposedWeeklyDistance: Math.round(thisWeekDistance * 10) / 10,
        thisWeekDistance: Math.round(thisWeekDistance * 10) / 10,
        acwr,
        lastEvent: lastMajorEvent ? {
            name: lastMajorEvent.name,
            distance_km: lastMajorEvent.distance_km,
            date: toDate(lastMajorEvent.date),
        } : undefined,
        daysSinceLastEvent: daysSinceEvent,
        recentActivities: allRecentRuns.slice(0, 10).map(a => ({
            date: toDate(a.date),
            distance_km: a.distance_km,
            type: a.type || 'Run',
            average_hr: a.average_hr,
        })),
    };
}

// ============================================
// RESPONSE PARSING
// ============================================

/**
 * Parse the Guardian's granular JSON response with resilient fallback
 */
function parseGuardianResponse(text: string): SafetyCheckResult {
    try {
        let jsonStr = text.trim();

        // Remove markdown code block if present
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
        }

        const parsed = JSON.parse(jsonStr);

        return {
            isSafe: Boolean(parsed.isSafe),
            riskLevel: validateRiskLevel(parsed.riskLevel),
            flaggedSessions: Array.isArray(parsed.flaggedSessions)
                ? parsed.flaggedSessions.map((s: { day?: string; reason?: string; maxAllowed?: string }) => ({
                    day: String(s.day || 'Unbekannt'),
                    reason: String(s.reason || ''),
                    maxAllowed: String(s.maxAllowed || ''),
                }))
                : [],
            overallCritique: String(parsed.overallCritique || parsed.critique || ''),
            adjustmentDirectives: String(parsed.adjustmentDirectives || parsed.recommendedChanges || ''),
            rawResponse: text,
        };
    } catch (parseError) {
        console.warn('[Safety Guardian] JSON parse failed, attempting recovery:', parseError);

        const lowerText = text.toLowerCase();
        const seemsUnsafe = lowerText.includes('risiko') ||
            lowerText.includes('gefahr') ||
            lowerText.includes('übertraining') ||
            lowerText.includes('zu hoch') ||
            lowerText.includes('nicht sicher') ||
            lowerText.includes('"issafe": false') ||
            lowerText.includes('"issafe":false');

        if (seemsUnsafe) {
            return {
                isSafe: false,
                riskLevel: 'medium',
                flaggedSessions: [],
                overallCritique: 'Guardian konnte strukturiertes Feedback nicht liefern, aber Risikosignale wurden erkannt.',
                adjustmentDirectives: 'Bitte Plan manuell auf Intensität und Volumen prüfen.',
                rawResponse: text,
            };
        }

        return {
            isSafe: true,
            riskLevel: 'low',
            flaggedSessions: [],
            overallCritique: '',
            adjustmentDirectives: '',
            rawResponse: text,
        };
    }
}

function validateRiskLevel(level: unknown): RiskLevel {
    if (level === 'low' || level === 'medium' || level === 'high') return level;
    return 'low';
}

// ============================================
// FORMATTING HELPERS
// ============================================

function createFailSafeResult(reason: string): SafetyCheckResult {
    console.warn(`[Safety Guardian] Fail-safe triggered: ${reason}`);
    return {
        isSafe: true,
        riskLevel: 'low',
        flaggedSessions: [],
        overallCritique: '',
        adjustmentDirectives: '',
        rawResponse: `FAIL_SAFE: ${reason}`,
    };
}

/**
 * Format safety disclaimer for fail-safe scenarios
 */
export function formatSafetyDisclaimer(): string {
    return '\n\n---\n⚠️ *Hinweis: Der automatische Sicherheitscheck konnte nicht durchgeführt werden. Bitte prüfe die Intensität und das Volumen dieses Plans sorgfältig.*';
}

/**
 * Format granular Guardian feedback for injection into coach regeneration
 */
export function formatGuardianFeedback(result: SafetyCheckResult): string {
    if (result.isSafe) return '';

    const lines = [
        `[SAFETY_OVERRIDE] Der Safety Guardian hat Risiken identifiziert (Risikostufe: ${result.riskLevel.toUpperCase()}):`,
        '',
        `**Kritik:** ${result.overallCritique}`,
    ];

    if (result.flaggedSessions.length > 0) {
        lines.push('');
        lines.push('**Geflaggte Sessions:**');
        result.flaggedSessions.forEach(s => {
            lines.push(`- **${s.day}**: ${s.reason} → Maximal erlaubt: ${s.maxAllowed}`);
        });
    }

    lines.push('');
    lines.push(`**Anpassungs-Direktiven:** ${result.adjustmentDirectives}`);
    lines.push('');
    lines.push('Handle im "Safety-First-Modus". Deine Kreativität ist nun den medizinischen Vorgaben untergeordnet. Erkläre dem Nutzer kurz, warum der Plan angepasst wurde.');

    return lines.join('\n');
}
