import { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: {
            stravaId?: string;
        } & DefaultSession["user"];
        accessToken?: string;
    }
}

declare module "@auth/core/types" {
    interface Session {
        user: {
            stravaId?: string;
        } & DefaultSession["user"];
        accessToken?: string;
    }
}
