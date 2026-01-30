import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
    const checks: Record<string, { set: boolean; value?: string }> = {
        AUTH_SECRET: {
            set: !!process.env.AUTH_SECRET,
            value: process.env.AUTH_SECRET ? process.env.AUTH_SECRET.substring(0, 4) + '...' : undefined,
        },
        AUTH_URL: {
            set: !!process.env.AUTH_URL,
            value: process.env.AUTH_URL,
        },
        AUTH_TRUST_HOST: {
            set: !!process.env.AUTH_TRUST_HOST,
            value: process.env.AUTH_TRUST_HOST,
        },
        NEXTAUTH_SECRET: {
            set: !!process.env.NEXTAUTH_SECRET,
            value: process.env.NEXTAUTH_SECRET ? process.env.NEXTAUTH_SECRET.substring(0, 4) + '...' : undefined,
        },
        NEXTAUTH_URL: {
            set: !!process.env.NEXTAUTH_URL,
            value: process.env.NEXTAUTH_URL,
        },
        STRAVA_CLIENT_ID: {
            set: !!process.env.STRAVA_CLIENT_ID,
            value: process.env.STRAVA_CLIENT_ID,
        },
        STRAVA_CLIENT_SECRET: {
            set: !!process.env.STRAVA_CLIENT_SECRET,
            value: process.env.STRAVA_CLIENT_SECRET ? process.env.STRAVA_CLIENT_SECRET.substring(0, 6) + '...' : undefined,
        },
        POSTGRES_URL: {
            set: !!process.env.POSTGRES_URL,
            value: process.env.POSTGRES_URL ? 'SET (hidden)' : undefined,
        },
        GOOGLE_GENERATIVE_AI_API_KEY: {
            set: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            value: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? process.env.GOOGLE_GENERATIVE_AI_API_KEY.substring(0, 8) + '...' : undefined,
        },
    };

    const allSet = Object.values(checks).every(c => c.set);
    const missing = Object.entries(checks)
        .filter(([, v]) => !v.set)
        .map(([k]) => k);

    // Test database connection
    let dbStatus = 'unknown';
    let dbError: string | undefined;
    try {
        const result = await sql`SELECT 1 as test`;
        dbStatus = result.rows.length > 0 ? 'connected' : 'failed';
    } catch (err) {
        dbStatus = 'error';
        dbError = err instanceof Error ? err.message : String(err);
    }

    return NextResponse.json({
        status: allSet ? 'OK' : 'MISSING_VARS',
        environment: process.env.NODE_ENV,
        vercelEnv: process.env.VERCEL_ENV,
        missing,
        checks,
        database: { status: dbStatus, error: dbError },
        timestamp: new Date().toISOString(),
    });
}
