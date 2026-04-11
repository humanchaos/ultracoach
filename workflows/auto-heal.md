---
description: Automatically diagnose, fix, and verify build failures with a max 3-iteration loop
---

# Workflow: Auto-Heal Pipeline

## Trigger
- A failed exit code from `npm run build`, `docker build`, or `npm test`.

## Sequence
1. **Step 1 (Diagnose):** Call @Diagnostician to parse the terminal output.
2. **Step 2 (Plan):** Call @Engineer to generate a fix based on the diagnosis.
3. **Step 3 (Verify):** Call @Auditor to run the build on the new branch.
4. **Step 4 (Loop):** If @Auditor fails, return to Step 1 with the new logs (Max 3 iterations).
5. **Step 5 (Finalize):** If successful, present the diff to the user for final approval before merging to main.