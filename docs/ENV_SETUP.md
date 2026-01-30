# Environment Setup

Copy these variables to `.env.local` in the `velo/` directory:

```bash
# Strava OAuth
STRAVA_CLIENT_ID=193868
STRAVA_CLIENT_SECRET=702ea150701129b3b60ec2401a59e0503c69efcf

# NextAuth (generate: openssl rand -base64 32)
NEXTAUTH_SECRET=your_random_secret_here
NEXTAUTH_URL=http://localhost:3000

# Vercel Postgres (from Vercel Dashboard > Storage > Postgres)
POSTGRES_URL=
POSTGRES_PRISMA_URL=
POSTGRES_URL_NON_POOLING=
POSTGRES_USER=
POSTGRES_HOST=
POSTGRES_PASSWORD=
POSTGRES_DATABASE=

# OpenAI (for the coach)
OPENAI_API_KEY=
```

## Setup Steps

1. **Vercel Postgres**: 
   - Go to [vercel.com/dashboard](https://vercel.com/dashboard)
   - Storage → Create Database → Postgres
   - Copy the environment variables from "Quickstart" tab

2. **Run the schema**:
   - Copy `supabase/schema.sql` contents
   - Go to Vercel Postgres → Data → Query
   - Paste and run

3. **Strava Callback URL**:
   - Go to [strava.com/settings/api](https://www.strava.com/settings/api)
   - Set Authorization Callback Domain to `localhost` (for dev)
