import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    getActiveTrainingBlock,
    getCurrentWeekInBlock,
    updateTrainingBlockPlan,
    updateComplianceCheck,
} from "@/lib/db";
import {
    processLoginDecision,
    auditCompliance,
    type StravaActivity
} from "@/lib/coaching/logic";

// Minimum days between audits
const AUDIT_INTERVAL_DAYS = 7;

interface AuditRequest {
    activities: Array<{
        id?: string;
        name: string;
        date: string;
        dateISO?: string;
        distance_km: number;
        type?: string;
        heart_rate?: number;
        average_hr?: number;
    }>;
    forceAudit?: boolean;
    confirmAdaptation?: boolean; // NEW: User confirmed they want to apply changes
}

/**
 * Compliance Audit API
 * 
 * Philosophy: The macro plan is the CENTER OF THE APP.
 * - Deviations are DETECTED and SIGNALED to the user
 * - Adaptations are PROPOSED but NEVER auto-applied
 * - Changes only happen when user explicitly confirms
 */

// POST - Run compliance check and PROPOSE adaptations (don't auto-apply)
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const stravaId = session.user.stravaId;

        // Get active training block
        const block = await getActiveTrainingBlock(stravaId);
        if (!block) {
            return NextResponse.json({
                audited: false,
                action: 'no_block',
                message: "No active training block. Create one from your race calendar."
            });
        }

        // Get request body
        const body: AuditRequest = await req.json().catch(() => ({ activities: [] }));

        // Check if audit is due (skip if forceAudit is true)
        if (!body.forceAudit && !body.confirmAdaptation) {
            const lastAudit = block.last_compliance_check;
            const daysSinceAudit = lastAudit
                ? (Date.now() - lastAudit.getTime()) / (1000 * 60 * 60 * 24)
                : Infinity;

            if (daysSinceAudit < AUDIT_INTERVAL_DAYS) {
                return NextResponse.json({
                    audited: false,
                    action: 'skipped',
                    message: `Last audit was ${Math.floor(daysSinceAudit)} days ago. Next audit in ${Math.ceil(AUDIT_INTERVAL_DAYS - daysSinceAudit)} days.`,
                });
            }
        }

        // Convert activities to the format expected by coaching logic
        const activities: StravaActivity[] = body.activities
            .filter(a => a.type === 'Run' || !a.type) // Default to runs
            .map((a, i) => ({
                id: a.id || `activity-${i}`,
                date: a.dateISO ? new Date(a.dateISO) : new Date(a.date),
                distance_km: a.distance_km,
                type: 'Run' as const,
                average_hr: a.average_hr || a.heart_rate,
            }));

        // Filter to last 7 days for weekly audit
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const thisWeekActivities = activities.filter(a => a.date >= oneWeekAgo);

        const currentWeek = getCurrentWeekInBlock(block);

        // Run the compliance audit
        const report = auditCompliance(block, thisWeekActivities, currentWeek);

        console.log(`[Compliance Audit] Week ${currentWeek}: ${report.compliance}% compliance`);
        console.log(`[Compliance Audit] Volume: ${report.volumeActual}/${report.volumePlanned}km`);
        console.log(`[Compliance Audit] Missed long run: ${report.missedLongRun}`);

        // Run the decision engine
        const decision = processLoginDecision(block, thisWeekActivities, currentWeek);

        // =============================================================
        // KEY CHANGE: User confirmation required for modifications
        // =============================================================
        if (decision.action === 'modify' && decision.modifiedBlock) {

            // If user has NOT confirmed, return proposal only
            if (!body.confirmAdaptation) {
                console.log(`[Compliance Audit] Deviation detected - proposing adaptation (not auto-applying)`);

                return NextResponse.json({
                    audited: true,
                    action: 'propose_modification',
                    compliance: decision.compliance,
                    message: decision.message,
                    deviationDetected: true,
                    proposal: {
                        reason: decision.message,
                        currentCompliance: decision.compliance,
                        volumeActual: report.volumeActual,
                        volumePlanned: report.volumePlanned,
                        missedLongRun: report.missedLongRun,
                        // Don't include the full modified block in proposal - 
                        // user just needs to know there's a deviation
                    },
                    userActionRequired: true,
                    hint: "Your training has deviated from the plan. Would you like to adapt the plan to match your current situation?",
                });
            }

            // User HAS confirmed - apply the adaptation
            console.log(`[Compliance Audit] User confirmed - applying adaptations: ${decision.message}`);

            await updateTrainingBlockPlan(
                block.id,
                decision.modifiedBlock.block_plan,
                decision.message
            );

            // Update audit timestamp
            await updateComplianceCheck(block.id);

            return NextResponse.json({
                audited: true,
                action: 'modified',
                compliance: decision.compliance,
                message: decision.message,
                adaptationApplied: true,
            });
        }

        // No modification needed - just update audit date
        await updateComplianceCheck(block.id);

        return NextResponse.json({
            audited: true,
            action: decision.action,
            compliance: decision.compliance,
            message: decision.message,
            deviationDetected: false,
        });

    } catch (error) {
        console.error("[Compliance Audit] Error:", error);
        return NextResponse.json(
            { error: "Failed to run compliance check" },
            { status: 500 }
        );
    }
}

// GET - Get compliance status without applying changes
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.stravaId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const block = await getActiveTrainingBlock(session.user.stravaId);
        if (!block) {
            return NextResponse.json({
                hasBlock: false,
                auditDue: false,
            });
        }

        const lastAudit = block.last_compliance_check;
        const daysSinceAudit = lastAudit
            ? (Date.now() - lastAudit.getTime()) / (1000 * 60 * 60 * 24)
            : Infinity;

        const currentWeek = getCurrentWeekInBlock(block);

        return NextResponse.json({
            hasBlock: true,
            blockId: block.id,
            currentWeek,
            totalWeeks: block.block_plan.totalWeeks,
            lastComplianceCheck: lastAudit?.toISOString() || null,
            daysSinceAudit: Math.floor(daysSinceAudit),
            auditDue: daysSinceAudit >= AUDIT_INTERVAL_DAYS,
            lastModifiedReason: block.last_modified_reason,
        });

    } catch (error) {
        console.error("[Compliance Audit GET] Error:", error);
        return NextResponse.json(
            { error: "Failed to get compliance status" },
            { status: 500 }
        );
    }
}
