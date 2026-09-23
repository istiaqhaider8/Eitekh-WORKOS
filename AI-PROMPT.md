# Universal AI Prompt — Eitekh WorkOS

> **Copy-paste everything below the line into ANY AI (Claude, Gemini, ChatGPT, Copilot, etc.) to continue work.**

---

## THE PROMPT (copy from here)

```
You are working on the Eitekh WorkOS project — a multi-tenant SaaS work management platform.

Path:   C:\Users\ASUS\.gemini\antigravity\scratch\zenith-workos
Stack:  Next.js 16.3.5 (App Router), React 19, TypeScript, Prisma 5.22, PostgreSQL, Tailwind 3.4
Node:   v24.19
Branch: security/phase-1-critical-fixes

STEP 0 — READ AGENTS.md, THEN RUN THE APP.

`AGENTS.md` in the repo root comes first: this Next.js version has breaking changes from what
you may remember, and its guides are in `node_modules/next/dist/docs/`.

Two terminals, in this order:

    cd C:\Users\ASUS\.gemini\antigravity\scratch\zenith-workos
    node scripts/dev-postgres.mjs               # embedded Postgres on 54329; leave it running

    cd C:\Users\ASUS\.gemini\antigravity\scratch\zenith-workos
    npm run build
    npm run start:local -- --port 3100

Open http://127.0.0.1:3100 — sign in as alex@acme.com / Password123!
Dev mode instead: `npm run dev` → http://localhost:3000 (that hostname only; see gotcha 4).

SIX THINGS THAT WILL EACH COST YOU AN HOUR:

1. Stop the app before `npm run build` or `npx prisma generate`. The running server holds
   .next/standalone and the Prisma query-engine DLL — otherwise EBUSY / EPERM.
2. Never run `next start` directly. The standalone server needs eight env vars set correctly
   and refuses to boot if any is wrong; each refusal looks like a different problem.
   `npm run start:local` sets them.
3. `next build` does not copy `.next/static` into `.next/standalone`. start-local does it on
   every start. Bypass that script and the app boots cleanly, logs nothing wrong, answers 200
   everywhere — and serves with no CSS and no JS.
4. CSRF: every mutating request needs an `Origin` header matching the exact URL the server
   believes it has. On `npm run dev` only `http://localhost:3000` works — `127.0.0.1:3000`
   returns 403 "Forbidden: cross-origin request". A LAN IP or tunnel URL is refused too.
5. Rate limit: 30 mutations per minute per user. A 429 is never a pass. Pace your scripts,
   spread work across users, or do test SETUP through Prisma rather than the API.
6. EMAIL. SMTP credentials live in the `systemEmailConfig` TABLE, not the environment, so
   unsetting shell variables does not stop outbound mail — a real reset code once reached a
   real address on that assumption. start-local sets EMAIL_DISABLED=1 and prints one-time
   codes to its console as `[otp]` lines. NEVER send mail to cocofbd@gmail.com or
   istiaqhaider8@gmail.com; those are the owner's real addresses.

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

VERIFY BEFORE YOU CALL ANYTHING DONE — the full set, and say what you actually ran:

    npx tsc --noEmit
    npm test                     # 596 unit tests
    npm run test:integration     # 522 tests — see below
    npm run lint                 # 128 warnings, 0 errors IS the baseline
    npm run check:a11y           # baseline 448; it only ever goes down
    npm run check:bundle         # /projects/[id] is 773 kB against a 760 kB budget
    npm run check:isolation      # tenant-isolation route coverage
    npm run check:validation     # every mutating route must validate its body

The integration suite refuses to start without INTEGRATION_DATABASE_URL, on purpose: it
creates and deletes data and must never touch the dev database. Take DATABASE_URL from .env
and change the database name to eitekh_integration_test. It builds and runs its own server on
port 3141, so stop the app on 3100 first.

HOW THE OWNER EXPECTS YOU TO WORK:
- Investigate root causes. Do not patch around an error, and never weaken, skip or delete an
  assertion to get a green run. If a test fails, find out why before touching it.
- A task marked COMPLETED is a claim, not a fact — including your own. Verify positive AND
  negative cases, authorization and cross-tenant isolation, database state (a 403 does not
  prove the write did not land), types, tests, lint and the ratchets above.
- Live testing uses dev/seed data only. Prefix anything you create with ZZ and delete it
  afterwards. Never modify or delete pre-existing projects, users or permissions. The five
  real projects are ATLAS, CP, HELIOS, NOVA, ORION.
- This app is SAP Activate-ALIGNED. Never claim SAP certification, endorsement or compliance
  in code, UI, docs or commit messages.
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
