import NextAuth from "next-auth";
import Strava from "next-auth/providers/strava";
import { upsertStravaUser, updateStravaTokens } from "./db";

// Use the built-in Strava provider from NextAuth
export const { handlers, auth, signIn, signOut } = NextAuth({
    debug: true,
    trustHost: true,
    providers: [
        Strava({
            clientId: process.env.STRAVA_CLIENT_ID!,
            clientSecret: process.env.STRAVA_CLIENT_SECRET!,
            authorization: {
                params: {
                    scope: "read,activity:read_all",
                },
            },
        }),
    ],
    callbacks: {
        async signIn({ user, account }) {
            // Save tokens to database on sign-in
            // CRITICAL: Use account.providerAccountId for stable Strava athlete ID
            // user.id is a random UUID that changes each session!
            if (account?.provider === "strava" && account.access_token) {
                const stableStravaId = account.providerAccountId; // This is the actual Strava athlete ID
                try {
                    await upsertStravaUser({
                        strava_id: stableStravaId,
                        name: user.name || undefined,
                        access_token: account.access_token,
                        refresh_token: account.refresh_token!,
                        expires_at: account.expires_at!,
                    });
                    console.log("[AUTH] User saved to database with Strava ID:", stableStravaId);
                } catch (error) {
                    console.error("[AUTH] Error saving user:", error);
                    // Still allow sign-in even if DB fails
                }
            }
            return true;
        },
        async jwt({ token, account, user }) {
            if (account && user) {
                // CRITICAL: Use providerAccountId for stable Strava ID
                const stableStravaId = account.providerAccountId;
                return {
                    ...token,
                    stravaId: stableStravaId, // Stable Strava athlete ID
                    accessToken: account.access_token,
                    refreshToken: account.refresh_token,
                    expiresAt: account.expires_at,
                };
            }

            // Check if token is expired and refresh if needed
            const expiresAt = token.expiresAt as number | undefined;
            if (expiresAt && Date.now() > (expiresAt - 300) * 1000) {
                try {
                    const response = await fetch("https://www.strava.com/oauth/token", {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({
                            client_id: process.env.STRAVA_CLIENT_ID!,
                            client_secret: process.env.STRAVA_CLIENT_SECRET!,
                            refresh_token: token.refreshToken as string,
                            grant_type: "refresh_token",
                        }),
                    });

                    const refreshed = await response.json();

                    if (response.ok) {
                        console.log("[AUTH] Token refreshed");
                        // Update database
                        await updateStravaTokens(
                            token.stravaId as string,
                            refreshed.access_token,
                            refreshed.refresh_token,
                            refreshed.expires_at
                        );

                        return {
                            ...token,
                            accessToken: refreshed.access_token,
                            refreshToken: refreshed.refresh_token,
                            expiresAt: refreshed.expires_at,
                        };
                    }
                } catch (error) {
                    console.error("[AUTH] Token refresh error:", error);
                }
            }

            return token;
        },
        async session({ session, token }) {
            return {
                ...session,
                user: {
                    ...session.user,
                    id: token.sub,
                    stravaId: token.stravaId as string,
                },
                accessToken: token.accessToken as string,
            };
        },
    },
});
