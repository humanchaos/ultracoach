import { sql } from "@vercel/postgres";

// Run migration to add HR zone columns
export async function GET() {
    try {
        await sql`ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z1_hr VARCHAR(20)`;
        await sql`ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z2_hr VARCHAR(20)`;
        await sql`ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z3_hr VARCHAR(20)`;
        await sql`ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z4_hr VARCHAR(20)`;
        await sql`ALTER TABLE lactate_tests ADD COLUMN IF NOT EXISTS z5_hr VARCHAR(20)`;

        return Response.json({ success: true, message: "HR zone columns added" });
    } catch (error) {
        console.error("Migration error:", error);
        return Response.json({ error: String(error) }, { status: 500 });
    }
}
