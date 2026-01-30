import { NextResponse } from "next/server";

export const maxDuration = 30; // Allow up to 30s for two-pass lookup

// API route to look up race details using Gemini with website verification
export async function POST(req: Request) {
    try {
        const { raceName } = await req.json();

        if (!raceName || raceName.trim().length < 3) {
            return NextResponse.json(
                { error: "Please provide a race name (at least 3 characters)" },
                { status: 400 }
            );
        }

        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "API key not configured" },
                { status: 500 }
            );
        }

        const currentYear = new Date().getFullYear();
        const currentDate = new Date().toISOString().split('T')[0];

        // ============================================
        // PASS 1: Find race using Google Search grounding
        // ============================================
        console.log(`[Race Lookup] Pass 1: Searching for "${raceName}" with Google Search`);

        const pass1Prompt = `Search for the running race: "${raceName}"

Find the OFFICIAL race website and extract these details:
- Official race name
- Official website URL (MUST be real and working)
- Location (city, country)
- Race type (road/trail/ultra)
- When it's typically held (month)
- ELEVATION: Total elevation gain and loss in meters (very important for trail races!)

Return ONLY a JSON object (no markdown):
{
  "found": true/false,
  "name": "Full Official Race Name",
  "location": "City, Country",
  "website": "Official race website URL",
  "race_type": "road" | "trail" | "ultra" | "track",
  "description": "Brief description",
  "approximate_month": "March",
  "elevation_gain_m": 2500,
  "elevation_loss_m": 2500
}

CRITICAL: The website URL must be the ACTUAL official race website you find in search results. Do NOT guess or make up URLs.
For elevation, look for "Höhenmeter", "elevation gain", "D+", "ascent", or similar. If not found, set to null.

If nothing found: {"found": false}`;

        const pass1Response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: pass1Prompt }] }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 500,
                    },
                    // Enable Google Search grounding
                    tools: [{
                        google_search: {}
                    }],
                }),
            }
        );

        if (!pass1Response.ok) {
            console.error("[Race Lookup] Pass 1 failed");
            return NextResponse.json({ error: "Failed to search for race" }, { status: 500 });
        }

        const pass1Data = await pass1Response.json();
        const pass1Text = pass1Data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        let raceInfo;
        try {
            let jsonStr = pass1Text.trim();
            if (jsonStr.startsWith("```")) {
                jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "");
            }
            raceInfo = JSON.parse(jsonStr.trim());
        } catch {
            console.error("[Race Lookup] Pass 1 parse error:", pass1Text);
            return NextResponse.json({ found: false, races: [] });
        }

        if (!raceInfo.found) {
            return NextResponse.json({ found: false, races: [] });
        }

        console.log(`[Race Lookup] Pass 1 found: ${raceInfo.name}, website: ${raceInfo.website}`);

        // ============================================
        // PASS 2: Validate URL exists and fetch content
        // ============================================
        let websiteContent = "";
        let websiteFetched = false;
        let validatedUrl: string | null = null; // Only set if URL actually responds

        if (raceInfo.website) {
            try {
                console.log(`[Race Lookup] Pass 2: Validating URL ${raceInfo.website}`);

                const websiteResponse = await fetch(raceInfo.website, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (compatible; UltraCoach/1.0; +https://myultracoach.vercel.app)",
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
                    },
                    signal: AbortSignal.timeout(8000), // 8 second timeout
                });

                // Only consider URL valid if we get a successful response
                if (websiteResponse.ok) {
                    validatedUrl = raceInfo.website; // URL is confirmed to exist
                    const html = await websiteResponse.text();
                    // Extract text content, limiting size to avoid token limits
                    websiteContent = extractTextFromHTML(html).slice(0, 8000);
                    websiteFetched = true;
                    console.log(`[Race Lookup] Pass 2: URL verified, got ${websiteContent.length} chars`);
                } else {
                    console.log(`[Race Lookup] Pass 2: URL returned ${websiteResponse.status}, marking as invalid`);
                }
            } catch (fetchError) {
                console.error("[Race Lookup] Pass 2: URL fetch failed (dead link?):", fetchError);
                // URL doesn't exist or is unreachable - don't use it
                validatedUrl = null;
            }
        }

        // ============================================
        // PASS 3: Extract accurate details from website
        // ============================================
        let finalRaceData;

        if (websiteFetched && websiteContent.length > 100) {
            console.log("[Race Lookup] Pass 3: Extracting details from website content");

            const pass3Prompt = `Extract race details from this official race website content.
Today's date is ${currentDate}. Current year is ${currentYear}.

WEBSITE CONTENT:
${websiteContent}

KNOWN RACE INFO:
- Name: ${raceInfo.name}
- Location: ${raceInfo.location}
- Usually held in: ${raceInfo.approximate_month || "unknown"}
- Elevation from search: ${raceInfo.elevation_gain_m || 'unknown'}

Extract and return ONLY a JSON object (no markdown):
{
  "name": "Official race name from the website",
  "date": "YYYY-MM-DD (the NEXT upcoming race date - if it shows 2025 dates and that's passed, use 2026)",
  "location": "City, Country",
  "available_distances": [
    {"name": "Short Trail", "km": 12, "elevation_gain_m": 500},
    {"name": "Medium Trail", "km": 21, "elevation_gain_m": 1200}
  ],
  "main_distance_km": 50,
  "main_elevation_gain_m": 2500,
  "main_elevation_loss_m": 2500,
  "race_type": "trail",
  "website": "${validatedUrl || ''}",
  "description": "Brief description",
  "verified_from_website": true
}

CRITICAL DATE RULES:
- Look for dates like "22. März 2026" or "March 22, 2026"
- If the website shows a past date (e.g., March 2025), ADD 1 YEAR
- The date MUST be in the future from ${currentDate}
- Format as YYYY-MM-DD

DISTANCE RULES:
- Extract ALL distance options (e.g., 12km, 21km, 33km, 50km)
- Use the exact distance names from the website
- main_distance_km should be the signature/longest distance

ELEVATION RULES (VERY IMPORTANT for training plans!):
- Look for "Höhenmeter", "elevation gain", "D+", "ascent", "vertical gain", "Aufstieg"
- Look for "D-", "descent", "Abstieg" for elevation loss
- Include elevation for EACH distance option if available
- Set main_elevation_gain_m and main_elevation_loss_m for the main distance
- If elevation isn't found in content but was in search results, use: ${raceInfo.elevation_gain_m || 'null'}

If you cannot find specific info, make reasonable estimates based on the content.`;

            const pass3Response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: pass3Prompt }] }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 800,
                        },
                    }),
                }
            );

            if (pass3Response.ok) {
                const pass3Data = await pass3Response.json();
                const pass3Text = pass3Data.candidates?.[0]?.content?.parts?.[0]?.text || "";

                try {
                    let jsonStr = pass3Text.trim();
                    if (jsonStr.startsWith("```")) {
                        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "");
                    }
                    finalRaceData = JSON.parse(jsonStr.trim());
                    console.log("[Race Lookup] Pass 3: Successfully extracted verified data");
                } catch {
                    console.error("[Race Lookup] Pass 3 parse error, using Pass 1 data");
                }
            }
        }

        // If Pass 3 didn't work, fall back to Pass 1 data with estimates
        if (!finalRaceData) {
            console.log("[Race Lookup] Using Pass 1 data (unverified)");
            finalRaceData = {
                name: raceInfo.name,
                date: estimateNextRaceDate(raceInfo.approximate_month, currentYear),
                location: raceInfo.location,
                available_distances: [],
                main_distance_km: 50,
                main_elevation_gain_m: raceInfo.elevation_gain_m || null,  // Include elevation from Pass 1
                main_elevation_loss_m: raceInfo.elevation_loss_m || null,
                race_type: raceInfo.race_type || "trail",
                website: validatedUrl || null, // Only include URL if we verified it exists
                description: raceInfo.description,
                verified_from_website: false,
            };
        } else {
            // Even for verified data, ensure we use the validated URL
            finalRaceData.website = validatedUrl || finalRaceData.website || null;
        }

        return NextResponse.json({
            found: true,
            multiple_matches: false,
            races: [finalRaceData],
            verified: finalRaceData.verified_from_website || false,
        });

    } catch (error) {
        console.error("[Race Lookup] Error:", error);
        return NextResponse.json(
            { error: "Failed to look up race" },
            { status: 500 }
        );
    }
}

// Helper: Extract readable text from HTML
function extractTextFromHTML(html: string): string {
    // Remove script and style blocks
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ");

    // Replace tags with spaces
    text = text.replace(/<[^>]+>/g, " ");

    // Decode common HTML entities
    text = text
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));

    // Normalize whitespace
    text = text.replace(/\s+/g, " ").trim();

    return text;
}

// Helper: Estimate next race date based on typical month
function estimateNextRaceDate(month: string | undefined, currentYear: number): string {
    const monthMap: Record<string, number> = {
        january: 1, february: 2, march: 3, april: 4,
        may: 5, june: 6, july: 7, august: 8,
        september: 9, october: 10, november: 11, december: 12,
        jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };

    const now = new Date();
    const currentMonth = now.getMonth() + 1;

    if (!month) {
        // Default to 6 months from now
        const futureDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
        return futureDate.toISOString().split('T')[0];
    }

    const raceMonth = monthMap[month.toLowerCase()] || 6;
    let year = currentYear;

    // If the race month has already passed this year, use next year
    if (raceMonth < currentMonth) {
        year = currentYear + 1;
    }

    // Assume middle of month
    return `${year}-${String(raceMonth).padStart(2, '0')}-15`;
}
