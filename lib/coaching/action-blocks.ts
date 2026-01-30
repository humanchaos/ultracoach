/**
 * Action Block Parser
 * 
 * Unified parser for all AI action blocks:
 * - PLAN_MODIFICATION: Modify training plan
 * - MEMORY_SAVE: Save coach memory
 * - RACE_ADD: Add a race to calendar
 * - RACE_DELETE: Remove a race (requires confirmation)
 * - PROFILE_UPDATE: Update athlete profile
 * - GOAL_SET: Set training goal
 * - LIFE_LOG: Log wellness data (sleep, stress, nutrition)
 */

// ============================================================================
// Types
// ============================================================================

export type ActionBlockType =
    | 'PLAN_MODIFICATION'
    | 'MEMORY_SAVE'
    | 'RACE_ADD'
    | 'RACE_DELETE'
    | 'PROFILE_UPDATE'
    | 'GOAL_SET'
    | 'LIFE_LOG';

export interface ActionBlock {
    type: ActionBlockType;
    payload: Record<string, unknown>;
    raw: string;
}

export interface RaceAddPayload {
    name: string;
    date: string;
    distance_km: number;
    race_type: 'ultra' | 'marathon' | 'half' | '10k' | '5k' | 'other';
    priority?: 'A' | 'B' | 'C';
    goal_time?: string;
    notes?: string;
}

export interface RaceDeletePayload {
    race_id: number;
    confirmed: boolean;
}

export interface ProfileUpdatePayload {
    weight_kg?: number;
    height_cm?: number;
}

export type GoalType = 'maintain' | 'get_faster' | 'lose_weight' | 'run_longer' | 'competition';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export interface GoalSetPayload {
    goal_type: GoalType;
    running_experience?: ExperienceLevel;
    target_pace?: string;
    weekly_mileage_km?: number;
}

export interface PlanModificationPayload {
    day: string;
    updates: Record<string, unknown>;
}

export interface MemorySavePayload {
    memory_type: 'preference' | 'injury' | 'health_note' | 'goal' | 'feeling';
    content: string;
    expires_in_days?: number | null;
}

export interface LifeLogPayload {
    date?: string;            // ISO date, defaults to today
    sleep_quality?: number;   // 1-10
    stress_level?: number;    // 1-10
    nutrition_score?: number; // 1-10
    hrv_status?: string;      // 'low' | 'normal' | 'high' | 'elevated'
    notes?: string;           // Free text context (e.g., "rough day at work")
    tags?: string[];          // e.g., ['alcohol', 'travel', 'sick']
    custom_data?: Record<string, unknown>;  // Flexible structured context
}

// ============================================================================
// Constants
// ============================================================================

const VALID_BLOCK_TYPES: ActionBlockType[] = [
    'PLAN_MODIFICATION',
    'MEMORY_SAVE',
    'RACE_ADD',
    'RACE_DELETE',
    'PROFILE_UPDATE',
    'GOAL_SET',
    'LIFE_LOG',
];

const VALID_RACE_TYPES = ['ultra', 'marathon', 'half', '10k', '5k', 'other'];
const VALID_PRIORITIES = ['A', 'B', 'C'];
const VALID_GOAL_TYPES: GoalType[] = ['maintain', 'get_faster', 'lose_weight', 'run_longer', 'competition'];
const VALID_EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'elite'];

// Weight bounds for validation (in kg)
const MIN_WEIGHT_KG = 30;
const MAX_WEIGHT_KG = 300;

// Height bounds for validation (in cm)
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse all action blocks from an AI response string.
 * Ignores malformed JSON blocks.
 */
export function parseActionBlocks(response: string): ActionBlock[] {
    if (typeof response !== 'string') {
        console.error('[ActionBlocks] parseActionBlocks: response must be a string');
        return [];
    }

    const blocks: ActionBlock[] = [];

    // Match all code blocks with known action types
    // Pattern: ```BLOCK_TYPE followed by JSON and closing ```
    const blockPattern = /```(PLAN_MODIFICATION|MEMORY_SAVE|RACE_ADD|RACE_DELETE|PROFILE_UPDATE|GOAL_SET|LIFE_LOG)\s*([\s\S]*?)```/g;

    let match;
    while ((match = blockPattern.exec(response)) !== null) {
        const blockType = match[1] as ActionBlockType;
        const jsonContent = match[2].trim();

        try {
            const payload = JSON.parse(jsonContent);
            blocks.push({
                type: blockType,
                payload,
                raw: match[0],
            });
        } catch (parseError) {
            console.warn(`[ActionBlocks] Failed to parse ${blockType} block: ${parseError}`);
            // Skip malformed blocks
        }
    }

    return blocks;
}

