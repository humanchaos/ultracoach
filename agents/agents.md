# UltraCoach Agent System

> Multi-agent architecture for the UltraCoach AI Running Coach platform.

## Agents

| # | Agent | File | Domain |
|---|-------|------|--------|
| 1 | **Sports Expert** | [`sports-expert.md`](agents/sports-expert.md) | Training science, periodization, race strategy, injury prevention |
| 2 | **Health Expert** | [`health-expert.md`](agents/health-expert.md) | Sports medicine, nutrition, sleep, recovery, mental health |
| 3 | **Terrain Expert** | [`terrain-expert.md`](agents/terrain-expert.md) | Course analysis, elevation, surface conditions, weather adaptation |
| 4 | **Coding Expert** | [`coding-expert.md`](agents/coding-expert.md) | Next.js 15, TypeScript, Vercel Postgres, Strava/Gemini APIs, testing |
| 5 | **UI Expert** | [`ui-expert.md`](agents/ui-expert.md) | Frontend design, UX, accessibility, data visualization, CSS |

## Agent Interaction Model

```
┌─────────────────────────────────────────────────┐
│                  User Request                    │
└──────────────────────┬──────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌─────────┐ ┌─────────────┐
   │   Sports   │ │ Health  │ │   Terrain   │
   │   Expert   │ │ Expert  │ │   Expert    │
   └─────┬──────┘ └────┬────┘ └──────┬──────┘
         │              │             │
         └──────┬───────┘             │
                ▼                     │
         Domain Advice ◄──────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
  ┌──────────┐   ┌────────────┐
  │  Coding  │   │    UI      │
  │  Expert  │   │   Expert   │
  └──────────┘   └────────────┘
```

## Collaboration Rules

1. **Domain Ownership:** Each agent owns its domain. Cross-domain questions should be routed to the appropriate expert.
2. **Health Veto:** The Health Expert can override any recommendation from other agents if it poses a health risk.
3. **Implementation Handoff:** The Sports/Health/Terrain experts define *what* to build; the Coding and UI experts define *how* to build it.
4. **Conflict Resolution:** When agents disagree, the conservative (safer) recommendation takes precedence.

## Trigger

All agents use `trigger: always_on` — they are active context for every interaction.
