# UltraCoach — Strava-Powered AI Running Coach 🏃‍♂️⛰️

**Personalized training plans for mountain ultras**, with automatic activity sync and intelligent coaching.

[![Live Demo](https://img.shields.io/badge/demo-myultracoach.vercel.app-blue)](https://myultracoach.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org)

## Features

- 🔗 **Strava Integration** — Auto-sync activities, analyze HR zones, pace, and elevation
- 🤖 **AI Coach Chat** — Conversational interface for training advice and plan adjustments
- 📊 **Dynamic Prescriptions** — Daily workouts based on readiness, sleep, and weekly budget
- 🏔️ **Ultra-Specific Training** — Periodization for 50km-100mile mountain races
- 🛡️ **Safety Interlocks** — Hard-coded constraints (48h quality spacing, sleep gates)

## Architecture

```
v1.2 Budget-Based Coaching
├── Weekly volume/quality budgets (not day-specific plans)
├── Daily prescription engine with readiness scoring
├── Safety interlocks (non-negotiable constraints)
└── Feature flags for gradual rollout
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS |
| Database | Vercel Postgres |
| Auth | NextAuth.js + Strava OAuth |
| AI | Google Gemini API |
| Hosting | Vercel |

## Getting Started

> ⚠️ **Self-Hosted**: This is a self-hosted application. You'll need your own **Strava API credentials**, **Google AI API key**, and **Vercel Postgres database**. No shared/hosted version is provided.

### Prerequisites

- Node.js 18+
- Strava API credentials ([get them here](https://www.strava.com/settings/api))
- Google AI API key
- Vercel Postgres database

### Setup

```bash
# Clone
git clone https://github.com/humanchaos/ultracoach.git
cd ultracoach

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
# Fill in your credentials in .env.local

# Run locally
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

See `.env.example` for required variables:
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `POSTGRES_URL`
- `AUTH_SECRET`

## Project Structure

```
lib/
├── coaching/
│   ├── block-generator.ts      # Macro plan generation
│   ├── daily-prescription-engine.ts  # Dynamic workout selection
│   ├── safety-interlocks.ts    # Hard constraints
│   ├── recovery-state.ts       # Post-race recovery phases
│   └── system-prompt-v6.ts     # AI coach personality
├── strava.ts                   # Strava API + caching
└── db.ts                       # Database operations
```

## License

Private — All rights reserved.

---

Built for athletes who chase peaks, not PRs.
