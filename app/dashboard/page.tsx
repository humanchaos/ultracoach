import { auth, signIn } from "@/lib/auth";
import { getStravaData, formatActivitiesForAI, getAthleteProfile } from "@/lib/strava";
import {
    getUserRaces,
    formatRacesForAI,
    getUserPreferences,
    getUserByStravaId,
    getCoachMemories,
    formatMemoriesForAI,
    getLactateTest,
    formatLactateTestForAI,
} from "@/lib/db";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
    const session = await auth();

    // Not signed in - show login
    if (!session?.user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl p-10 max-w-md w-full mx-4 border border-white/20">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center gap-2 mb-4">
                            <span className="text-4xl">🏔️</span>
                            <div className="w-px h-8 bg-gradient-to-b from-purple-400 to-orange-400"></div>
                            <span className="text-4xl">🤖</span>
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">
                            Ultra<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-orange-400">Coach</span>
                        </h1>
                        <p className="text-purple-200 mt-2 font-medium">AI-Powered Training Intelligence</p>
                    </div>
                    <form
                        action={async () => {
                            "use server";
                            await signIn("strava", { redirectTo: "/dashboard" });
                        }}
                    >
                        <button
                            type="submit"
                            className="w-full bg-[#FC4C02] hover:bg-[#E34402] text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-all shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02]"
                        >
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                            </svg>
                            Connect with Strava
                        </button>
                    </form>
                    <p className="text-center text-purple-300/60 text-sm mt-6">
                        Sync your training • Get AI insights • Dominate your races
                    </p>
                </div>
            </div>
        );
    }

    // Fetch all data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let activities: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let races: any[] = [];
    let trainingContext = "";
    let racesContext = "";
    let preferencesContext = "";
    // NOTE: Recovery context removed - AI now detects recovery needs from activity data (v3 architecture)
    let athleteContext = "";
    let memoriesContext = "";
    let lactateContext = "";
    let error = null;
    let userSignupDate: string | null = null;

    try {
        const stravaId = session.user.stravaId as string;

        // Fetch activities, races, preferences, athlete profile, user data, memories, and lactate in parallel
        // Each has its own catch handler so one failure doesn't block the others
        const [fetchedActivities, fetchedRaces, fetchedPreferences, fetchedProfile, fetchedUser, fetchedMemories, fetchedLactate] = await Promise.all([
            getStravaData(stravaId).catch((e) => {
                console.error("[Dashboard] Strava sync failed:", e.message);
                error = e.message;
                return [];
            }),
            getUserRaces(stravaId).catch(() => []),
            getUserPreferences(stravaId).catch(() => null),
            getAthleteProfile(stravaId).catch(() => null),
            getUserByStravaId(stravaId).catch(() => null),
            getCoachMemories(stravaId).catch(() => []),
            getLactateTest(stravaId).catch(() => null),
        ]);

        activities = fetchedActivities;
        races = fetchedRaces;
        trainingContext = formatActivitiesForAI(activities);
        racesContext = formatRacesForAI(fetchedRaces);
        userSignupDate = fetchedUser?.created_at?.toISOString() || null;
        memoriesContext = formatMemoriesForAI(fetchedMemories);
        lactateContext = formatLactateTestForAI(fetchedLactate);

        // Debug logging for lactate data
        console.log("[Dashboard] Lactate data:", fetchedLactate ? "Found" : "NOT FOUND");
        if (fetchedLactate) {
            console.log("[Dashboard] Lactate context:", lactateContext.substring(0, 200));
        }

        // Format athlete profile for AI context
        if (fetchedProfile) {
            const parts = [];
            if (fetchedProfile.firstName) parts.push(`Name: ${fetchedProfile.firstName}`);
            if (fetchedProfile.sex) parts.push(`Gender: ${fetchedProfile.sex === 'M' ? 'Male' : 'Female'}`);
            if (fetchedProfile.age) parts.push(`Age: ${fetchedProfile.age} years old`);
            if (fetchedProfile.weight) parts.push(`Weight: ${fetchedProfile.weight}kg`);
            if (fetchedProfile.city && fetchedProfile.country) {
                parts.push(`Location: ${fetchedProfile.city}, ${fetchedProfile.country}`);
            }
            if (parts.length > 0) {
                athleteContext = parts.join(' | ');
            }
        }

        // Format preferences for AI context
        if (fetchedPreferences) {
            const parts = [];
            if (fetchedPreferences.notes) {
                parts.push(`Coach Memory Notes: ${fetchedPreferences.notes}`);
            }
            if (fetchedPreferences.training_days?.length) {
                parts.push(`Preferred Training Days: ${fetchedPreferences.training_days.join(', ')}`);
            }
            if (fetchedPreferences.long_run_day) {
                parts.push(`Preferred Long Run Day: ${fetchedPreferences.long_run_day}`);
            }
            if (fetchedPreferences.max_weekly_km) {
                parts.push(`Max Weekly Volume: ${fetchedPreferences.max_weekly_km}km`);
            }
            if (parts.length > 0) {
                preferencesContext = parts.join('\n');
            }
        }

        // NOTE: Hardcoded recovery detection removed - AI now handles this through v3 system prompt
        // The AI coach sees the ultra/marathon in the activity data and applies appropriate recovery protocols
    } catch (e) {
        error = e instanceof Error ? e.message : "Failed to fetch activities";
        console.error("[Dashboard] Error fetching data:", e);
    }

    // Combine contexts for AI
    const fullContext = `--- ATHLETE PROFILE ---
${athleteContext || "Profile not available"}

--- ATHLETE PREFERENCES & COACH MEMORY ---
${preferencesContext || "No preferences set yet."}

${memoriesContext}

${lactateContext}

--- RECENT TRAINING LOG ---
${trainingContext}

--- RACE CALENDAR ---
${racesContext}

Note: Consider the athlete's age and gender when giving recovery and training advice.`;

    return (
        <DashboardClient
            session={session}
            activities={activities}
            races={races}
            fullContext={fullContext}
            trainingContext={trainingContext}
            racesContext={racesContext}
            error={error}
            userSignupDate={userSignupDate}
        />
    );
}
