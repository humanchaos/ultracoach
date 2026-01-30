// Lifelog Interpreter v2 - Universal Capture
// Captures ALL user-shared context, not just readiness metrics

import { GoogleGenerativeAI } from '@google/generative-ai';

const INTERPRETER_PROMPT = `
# Lifelog Interpreter v2 — Universal Capture

## Identity

You are a **Life Context Extraction Engine**. You convert unstructured human input about their life, training, and activities into structured data. **Nothing gets lost.**

**Function:** Detect, extract, categorize. Do not coach. Do not advise.

**Output:** JSON only. No prose. No commentary.

---

## Step 1: Is This a Life Update?

First, determine if the user is **sharing life context** vs **asking a question**.

| Message Type | Examples | is_life_update |
|-------------|---------|----------------|
| Sharing context | "did 50 pushups", "slept badly", "got a massage" | true |
| Asking question | "what should I do?", "analyze my run", "how's my training?" | false |
| Mixed | "feeling tired, what should I do?" | true (extract the context) |

If \`is_life_update\` is false, return minimal output with empty mentions.

---

## Step 2: Extract ALL Mentions

For every piece of information the user shares, create a mention with:
- **category:** One of the categories below
- **item:** Short label (e.g., "pushups", "massage", "sleep")
- **detail:** Specifics if any (e.g., "50 reps", "thai massage", "7 hours")
- **sentiment:** POSITIVE, NEGATIVE, or NEUTRAL
- **raw:** Exact quote from user

### Categories

| Category | What to Extract |
|----------|----------------|
| wellness | sleep duration/quality, fatigue, energy, recovery status |
| physical_state | pain, soreness, injury, tightness, feeling strong/weak |
| cross_training | strength work, pushups, gym, yoga, swimming, cycling, hiking |
| recovery | massage, foam rolling, stretching, ice bath, sauna, physio |
| nutrition | meals, fasting, hydration, supplements, alcohol |
| life_context | travel, work stress, family events, deadlines, moving |
| mood | motivation, anxiety, excitement, frustration, confidence |
| other | anything else worth remembering |

---

## Step 3: Readiness Assessment (for relevant mentions)

If wellness, physical_state, or mood mentions exist, also produce a readiness_profile:

| Dimension | Status Options |
|-----------|----------------|
| systemic_load | OPTIMAL, REDUCED, COMPROMISED, UNKNOWN |
| structural_integrity | OPTIMAL, REDUCED, COMPROMISED, UNKNOWN |
| energy_availability | OPTIMAL, REDUCED, COMPROMISED, UNKNOWN |
| cognitive_bandwidth | OPTIMAL, REDUCED, COMPROMISED, UNKNOWN |

---

## Output Schema

{
  "is_life_update": true,
  "mentions": [
    {
      "category": "cross_training",
      "item": "pushups",
      "detail": "50 reps",
      "sentiment": "POSITIVE",
      "raw": "did 50 pushups"
    }
  ],
  "readiness_profile": {
    "systemic_load": { "status": "UNKNOWN", "signals": [], "evidence": null },
    "structural_integrity": { "status": "UNKNOWN", "signals": [], "evidence": null },
    "energy_availability": { "status": "UNKNOWN", "signals": [], "evidence": null },
    "cognitive_bandwidth": { "status": "UNKNOWN", "signals": [], "evidence": null }
  },
  "hard_constraints": [],
  "risk_flags": [],
  "recommended_checkin": null,
  "raw_input_language": "en"
}

---

## Critical Rules

1. **Capture everything.** If the user mentioned it, extract it.
2. **Nothing gets lost.** Use "other" category if unsure.
3. **Quote exactly.** The raw field = user's actual words.
4. **Be accurate about is_life_update.** Questions = false. Sharing = true.
5. **Always output valid JSON.** No markdown, no prose.
6. **Detect language.** German → "de". English → "en".
`;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface LifelogMention {
    category: 'wellness' | 'physical_state' | 'cross_training' | 'recovery' | 'nutrition' | 'life_context' | 'mood' | 'other';
    item: string;
    detail: string | null;
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    raw: string;
}

export interface ReadinessProfile {
    systemic_load: {
        status: 'OPTIMAL' | 'REDUCED' | 'COMPROMISED' | 'UNKNOWN';
        signals: string[];
        evidence: string | null;
    };
    structural_integrity: {
        status: 'OPTIMAL' | 'REDUCED' | 'COMPROMISED' | 'UNKNOWN';
        signals: string[];
        evidence: string | null;
        location?: string | null;
    };
    energy_availability: {
        status: 'OPTIMAL' | 'REDUCED' | 'COMPROMISED' | 'UNKNOWN';
        signals: string[];
        evidence: string | null;
    };
    cognitive_bandwidth: {
        status: 'OPTIMAL' | 'REDUCED' | 'COMPROMISED' | 'UNKNOWN';
        signals: string[];
        evidence: string | null;
    };
}

