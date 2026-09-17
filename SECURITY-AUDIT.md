# Eitekh WorkOS — Security Audit Report

> **Audit Date**: 2026-09-15
> **Auditor**: Automated security audit via Claude Code
> **System**: Eitekh WorkOS (Multi-tenant SaaS Work Management Platform)
> **Branch**: `security/phase-1-critical-fixes`
> **Status**: Phase 1 complete, Phase 2 input validation complete — 107/107 routes validated (18/73 findings resolved, 1 partial).

---

> ### 📌 Reconciliation note (added 2026-09-17 by Claude Opus 5, 1M context)
>
> **The counts in this document are stale.** Work continued in `AI-STATUS.md` after this audit was
> written, so most findings here were subsequently addressed — this file was never updated to match.
> Conversely, `AI-STATUS.md` then over-claimed **74/74 (100%)**, which is also wrong.
>
> **Verified position as of 2026-09-17: 71 of 74 findings resolved, 3 reopened.**
>
> | Finding | Marked | Reality | Now tracked as |
> |---|---|---|---|
> | **ARCH-2** — in-memory singletons won't scale | COMPLETED | Closed with `src/lib/container.ts`, a **testability** DI helper ("Production code uses the real singletons by default"). Shared state is still process-local: `rate-limit.ts:11`, `cache-manager.ts:66`, `sync-engine.ts:79` | PROD-2 / PROD-3 / PROD-4 |
> | **OPS-3** — no monitoring or alerting | COMPLETED | Closed as "(health endpoint + logging)". A health endpoint is liveness, not monitoring; logs go to `console.*` with no sink or alerting | PROD-7 |
> | **PERF-8** — bundle size not optimized | COMPLETED | `/projects/[id]` still ships **310 kB** First Load JS | PROD-12 |
>
> **Neither this file nor `AI-STATUS.md` answers "can we launch to paying tenants?"** That question
> is answered in **[`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md)**, which is the active plan:
> 17 tasks across 3 gates, with acceptance criteria and verification commands.
>
> **Summary**: no Critical security findings remain open. What blocks a multi-tenant production
> launch is **infrastructure and verification**, not security features — SQLite in production, all
> shared state in-process, and zero tenant-isolation or authorization tests across 118 API routes.
>
> Treat a COMPLETED status in any tracker as a claim to verify. See `PRODUCTION-READINESS.md` §8.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Audit Methodology](#audit-methodology)
4. [Findings Summary](#findings-summary)
5. [Phase 1 — RESOLVED Critical Fixes](#phase-1--resolved-critical-fixes)
6. [Phase 2 — Input Validation & Data Integrity](#phase-2--input-validation--data-integrity)
7. [Phase 3 — Architecture & Auth Refactoring](#phase-3--architecture--auth-refactoring)
8. [Phase 4 — Performance & Scalability](#phase-4--performance--scalability)
9. [Phase 5 — UI/UX & Frontend Hardening](#phase-5--uiux--frontend-hardening)
10. [Phase 6 — Operational Readiness](#phase-6--operational-readiness)
11. [Root Cause Analysis](#root-cause-analysis)
12. [Files Modified in Phase 1](#files-modified-in-phase-1)
13. [Implementation Roadmap](#implementation-roadmap)
14. [How to Continue This Work](#how-to-continue-this-work)

---

## Executive Summary

A comprehensive security audit of the Eitekh WorkOS platform identified **73 findings** across 12 domains. The audit covered codebase structure, authentication, authorization (PBAC), data handling, API security, notifications, email, database, performance, and UI/UX.

**10 Critical findings** have been resolved in Phase 1 and pushed to GitHub on branch `security/phase-1-critical-fixes`. These fixes close all exploitable attack chains that were verified against the running system, including a full pre-authentication account takeover chain, cross-tenant data injection, and a hardcoded backdoor.

**Phase 2 input validation is complete** — zod validation library installed, shared validation schemas created, and applied to all 107 route handlers (100% coverage). Rate limiting added to registration. Attachment size/type validation enforced. CSRF origin-checking middleware added. Email template rendering now HTML-escapes all interpolated values. 8 additional findings fully resolved, 1 partially addressed.

**56 findings remain** across Phases 2–6, ranging from High to Low severity. No Critical findings remain open.

### Severity Breakdown

| Severity | Total | Resolved | Partial | Remaining |
|----------|-------|----------|---------|-----------|
| Critical | 10    | 10       | 0       | 0         |
| High     | 18    | 5        | 2       | 11        |
| Medium   | 27    | 2        | 0       | 25        |
| Low      | 18    | 0        | 0       | 18        |
| **Total**| **73**| **17**   | **2**   | **54**    |

### Progress: 23% complete (17/73 resolved, 2 partial)

---

## System Overview

| Attribute | Value |
|-----------|-------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Frontend | React 19, Tailwind CSS |
| ORM | Prisma |
| Database | SQLite (file-based) |
| Auth | JWT (cookie-based) + Session table |
| Authorization | PBAC (Policy-Based Access Control) custom engine |
| Real-time | Server-Sent Events (SSE) |
| API Routes | 107 route handlers |
| Source Files | 192 files |
| Lines of Code | ~66,000 |
| Architecture | Multi-tenant SaaS (organizations → workspaces → projects) |

---

## Audit Methodology

1. **Static analysis**: Full codebase review of all 192 source files, 107 API routes, auth system, PBAC engine, notification system, email templates, and database schema.
2. **Live exploitation**: Black-box testing against the running dev server. Created throwaway accounts and empirically verified attack chains including account takeover, cross-tenant injection, session bypass, and data leakage.
3. **Domain auditors**: Specialized analysis across 12 domains (auth, PBAC, data handling, API security, notifications, email, database, performance, UI/UX, super-admin, configuration, real-time sync).
4. **Verification**: All Critical findings were reproduced live. Fixes were verified by re-running the same exploits and confirming they fail.

---

## Findings Summary

### All 73 Findings by ID

| ID | Severity | Status | Phase | Title |
|----|----------|--------|-------|-------|
| AUTH-1 | Critical | ✅ RESOLVED | 1 | Pre-auth account takeover via leaked reset tokens |
| AUTH-2 | Critical | ✅ RESOLVED | 1 | Hardcoded JWT fallback secret |
| AUTH-3 | Critical | ✅ RESOLVED | 1 | Session revocation non-functional |
| AUTH-4 | High | ⬚ PENDING | 2 | Cookie secure flag tied to NODE_ENV |
| AUTH-5 | High | ✅ RESOLVED | 2 | No password complexity requirements |
| AUTH-6 | High | ✅ RESOLVED | 2 | No rate limiting on auth endpoints |
| AUTH-7 | Critical | ✅ RESOLVED | 1 | Reset token stored in plaintext |
| AUTH-8 | Medium | ⬚ PENDING | 3 | No account lockout after failed attempts |
| AUTH-9 | Medium | ⬚ PENDING | 3 | No MFA enforcement option |
| AUTH-10 | Low | ⬚ PENDING | 6 | Session expiry not configurable |
| PBAC-1 | Critical | ✅ RESOLVED | 1 | Role escalation via unvalidated role strings |
| PBAC-2 | Critical | ✅ RESOLVED | 1 | Hardcoded email backdoor in PBAC engine |
| PBAC-3 | High | ⬚ PENDING | 3 | Two confusable auth helpers (assertProjectAccess vs assertProjectPermission) |
| PBAC-4 | Medium | ⬚ PENDING | 3 | PBAC cache invalidation race conditions |
| PBAC-5 | Medium | ⬚ PENDING | 3 | No permission audit trail |
| PBAC-6 | Low | ⬚ PENDING | 5 | Permission denied errors not user-friendly |
| DATA-1 | Critical | ✅ RESOLVED | 1 | Secrets serialized to browser (passwordHash, resetToken, mfaSecret) |
| DATA-2 | High | ✅ RESOLVED | 2 | Unbounded base64 attachments stored in DB |
| DATA-3 | High | ✅ RESOLVED | 2 | Unsanitized search params passed to Prisma |
| DATA-4 | Medium | ✅ RESOLVED | 2 | Missing CSRF protection on state-changing endpoints |
| DATA-5 | Medium | ✅ RESOLVED | 2 | Email content not sanitized (HTML injection) |
| DATA-6 | Critical | ✅ RESOLVED | 1 | No security response headers |
| DATA-7 | Medium | ⬚ PENDING | 3 | No data encryption at rest |
| DATA-8 | Low | ⬚ PENDING | 6 | No data retention/deletion policy |
| NOTIF-1 | Critical | ✅ RESOLVED | 1 | Cross-tenant notification and email injection |
| NOTIF-2 | Medium | ⬚ PENDING | 4 | Notification fan-out blocks request |
| NOTIF-3 | Low | ⬚ PENDING | 5 | No notification preferences/opt-out |
| NOTIF-4 | Low | ⬚ PENDING | 5 | Notification UI missing bulk actions |
| EMAIL-1 | High | ✅ RESOLVED | 2 | Email templates interpolate unsanitized user input |
| EMAIL-2 | Medium | ⬚ PENDING | 3 | No email delivery tracking or retry |
| EMAIL-3 | Low | ⬚ PENDING | 6 | No email template versioning |
| EMAIL-4 | Low | ⬚ PENDING | 6 | Hardcoded sender address |
| ADMIN-1 | Critical | ✅ RESOLVED | 1 | Audit-log cross-tenant data leak |
| ADMIN-2 | High | ⬚ PENDING | 3 | Super-admin endpoints lack consistent authorization |
| ADMIN-3 | Medium | ⬚ PENDING | 3 | No admin action audit trail |
| ADMIN-4 | Low | ⬚ PENDING | 6 | No admin dashboard access logging |
| API-1 | High | ✅ RESOLVED | 2 | Schema validation across all 107 API routes (107/107 done) |
| API-2 | High | 🔧 PARTIAL | 2 | Inconsistent error response formats (standardized for validated routes) |
| API-3 | Medium | ⬚ PENDING | 3 | No API versioning strategy |
| API-4 | Medium | ⬚ PENDING | 4 | No request/response logging middleware |
| API-5 | Low | ⬚ PENDING | 6 | No OpenAPI/Swagger documentation |
| ARCH-1 | High | ⬚ PENDING | 3 | SQLite with no migration system |
| ARCH-2 | High | ⬚ PENDING | 3 | In-memory singletons as infrastructure |
| ARCH-3 | Medium | ⬚ PENDING | 3 | No service layer between routes and Prisma |
| ARCH-4 | Medium | ⬚ PENDING | 3 | No error handling middleware |
| ARCH-5 | Medium | ⬚ PENDING | 4 | Large Prisma queries not optimized |
| ARCH-6 | Low | ⬚ PENDING | 6 | No dependency injection / testability |
| PERF-1 | High | ⬚ PENDING | 4 | N+1 queries in issue/project listings |
| PERF-2 | High | ⬚ PENDING | 4 | Missing database indexes on foreign keys |
| PERF-3 | Medium | ⬚ PENDING | 4 | SSE connection memory leaks |
| PERF-4 | Medium | ⬚ PENDING | 4 | No pagination on several list endpoints |
| PERF-5 | Medium | ⬚ PENDING | 4 | Synchronous email sending in request path |
| PERF-6 | Medium | ⬚ PENDING | 4 | No caching layer (Redis or in-memory with TTL) |
| PERF-7 | Low | ⬚ PENDING | 4 | No connection pooling strategy |
| PERF-8 | Low | ⬚ PENDING | 4 | Bundle size not optimized |
| UI-1 | High | ⬚ PENDING | 5 | XSS via unsanitized user content in rendering |
| UI-2 | Medium | ⬚ PENDING | 5 | Client-side only validation on forms |
| UI-3 | Medium | ⬚ PENDING | 5 | Accessibility gaps (ARIA, keyboard navigation) |
| UI-4 | Medium | ⬚ PENDING | 5 | Stale real-time data after SSE reconnection |
| UI-5 | Medium | ⬚ PENDING | 5 | No optimistic updates (slow perceived performance) |
| UI-6 | Low | ⬚ PENDING | 5 | Missing loading/error states on data fetches |
| UI-7 | Low | ⬚ PENDING | 5 | No dark mode consistency |
| UI-8 | Low | ⬚ PENDING | 5 | Mobile responsiveness gaps in data tables |
| OPS-1 | High | ⬚ PENDING | 6 | No rate limiting on any endpoint |
| OPS-2 | High | ⬚ PENDING | 6 | No backup strategy for SQLite file DB |
| OPS-3 | Medium | ⬚ PENDING | 6 | No monitoring or alerting |
| OPS-4 | Medium | ⬚ PENDING | 6 | Secrets/config partially hardcoded |
| OPS-5 | Medium | ⬚ PENDING | 6 | No CI/CD pipeline |
| OPS-6 | Medium | ⬚ PENDING | 6 | No health check endpoint |
| OPS-7 | Low | ⬚ PENDING | 6 | No structured logging |
| OPS-8 | Low | ⬚ PENDING | 6 | No environment-specific configuration |
| OPS-9 | Low | ⬚ PENDING | 6 | No deployment documentation |
| TEST-1 | Medium | ⬚ PENDING | 6 | Zero test coverage |
| TEST-2 | Low | ⬚ PENDING | 6 | No integration test framework |

---

## Phase 1 — RESOLVED Critical Fixes

> **Status**: ✅ COMPLETE — 10/10 findings resolved
> **Branch**: `security/phase-1-critical-fixes`
> **Commit**: `7cc82e9`
> **Files changed**: 16 (+248 / −55 lines)

### AUTH-1: Pre-auth Account Takeover via Leaked Reset Tokens

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: `POST /api/auth/forgot-password` returned a `devResetUrl` containing the raw reset token in the HTTP response. Any attacker could request a password reset for any email and receive the token without access to the victim's inbox.
- **Exploit verified**: Yes — full takeover chain reproduced against running server.
- **Fix applied in**: `src/app/api/auth/forgot-password/route.ts`
  - Removed `devResetUrl` from response entirely
  - Raw token generated with `crypto.randomBytes(32)`
  - Token stored as SHA-256 hash (not plaintext)
  - Response returns only a generic success message
- **Related fix**: AUTH-7 (reset-password endpoint now hashes incoming token before DB lookup)

### AUTH-2: Hardcoded JWT Fallback Secret

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: `JWT_SECRET` had a hardcoded fallback string. If the env var was unset, all tokens were signed with a known secret, allowing any attacker to forge valid JWTs.
- **Fix applied in**: `src/lib/auth.ts`
  - `JWT_SECRET` now throws at module load if missing — server won't start
  - JWT signing pins `algorithm: "HS256"`, adds `issuer` and `audience` claims
  - JWT verification pins `algorithms: ["HS256"]`, validates issuer/audience
  - Bcrypt cost raised from 10 to 12
  - `MAX_PASSWORD_LENGTH = 64` enforced in `hashPassword`

### AUTH-3: Session Revocation Non-Functional

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: The `Session` table existed but `getCurrentUser()` never checked it. Logging out deleted the session row, but the JWT remained valid. Password reset invalidated sessions in the DB, but tokens still worked.
- **Fix applied in**: `src/lib/auth.ts`
  - `getCurrentUser()` now validates `payload.sessionId` against the `Session` table
  - Checks session exists, userId matches, and `expiresAt` is in the future
  - Updates `lastActiveAt` on each validated request
  - Rejects legacy tokens without `sessionId` claim

### AUTH-7: Reset Token Stored in Plaintext

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: Reset tokens stored as raw strings in the `User.resetToken` column. A database backup or read-only SQL injection yields instant account takeover for any user with a pending reset.
- **Fix applied in**: `src/app/api/auth/forgot-password/route.ts`, `src/app/api/auth/reset-password/route.ts`
  - Forgot-password: stores `SHA-256(rawToken)`, emails `rawToken`
  - Reset-password: hashes the incoming token, looks up by hash

### PBAC-1: Role Escalation via Unvalidated Role Strings

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: `POST /api/projects/:id/members` accepted arbitrary role strings (e.g., `"role_<orgId>_org-admin"`) and passed them directly to the PBAC engine, which resolved them as org-scoped admin roles.
- **Fix applied in**: `src/app/api/projects/[id]/members/route.ts`, `src/lib/pbac-engine.ts`
  - Added `ALLOWED_PROJECT_ROLES` allowlist (6 valid project roles)
  - `normalizeProjectRole()` rejects anything not on the list
  - `syncProjectMemberRole()` validates role scope is `"PROJECT"` and orgId matches

### PBAC-2: Hardcoded Email Backdoor

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: The PBAC engine contained `if (u.isSuperAdmin || u.email === 'cocofbd@gmail.com')` in 3 locations, granting unconditional admin access to that email address regardless of actual permissions.
- **Fix applied in**: `src/lib/pbac-engine.ts`
  - Removed `u.email === 'cocofbd@gmail.com'` from all 3 locations (~lines 558, 1284, 1314)
  - Only `u.isSuperAdmin` flag now grants bypass

### DATA-1: Secrets Serialized to Browser

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: API routes used `include: { assignee: true }` on User relations, which selects all columns including `passwordHash`, `resetToken`, `mfaSecret`, `recoveryCodes`, and `verificationToken`. These were sent in JSON responses to the browser.
- **Fix applied in**: `src/lib/safe-select.ts` (new file), 6 API routes
  - Created `publicUserSelect` (only: id, email, firstName, lastName, avatarUrl, jobTitle)
  - Created `publicUserRelation` helper for Prisma includes
  - Applied to: issues/[id], issues/[id]/subtasks, projects/[id]/export, projects/[id]/issues, projects/[id]/reports/download, sprints

### DATA-6: No Security Response Headers

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: No CSP, HSTS, X-Frame-Options, or other security headers. Enables clickjacking, MIME sniffing attacks, and weakens XSS mitigations.
- **Fix applied in**: `next.config.mjs`
  - Content-Security-Policy (script-src self + unsafe-inline/eval for Next.js runtime)
  - Strict-Transport-Security (63072000s, includeSubDomains, preload)
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy: camera=(), microphone=(), geolocation=()
  - `poweredByHeader: false`

### NOTIF-1: Cross-Tenant Notification & Email Injection

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: `POST /api/notifications` accepted arbitrary `recipientUserIds` and `emailTemplateKey`. Any authenticated user could send platform-branded emails (including forged PASSWORD_RESET emails with attacker-controlled links) to any user in any organization.
- **Exploit verified**: Yes — cross-tenant notification injection reproduced.
- **Fix applied in**: `src/app/api/notifications/route.ts`
  - Recipients validated against caller's organization membership
  - `emailTemplateKey` and `emailVariables` never accepted from client
  - `sendEmailAsync` forced to `false` for user-initiated notifications

### ADMIN-1: Audit-Log Cross-Tenant Data Leak

- **Severity**: Critical
- **Status**: ✅ RESOLVED
- **Attack**: `GET /api/super-admin/audit-logs` had no authorization check. Any authenticated user could read all audit logs across all tenants. The `groupBy` aggregation leaked action-type counts for all organizations.
- **Exploit verified**: Yes — fresh account could read global audit metadata.
- **Fix applied in**: `src/app/api/super-admin/audit-logs/route.ts`
  - Requires `isSuperAdmin` or `isSupportAdmin` for platform-wide access
  - Requires OWNER/ADMIN org role for tenant-scoped access
  - `groupBy` aggregation scoped with `where: whereClause`

---

## Phase 2 — Input Validation & Data Integrity

> **Status**: ⬚ NOT STARTED — ~18 findings
> **Priority**: High
> **Estimated effort**: 2–3 weeks

| ID | Severity | Title | Details |
|----|----------|-------|---------|
| API-1 | High | Zero schema validation on 107 API routes | No zod, yup, or joi on any endpoint. All input trusted implicitly. Add a shared validation middleware with zod schemas for every route. |
| DATA-2 | High | Unbounded base64 attachments in DB | `fileUrl` field accepts unlimited base64 strings. Cap at ~5MB, validate MIME type from data-URL prefix, derive `mimeType` server-side. |
| AUTH-4 | High | Cookie secure flag tied to NODE_ENV | `secure: process.env.NODE_ENV === 'production'` in login/register routes. Should be unconditional or protocol-based. Files: `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts`. |
| AUTH-5 | High | No password complexity requirements | Any string accepted. Add minimum length (8+), complexity rules. |
| AUTH-6 | High | No rate limiting on auth endpoints | Login, register, forgot-password open to brute force. Needs per-IP throttling. |
| DATA-3 | High | Unsanitized search params in Prisma queries | Several routes pass raw `searchParams.get()` values into `where` clauses. |
| EMAIL-1 | High | Email templates interpolate unsanitized input | User-supplied names/values inserted into HTML email templates without escaping. |
| API-2 | High | Inconsistent error response formats | Some routes return `{error: string}`, others `{message: string}`, others raw strings. Standardize. |
| DATA-4 | Medium | Missing CSRF protection | Cookie-based auth without CSRF tokens on POST/PATCH/DELETE. |
| DATA-5 | Medium | Email HTML injection | User-supplied values in email HTML without sanitization. |

---

## Phase 3 — Architecture & Auth Refactoring

> **Status**: ⬚ NOT STARTED — ~14 findings
> **Priority**: Medium–High
> **Estimated effort**: 3–4 weeks

| ID | Severity | Title | Details |
|----|----------|-------|---------|
| ARCH-1 | High | SQLite with no migration system | Schema changes are ad-hoc via `prisma db push`. Need `prisma migrate` for production. |
| ARCH-2 | High | In-memory singletons as infrastructure | SSE manager, PBAC cache, notification engine store state in memory. Lost on restart, can't scale horizontally. |
| PBAC-3 | High | Two confusable auth helpers | `assertProjectAccess` (checks membership) vs `assertProjectPermission` (checks PBAC). Easy to use the wrong one. Merge or rename. |
| ADMIN-2 | High | Super-admin endpoints inconsistent auth | Some check `isSuperAdmin`, some don't check at all. Standardize. |
| AUTH-8 | Medium | No account lockout | No limit on failed login attempts per account. |
| AUTH-9 | Medium | No MFA enforcement option | MFA fields exist in schema but no implementation. |
| PBAC-4 | Medium | PBAC cache race conditions | In-memory cache can serve stale permissions after role changes. |
| PBAC-5 | Medium | No permission audit trail | Role changes not logged to audit system. |
| ARCH-3 | Medium | No service layer | Business logic duplicated across route handlers. |
| ARCH-4 | Medium | No error handling middleware | Each route has its own try/catch with inconsistent formatting. |
| API-3 | Medium | No API versioning | Breaking changes have no migration path. |
| DATA-7 | Medium | No encryption at rest | Sensitive data stored unencrypted in SQLite file. |
| EMAIL-2 | Medium | No email delivery tracking | Failed emails silently dropped with `console.error`. |
| ADMIN-3 | Medium | No admin action audit trail | Super-admin actions not logged. |

---

## Phase 4 — Performance & Scalability

> **Status**: ⬚ NOT STARTED — ~12 findings
> **Priority**: Medium
> **Estimated effort**: 2–3 weeks

| ID | Severity | Title | Details |
|----|----------|-------|---------|
| PERF-1 | High | N+1 queries in listings | Issue/project list endpoints fetch relations in loops. Use Prisma `include` with selection. |
| PERF-2 | High | Missing database indexes | No indexes on foreign keys used in WHERE/JOIN/ORDER BY. Add to schema.prisma. |
| PERF-3 | Medium | SSE connection memory leaks | Disconnected clients not reliably cleaned up from in-memory map. |
| PERF-4 | Medium | Missing pagination on list endpoints | Some routes return all records. Add limit/offset/cursor pagination. |
| PERF-5 | Medium | Synchronous email in request path | `sendEmail` called in-line. Move to background queue. |
| PERF-6 | Medium | No caching layer | Every request hits SQLite. Add Redis or TTL-based in-memory cache. |
| ARCH-5 | Medium | Large Prisma queries not optimized | Some queries select entire related trees unnecessarily. |
| API-4 | Medium | No request/response logging | No middleware for logging request details, timing, errors. |
| NOTIF-2 | Medium | Notification fan-out blocks request | Sending to N users happens synchronously in the request. |
| PERF-7 | Low | No connection pooling strategy | SQLite doesn't need pooling, but migration to PostgreSQL would. |
| PERF-8 | Low | Bundle size not optimized | No analysis or tree-shaking verification. |

---

## Phase 5 — UI/UX & Frontend Hardening

> **Status**: ⬚ NOT STARTED — ~10 findings
> **Priority**: Medium–Low
> **Estimated effort**: 2 weeks

| ID | Severity | Title | Details |
|----|----------|-------|---------|
| UI-1 | High | XSS via unsanitized user content | Issue descriptions and comments rendered without escaping. Use DOMPurify or React's built-in escaping consistently. |
| UI-2 | Medium | Client-side only form validation | Server accepts anything — client checks are cosmetic. |
| UI-3 | Medium | Accessibility gaps | Modals, dropdowns, and data tables missing ARIA roles and keyboard navigation. |
| UI-4 | Medium | Stale data after SSE reconnection | Client doesn't refetch state after SSE connection drops and reconnects. |
| UI-5 | Medium | No optimistic updates | Every action waits for server response. Perceived performance is slow. |
| PBAC-6 | Low | Permission errors not user-friendly | Users see generic "Forbidden" instead of what permission they need. |
| NOTIF-3 | Low | No notification preferences | Users can't opt out of notification types. |
| NOTIF-4 | Low | Notification UI missing bulk actions | No select-all, bulk mark-read, bulk delete. |
| UI-6 | Low | Missing loading/error states | Several views blank or stale during network calls. |
| UI-7 | Low | Dark mode inconsistency | Some components don't respect theme toggle. |
| UI-8 | Low | Mobile data table overflow | Wide tables break on small screens. Need horizontal scroll. |

---

## Phase 6 — Operational Readiness

> **Status**: ⬚ NOT STARTED — ~9 findings
> **Priority**: Medium–Low
> **Estimated effort**: 2–3 weeks

| ID | Severity | Title | Details |
|----|----------|-------|---------|
| OPS-1 | High | No rate limiting | All 107 endpoints open to abuse. Need per-IP/per-user throttling (e.g., express-rate-limit equivalent for Next.js). |
| OPS-2 | High | No SQLite backup strategy | Single-file DB with no automated backups. A crash or disk failure loses everything. |
| OPS-3 | Medium | No monitoring or alerting | No health checks, error tracking (Sentry), or uptime monitoring. |
| OPS-4 | Medium | Secrets partially hardcoded | Some config values in source. Need proper `.env` management and validation. |
| OPS-5 | Medium | No CI/CD pipeline | No automated testing, linting, or deployment. |
| OPS-6 | Medium | No health check endpoint | No `/api/health` for load balancers or monitoring. |
| TEST-1 | Medium | Zero test coverage | No unit, integration, or e2e tests exist in the project. |
| AUTH-10 | Low | Session expiry not configurable | Hardcoded expiry. Should be env-configurable. |
| EMAIL-3 | Low | No email template versioning | Template changes affect all in-flight emails immediately. |
| EMAIL-4 | Low | Hardcoded sender address | Email "from" address in code, not env config. |
| ADMIN-4 | Low | No admin access logging | Super-admin page views not tracked. |
| DATA-8 | Low | No data retention policy | Old data never cleaned up. No GDPR deletion support. |
| OPS-7 | Low | No structured logging | `console.log`/`console.error` throughout. Need structured JSON logs. |
| OPS-8 | Low | No environment-specific config | Same config for dev/staging/prod. |
| OPS-9 | Low | No deployment documentation | No README section on how to deploy. |
| TEST-2 | Low | No integration test framework | No test runner, no DB fixtures, no API test helpers. |
| API-5 | Low | No API documentation | No OpenAPI/Swagger spec. |
| ARCH-6 | Low | No dependency injection | Hard to mock dependencies for testing. |

---

## Root Cause Analysis

The 73 findings trace back to **6 systemic root causes**. Fixing these structurally (Phases 2–3) will prevent recurrence:

### 1. No Input Validation Layer
- **Impact**: 107 of 107 routes now validate input with zod schemas
- **Result**: Arbitrary data flows from HTTP request to database unchecked
- **Fix**: ✅ Added zod schemas to every route handler (Phase 2, API-1 — COMPLETE)

### 2. Secrets on the Same Model as Public Data
- **Impact**: `User` model contains both public fields (name, email) and secrets (passwordHash, resetToken, mfaSecret)
- **Result**: Any `include: { user: true }` sends secrets to the browser
- **Fix**: Phase 1 added `publicUserSelect`; Phase 3 should split the model or enforce at the Prisma middleware level

### 3. Two Confusable Auth Helpers
- **Impact**: `assertProjectAccess` checks membership; `assertProjectPermission` checks PBAC permissions. Names are similar.
- **Result**: Developers pick the wrong one, leaving endpoints with membership-only checks instead of permission checks
- **Fix**: Merge into one helper or rename to be unambiguous (Phase 3, PBAC-3)

### 4. Stateless JWT with Decorative Sessions
- **Impact**: JWTs were self-contained; Session table was populated but never validated
- **Result**: Logout, password-reset invalidation, and admin force-logout were non-functional
- **Fix**: Phase 1 wired sessions into `getCurrentUser`. Phase 3 should consider short-lived JWTs + refresh tokens.

### 5. In-Memory Singletons as Infrastructure
- **Impact**: SSE connections, PBAC role cache, and notification engine state all live in Node.js memory
- **Result**: State lost on restart, can't scale to multiple instances, SSE connections leak
- **Fix**: Move to Redis or database-backed state (Phase 3, ARCH-2)

### 6. SQLite Without Migrations
- **Impact**: Schema managed via `prisma db push` (destructive), no migration history
- **Result**: No rollback capability, no schema versioning, risky for production
- **Fix**: Switch to `prisma migrate` and consider PostgreSQL for production (Phase 3, ARCH-1)

---

## Files Modified in Phase 1

| File | Change |
|------|--------|
| `src/lib/auth.ts` | JWT hardening, session validation, bcrypt cost increase |
| `src/lib/pbac-engine.ts` | Backdoor removal (3 sites), syncProjectMemberRole validation |
| `src/lib/safe-select.ts` | **NEW** — publicUserSelect/publicUserRelation helpers |
| `src/app/api/auth/forgot-password/route.ts` | Token hashing, devResetUrl removal |
| `src/app/api/auth/reset-password/route.ts` | Token hash lookup |
| `src/app/api/notifications/route.ts` | Cross-tenant validation, email template blocking |
| `src/app/api/projects/[id]/members/route.ts` | Role allowlist, normalizeProjectRole() |
| `src/app/api/super-admin/audit-logs/route.ts` | Authorization + scoped aggregation |
| `src/app/api/issues/[id]/route.ts` | publicUserRelation applied |
| `src/app/api/issues/[id]/subtasks/route.ts` | publicUserRelation applied |
| `src/app/api/projects/[id]/export/route.ts` | publicUserRelation applied |
| `src/app/api/projects/[id]/issues/route.ts` | publicUserRelation applied |
| `src/app/api/projects/[id]/reports/download/route.ts` | publicUserRelation applied |
| `src/app/api/sprints/route.ts` | publicUserRelation applied |
| `next.config.mjs` | Security headers, poweredByHeader disabled |
| `.claude/launch.json` | Dev server configuration |

---

## Implementation Roadmap

| Phase | Focus | Findings | Priority | Est. Effort | Dependencies |
|-------|-------|----------|----------|-------------|--------------|
| ~~1~~ | ~~Critical Security~~ | ~~10~~ | ~~Critical~~ | ~~1 week~~ | ~~None~~ ✅ DONE |
| 2 | Input Validation & Data Integrity | ~18 | High | 2–3 weeks | None |
| 3 | Architecture & Auth Refactoring | ~14 | Medium–High | 3–4 weeks | Phase 2 |
| 4 | Performance & Scalability | ~12 | Medium | 2–3 weeks | Phase 3 |
| 5 | UI/UX & Frontend Hardening | ~10 | Medium–Low | 2 weeks | Phase 2 |
| 6 | Operational Readiness | ~9 | Medium–Low | 2–3 weeks | Phases 3–4 |

**Total estimated effort**: 12–16 weeks for full remediation.

---

## How to Continue This Work

### For AI assistants (Claude, Gemini, Copilot, etc.)

1. **Read this document first** to understand the full scope and current progress.
2. **Check the branch**: Work should continue on `security/phase-1-critical-fixes` or a new branch per phase (e.g., `security/phase-2-validation`).
3. **Phase 1 is done** — do not re-fix these issues. Verify they work if needed, but don't duplicate the changes.
4. **Next priority is Phase 2** — start with API-1 (add zod validation) and DATA-2 (attachment size limits) as they have the widest impact.
5. **Update this document** as findings are resolved — change status from `⬚ PENDING` to `✅ RESOLVED` and add fix details.
6. **Run `npx tsc --noEmit`** after every change to verify TypeScript compiles clean.
7. **Test against the running dev server** (`npm run dev`) — verify fixes with actual HTTP requests, not just code review.

### For developers

1. **Review the PR** on branch `security/phase-1-critical-fixes` before merging to `main`.
2. **Set `JWT_SECRET`** as an environment variable — the server will not start without it after this fix.
3. **Existing user sessions will be invalidated** after merge because `getCurrentUser` now requires a `sessionId` claim. Users will need to log in again.
4. **The reset token format changed** — any pending password resets will be invalidated. Users should request a new reset link.

---

*Last updated: 2026-09-15 | Phase 1 complete | 10/73 findings resolved*
