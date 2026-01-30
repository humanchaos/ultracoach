import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const maxDuration = 30;

// POST - Parse a lactate test PDF and extract data
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "API key not configured" }, { status: 500 });
        }

        // Get the PDF as base64
        const formData = await req.formData();
        const file = formData.get("pdf") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
        }

        // Validate file type
        if (!file.type.includes("pdf")) {
            return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
        }

        // Convert file to base64
        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");

        console.log(`[Lactate PDF] Parsing ${file.name} (${Math.round(bytes.byteLength / 1024)}KB)`);

        // Send to Gemini for parsing
        const prompt = `You are analyzing a lactate threshold test report PDF.

Extract ALL the following data from this document. Be thorough - look for:
- Test date
- Heart rate data (max HR, thresholds)
- Pace/speed data (thresholds)
- VO2max if mentioned
- Training zones (HR zones, pace zones)
- Lactate values at different intensities
- Any fatmax/fat burning zone data
- Athlete information (name, age, weight)

Return ONLY a JSON object (no markdown) with this structure:
{
  "success": true,
  "test_date": "YYYY-MM-DD",
  "max_hr": 185,
  "aerobic_threshold_hr": 145,
  "aerobic_threshold_pace": "5:30",
  "anaerobic_threshold_hr": 165,
  "anaerobic_threshold_pace": "4:45",
  "vo2max": 52.5,
  "fatmax_hr": 130,
  "fatmax_pace": "6:15",
  "hr_zones": [
    {"zone": 1, "name": "Recovery", "min_hr": 100, "max_hr": 130},
    {"zone": 2, "name": "Aerobic", "min_hr": 130, "max_hr": 145},
    {"zone": 3, "name": "Tempo", "min_hr": 145, "max_hr": 165},
    {"zone": 4, "name": "Threshold", "min_hr": 165, "max_hr": 175},
    {"zone": 5, "name": "VO2max", "min_hr": 175, "max_hr": 185}
  ],
  "pace_zones": [
    {"zone": 1, "name": "Easy", "pace": "6:00-6:30"},
    {"zone": 2, "name": "Aerobic", "pace": "5:30-6:00"}
  ],
  "lactate_curve": [
    {"speed_kmh": 8, "hr": 120, "lactate": 0.8},
    {"speed_kmh": 10, "hr": 140, "lactate": 1.2},
    {"speed_kmh": 12, "hr": 160, "lactate": 2.5},
    {"speed_kmh": 14, "hr": 175, "lactate": 4.5}
  ],
  "athlete_name": "Name from report",
  "athlete_age": 35,
  "athlete_weight_kg": 72,
  "notes": "Any additional relevant info from the report",
  "raw_summary": "Brief summary of what the test showed"
}

IMPORTANT:
- Use null for any field you cannot find in the document
- Pace should be in min:sec per km format
- For German PDFs: "Schwelle" = threshold, "aerobe Schwelle" = aerobic threshold
- LT1/VT1/AeT = Aerobic threshold
- LT2/VT2/AnT/MLSS = Anaerobic threshold
- If the PDF shows zones, extract them exactly as shown

If you cannot parse the PDF or it's not a lactate test:
{"success": false, "error": "Description of problem"}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            {
                                inline_data: {
                                    mime_type: "application/pdf",
                                    data: base64,
                                },
                            },
                        ],
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 2000,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[Lactate PDF] Gemini API error:", errorText);
            return NextResponse.json({ error: "Failed to parse PDF" }, { status: 500 });
        }

        const data = await response.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // Parse the JSON response
        try {
            let jsonStr = textResponse.trim();
            if (jsonStr.startsWith("```")) {
                jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "");
            }

            const parsed = JSON.parse(jsonStr.trim());

            if (!parsed.success) {
                return NextResponse.json({
                    success: false,
                    error: parsed.error || "Could not parse lactate test data from PDF"
                });
            }

            console.log("[Lactate PDF] Successfully parsed:", {
                test_date: parsed.test_date,
                max_hr: parsed.max_hr,
                lt1_hr: parsed.aerobic_threshold_hr,
                lt2_hr: parsed.anaerobic_threshold_hr,
                vo2max: parsed.vo2max,
                zones: parsed.hr_zones?.length || 0,
            });

            return NextResponse.json(parsed);
        } catch (parseError) {
            console.error("[Lactate PDF] Failed to parse response:", textResponse);
            return NextResponse.json({
                success: false,
                error: "Failed to extract structured data from PDF"
            });
        }

    } catch (error) {
        console.error("[Lactate PDF] Error:", error);
        return NextResponse.json(
            { error: "Failed to process lactate test PDF" },
            { status: 500 }
        );
    }
}