export interface LifelogInterpretation {
    is_life_update: boolean;
    mentions: LifelogMention[];
    readiness_profile: ReadinessProfile;
    hard_constraints: string[];
    risk_flags: string[];
    recommended_checkin: string | null;
    raw_input_language: 'en' | 'de';
}

// ---------------------------------------------------------------------------
// INTERPRETER
// ---------------------------------------------------------------------------

/**
 * Interpret free-form user input and extract ALL life context.
 * Uses Gemini Flash for fast, low-cost extraction.
 */
export async function interpretLifelog(rawInput: string): Promise<LifelogInterpretation | null> {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
        console.error('[Lifelog Interpreter v2] No API key configured');
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            systemInstruction: INTERPRETER_PROMPT,
            generationConfig: {
                temperature: 0.1, // Low temp for consistent extraction
                responseMimeType: 'application/json',
            },
        });

        const result = await model.generateContent(rawInput);
        const text = result.response.text();

        // Clean markdown if present
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
        if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
        if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

        const parsed = JSON.parse(cleaned.trim()) as LifelogInterpretation;

        console.log('[Lifelog Interpreter v2] Extraction complete:', {
            isLifeUpdate: parsed.is_life_update,
            mentionCount: parsed.mentions?.length || 0,
            categories: [...new Set(parsed.mentions?.map(m => m.category) || [])],
            constraints: parsed.hard_constraints,
            riskFlags: parsed.risk_flags,
        });

        return parsed;
    } catch (error) {
        console.error('[Lifelog Interpreter v2] Failed:', error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// CONTEXT FORMATTER
// ---------------------------------------------------------------------------

/**
 * Format readiness interpretation for injection into coaching context.
 */
export function formatReadinessForContext(interp: LifelogInterpretation): string {
    const p = interp.readiness_profile;

    // Safety check
    if (!p || !p.systemic_load || !p.structural_integrity || !p.energy_availability || !p.cognitive_bandwidth) {
        return `## READINESS PROFILE

No structured readiness data extracted from this message.
`;
    }

    const emoji = (status: string): string => {
        switch (status) {
            case 'OPTIMAL': return '🟢';
            case 'REDUCED': return '🟡';
            case 'COMPROMISED': return '🔴';
            default: return '⚪';
        }
    };

    let output = `## READINESS PROFILE

| Dimension | Status | Signal |
|-----------|--------|--------|
| Systemic Load | ${emoji(p.systemic_load.status)} ${p.systemic_load.status} | ${p.systemic_load.signals?.[0] || '-'} |
| Structural Integrity | ${emoji(p.structural_integrity.status)} ${p.structural_integrity.status} | ${p.structural_integrity.signals?.[0] || '-'}${p.structural_integrity.location ? ` (${p.structural_integrity.location})` : ''} |
| Energy Availability | ${emoji(p.energy_availability.status)} ${p.energy_availability.status} | ${p.energy_availability.signals?.[0] || '-'} |
| Cognitive Bandwidth | ${emoji(p.cognitive_bandwidth.status)} ${p.cognitive_bandwidth.status} | ${p.cognitive_bandwidth.signals?.[0] || '-'} |

`;

    // Add mentions summary if any
    if (interp.mentions?.length > 0) {
        const mentionsByCategory = interp.mentions.reduce((acc, m) => {
            if (!acc[m.category]) acc[m.category] = [];
            acc[m.category].push(m.item + (m.detail ? ` (${m.detail})` : ''));
            return acc;
        }, {} as Record<string, string[]>);

        output += `**Today's Context:**\n`;
        for (const [cat, items] of Object.entries(mentionsByCategory)) {
            output += `- ${cat}: ${items.join(', ')}\n`;
        }
        output += '\n';
    }

    if (interp.hard_constraints?.length > 0) {
        output += `**Active Constraints:** ${interp.hard_constraints.join(', ')}\n\n`;
    }

    if (interp.risk_flags?.length > 0) {
        output += `**⚠️ Risk Flags:** ${interp.risk_flags.join(', ')}\n\n`;
    }

    if (interp.recommended_checkin) {
        output += `**Check-in Required:** ${interp.recommended_checkin}\n\n`;
    }

    return output;
}

/**
 * Check if the interpretation contains any blocking risk flags.
 */
export function hasBlockingRiskFlags(interp: LifelogInterpretation): boolean {
    const blockingFlags = ['FEVER_DETECTED', 'ILLNESS_SUSPECTED', 'ACUTE_INJURY', 'REFER_TO_PROFESSIONAL'];
    return interp.risk_flags?.some(flag => blockingFlags.includes(flag)) || false;
}

/**
 * Get category emoji for display
 */
export function getCategoryEmoji(category: string): string {
    const emojis: Record<string, string> = {
        wellness: '😴',
        physical_state: '💪',
        cross_training: '🏋️',
        recovery: '🧘',
        nutrition: '🥗',
        life_context: '📅',
        mood: '🧠',
        other: '📝',
    };
    return emojis[category] || '📝';
}