// ============================================================================
// Validators
// ============================================================================

/**
 * Validate a RACE_ADD payload.
 * Returns validated payload or null if invalid.
 */
export function validateRaceAdd(payload: unknown): RaceAddPayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;

    // Check required fields
    if (typeof p.name !== 'string' || !p.name.trim()) {
        return null;
    }
    if (typeof p.date !== 'string' || !p.date.trim()) {
        return null;
    }
    if (typeof p.distance_km !== 'number' || p.distance_km <= 0) {
        return null;
    }
    if (!VALID_RACE_TYPES.includes(p.race_type as string)) {
        return null;
    }

    // Validate optional priority
    if (p.priority !== undefined && !VALID_PRIORITIES.includes(p.priority as string)) {
        return null;
    }

    return {
        name: p.name.trim(),
        date: p.date,
        distance_km: p.distance_km,
        race_type: p.race_type as RaceAddPayload['race_type'],
        priority: (p.priority as RaceAddPayload['priority']) || 'B',
        goal_time: typeof p.goal_time === 'string' ? p.goal_time : undefined,
        notes: typeof p.notes === 'string' ? p.notes : undefined,
    };
}

/**
 * Validate a RACE_DELETE payload.
 * Returns validated payload or null if invalid.
 * IMPORTANT: Requires confirmed === true (per user requirement)
 */
export function validateRaceDelete(payload: unknown): RaceDeletePayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;

    // Check required fields
    if (typeof p.race_id !== 'number') {
        return null;
    }

    // CRITICAL: Deletion must be explicitly confirmed
    if (p.confirmed !== true) {
        console.warn('[ActionBlocks] RACE_DELETE rejected: confirmation required');
        return null;
    }

    return {
        race_id: p.race_id,
        confirmed: true,
    };
}

/**
 * Validate a PROFILE_UPDATE payload.
 * Returns validated payload or null if invalid.
 * NOTE: Per user decision, Strava values win over chat updates.
 * This validation ensures reasonable bounds but the caller should
 * decide whether to apply based on source priority.
 */
export function validateProfileUpdate(payload: unknown): ProfileUpdatePayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;
    const result: ProfileUpdatePayload = {};

    // Validate weight if present
    if (p.weight_kg !== undefined) {
        if (typeof p.weight_kg !== 'number' ||
            p.weight_kg < MIN_WEIGHT_KG ||
            p.weight_kg > MAX_WEIGHT_KG) {
            return null;
        }
        result.weight_kg = p.weight_kg;
    }

    // Validate height if present
    if (p.height_cm !== undefined) {
        if (typeof p.height_cm !== 'number' ||
            p.height_cm < MIN_HEIGHT_CM ||
            p.height_cm > MAX_HEIGHT_CM) {
            return null;
        }
        result.height_cm = p.height_cm;
    }

    // Must have at least one field
    if (Object.keys(result).length === 0) {
        return null;
    }

    return result;
}

/**
 * Validate a GOAL_SET payload.
 * Returns validated payload or null if invalid.
 */
export function validateGoalSet(payload: unknown): GoalSetPayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;

    // Check required field
    if (!VALID_GOAL_TYPES.includes(p.goal_type as GoalType)) {
        return null;
    }

    // Validate optional running_experience
    if (p.running_experience !== undefined &&
        !VALID_EXPERIENCE_LEVELS.includes(p.running_experience as ExperienceLevel)) {
        return null;
    }

    return {
        goal_type: p.goal_type as GoalType,
        running_experience: p.running_experience as ExperienceLevel | undefined,
        target_pace: typeof p.target_pace === 'string' ? p.target_pace : undefined,
        weekly_mileage_km: typeof p.weekly_mileage_km === 'number' ? p.weekly_mileage_km : undefined,
    };
}

/**
 * Validate a PLAN_MODIFICATION payload.
 */
