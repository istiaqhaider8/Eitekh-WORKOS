# Eitekh WorkOS (Enterprise Edition)

[![Next.js](https://img.shields.io/badge/Next.js-15.0-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.0-2D3748?logo=prisma)](https://www.prisma.io/)
[![PBAC Security](https://img.shields.io/badge/Security-PBAC%20Enforced-green?logo=shield)](./docs/PBAC_GOVERNANCE.md)
[![Tests Passing](https://img.shields.io/badge/Tests-149%2F149%20Passed-brightgreen)](./docs/PBAC_GOVERNANCE.md)

> **Eitekh WorkOS** is a next-generation, multi-tenant enterprise operating system for agile project planning, issue tracking, workload balancing, and policy-based access governance. Engineered with Next.js 15 App Router, React 19, and Prisma ORM, Eitekh WorkOS brings together Linear-like speed, Jira-grade project governance, and deterministic PBAC security.

---

## 📑 Table of Contents
- [Executive Overview](#-executive-overview)
- [Key Features & Architectural Pillars](#-key-features--architectural-pillars)
  - [1. Policy-Based Access Control (PBAC)](#1-policy-based-access-control-pbac)
  - [2. Super Administrator Command Center (Full CRUD)](#2-super-administrator-command-center-full-crud)
  - [3. Interactive Agile Workspace & Views](#3-interactive-agile-workspace--views)
  - [4. Real-time Synchronization & 6-Tier Cache Manager](#4-real-time-synchronization--6-tier-cache-manager)
  - [5. Tenant Isolation & Immutable Audit Ledger](#5-tenant-isolation--immutable-audit-ledger)
- [System Architecture](#-system-architecture)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Configuration](#environment-configuration)
  - [Database Setup & Seeding](#database-setup--seeding)
  - [Running Development Server](#running-development-server)
- [Automated Testing & Verification](#-automated-testing--verification)
- [REST API Reference](#-rest-api-reference)
- [Documentation Index](#-documentation-index)
- [License](#-license)

---

## 🚀 Executive Overview

Eitekh WorkOS is architected for cross-functional engineering, product, and leadership squads who demand:
- **Strict Multi-Tenancy**: Complete isolation across Organizations, Workspaces, Teams, and Projects.
- **Deterministic Access Security**: Granular, provable access governance where permissions are never ambiguous.
- **Zero-Latency Interactions**: Optimistic updates, sub-millisecond capability caching, and live WebSocket synchronization.
- **Enterprise-Grade Governance**: Immutable platform audit trails tracking every administrative and security event.

---

## 💎 Key Features & Architectural Pillars

### 1. Policy-Based Access Control (PBAC)
Eitekh WorkOS incorporates an enterprise-grade PBAC engine (src/lib/pbac-engine.ts) with **18 Canonical Modules** and **59 Granular Permissions**:
- **6 Canonical Roles**:
  - **Super Admin**: 59/59 permissions (Unrestricted cross-tenant authority).
  - **Organization ADMIN**: 59/59 permissions (Complete organization-wide governance).
  - **PROJECT ADMIN**: 56/59 permissions (Full project scope, workflows, automations, custom fields, deletions).
  - **PROJECT MANAGER**: 40/59 permissions (Roadmaps, backlog grooming, sprint lifecycle, epics, reports).
  - **MEMBER**: 24/59 permissions (Core contributor: issue/subtask creation and editing, comments, CSV export).
  - **VIEWER**: 13/59 permissions (**Strict read-only stakeholder visibility**; zero creates, zero edits, zero deletes).
- **Sub-Millisecond In-Memory Caching**: 60s TTL memory capability cache for scale (>100k users).
- **4-Step Provenance Inspector**: Explains grant pathways (*Identity -> Role Binding -> Capability Grant -> Scope Boundary*).
- **Runtime Security Gate Enforcement**: Integrated across all routes via ssertProjectPermission and ssertOrgPermission.

### 2. Super Administrator Command Center (Full CRUD)
Super Administrators enjoy complete Create, Read, Update, and Delete authority:
- **Organizations**: Provision, edit, domain bind, suspend, or delete tenants.
- **Workspaces**: Multi-workspace management per organization with live project and member metrics.
- **Projects**: Project provisioning with Scrum and Kanban workflows, custom keys, and priority schemes.
- **Feature Flags**: Global and tenant-specific feature toggle engine with instant client synchronization.
- **Platform Announcements**: Broadcast alerts across tenants with severity coloring (INFO, WARNING, CRITICAL).
- **Access Governance**: Inspect access matrices, clone roles, and audit permissions.

### 3. Interactive Agile Workspace & Views
- **Kanban Board**: Drag-and-drop workflow status transitions, column WIP thresholds, swimlanes (by Assignee, Epic, Priority), and quick task creation.
- **List & Grid View**: High-throughput table view with multi-column sorting, multi-status filters, search, and bulk operations.
- **Scrum Sprint Lifecycle**: Sprint planning, starting, completing, rollover of incomplete issues to backlog, and live burndown metrics.
- **Gantt & Timeline View**: Real-time dependency link mapping (BLOCKS, BLOCKED_BY), critical path calculations, and horizontal panning.
- **Milestone Calendar**: Month-by-month milestone tracking, due date visualization, and jump-to-today navigation.
- **Workload & Capacity Balancer**: Resource allocation by story points, over-capacity indicators, and team utilization cards.
- **Executive Dashboard**: Sprint velocity tracking, status distribution charts, and high-level KPIs.

### 4. Real-Time Synchronization & 6-Tier Cache Manager
- **Live Sync Engine (src/lib/sync-engine.ts)**: Real-time broadcast channel synchronizing issues, sprints, and comments across concurrent tabs and users.
- **Cache Management Suite (src/lib/cache-manager.ts)**:
  - SERVER_APP_CACHE: Dynamic API responses and memory fragments.
  - ANALYTICS_CACHE: Derived project metrics and workload statistics.
  - PBAC_CAPABILITY_CACHE: Role-permission evaluation matrices.
  - APP_QUERY_STORE: Next.js client-side cached query payloads.
  - SEARCH_INDEX: Global issue and comment search cache.
  - REALTIME_CHANNELS: Active WebSocket and SSE channels.
  - **100% Data Safety Guarantee**: Cache purges never touch persistent business records.

### 5. Tenant Isolation & Immutable Audit Ledger
- **Multi-Tenant Boundaries**: Strict isolation via ssertOrgAccess and ssertProjectAccess in src/lib/tenant.ts. Cross-tenant attempts trigger security alerts.
- **Audit Ledger (PlatformAuditLog)**: Immutable audit events capturing actor, IP address, user agent, target resource, previous state, and new state.

---

## 🏗 System Architecture

`
┌────────────────────────────────────────────────────────────────────────┐
│                        EITEKH WORKOS FRONTEND                          │
│     React 19 • Tailwind CSS • Lucide Icons • Optimistic UI Stores      │
│  [Kanban]   [List]   [Gantt Timeline]   [Calendar]   [Super Admin]     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST / SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                       NEXT.JS 15 APP ROUTER                            │
│  ┌───────────────────────┐  ┌───────────────────────────────────────┐  │
│  │   Authentication      │  │        Tenant Access Control          │  │
│  │   JWT / MFA / Session │  │  assertOrgAccess / assertProjectAccess│  │
│  └──────────┬────────────┘  └───────────────────┬───────────────────┘  │
│             │                                   │                      │
│  ┌──────────▼───────────────────────────────────▼───────────────────┐  │
│  │           HIGH-PRIORITY DETERMINISTIC PBAC ENGINE                │  │
│  │  18 Modules • 59 Perms • In-Memory Cache • Provenance Inspector  │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
│                                 │                                      │
│  ┌──────────────────────────────▼───────────────────────────────────┐  │
│  │                  6-TIER SYSTEM CACHE & SYNC                      │  │
│  │    Server Cache • Analytics Cache • Real-Time Sync Channel       │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
│                                 │                                      │
│  ┌──────────────────────────────▼───────────────────────────────────┐  │
│  │                         PRISMA ORM                               │  │
│  │   Users • Orgs • Workspaces • Projects • Issues • Audit Ledger    │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ SQL
┌───────────────────────────────────▼────────────────────────────────────┐
│                    DATABASE (SQLite / PostgreSQL)                      │
└────────────────────────────────────────────────────────────────────────┘
`

---

## 🛠 Getting Started

### Prerequisites
- **Node.js**: 18.18.0 or higher (Node.js 20+ recommended)
- **npm**: 9.0.0 or higher
- **Git**: 2.30+

### Installation

`ash
# 1. Clone repository
git clone git@github.com:istiaqhaider8/Eitekh-WORKOS.git
cd Eitekh-WORKOS

# 2. Install dependencies
npm install
`

### Environment Configuration

Copy .env.example to create your local .env:

`ash
cp .env.example .env
`

Adjust the configuration settings:

`env
DATABASE_URL= file:./dev.db
JWT_SECRET=your-super-secure-jwt-secret-key-at-least-32-chars
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional SMTP settings for notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-16-char-app-password
`

### Database Setup & Seeding

`ash
# Generate Prisma Client
npx prisma generate

# Apply Database Migrations
npx prisma db push

# Seed Initial Demonstration & Enterprise Roles
node prisma/seed.js
`

### Running Development Server

`ash
npm run dev
`

Open [http://localhost:3000](http://localhost:3000) in your browser.

Default demonstration credentials:
- **Super Administrator**: cocofbd@gmail.com / password configured in seed.

---

## 🧪 Automated Testing & Verification

Eitekh WorkOS features automated end-to-end test suites:

### 1. PBAC Role Permission Verification Suite (149 Tests)
Validates all 6 canonical roles, 18 categories, 59 permissions, capability caching, role cloning, provenance inspector, and runtime security gates.

`ash
npx tsx scratch/test-all-role-permissions.js
`
*Result: **149 PASSED, 0 FAILED (100%)***

### 2. Super Admin Full CRUD Test Suite (70 Tests)
Validates complete Create, Read, Update, and Delete functionality across Organizations, Workspaces, Projects, Feature Flags, and Announcements with immutable audit verification.

`ash
node scratch/test-super-admin-crud.js
`
*Result: **70 PASSED, 0 FAILED (100%)***

### 3. System Refresh & Cache Acceptance Suite
Validates all 6 tiers of cache refresh with mathematical proof of zero business data loss.

`ash
node scratch/test-cache-acceptance.js
`
*Result: **100% Data Safety Guaranteed***

### 4. TypeScript Strict Compilation
`ash
npx tsc --noEmit
`
*Result: **0 Errors (Exit Code 0)***

---

## 📡 REST API Reference

| Domain | Method | Endpoint | Description | Permission Required |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | POST | /api/auth/login | User authentication & JWT issuance | Public |
| **Auth** | POST | /api/auth/register | User self-service registration | Public |
| **Auth** | GET | /api/auth/me | Current user profile & PBAC capabilities | Authenticated |
| **Issues** | GET | /api/projects/[id]/issues | List project issues with filters | issues:view |
| **Issues** | POST | /api/projects/[id]/issues | Create new issue | issues:create |
| **Issues** | PATCH | /api/issues/[id] | Update issue status, priority, fields | issues:edit |
| **Issues** | DELETE| /api/issues/[id] | Permanently delete issue | issues:delete |
| **Subtasks**| POST | /api/issues/[id]/subtasks | Add subtask to issue | 	asks:create |
| **Subtasks**| PATCH| /api/subtasks/[id] | Update subtask status | 	asks:edit |
| **Subtasks**| DELETE| /api/subtasks/[id] | Delete subtask | 	asks:delete |
| **Comments**| POST | /api/issues/[id]/comments | Post comment with @mentions | issues:comment |
| **Sprints** | GET | /api/sprints | List sprints for project | sprints:view |
| **Sprints** | POST | /api/sprints | Create new sprint | sprints:create |
| **Sprints** | PATCH| /api/sprints | Start or complete sprint | sprints:start / sprints:complete |
| **Sprints** | DELETE| /api/sprints | Delete sprint and rollover issues | sprints:delete |
| **Epics** | POST | /api/epics | Create roadmap epic | epics:create |
| **Epics** | PATCH| /api/epics/[id] | Update roadmap epic | epics:edit |
| **Epics** | DELETE| /api/epics/[id] | Delete roadmap epic | epics:delete |
| **Workflows**| POST | /api/workflows | Create custom workflow | settings:workflows |
| **Custom Fields**| POST| /api/custom-fields | Define custom field schema | settings:custom_fields |
| **Automations**| POST| /api/automations | Register automation trigger rule | settings:automations |
| **Export** | GET | /api/projects/[id]/export | Export issues to CSV, Excel, PDF | export:csv / export:excel |
| **Import** | POST | /api/projects/[id]/import | Bulk import issues from CSV | export:import_data |
| **Super Admin**| POST | /api/super-admin/orgs | Create organization | Super Admin Role |
| **Super Admin**| DELETE| /api/super-admin/orgs | Delete organization | Super Admin Role |
| **Super Admin**| POST | /api/super-admin/features | Create feature flag | Super Admin Role |
| **Super Admin**| POST | /api/super-admin/announcements | Broadcast announcement | Super Admin Role |
| **Cache** | GET | /api/admin/cache/status | Get multi-tier cache telemetry | canServerRefresh |
| **Cache** | POST | /api/admin/cache/refresh | Flush cache tiers safely | canFullRefresh |

---

## 📚 Documentation Index

For in-depth architectural and operational guides, inspect the /docs directory:
- [PBAC Governance & Role Matrix Reference](./docs/PBAC_GOVERNANCE.md)
- [System Architecture & Data Model](./docs/ARCHITECTURE.md)
- [Super Administrator Operations Manual](./docs/SUPER_ADMIN_MANUAL.md)
- [REST API Comprehensive Reference](./docs/API_DOCUMENTATION.md)

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
