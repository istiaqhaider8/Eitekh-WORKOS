# Universal AI Prompt — Eitekh WorkOS

> **Copy-paste everything below the line into ANY AI (Claude, Gemini, ChatGPT, Copilot, etc.) to continue work.**

---

## THE PROMPT (copy from here)

```
You are working on the Eitekh WorkOS project — a multi-tenant SaaS work management platform.

STEP 1 — READ THESE FILES FIRST (in this order):
1. Read `AI-STATUS.md` in the repo root — this is the LIVE status tracker. It tells you exactly what is done, what is in progress, and what remains.
2. Read `PRODUCTION-READINESS.md` — the ACTIVE launch-blocking plan (17 tasks, 3 gates, acceptance criteria + verification commands). This is where current priority work lives.
3. Read `PERFORMANCE-PLAN.md` — the measured performance findings and fix plan.
4. Read `SECURITY-AUDIT.md` — the full security audit with 73 findings (note: its counts are stale, see its reconciliation note).

IMPORTANT — VERIFY, DON'T TRUST: a task marked COMPLETED is a claim, not a fact. Three findings (ARCH-2, OPS-3, PERF-8) were closed without actually being fixed. Run the check commands in `PRODUCTION-READINESS.md` §8 before assuming something is done.
3. Read `src/lib/validation.ts` — the central validation library with all Zod schemas.

STEP 2 — PICK THE NEXT TASK:
Look at the "NEXT PRIORITY TASKS" section in AI-STATUS.md. Pick the top unclaimed task (status = PENDING). Change its status to IN_PROGRESS before starting.

STEP 3 — DO THE WORK:
Follow the patterns already established in the codebase. Key rules:
- Branch: security/phase-1-critical-fixes
- All changes must be committed and pushed to GitHub
- Commit style: feat(scope): description
- TypeScript must compile clean (run: npx tsc --noEmit)
- Follow existing code patterns — don't invent new abstractions

STEP 4 — UPDATE AI-STATUS.md:
After EVERY change you make, you MUST update AI-STATUS.md:
- Move completed tasks from PENDING to COMPLETED
- Add what you did under "SESSION LOG" with today's date
- Update the progress counters
- Commit and push AI-STATUS.md with every other commit

This is MANDATORY. The next AI session depends on this file being current.

STEP 5 — COMMIT AND PUSH:
Every change must be committed and pushed. No exceptions. End commit messages with:
Co-Authored-By: [Your AI Name] <noreply@example.com>
```

---

## HOW THIS SYSTEM WORKS

```
You (human) start new AI session
        |
        v
AI reads AI-STATUS.md  <-- always up to date
        |
        v
AI picks next PENDING task
        |
        v
AI does the work
        |
        v
AI updates AI-STATUS.md  <-- marks task done, logs what changed
        |
        v
AI commits + pushes everything
        |
        v
Next AI session reads AI-STATUS.md  <-- sees exactly where things stand
```

Every AI updates the same file. Every AI reads the same file. No context is lost.