export function validatePlanModification(payload: unknown): PlanModificationPayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;

    if (typeof p.day !== 'string' || !p.day.trim()) {
        return null;
    }

    if (!p.updates || typeof p.updates !== 'object') {
        return null;
    }

    return {
        day: p.day,
        updates: p.updates as Record<string, unknown>,
    };
}

/**
 * Validate a MEMORY_SAVE payload.
 */
export function validateMemorySave(payload: unknown): MemorySavePayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;

    const validMemoryTypes = ['preference', 'injury', 'health_note', 'goal', 'feeling'];
    if (!validMemoryTypes.includes(p.memory_type as string)) {
        return null;
    }

    if (typeof p.content !== 'string' || !p.content.trim()) {
        return null;
    }

    return {
        memory_type: p.memory_type as MemorySavePayload['memory_type'],
        content: p.content,
        expires_in_days: typeof p.expires_in_days === 'number' ? p.expires_in_days : null,
    };
}

/**
 * Validate a LIFE_LOG payload.
 * Accepts wellness metrics OR free-text context (notes/tags/custom_data).
 * Allows flexible life logging without requiring numeric scores.
 */
export function validateLifeLog(payload: unknown): LifeLogPayload | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const p = payload as Record<string, unknown>;
    const result: LifeLogPayload = {};

    // Validate sleep_quality (1-10)
    if (p.sleep_quality !== undefined) {
        if (typeof p.sleep_quality !== 'number' ||
            p.sleep_quality < 1 ||
            p.sleep_quality > 10 ||
            !Number.isInteger(p.sleep_quality)) {
            console.warn('[ActionBlocks] LIFE_LOG: Invalid sleep_quality (must be 1-10)');
            return null;
        }
        result.sleep_quality = p.sleep_quality;
    }

    // Validate stress_level (1-10)
    if (p.stress_level !== undefined) {
        if (typeof p.stress_level !== 'number' ||
            p.stress_level < 1 ||
            p.stress_level > 10 ||
            !Number.isInteger(p.stress_level)) {
            console.warn('[ActionBlocks] LIFE_LOG: Invalid stress_level (must be 1-10)');
            return null;
        }
        result.stress_level = p.stress_level;
    }

    // Validate nutrition_score (1-10)
    if (p.nutrition_score !== undefined) {
        if (typeof p.nutrition_score !== 'number' ||
            p.nutrition_score < 1 ||
            p.nutrition_score > 10 ||
            !Number.isInteger(p.nutrition_score)) {
            console.warn('[ActionBlocks] LIFE_LOG: Invalid nutrition_score (must be 1-10)');
            return null;
        }
        result.nutrition_score = p.nutrition_score;
    }

    // Validate hrv_status
    if (p.hrv_status !== undefined) {
        const validHrvValues = ['low', 'normal', 'high', 'elevated'];
        if (typeof p.hrv_status !== 'string' || !validHrvValues.includes(p.hrv_status)) {
            console.warn('[ActionBlocks] LIFE_LOG: Invalid hrv_status (must be low/normal/high/elevated)');
            return null;
        }
        result.hrv_status = p.hrv_status;
    }

    // Optional date (defaults to today in handler)
    if (p.date !== undefined) {
        if (typeof p.date !== 'string') {
            return null;
        }
        result.date = p.date;
    }

    // Optional notes (free text context)
    if (typeof p.notes === 'string' && p.notes.trim()) {
        result.notes = p.notes.trim();
    }

    // Optional tags
    if (Array.isArray(p.tags)) {
        result.tags = p.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    }

    // Optional custom_data (flexible structured context)
    if (p.custom_data !== undefined && typeof p.custom_data === 'object' && p.custom_data !== null) {
        result.custom_data = p.custom_data as Record<string, unknown>;
    }

    // Must have at least one piece of information to log
    const hasMetric = result.sleep_quality || result.stress_level || result.nutrition_score || result.hrv_status;
    const hasContext = result.notes || (result.tags && result.tags.length > 0) || (result.custom_data && Object.keys(result.custom_data).length > 0);

    if (!hasMetric && !hasContext) {
        console.warn('[ActionBlocks] LIFE_LOG: At least one metric or context required');
        return null;
    }

    return result;
}
