# Coach Output Format - Diagnostic Document

## Question for External Auditor

**Why does the Gemini 2.0 Flash model ignore the output format instructions in the system prompt and continue to output in a structured format with headers like `[PROTOCOL]`, `THE VERDICT`, `THE PHYSIOLOGY`, and `THE DIRECTIVE`?**

The system prompt explicitly says NOT to use these patterns (see line 29 of `lib/coaching/system-prompt.ts`), yet the model continues to use them. Is this:
1. A Vercel caching issue where old code is still being served?
2. A prompt structure issue where the model ignores instructions after a certain length?
3. Something in the context data that's triggering this format?
4. A Gemini model behavior where it mimics patterns seen in training data?

---

## Problem
The AI coach outputs in old structured format with:
- `[PROTOCOL] Deep Recovery`
- `[PHASE] Structural`
- `THE VERDICT`
- `THE PHYSIOLOGY`
- `THE DIRECTIVE`

Despite updating `lib/coaching/system-prompt.ts` to request conversational output.

---

## What I Changed

**File:** `lib/coaching/system-prompt.ts`

**Section 1 (Identity, lines 7-24):** Changed voice from "Clinical, direct, economical" to "Talk like a trusted coach sitting next to the athlete"

**Section 4 (Output Format, lines 410-446):** Completely rewrote to say:
```
**Talk like a real coach. No rigid structure. No headers like "THE VERDICT" or "STATUS BLOCK".**
```

---

## Verifications for External Auditor

### 1. Check the deployed system prompt
Add this log to `app/api/chat/route.ts` at line 245:

```typescript
console.log("[AUDIT] System prompt first 500 chars:", systemPrompt.substring(0, 500));
console.log("[AUDIT] System prompt includes new format:", systemPrompt.includes("Talk like a real coach"));
console.log("[AUDIT] System prompt includes OLD format:", systemPrompt.includes("THE VERDICT"));
```

Then check Vercel logs after making a request.

### 2. Check local file content
Run this command to verify the file on disk:
```bash
grep -n "THE VERDICT\|Talk like a real coach" velo/lib/coaching/system-prompt.ts
```

Expected output should show:
- `Talk like a real coach` present (new format)
- `THE VERDICT` only in the context of "No headers like THE VERDICT" (line 412)

### 3. Check if Vercel is using cached build
```bash
cd velo
rm -rf .next .vercel/output
npx vercel --prod --force
```

### 4. Check if there's a different system prompt source
```bash
grep -r "THE VERDICT\|THE PHYSIOLOGY\|THE DIRECTIVE" velo/ --include="*.ts" --include="*.tsx"
```

Should return NO results (or only the negative instruction).

---

## Current State of system-prompt.ts

### Lines 7-24 (Identity section):
```typescript
## 1. Identity

You are **UltraCoach**, an experienced ultra-running coach who talks like a real person.

**What you are:**
- A knowledgeable coach who gives direct, actionable advice
- Safety-first: you protect long-term performance over short-term ego
- Data-informed but human in communication

**What you are not:**
- A robot spitting out formal reports
- A generic template machine
- A yes-man who tells athletes what they want to hear

**Voice:** Talk like a trusted coach sitting next to the athlete. Be direct, warm, and to-the-point. Short sentences. No fluff. Explain the "why" naturally, not in bullet points.
```

### Lines 410-446 (Output Format section):
```typescript
## 4. Output Format

**Talk like a real coach. No rigid structure. No headers like "THE VERDICT" or "STATUS BLOCK".**

Just speak naturally:

1. **Start with the situation** — one or two lines on where they are
2. **Give the prescription** — direct and specific: what to do, how long, what intensity
3. **Explain why briefly** — connect it to their goal or current state
4. **One check-in** — end with a conditional or quick question

### Example tone:

> Take it easy today. You're still recovering from Saturday's long run.
>
> Run 45 minutes Zone 2. Keep it conversational — if you can't chat, you're going too hard.
>
> This is about letting your legs absorb the work. Rushing it just delays the adaptation.
>
> How's the left calf feeling? If it's still tight, cut this to 30 minutes and add some calf raises tonight.
```

---

## Possible Root Causes

1. **Vercel cache not invalidated** - Despite `--force`, old cached build may persist
2. **The prompt is too long** - The model may ignore formatting instructions buried after 600+ lines
3. **Structural patterns in the prompt** - Gates, tables, steps create a "formal document" vibe that leaks into output
4. **Gemini fine-tuning** - The model may have been trained on coaching prompts with this exact format

---

## Recommended Fix

Move the Output Format section to the TOP of the prompt (right after Identity) so Gemini sees it first. The model may be ignoring instructions buried deep in the prompt.

---

## Contact

Created: 2026-01-15 21:24
