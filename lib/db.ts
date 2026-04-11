import { sql } from '@vercel/postgres';

// Types for our database
export interface StravaUser {
  id: number;
  strava_id: string;
  email: string | null;
  name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  last_fetch: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Race {
  id: number;
  user_strava_id: string;
  name: string;
  date: Date;
  distance_km: number;
  elevation_gain_m?: number;  // Total climbing in meters
  elevation_loss_m?: number;  // Total descent in meters (usually equals gain)
  race_type: 'ultra' | 'marathon' | 'half' | '10k' | '5k' | 'other';
  goal_time?: string;
  priority: 'A' | 'B' | 'C'; // A = main goal, B = tune-up, C = for fun
  notes?: string;
  created_at: Date;
}

export interface UserPreferences {
  id: number;
  user_strava_id: string;
  training_days: string[]; // e.g., ['mon', 'tue', 'thu', 'sat']
  long_run_day: string; // e.g., 'sunday'
  max_weekly_km: number;
  notes: string; // free-form notes the AI should remember
  created_at: Date;
  updated_at: Date;
}

// Get user by Strava ID
export async function getUserByStravaId(stravaId: string): Promise<StravaUser | null> {
  const result = await sql<StravaUser>`
    SELECT * FROM strava_users WHERE strava_id = ${stravaId}
  `;
  return result.rows[0] || null;
}

// Upsert user (create or update)
export async function upsertStravaUser(user: {
  strava_id: string;
  email?: string;
  name?: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}): Promise<StravaUser> {
  const result = await sql<StravaUser>`
    INSERT INTO strava_users (strava_id, email, name, access_token, refresh_token, expires_at)
    VALUES (${user.strava_id}, ${user.email || null}, ${user.name || null}, ${user.access_token}, ${user.refresh_token}, ${user.expires_at})
    ON CONFLICT (strava_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// Update tokens after refresh
export async function updateStravaTokens(
  stravaId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): Promise<void> {
  await sql`
    UPDATE strava_users
    SET access_token = ${accessToken},
        refresh_token = ${refreshToken},
        expires_at = ${expiresAt},
        updated_at = NOW()
    WHERE strava_id = ${stravaId}
  `;
}

// Update last fetch timestamp
export async function updateLastFetch(stravaId: string): Promise<void> {
  await sql`
    UPDATE strava_users
    SET last_fetch = NOW(), updated_at = NOW()
    WHERE strava_id = ${stravaId}
  `;
}

// ============ RACE CALENDAR FUNCTIONS ============

// Get all races for a user (future races only, ordered by date)
export async function getUserRaces(stravaId: string): Promise<Race[]> {
  const result = await sql<Race>`
    SELECT * FROM races 
    WHERE user_strava_id = ${stravaId} 
    AND date >= CURRENT_DATE
    ORDER BY date ASC
  `;
  return result.rows;
}

// Get all races including past ones
export async function getAllUserRaces(stravaId: string): Promise<Race[]> {
  const result = await sql<Race>`
    SELECT * FROM races 
    WHERE user_strava_id = ${stravaId}
    ORDER BY date DESC
  `;
  return result.rows;
}

// Get a single race by ID
export async function getRaceById(raceId: number): Promise<Race | null> {
  const result = await sql<Race>`
    SELECT * FROM races 
    WHERE id = ${raceId}
  `;
  return result.rows[0] || null;
}

// Add a new race
export async function addRace(race: {
  user_strava_id: string;
  name: string;
  date: Date;
  distance_km: number;
  elevation_gain_m?: number;
  elevation_loss_m?: number;
  race_type: 'ultra' | 'marathon' | 'half' | '10k' | '5k' | 'other';
  goal_time?: string;
  priority: 'A' | 'B' | 'C';
  notes?: string;
}): Promise<Race> {
  const result = await sql<Race>`
    INSERT INTO races (user_strava_id, name, date, distance_km, elevation_gain_m, elevation_loss_m, race_type, goal_time, priority, notes)
    VALUES (${race.user_strava_id}, ${race.name}, ${race.date.toISOString()}, ${race.distance_km}, ${race.elevation_gain_m || null}, ${race.elevation_loss_m || null}, ${race.race_type}, ${race.goal_time || null}, ${race.priority}, ${race.notes || null})
    RETURNING *
  `;
  return result.rows[0];
}

// Update a race
export async function updateRace(
  raceId: number,
  stravaId: string,
  updates: Partial<Omit<Race, 'id' | 'user_strava_id' | 'created_at'>>
): Promise<Race | null> {
  // Build dynamic update - for simplicity, we'll update all provided fields
  const result = await sql<Race>`
    UPDATE races
    SET 
      name = COALESCE(${updates.name || null}, name),
      date = COALESCE(${updates.date?.toISOString() || null}, date),
      distance_km = COALESCE(${updates.distance_km || null}, distance_km),
      elevation_gain_m = COALESCE(${updates.elevation_gain_m ?? null}, elevation_gain_m),
      elevation_loss_m = COALESCE(${updates.elevation_loss_m ?? null}, elevation_loss_m),
      race_type = COALESCE(${updates.race_type || null}, race_type),
      goal_time = COALESCE(${updates.goal_time || null}, goal_time),
      priority = COALESCE(${updates.priority || null}, priority),
      notes = COALESCE(${updates.notes || null}, notes)
    WHERE id = ${raceId} AND user_strava_id = ${stravaId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// Delete a race
export async function deleteRace(raceId: number, stravaId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM races 
    WHERE id = ${raceId} AND user_strava_id = ${stravaId}
  `;
  return (result.rowCount ?? 0) > 0;
}

// ============ USER PREFERENCES FUNCTIONS ============

// Get user preferences
export async function getUserPreferences(stravaId: string): Promise<UserPreferences | null> {
  const result = await sql<UserPreferences>`
    SELECT * FROM user_preferences WHERE user_strava_id = ${stravaId}
  `;
  return result.rows[0] || null;
}

// Upsert user preferences
export async function upsertUserPreferences(prefs: {
  user_strava_id: string;
  training_days?: string[];
  long_run_day?: string;
  max_weekly_km?: number;
  notes?: string;
}): Promise<UserPreferences> {
  const trainingDaysJson = JSON.stringify(prefs.training_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

  const result = await sql<UserPreferences>`
    INSERT INTO user_preferences (user_strava_id, training_days, long_run_day, max_weekly_km, notes)
    VALUES (${prefs.user_strava_id}, ${trainingDaysJson}, ${prefs.long_run_day || 'sunday'}, ${prefs.max_weekly_km || 80}, ${prefs.notes || ''})
    ON CONFLICT (user_strava_id) DO UPDATE SET
      training_days = COALESCE(${trainingDaysJson}, user_preferences.training_days),
      long_run_day = COALESCE(${prefs.long_run_day || null}, user_preferences.long_run_day),
      max_weekly_km = COALESCE(${prefs.max_weekly_km || null}, user_preferences.max_weekly_km),
      notes = COALESCE(${prefs.notes || null}, user_preferences.notes),
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// Format races for AI context
export function formatRacesForAI(races: Race[]): string {
  if (races.length === 0) return "No upcoming races scheduled.";

  const today = new Date();

  return races.map(race => {
    const raceDate = new Date(race.date);
    const daysUntil = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weeksUntil = Math.floor(daysUntil / 7);

    let timeframe = `${daysUntil} days`;
    if (weeksUntil > 0) {
      timeframe = `${weeksUntil} weeks, ${daysUntil % 7} days`;
    }

    const priorityLabel = race.priority === 'A' ? '⭐ MAIN GOAL' : race.priority === 'B' ? 'Tune-up' : 'Fun race';

    return `- ${race.name} (${race.distance_km}km ${race.race_type}) on ${raceDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} - ${timeframe} away [${priorityLabel}]${race.goal_time ? ` Goal: ${race.goal_time}` : ''}`;
  }).join('\n');
}

// ============ USER GOALS FUNCTIONS ============

export type GoalType = 'maintain' | 'get_faster' | 'lose_weight' | 'run_longer' | 'competition';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export interface UserGoal {
  id: number;
  user_strava_id: string;
  goal_type: GoalType;
  target_race_id?: number;
  target_pace?: string;
  weekly_mileage_km: number;
  running_experience: ExperienceLevel;
  injuries_notes?: string;
  last_race_date?: Date;
  last_race_distance_km?: number;
  recovery_end_date?: Date;
  created_at: Date;
  updated_at: Date;
}

// Get user goal
export async function getUserGoal(stravaId: string): Promise<UserGoal | null> {
  const result = await sql<UserGoal>`
    SELECT * FROM user_goals WHERE user_strava_id = ${stravaId}
  `;
  return result.rows[0] || null;
}

// Upsert user goal
export async function upsertUserGoal(goal: {
  user_strava_id: string;
  goal_type: GoalType;
  target_race_id?: number;
  target_pace?: string;
  weekly_mileage_km?: number;
  running_experience?: ExperienceLevel;
  injuries_notes?: string;
}): Promise<UserGoal> {
  const result = await sql<UserGoal>`
    INSERT INTO user_goals (user_strava_id, goal_type, target_race_id, target_pace, weekly_mileage_km, running_experience, injuries_notes)
    VALUES (${goal.user_strava_id}, ${goal.goal_type}, ${goal.target_race_id || null}, ${goal.target_pace || null}, ${goal.weekly_mileage_km || 30}, ${goal.running_experience || 'intermediate'}, ${goal.injuries_notes || null})
    ON CONFLICT (user_strava_id) DO UPDATE SET
      goal_type = ${goal.goal_type},
      target_race_id = COALESCE(${goal.target_race_id || null}, user_goals.target_race_id),
      target_pace = COALESCE(${goal.target_pace || null}, user_goals.target_pace),
      weekly_mileage_km = COALESCE(${goal.weekly_mileage_km || null}, user_goals.weekly_mileage_km),
      running_experience = COALESCE(${goal.running_experience || null}, user_goals.running_experience),
      injuries_notes = COALESCE(${goal.injuries_notes || null}, user_goals.injuries_notes),
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// Update after a race completion
export async function updatePostRace(
  stravaId: string,
  raceDate: Date,
  raceDistanceKm: number
): Promise<UserGoal | null> {
  // Calculate recovery period based on race distance
  let recoveryDays = 7; // default
  if (raceDistanceKm >= 80) recoveryDays = 21; // ultra
  else if (raceDistanceKm >= 42) recoveryDays = 14; // marathon
  else if (raceDistanceKm >= 21) recoveryDays = 10; // half
  else if (raceDistanceKm >= 10) recoveryDays = 5; // 10k

  const recoveryEndDate = new Date(raceDate);
  recoveryEndDate.setDate(recoveryEndDate.getDate() + recoveryDays);

  const result = await sql<UserGoal>`
    UPDATE user_goals
    SET last_race_date = ${raceDate.toISOString()},
        last_race_distance_km = ${raceDistanceKm},
        recovery_end_date = ${recoveryEndDate.toISOString()},
        goal_type = 'maintain',
        updated_at = NOW()
    WHERE user_strava_id = ${stravaId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// Format goal for AI context
export function formatGoalForAI(goal: UserGoal | null, races: Race[]): string {
  if (!goal) {
    return `USER GOAL: Not yet set. Ask the user what their training goal is (Maintain fitness, Get faster, Lose weight, Run longer, or Prepare for a race).`;
  }

  const today = new Date();
  let goalDescription = '';

  // Check if in recovery period
  if (goal.recovery_end_date) {
    const recoveryEnd = new Date(goal.recovery_end_date);
    if (recoveryEnd > today) {
      const daysLeft = Math.ceil((recoveryEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return `USER GOAL: POST-RACE RECOVERY MODE
- Recently completed: ${goal.last_race_distance_km}km race on ${new Date(goal.last_race_date!).toLocaleDateString()}
- Recovery period: ${daysLeft} days remaining (ends ${recoveryEnd.toLocaleDateString()})
- Focus: Easy runs only, reduced volume, active recovery, NO speed work
- After recovery: Ask what goal they want to pursue next

ATHLETE PROFILE:
- Weekly mileage: ${goal.weekly_mileage_km}km
- Experience: ${goal.running_experience}
${goal.injuries_notes ? `- Injuries/Notes: ${goal.injuries_notes}` : ''}`;
    }
  }

  // Check for upcoming A-priority race for proactive notification
  const upcomingARace = races.find(r => r.priority === 'A');
  let raceAlert = '';
  if (upcomingARace && goal.goal_type !== 'competition') {
    const raceDate = new Date(upcomingARace.date);
    const weeksUntil = Math.floor((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 7));
    if (weeksUntil <= 12 && weeksUntil >= 6) {
      raceAlert = `\n\n⚠️ PROACTIVE ALERT: User has ${upcomingARace.name} (${upcomingARace.distance_km}km) in ${weeksUntil} weeks but hasn't started race-specific training. RECOMMEND switching to competition preparation mode.`;
    }
  }

  switch (goal.goal_type) {
    case 'maintain':
      goalDescription = `MAINTAIN FITNESS - Focus on consistency and balanced training. No aggressive progression needed. Prioritize easy runs, light variety, and recovery.`;
      break;
    case 'get_faster':
      goalDescription = `GET FASTER - Focus on speed development. Include interval training, tempo runs, progressive intensity. Build recovery weeks every 3-4 weeks. Track pace improvements.`;
      break;
    case 'lose_weight':
      goalDescription = `LOSE WEIGHT - Focus on caloric expenditure and sustainability. Emphasize longer Zone 2 runs, gradual volume increases, and cross-training. Avoid burnout and overtraining.`;
      break;
    case 'run_longer':
      goalDescription = `RUN LONGER - Focus on endurance building. Progressively increase long run distance (max 10% weekly), prioritize time on feet over pace, include proper recovery.`;
      break;
    case 'competition':
      const targetRace = races.find(r => r.id === goal.target_race_id) || upcomingARace;
      if (targetRace) {
        const raceDate = new Date(targetRace.date);
        const weeksUntil = Math.floor((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 7));
        const daysUntil = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        let phase = 'BASE BUILDING';
        if (daysUntil <= 7) phase = 'RACE WEEK - Taper and rest';
        else if (weeksUntil <= 2) phase = 'TAPER PHASE - Reduce volume, maintain intensity';
        else if (weeksUntil <= 5) phase = 'PEAK/SHARPENING - Race-specific workouts';
        else if (weeksUntil <= 10) phase = 'BUILD PHASE - Progressive overload';

        goalDescription = `COMPETITION PREPARATION for ${targetRace.name}
- Race: ${targetRace.distance_km}km ${targetRace.race_type} on ${raceDate.toLocaleDateString()}
- Time until race: ${weeksUntil} weeks (${daysUntil} days)
- Current phase: ${phase}
${goal.target_pace ? `- Target pace: ${goal.target_pace}` : ''}
${targetRace.goal_time ? `- Goal time: ${targetRace.goal_time}` : ''}`;
      } else {
        goalDescription = `COMPETITION PREPARATION - No target race selected yet. Ask user to select or add a race.`;
      }
      break;
  }

  return `USER GOAL: ${goalDescription}

ATHLETE PROFILE:
- Weekly mileage: ${goal.weekly_mileage_km}km
- Experience level: ${goal.running_experience}
${goal.injuries_notes ? `- Injuries/Notes: ${goal.injuries_notes}` : ''}${raceAlert}`;
}

// ============ COACH MEMORY FUNCTIONS ============

export type MemoryType = 'feeling' | 'injury' | 'preference' | 'health_note' | 'goal';

export interface CoachMemory {
  id: number;
  user_strava_id: string;
  memory_type: MemoryType;
  content: string;
  extracted_from?: string;
  relevance_score: number;
  created_at: Date;
  expires_at?: Date;
}

// Get all memories for a user (optionally filter by type, exclude expired)
export async function getCoachMemories(
  stravaId: string,
  type?: MemoryType
): Promise<CoachMemory[]> {
  if (type) {
    const result = await sql<CoachMemory>`
      SELECT * FROM coach_memories 
      WHERE user_strava_id = ${stravaId} 
        AND memory_type = ${type}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `;
    return result.rows;
  }
  const result = await sql<CoachMemory>`
    SELECT * FROM coach_memories 
    WHERE user_strava_id = ${stravaId}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return result.rows;
}

// Save a new memory
export async function saveCoachMemory(memory: {
  user_strava_id: string;
  memory_type: MemoryType;
  content: string;
  extracted_from?: string;
  expires_at?: Date;
}): Promise<CoachMemory> {
  const result = await sql<CoachMemory>`
    INSERT INTO coach_memories (user_strava_id, memory_type, content, extracted_from, expires_at)
    VALUES (
      ${memory.user_strava_id},
      ${memory.memory_type},
      ${memory.content},
      ${memory.extracted_from || null},
      ${memory.expires_at?.toISOString() || null}
    )
    RETURNING *
  `;
  return result.rows[0];
}

// Delete a memory
export async function deleteCoachMemory(id: number, stravaId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM coach_memories 
    WHERE id = ${id} AND user_strava_id = ${stravaId}
  `;
  return (result.rowCount ?? 0) > 0;
}

// Format memories for AI context
export function formatMemoriesForAI(memories: CoachMemory[]): string {
  if (!memories.length) return '';

  const grouped: Record<string, string[]> = {};
  memories.forEach(m => {
    if (!grouped[m.memory_type]) grouped[m.memory_type] = [];
    grouped[m.memory_type].push(m.content);
  });

  const lines: string[] = ['## COACH MEMORY (Athlete-provided insights)', ''];

  if (grouped['injury']?.length) {
    lines.push('**Injuries/Concerns:**');
    grouped['injury'].forEach(c => lines.push(`- ${c}`));
    lines.push('');
  }
  if (grouped['feeling']?.length) {
    lines.push('**Recent feelings/state:**');
    grouped['feeling'].slice(0, 5).forEach(c => lines.push(`- ${c}`));
    lines.push('');
  }
  if (grouped['preference']?.length) {
    lines.push('**Preferences:**');
    grouped['preference'].forEach(c => lines.push(`- ${c}`));
    lines.push('');
  }
  if (grouped['health_note']?.length) {
    lines.push('**Health notes:**');
    grouped['health_note'].forEach(c => lines.push(`- ${c}`));
  }

  return lines.join('\n');
}

// ============ LACTATE TEST DATA FUNCTIONS ============

export interface LactateTest {
  id: number;
  user_strava_id: string;
  test_date: Date;
  aerobic_threshold_hr?: number;
  aerobic_threshold_pace?: string;
  aerobic_threshold_power?: number;
  anaerobic_threshold_hr?: number;
  anaerobic_threshold_pace?: string;
  anaerobic_threshold_power?: number;
  max_hr?: number;
  vo2max?: number;
  source: 'manual' | 'pdf_upload';
  raw_pdf_data?: object;
  notes?: string;
  // HR zones (editable)
  z1_hr?: string;
  z2_hr?: string;
  z3_hr?: string;
  z4_hr?: string;
  z5_hr?: string;
  created_at: Date;
}

// Get latest lactate test for a user
// Get latest lactate test for a user
export async function getLactateTest(stravaId: string): Promise<LactateTest | null> {
  const result = await sql<LactateTest>`
    SELECT * FROM lactate_tests 
    WHERE user_strava_id = ${stravaId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return result.rows[0] || null;
}

// Save lactate test data (UPSERT - updates if user already has a test)
export async function saveLactateTest(test: {
  user_strava_id: string;
  test_date: Date;
  aerobic_threshold_hr?: number;
  aerobic_threshold_pace?: string;
  anaerobic_threshold_hr?: number;
  anaerobic_threshold_pace?: string;
  max_hr?: number;
  vo2max?: number;
  source?: 'manual' | 'pdf_upload';
  raw_pdf_data?: object;
  notes?: string;
  z1_hr?: string;
  z2_hr?: string;
  z3_hr?: string;
  z4_hr?: string;
  z5_hr?: string;
}): Promise<LactateTest> {
  // First check if user already has a lactate test - if so, update it
  const existing = await sql<LactateTest>`
    SELECT id FROM lactate_tests WHERE user_strava_id = ${test.user_strava_id}
    ORDER BY created_at DESC LIMIT 1
  `;

  if (existing.rows.length > 0) {
    // Update existing record
    const result = await sql<LactateTest>`
      UPDATE lactate_tests SET
        test_date = ${test.test_date.toISOString()},
        aerobic_threshold_hr = ${test.aerobic_threshold_hr || null},
        aerobic_threshold_pace = ${test.aerobic_threshold_pace || null},
        anaerobic_threshold_hr = ${test.anaerobic_threshold_hr || null},
        anaerobic_threshold_pace = ${test.anaerobic_threshold_pace || null},
        max_hr = ${test.max_hr || null},
        vo2max = ${test.vo2max || null},
        source = ${test.source || 'manual'},
        raw_pdf_data = ${test.raw_pdf_data ? JSON.stringify(test.raw_pdf_data) : null},
        notes = ${test.notes || null},
        z1_hr = ${test.z1_hr || null},
        z2_hr = ${test.z2_hr || null},
        z3_hr = ${test.z3_hr || null},
        z4_hr = ${test.z4_hr || null},
        z5_hr = ${test.z5_hr || null}
      WHERE id = ${existing.rows[0].id}
      RETURNING *
    `;
    return result.rows[0];
  }

  // Insert new record if no existing test
  const result = await sql<LactateTest>`
    INSERT INTO lactate_tests (
      user_strava_id, test_date, aerobic_threshold_hr, aerobic_threshold_pace,
      anaerobic_threshold_hr, anaerobic_threshold_pace, max_hr, vo2max,
      source, raw_pdf_data, notes, z1_hr, z2_hr, z3_hr, z4_hr, z5_hr
    )
    VALUES (
      ${test.user_strava_id},
      ${test.test_date.toISOString()},
      ${test.aerobic_threshold_hr || null},
      ${test.aerobic_threshold_pace || null},
      ${test.anaerobic_threshold_hr || null},
      ${test.anaerobic_threshold_pace || null},
      ${test.max_hr || null},
      ${test.vo2max || null},
      ${test.source || 'manual'},
      ${test.raw_pdf_data ? JSON.stringify(test.raw_pdf_data) : null},
      ${test.notes || null},
      ${test.z1_hr || null},
      ${test.z2_hr || null},
      ${test.z3_hr || null},
      ${test.z4_hr || null},
      ${test.z5_hr || null}
    )
    RETURNING *
  `;
  return result.rows[0];
}

// Format lactate test for AI context
export function formatLactateTestForAI(test: LactateTest | null): string {
  if (!test) return '';

  const lines: string[] = [
    '## LAB TEST DATA',
    `Test date: ${new Date(test.test_date).toLocaleDateString()}`,
  ];

  if (test.aerobic_threshold_hr || test.aerobic_threshold_pace) {
    lines.push(`Aerobic threshold (LT1): ${test.aerobic_threshold_hr ? `${test.aerobic_threshold_hr}bpm` : ''}${test.aerobic_threshold_pace ? ` @ ${test.aerobic_threshold_pace}/km` : ''}`);
  }
  if (test.anaerobic_threshold_hr || test.anaerobic_threshold_pace) {
    lines.push(`Anaerobic threshold (LT2): ${test.anaerobic_threshold_hr ? `${test.anaerobic_threshold_hr}bpm` : ''}${test.anaerobic_threshold_pace ? ` @ ${test.anaerobic_threshold_pace}/km` : ''}`);
  }
  if (test.max_hr) {
    lines.push(`Max HR: ${test.max_hr}bpm`);
  }
  if (test.vo2max) {
    lines.push(`VO2max: ${test.vo2max} ml/kg/min`);
  }

  lines.push('');
  lines.push('USE THESE VALUES for prescribing training zones - they are lab-tested, not estimated.');

  return lines.join('\n');
}

// ============ TRAINING BLOCK FUNCTIONS ============

export interface TrainingPhase {
  name: string;           // "Base", "Build", "Peak", "Taper"
  weeks: number;
  focus: string;          // "Aerobic volume", "Threshold work", etc.
  weeklyKm: number[];     // Target km for each week in this phase
}

export interface BlockPlan {
  totalWeeks: number;
  phases: TrainingPhase[];
  keyWorkouts: string[];  // ["Long run", "Tempo", "Intervals"]
  notes: string;          // AI-generated training philosophy
}

export interface TrainingBlock {
  id: number;
  user_strava_id: string;
  race_id: number | null;
  start_date: Date;
  end_date: Date;         // Race day
  block_plan: BlockPlan;
  weekly_workouts: Record<string, DailyWorkout[]>;  // Stored workouts by week number
  last_compliance_check: Date | null;
  last_modified_reason: string | null;  // Why the plan was last modified
  status: 'active' | 'completed' | 'abandoned' | 'compromised';
  created_at: Date;
  updated_at: Date;
}

// Workout modification tracking (for bio-feedback adjustments)
export interface WorkoutModification {
  triggered_by: 'sleep' | 'stress' | 'injury' | 'general';
  original_workout: string;   // What the workout was before modification
  original_type?: string;     // Original type (e.g., "Tempo")
  reason: string;             // Human-readable reason
  modified_at: string;        // ISO timestamp
}

// Structure for stored daily workouts
export interface DailyWorkout {
  day: string;           // "Monday", "Tuesday", etc.
  type: string;          // "Easy", "Tempo", "Long Run", "Rest", etc.
  distance_km?: number;
  duration_min?: number;
  elevation_m?: number;  // Target vertical gain in meters
  description?: string;
  intensity?: string;    // "Zone 2", "Threshold", etc.
  hrZone?: string;       // e.g., "Zone 2: 130-145 bpm"
  targetPace?: string;   // e.g., "6:30-7:00/km"
  effortLevel?: string;  // e.g., "Conversational"
  nutrition?: string;    // e.g., "Eat 2h before. Bring gel for runs >1h"
  recovery?: string;     // NEW: Evening recovery suggestions (massage gun, ice bath, etc.)
  corosZone?: string;    // COROS watch equivalent zone label
  rationale?: string;    // Why this workout
  modification?: WorkoutModification; // Bio-feedback adjustment record
}

// Get active training block for a user (optionally for a specific race)
export async function getActiveTrainingBlock(
  stravaId: string,
  raceId?: number
): Promise<TrainingBlock | null> {
  if (raceId) {
    const result = await sql`
      SELECT * FROM training_blocks 
      WHERE user_strava_id = ${stravaId} 
      AND race_id = ${raceId}
      AND status = 'active'
    `;
    return result.rows[0] ? transformBlock(result.rows[0]) : null;
  }

  // Get the most relevant active block (closest race)
  const result = await sql`
    SELECT tb.*, ur.name as race_name FROM training_blocks tb
    LEFT JOIN races ur ON tb.race_id = ur.id
    WHERE tb.user_strava_id = ${stravaId} 
    AND tb.status = 'active'
    ORDER BY ur.date ASC
    LIMIT 1
  `;
  return result.rows[0] ? transformBlock(result.rows[0]) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformBlock(row: any): TrainingBlock {
  return {
    ...row,
    raceName: row.race_name || null,
    start_date: new Date(row.start_date),
    end_date: new Date(row.end_date),
    block_plan: typeof row.block_plan === 'string' ? JSON.parse(row.block_plan) : row.block_plan,
    weekly_workouts: typeof row.weekly_workouts === 'string' ? JSON.parse(row.weekly_workouts) : (row.weekly_workouts || {}),
    last_compliance_check: row.last_compliance_check ? new Date(row.last_compliance_check) : null,
    last_modified_reason: row.last_modified_reason || null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// Save a new training block
export async function saveTrainingBlock(block: {
  user_strava_id: string;
  race_id?: number;
  start_date: Date;
  end_date: Date;
  block_plan: BlockPlan;
  weekly_workouts?: Record<string, DailyWorkout[]>;
}): Promise<TrainingBlock> {
  // First, mark any existing active blocks for this race as abandoned
  if (block.race_id) {
    await sql`
      UPDATE training_blocks 
      SET status = 'abandoned', updated_at = NOW()
      WHERE user_strava_id = ${block.user_strava_id} 
      AND race_id = ${block.race_id}
      AND status = 'active'
    `;
  }

  const result = await sql`
    INSERT INTO training_blocks (
      user_strava_id, race_id, start_date, end_date, block_plan, weekly_workouts, status
    ) VALUES (
      ${block.user_strava_id},
      ${block.race_id || null},
      ${block.start_date.toISOString()},
      ${block.end_date.toISOString()},
      ${JSON.stringify(block.block_plan)},
      ${JSON.stringify(block.weekly_workouts || {})},
      'active'
    )
    RETURNING *
  `;
  return transformBlock(result.rows[0]);
}

// Update block status
export async function updateTrainingBlockStatus(
  blockId: number,
  status: 'active' | 'completed' | 'abandoned' | 'compromised'
): Promise<void> {
  await sql`
    UPDATE training_blocks 
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${blockId}
  `;
}

// Get current week number in a block (Monday-aligned to match block-calendar.tsx grid)
export function getCurrentWeekInBlock(block: TrainingBlock): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Find the Monday of the week containing the start date
  const startDate = new Date(block.start_date);
  startDate.setHours(0, 0, 0, 0);
  const dow = startDate.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const startMonday = new Date(startDate);
  startMonday.setDate(startMonday.getDate() - daysSinceMonday);

  const diffMs = now.getTime() - startMonday.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(diffWeeks + 1, block.block_plan.totalWeeks));
}

// Get current phase in a block
export function getCurrentPhaseInBlock(block: TrainingBlock): { phase: TrainingPhase; weekInPhase: number } {
  const currentWeek = getCurrentWeekInBlock(block);
  let weekCounter = 0;

  for (const phase of block.block_plan.phases) {
    if (currentWeek <= weekCounter + phase.weeks) {
      return {
        phase,
        weekInPhase: currentWeek - weekCounter,
      };
    }
    weekCounter += phase.weeks;
  }

  // Default to last phase
  const lastPhase = block.block_plan.phases[block.block_plan.phases.length - 1];
  return { phase: lastPhase, weekInPhase: lastPhase.weeks };
}

// ============ CONTEXT INJECTION (Architectural Integrity Layer 1) ============

export interface WeekTargets {
  weekNumber: number;
  totalWeeks: number;
  targetVolume: number;     // km target for this week
  phaseName: string;
  phaseFocus: string;
  keyWorkouts: string[];
  isRecoveryWeek: boolean;  // true if this week is lower than previous
}

// Get strict targets for a specific week (used to constrain AI generation)
export function getBlockTargetsForWeek(block: TrainingBlock, weekNumber: number): WeekTargets {
  const { phase, weekInPhase } = getCurrentPhaseInBlock({ ...block, block_plan: block.block_plan } as TrainingBlock);

  // Get the target volume for this week
  const targetVolume = phase.weeklyKm[weekInPhase - 1] ?? phase.weeklyKm[0] ?? 40;

  // Check if this is a recovery week (volume less than previous week)
  const previousWeekVolume = weekInPhase > 1
    ? phase.weeklyKm[weekInPhase - 2]
    : targetVolume;
  const isRecoveryWeek = targetVolume < previousWeekVolume * 0.9;

  return {
    weekNumber,
    totalWeeks: block.block_plan.totalWeeks,
    targetVolume,
    phaseName: phase.name,
    phaseFocus: phase.focus,
    keyWorkouts: block.block_plan.keyWorkouts,
    isRecoveryWeek,
  };
}

// Format week targets as strict AI constraints
export function formatTargetsAsConstraints(targets: WeekTargets): string {
  const tolerance = targets.isRecoveryWeek ? 5 : 10;
  return [
    '## STRICT VOLUME CONSTRAINTS (DO NOT EXCEED)',
    `CONSTRAINT 1: Total weekly volume MUST be ${targets.targetVolume}km (±${tolerance}%)`,
    `CONSTRAINT 2: This is Week ${targets.weekNumber} of ${targets.totalWeeks} — ${targets.phaseName} phase`,
    `CONSTRAINT 3: Focus: ${targets.phaseFocus}`,
    `CONSTRAINT 4: Must include: ${targets.keyWorkouts.join(', ')}`,
    targets.isRecoveryWeek ? 'CONSTRAINT 5: This is a RECOVERY week - reduce intensity appropriately' : '',
    '',
    `Volume validation: AI will retry if sum of distance_km deviates >±${tolerance}% from ${targets.targetVolume}km`,
  ].filter(Boolean).join('\n');
}

// Format block for AI context
export function formatBlockForAI(block: TrainingBlock | null, race?: Race): string {
  if (!block) return '';

  const currentWeek = getCurrentWeekInBlock(block);
  const { phase, weekInPhase } = getCurrentPhaseInBlock(block);
  const weeksUntilRace = block.block_plan.totalWeeks - currentWeek + 1;

  const lines: string[] = [
    '## TRAINING BLOCK',
    `Race: ${race?.name || 'Goal Race'} on ${block.end_date.toLocaleDateString()}`,
    `Current Phase: ${phase.name} (Week ${weekInPhase} of ${phase.weeks})`,
    `Block Progress: Week ${currentWeek} of ${block.block_plan.totalWeeks} (${weeksUntilRace} weeks until race)`,
    `Phase Focus: ${phase.focus}`,
    `This Week Target: ${phase.weeklyKm[weekInPhase - 1] || phase.weeklyKm[0]}km`,
    '',
    'IMPORTANT: Generate this week\'s plan WITHIN these block parameters.',
    `Key workouts for ${phase.name} phase: ${block.block_plan.keyWorkouts.join(', ')}`,
    '',
  ];

  if (block.block_plan.notes) {
    lines.push(`Coach Notes: ${block.block_plan.notes}`);
  }

  return lines.join('\n');
}

/**
 * Enhanced training block formatter for chat context.
 * Includes prescribed workouts for this week and last week for continuity.
 */
export function formatBlockForAIv2(block: TrainingBlock | null, race?: Race): string {
  if (!block) return '';

  const currentWeek = getCurrentWeekInBlock(block);
  const { phase, weekInPhase } = getCurrentPhaseInBlock(block);
  const weeksUntilRace = block.block_plan.totalWeeks - currentWeek + 1;

  // Build race profile string
  let raceProfile = `${race?.name || 'Goal Race'} on ${block.end_date.toLocaleDateString()}`;
  if (race) {
    raceProfile += ` — ${race.distance_km}km`;
    if (race.elevation_gain_m) {
      const vertDensity = Math.round(race.elevation_gain_m / race.distance_km);
      raceProfile += ` / +${race.elevation_gain_m}m`;
      if (race.elevation_loss_m && race.elevation_loss_m !== race.elevation_gain_m) {
        raceProfile += ` / -${race.elevation_loss_m}m`;
      }
      raceProfile += ` (${vertDensity}m/km)`;
    }
  }

  // Get today's info for context INCLUDING TIME
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = dayNames[today.getDay()];
  const todayFormatted = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Add time-of-day context
  const hours = today.getHours();
  const minutes = today.getMinutes();
  const timeFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  let timeOfDay: string;
  if (hours < 6) {
    timeOfDay = 'early morning (before 6am)';
  } else if (hours < 12) {
    timeOfDay = 'morning';
  } else if (hours < 17) {
    timeOfDay = 'afternoon';
  } else if (hours < 21) {
    timeOfDay = 'evening';
  } else {
    timeOfDay = 'late evening (after 9pm - day is almost over)';
  }

  const lines: string[] = [
    '## TRAINING BLOCK',
    '',
    `**Current Time:** ${timeFormatted} (${timeOfDay})`,
    `**Today:** ${todayFormatted} (${todayName})`,

    `**Target Race:** ${raceProfile}`,
    `**Current Phase:** ${phase.name} (Week ${weekInPhase} of ${phase.weeks})`,
    `**Block Progress:** Week ${currentWeek} of ${block.block_plan.totalWeeks} (${weeksUntilRace} weeks until race)`,
    `**Phase Focus:** ${phase.focus}`,
    `**This Week Volume Target:** ${phase.weeklyKm[weekInPhase - 1] || phase.weeklyKm[0]}km`,
    `**Key Workouts:** ${block.block_plan.keyWorkouts.join(', ')}`,
    '',
  ];

  // Add coach notes / training philosophy if present
  if (block.block_plan.notes) {
    lines.push(`**Training Philosophy:** ${block.block_plan.notes}`);
    lines.push('');
  }

  // Add last modification reason if present
  if (block.last_modified_reason) {
    lines.push(`**Last Adjustment:** ${block.last_modified_reason}`);
    lines.push('');
  }

  // Add THIS WEEK's prescribed workouts if they exist
  const thisWeekWorkouts = block.weekly_workouts?.[currentWeek.toString()];

  // Find and highlight today's workout prominently at the top
  const todayWorkout = thisWeekWorkouts?.find(w =>
    w.day.toLowerCase() === todayName.toLowerCase()
  );
  if (todayWorkout) {
    const details = [];
    if (todayWorkout.distance_km) details.push(`${todayWorkout.distance_km}km`);
    if (todayWorkout.duration_min) details.push(`${todayWorkout.duration_min}min`);
    const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
    lines.push(`**TODAY'S PRESCRIBED WORKOUT:** ${todayWorkout.type}${detailStr}`);
    lines.push('');
  } else if (thisWeekWorkouts && thisWeekWorkouts.length > 0) {
    // We have workouts but none for today = rest day
    lines.push(`**TODAY'S PRESCRIBED WORKOUT:** Rest Day`);
    lines.push('');
  }

  if (thisWeekWorkouts && thisWeekWorkouts.length > 0) {
    lines.push('### This Week\'s Prescribed Plan');
    for (const workout of thisWeekWorkouts) {
      const details = [];
      if (workout.distance_km) details.push(`${workout.distance_km}km`);
      if (workout.duration_min) details.push(`${workout.duration_min}min`);
      const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
      const isToday = workout.day.toLowerCase() === todayName.toLowerCase();
      const todayMarker = isToday ? ' ← TODAY' : '';
      lines.push(`- **${workout.day}:** ${workout.type}${detailStr}${workout.description ? ` — ${workout.description}` : ''}${todayMarker}`);
    }
    lines.push('');
  }


  // Add LAST WEEK's prescribed workouts for continuity
  const lastWeek = currentWeek - 1;
  if (lastWeek >= 1) {
    const lastWeekWorkouts = block.weekly_workouts?.[lastWeek.toString()];
    if (lastWeekWorkouts && lastWeekWorkouts.length > 0) {
      lines.push('### Last Week\'s Prescribed Plan (for reference)');
      for (const workout of lastWeekWorkouts) {
        const details = [];
        if (workout.distance_km) details.push(`${workout.distance_km}km`);
        if (workout.duration_min) details.push(`${workout.duration_min}min`);
        const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
        lines.push(`- **${workout.day}:** ${workout.type}${detailStr}`);
      }
      lines.push('');
      lines.push('*Compare actual activities in TRAINING LOG against these prescriptions.*');
      lines.push('');
    }
  }

  // Add phase progression context
  lines.push('### Phase Progression');
  let weekCounter = 0;
  for (const p of block.block_plan.phases) {
    const startWeek = weekCounter + 1;
    const endWeek = weekCounter + p.weeks;
    const isCurrent = currentWeek >= startWeek && currentWeek <= endWeek;
    const marker = isCurrent ? ' ← YOU ARE HERE' : '';
    lines.push(`- ${p.name}: Weeks ${startWeek}-${endWeek} (${p.focus})${marker}`);
    weekCounter += p.weeks;
  }

  return lines.join('\n');
}

// ============ WEEKLY WORKOUT PERSISTENCE FUNCTIONS ============

// Get stored weekly workouts for a specific week (returns null if not stored)
export async function getStoredWeeklyWorkouts(
  blockId: number,
  weekNumber: number
): Promise<DailyWorkout[] | null> {
  const result = await sql`
    SELECT weekly_workouts FROM training_blocks 
    WHERE id = ${blockId}
  `;

  if (!result.rows[0]) return null;

  const workouts = typeof result.rows[0].weekly_workouts === 'string'
    ? JSON.parse(result.rows[0].weekly_workouts)
    : result.rows[0].weekly_workouts || {};

  return workouts[weekNumber.toString()] || null;
}

// Save weekly workouts for a specific week
export async function saveWeeklyWorkouts(
  blockId: number,
  weekNumber: number,
  workouts: DailyWorkout[]
): Promise<void> {
  // Get current weekly_workouts, update the specific week, save back
  const result = await sql`
    SELECT weekly_workouts FROM training_blocks 
    WHERE id = ${blockId}
  `;

  if (!result.rows[0]) return;

  const currentWorkouts = typeof result.rows[0].weekly_workouts === 'string'
    ? JSON.parse(result.rows[0].weekly_workouts)
    : result.rows[0].weekly_workouts || {};

  // Add/update the week
  currentWorkouts[weekNumber.toString()] = workouts;

  await sql`
    UPDATE training_blocks 
    SET weekly_workouts = ${JSON.stringify(currentWorkouts)}, updated_at = NOW()
    WHERE id = ${blockId}
  `;
}

// Update training block (for persisting adaptations)
export async function updateTrainingBlock(
  blockId: number,
  updates: {
    block_plan?: BlockPlan;
    weekly_workouts?: Record<string, DailyWorkout[]>;
    status?: 'active' | 'completed' | 'abandoned';
  }
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.block_plan !== undefined) {
    values.push(JSON.stringify(updates.block_plan));
    setClauses.push('block_plan = $' + values.length);
  }
  if (updates.weekly_workouts !== undefined) {
    values.push(JSON.stringify(updates.weekly_workouts));
    setClauses.push('weekly_workouts = $' + values.length);
  }
  if (updates.status !== undefined) {
    values.push(updates.status);
    setClauses.push('status = $' + values.length);
  }

  if (setClauses.length === 0) return;

  values.push(blockId);

  // Build raw SQL since we have dynamic SET clauses
  const query = `UPDATE training_blocks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`;

  // Use raw query
  await sql.query(query, values);
}

// Update last compliance check timestamp
export async function updateComplianceCheck(blockId: number): Promise<void> {
  await sql`
    UPDATE training_blocks 
    SET last_compliance_check = NOW(), updated_at = NOW()
    WHERE id = ${blockId}
  `;
}

// Update training block with modified plan and audit timestamp (from compliance check)
export async function updateTrainingBlockPlan(
  blockId: number,
  blockPlan: BlockPlan,
  reason?: string
): Promise<void> {
  await sql`
    UPDATE training_blocks 
    SET 
      block_plan = ${JSON.stringify(blockPlan)},
      last_compliance_check = NOW(),
      last_modified_reason = ${reason || null},
      updated_at = NOW()
    WHERE id = ${blockId}
  `;
}

// Invalidate weekly workouts from a specific week onwards (for when adaptations require regeneration)
export async function invalidateWeeklyWorkouts(
  blockId: number,
  fromWeek: number
): Promise<void> {
  const result = await sql`
    SELECT weekly_workouts FROM training_blocks 
    WHERE id = ${blockId}
  `;

  if (!result.rows[0]) return;

  const currentWorkouts = typeof result.rows[0].weekly_workouts === 'string'
    ? JSON.parse(result.rows[0].weekly_workouts)
    : result.rows[0].weekly_workouts || {};

  // Remove all weeks >= fromWeek
  Object.keys(currentWorkouts).forEach(weekStr => {
    const week = parseInt(weekStr);
    if (week >= fromWeek) {
      delete currentWorkouts[weekStr];
    }
  });

  await sql`
    UPDATE training_blocks 
    SET weekly_workouts = ${JSON.stringify(currentWorkouts)}, updated_at = NOW()
    WHERE id = ${blockId}
  `;
}

// Delete active training block
export async function deleteActiveTrainingBlock(stravaId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM training_blocks 
    WHERE user_strava_id = ${stravaId} 
    AND status = 'active'
    RETURNING id
  `;
  return result.rows.length > 0;
}

// ============ PLAN VERSIONING & CHANGELOG FUNCTIONS ============

export interface PlanChangelogEntry {
  id: number;
  block_id: number;
  version: number;
  change_type: 'created' | 'volume_adjusted' | 'phase_modified' | 'compliance_adaptation';
  reason: string;
  volume_change_pct: number | null;
  old_plan_snapshot: BlockPlan | null;
  week_number: number | null;
  created_at: Date;
}

// Increment plan version and return new version number
export async function incrementPlanVersion(blockId: number): Promise<number> {
  try {
    const result = await sql`
      UPDATE training_blocks 
      SET plan_version = COALESCE(plan_version, 1) + 1, updated_at = NOW()
      WHERE id = ${blockId}
      RETURNING plan_version
    `;
    return result.rows[0]?.plan_version || 1;
  } catch {
    console.log('[DB] plan_version column does not exist yet - returning simulated version');
    return 2; // Simulated version increment
  }
}

// Get current plan version
export async function getPlanVersion(blockId: number): Promise<number> {
  try {
    const result = await sql`
      SELECT plan_version FROM training_blocks WHERE id = ${blockId}
    `;
    return result.rows[0]?.plan_version || 1;
  } catch {
    console.log('[DB] plan_version column does not exist yet - returning 1');
    return 1;
  }
}

// Save a plan change to the changelog
export async function savePlanChange(change: {
  block_id: number;
  version: number;
  change_type: 'created' | 'volume_adjusted' | 'phase_modified' | 'compliance_adaptation';
  reason: string;
  volume_change_pct?: number;
  old_plan_snapshot?: BlockPlan;
  week_number?: number;
}): Promise<PlanChangelogEntry | null> {
  try {
    const result = await sql<PlanChangelogEntry>`
      INSERT INTO plan_changelog (
        block_id, version, change_type, reason, volume_change_pct, old_plan_snapshot, week_number
      ) VALUES (
        ${change.block_id},
        ${change.version},
        ${change.change_type},
        ${change.reason},
        ${change.volume_change_pct || null},
        ${change.old_plan_snapshot ? JSON.stringify(change.old_plan_snapshot) : null},
        ${change.week_number || null}
      )
      RETURNING *
    `;
    return {
      ...result.rows[0],
      old_plan_snapshot: result.rows[0].old_plan_snapshot
        ? (typeof result.rows[0].old_plan_snapshot === 'string'
          ? JSON.parse(result.rows[0].old_plan_snapshot)
          : result.rows[0].old_plan_snapshot)
        : null,
      created_at: new Date(result.rows[0].created_at),
    };
  } catch {
    console.log('[DB] plan_changelog table does not exist yet - skipping save');
    return null;
  }
}

// Get plan changelog for a block
export async function getPlanChangelog(blockId: number): Promise<PlanChangelogEntry[]> {
  try {
    const result = await sql<PlanChangelogEntry>`
      SELECT * FROM plan_changelog 
      WHERE block_id = ${blockId}
      ORDER BY created_at DESC
    `;
    return result.rows.map(row => ({
      ...row,
      old_plan_snapshot: row.old_plan_snapshot
        ? (typeof row.old_plan_snapshot === 'string'
          ? JSON.parse(row.old_plan_snapshot)
          : row.old_plan_snapshot)
        : null,
      created_at: new Date(row.created_at),
    }));
  } catch {
    console.log('[DB] plan_changelog table does not exist yet - returning empty');
    return [];
  }
}

// ============ USER JOURNAL FUNCTIONS (Life Context Engine) ============

export interface JournalEntry {
  id: number;
  user_strava_id: string;
  date: Date;
  sleep_quality?: number;    // 1-10
  stress_level?: number;     // 1-10
  nutrition_score?: number;  // 1-10
  hrv_status?: string;       // 'low' | 'normal' | 'high' | 'elevated'
  notes?: string;
  tags: string[];
  custom_data?: Record<string, unknown>;  // Flexible life context (work stress, travel, mood, etc.)
  created_at: Date;
  updated_at: Date;
}

// Upsert a journal entry (one per day per user)
export async function upsertJournalEntry(entry: {
  user_strava_id: string;
  date: Date;
  sleep_quality?: number;
  stress_level?: number;
  nutrition_score?: number;
  hrv_status?: string;
  notes?: string;
  tags?: string[];
  custom_data?: Record<string, unknown>;
}): Promise<JournalEntry> {
  const dateStr = entry.date.toISOString().split('T')[0]; // YYYY-MM-DD
  // Convert tags array to PostgreSQL array literal format: {"tag1","tag2"}
  const tagsArray = entry.tags || [];
  const tagsLiteral = `{${tagsArray.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`;
  // Convert custom_data to JSON string for PostgreSQL
  const customDataJson = entry.custom_data ? JSON.stringify(entry.custom_data) : null;

  const result = await sql<JournalEntry>`
    INSERT INTO user_journal (
      user_strava_id, date, sleep_quality, stress_level, nutrition_score, hrv_status, notes, tags, custom_data
    ) VALUES (
      ${entry.user_strava_id},
      ${dateStr}::date,
      ${entry.sleep_quality ?? null},
      ${entry.stress_level ?? null},
      ${entry.nutrition_score ?? null},
      ${entry.hrv_status ?? null},
      ${entry.notes ?? null},
      ${tagsLiteral}::text[],
      ${customDataJson}::jsonb
    )
    ON CONFLICT (user_strava_id, date) DO UPDATE SET
      sleep_quality = COALESCE(EXCLUDED.sleep_quality, user_journal.sleep_quality),
      stress_level = COALESCE(EXCLUDED.stress_level, user_journal.stress_level),
      nutrition_score = COALESCE(EXCLUDED.nutrition_score, user_journal.nutrition_score),
      hrv_status = COALESCE(EXCLUDED.hrv_status, user_journal.hrv_status),
      notes = COALESCE(EXCLUDED.notes, user_journal.notes),
      tags = CASE 
        WHEN array_length(EXCLUDED.tags, 1) > 0 THEN EXCLUDED.tags 
        ELSE user_journal.tags 
      END,
      custom_data = CASE
        WHEN EXCLUDED.custom_data IS NOT NULL THEN user_journal.custom_data || EXCLUDED.custom_data
        ELSE user_journal.custom_data
      END,
      updated_at = NOW()
    RETURNING *
  `;

  return {
    ...result.rows[0],
    date: new Date(result.rows[0].date),
    tags: result.rows[0].tags || [],
    custom_data: result.rows[0].custom_data || {},
    created_at: new Date(result.rows[0].created_at),
    updated_at: new Date(result.rows[0].updated_at),
  };
}

// Get recent journal entries (last N days)
export async function getRecentJournal(
  stravaId: string,
  days: number = 7
): Promise<JournalEntry[]> {
  // Calculate the cutoff date in JavaScript to avoid SQL INTERVAL issues
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const result = await sql<JournalEntry>`
    SELECT * FROM user_journal
    WHERE user_strava_id = ${stravaId}
    AND date >= ${cutoffDateStr}::date
    ORDER BY date DESC
  `;

  return result.rows.map(row => ({
    ...row,
    date: new Date(row.date),
    tags: row.tags || [],
    custom_data: row.custom_data || {},
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  }));
}

// Get today's journal entry
export async function getTodayJournal(stravaId: string): Promise<JournalEntry | null> {
  const result = await sql<JournalEntry>`
    SELECT * FROM user_journal
    WHERE user_strava_id = ${stravaId}
    AND date = CURRENT_DATE
  `;

  if (!result.rows[0]) return null;

  return {
    ...result.rows[0],
    date: new Date(result.rows[0].date),
    tags: result.rows[0].tags || [],
    custom_data: result.rows[0].custom_data || {},
    created_at: new Date(result.rows[0].created_at),
    updated_at: new Date(result.rows[0].updated_at),
  };
}

// Format journal for AI context injection
export function formatJournalForAI(entries: JournalEntry[]): string {
  if (!entries.length) {
    return '';  // No journal data yet - don't add section
  }

  const lines: string[] = [
    '## WELLNESS LOG (Last 7 Days)',
    '',
  ];

  // Calculate averages
  const sleepScores = entries.filter(e => e.sleep_quality).map(e => e.sleep_quality!);
  const stressScores = entries.filter(e => e.stress_level).map(e => e.stress_level!);
  const nutritionScores = entries.filter(e => e.nutrition_score).map(e => e.nutrition_score!);

  if (sleepScores.length > 0) {
    const avg = sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length;
    const status = avg < 5 ? '⚠️ POOR' : avg < 7 ? 'Moderate' : '✓ Good';
    lines.push(`**Sleep:** Avg ${avg.toFixed(1)}/10 (${status})`);
  }

  if (stressScores.length > 0) {
    const avg = stressScores.reduce((a, b) => a + b, 0) / stressScores.length;
    const status = avg > 7 ? '⚠️ HIGH' : avg > 5 ? 'Moderate' : '✓ Low';
    lines.push(`**Stress:** Avg ${avg.toFixed(1)}/10 (${status})`);
  }

  if (nutritionScores.length > 0) {
    const avg = nutritionScores.reduce((a, b) => a + b, 0) / nutritionScores.length;
    const status = avg < 5 ? '⚠️ POOR' : avg < 7 ? 'Moderate' : '✓ Good';
    lines.push(`**Nutrition:** Avg ${avg.toFixed(1)}/10 (${status})`);
  }

  lines.push('');

  // Daily breakdown as table (most recent 5 days)
  lines.push('**Daily Log:**');
  lines.push('');
  lines.push('| Date | Sleep | Stress | Notes |');
  lines.push('|------|-------|--------|-------|');

  for (const entry of entries.slice(0, 5)) {
    const dateStr = entry.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const sleep = entry.sleep_quality ? `${entry.sleep_quality}/10` : '-';
    const stress = entry.stress_level ? `${entry.stress_level}/10` : '-';

    // Build notes string (tags + notes + any alerts)
    const noteParts: string[] = [];
    if (entry.tags.length > 0) noteParts.push(`[${entry.tags.join(', ')}]`);
    if (entry.notes) noteParts.push(entry.notes);
    // Only include important custom_data fields
    if (entry.custom_data) {
      const customData = entry.custom_data as Record<string, string>;
      if (customData.injury_risk) noteParts.push(`⚠️ ${customData.injury_risk}`);
      if (customData.check_in) noteParts.push(String(customData.check_in));
    }
    const notes = noteParts.join(' ') || '-';

    lines.push(`| ${dateStr} | ${sleep} | ${stress} | ${notes} |`);
  }
  lines.push('');

  // Flag critical patterns
  const last2DaysSleep = sleepScores.slice(0, 2);
  const last2DaysStress = stressScores.slice(0, 2);

  if (last2DaysSleep.length >= 2 && last2DaysSleep.every(s => s < 5)) {
    lines.push('');
    lines.push('⚠️ **READINESS ALERT:** Poor sleep for 2+ consecutive days. Consider reducing intensity.');
  }

  if (last2DaysStress.length >= 2 && last2DaysStress.every(s => s > 8)) {
    lines.push('');
    lines.push('⚠️ **READINESS ALERT:** High stress for 2+ consecutive days. Prioritize recovery.');
  }

  return lines.join('\n');
}

// Wipe all data for a test user (for simulation scripts)
export async function wipeTestUserData(stravaId: string): Promise<void> {
  // Delete in order due to foreign key constraints
  // Use try-catch for tables that may not exist yet
  try {
    await sql`DELETE FROM plan_changelog WHERE block_id IN (SELECT id FROM training_blocks WHERE user_strava_id = ${stravaId})`;
  } catch {
    console.log('[DB] plan_changelog table does not exist yet - skipping');
  }
  try {
    await sql`DELETE FROM user_journal WHERE user_strava_id = ${stravaId}`;
  } catch {
    console.log('[DB] user_journal table does not exist yet - skipping');
  }
  await sql`DELETE FROM training_blocks WHERE user_strava_id = ${stravaId}`;
  await sql`DELETE FROM coach_memories WHERE user_strava_id = ${stravaId}`;
  await sql`DELETE FROM user_goals WHERE user_strava_id = ${stravaId}`;
  await sql`DELETE FROM races WHERE user_strava_id = ${stravaId}`;
  await sql`DELETE FROM user_preferences WHERE user_strava_id = ${stravaId}`;
  console.log(`[DB] Wiped all data for test user: ${stravaId}`);
}

// ============ SAFETY GUARDIAN LOG FUNCTIONS ============

export interface SafetyLogEntry {
  id: number;
  user_strava_id: string;
  coach_draft: string;
  guardian_response: {
    isSafe: boolean;
    riskLevel?: string;
    flaggedSessions?: Array<{ day: string; reason: string; maxAllowed: string }>;
    overallCritique?: string;
    adjustmentDirectives?: string;
    // v1 compat
    critique?: string;
    recommendedChanges?: string;
    rawResponse?: string;
  };
  iteration_number: number;
  final_plan_approved: boolean;
  strava_context?: object;
  created_at: Date;
}

/**
 * Log a Safety Guardian check result to the database
 */
export async function logSafetyCheck(entry: {
  user_strava_id: string;
  coach_draft: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guardian_response: any;
  iteration_number: number;
  final_plan_approved: boolean;
  strava_context?: object;
}): Promise<SafetyLogEntry> {
  const result = await sql<SafetyLogEntry>`
    INSERT INTO ai_safety_logs (
      user_strava_id, coach_draft, guardian_response, 
      iteration_number, final_plan_approved, strava_context
    ) VALUES (
      ${entry.user_strava_id},
      ${entry.coach_draft.substring(0, 10000)},
      ${JSON.stringify(entry.guardian_response)},
      ${entry.iteration_number},
      ${entry.final_plan_approved},
      ${entry.strava_context ? JSON.stringify(entry.strava_context) : null}
    )
    RETURNING *
  `;
  return transformSafetyLog(result.rows[0]);
}

/**
 * Get recent safety logs for a user (for debugging/analysis)
 */
export async function getRecentSafetyLogs(
  stravaId: string,
  limit: number = 20
): Promise<SafetyLogEntry[]> {
  const result = await sql<SafetyLogEntry>`
    SELECT * FROM ai_safety_logs 
    WHERE user_strava_id = ${stravaId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return result.rows.map(transformSafetyLog);
}

/**
 * Get safety logs where the Guardian flagged issues (for quality review)
 */
export async function getFlaggedSafetyLogs(
  stravaId?: string,
  limit: number = 50
): Promise<SafetyLogEntry[]> {
  if (stravaId) {
    const result = await sql<SafetyLogEntry>`
      SELECT * FROM ai_safety_logs 
      WHERE user_strava_id = ${stravaId}
        AND (guardian_response->>'isSafe')::boolean = false
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result.rows.map(transformSafetyLog);
  }

  const result = await sql<SafetyLogEntry>`
    SELECT * FROM ai_safety_logs 
    WHERE (guardian_response->>'isSafe')::boolean = false
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return result.rows.map(transformSafetyLog);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformSafetyLog(row: any): SafetyLogEntry {
  return {
    ...row,
    guardian_response: typeof row.guardian_response === 'string'
      ? JSON.parse(row.guardian_response)
      : row.guardian_response,
    strava_context: row.strava_context
      ? (typeof row.strava_context === 'string' ? JSON.parse(row.strava_context) : row.strava_context)
      : undefined,
    created_at: new Date(row.created_at),
  };
}
