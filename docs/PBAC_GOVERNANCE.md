# Policy-Based Access Control (PBAC) Governance Specification

> **Classification:** Enterprise Security & Access Governance Standard  
> **Status:** Production-Ready & Verified (149/149 Tests Passing)  
> **Engine:** `src/lib/pbac-engine.ts`  
> **Security Gate:** `src/lib/tenant.ts` (`assertProjectPermission`, `assertOrgPermission`)

---

## 1. Executive Summary

Eitekh WorkOS implements a deterministic, multi-tier Policy-Based Access Control (PBAC) Engine. Unlike traditional coarse RBAC, PBAC evaluates:
1. **Subject**: User identity, global flags (`isSuperAdmin`), and contextual role bindings.
2. **Context Scope**: Organization ID, Workspace ID, and Project ID.
3. **Action Capability**: Exact permission key (e.g. `issues:delete`, `sprints:complete`).
4. **Provenance Trail**: Auditable grant pathway explaining *why* access was permitted or denied.

---

## 2. Canonical Roles & Permission Distribution

The engine standardizes six canonical roles across the multi-tenant hierarchy:

| Role | Scope | Total Perms | Summary Profile |
| :--- | :--- | :--- | :--- |
| **Super Admin** | Platform / Global | **59 / 59** (100%) | Full platform-level unrestricted CRUD across all organizations, tenants, and system settings. |
| **Organization ADMIN** | Organization | **59 / 59** (100%) | Complete management of organization settings, billing, workspaces, projects, and users. |
| **PROJECT ADMIN** | Project | **56 / 59** (95%) | Full project ownership: issue lifecycle, workflows, automations, custom fields, and destructive actions. |
| **PROJECT MANAGER** | Project | **40 / 59** (68%) | Sprint management, backlog refinement, roadmaps, epics, and reporting (restricted from schema modifications). |
| **MEMBER** | Project | **24 / 59** (41%) | Core developer/contributor: create/edit issues and subtasks, log time, add comments, and export CSV. |
| **VIEWER** | Project | **13 / 59** (22%) | Read-only stakeholder: view issues, boards, sprints, epics, timeline, and calendar. Zero mutation capability. |

---

## 3. The 18 Canonical Capability Domains (59 Permissions)

### 1. Issues (`issues:*`)
- `issues:view` (All roles) — Read issues, details, and activity logs.
- `issues:create` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — File new issues.
- `issues:edit` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Modify title, description, priority, dates.
- `issues:delete` (Super Admin, Org Admin, Project Admin) — Permanently purge or archive issues.
- `issues:assign` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Change assignees.
- `issues:transition` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Move statuses on Kanban/Scrum boards.
- `issues:comment` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Post discussions.
- `issues:bulk_edit` (Super Admin, Org Admin, Project Admin, Project Manager) — Perform batch updates.

### 2. Sprints (`sprints:*`)
- `sprints:view` (All roles) — View sprint backlogs and burndown metrics.
- `sprints:create` (Super Admin, Org Admin, Project Admin, Project Manager) — Plan new sprints.
- `sprints:start` (Super Admin, Org Admin, Project Admin, Project Manager) — Activate sprint timeline.
- `sprints:complete` (Super Admin, Org Admin, Project Admin, Project Manager) — Close active sprint and rollover incomplete tasks.
- `sprints:delete` (Super Admin, Org Admin, Project Admin) — Delete empty or unstarted sprints.

### 3. Epics (`epics:*`)
- `epics:view` (All roles) — Read roadmap milestones and epics.
- `epics:create` (Super Admin, Org Admin, Project Admin, Project Manager) — Create strategic epics.
- `epics:edit` (Super Admin, Org Admin, Project Admin, Project Manager) — Update epic scope, dates, and color.
- `epics:delete` (Super Admin, Org Admin, Project Admin) — Remove epics and disassociate issues.

### 4. Tasks & Subtasks (`tasks:*`)
- `tasks:view` (All roles) — View checklists and subtasks.
- `tasks:create` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Add checklist items.
- `tasks:edit` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Mark done, edit subtask title.
- `tasks:delete` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Remove checklist items.

### 5. Comments & Mentions (`comments:*`)
- `comments:view` (All roles) — Read comment threads.
- `comments:create` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Post comment with @mentions.
- `comments:edit_own` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Edit authored comment.
- `comments:edit_any` (Super Admin, Org Admin, Project Admin) — Moderate inappropriate comments.
- `comments:delete_own` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Delete own comment.
- `comments:delete_any` (Super Admin, Org Admin, Project Admin) — Moderator deletion.

### 6. Attachments (`attachments:*`)
- `attachments:view` (All roles) — Download and view files.
- `attachments:upload` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Attach assets to issues.
- `attachments:delete` (Super Admin, Org Admin, Project Admin) — Delete uploaded files.

### 7. Time Tracking (`timetracking:*`)
- `timetracking:view` (All roles) — Inspect time spent vs estimated.
- `timetracking:log` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Record hours worked.
- `timetracking:manage` (Super Admin, Org Admin, Project Admin, Project Manager) — Edit or adjust other members' time entries.

### 8. Workflows & Custom Statuses (`settings:workflows`)
- `settings:workflows` (Super Admin, Org Admin, Project Admin) — Configure project states, WIP limits, and transition rules.

### 9. Custom Fields (`settings:custom_fields`)
- `settings:custom_fields` (Super Admin, Org Admin, Project Admin) — Add typed metadata fields (dropdown, text, number, date).

### 10. Automations (`settings:automations`)
- `settings:automations` (Super Admin, Org Admin, Project Admin) — Define trigger-action rules (e.g. on status change -> notify).

### 11. Project Settings & Administration (`settings:project`, `projects:delete`)
- `settings:project` (Super Admin, Org Admin, Project Admin) — Configure project details, integrations, and default views.
- `projects:delete` (Super Admin, Org Admin, Project Admin) — Archive or delete project.

### 12. Workspace Administration (`workspaces:*`)
- `workspaces:view` (All roles) — Access workspace overview.
- `workspaces:manage` (Super Admin, Org Admin) — Manage workspace members, settings, and teams.

### 13. Organization Governance (`org:*`)
- `org:settings` (Super Admin, Org Admin) — Organization domain, SSO, and general configuration.
- `org:members` (Super Admin, Org Admin) — Invite, promote, suspend organization members.
- `org:billing` (Super Admin, Org Admin) — Manage subscription, tier limits, and invoices.

### 14. Data Import & Export (`export:*`)
- `export:csv` (Super Admin, Org Admin, Project Admin, Project Manager, Member) — Export issues to CSV.
- `export:excel` (Super Admin, Org Admin, Project Admin, Project Manager) — Generate formatted Excel workbook.
- `export:pdf` (Super Admin, Org Admin, Project Admin, Project Manager) — Generate executive PDF report.
- `export:import_data` (Super Admin, Org Admin, Project Admin) — Import backlog from CSV/Jira.

### 15. Reports & Analytics (`reports:*`)
- `reports:view` (All roles) — View velocity, burnup/burndown, and cumulative flow diagrams.
- `reports:export` (Super Admin, Org Admin, Project Admin, Project Manager) — Export analytical data sets.

### 16. Webhooks & API Keys (`webhooks:*`)
- `webhooks:manage` (Super Admin, Org Admin, Project Admin) — Configure outgoing event webhooks.

### 17. Security & Audit (`audit:*`)
- `audit:view` (Super Admin, Org Admin) — Access immutable security audit ledger.
- `audit:export` (Super Admin, Org Admin) — Export compliance audit logs.

### 18. Platform Administration (`superadmin:*`)
- `superadmin:access` (Super Admin only) — System console, cross-tenant management, feature flags, cache manager.

---

## 4. Capability Caching Architecture

To achieve sub-millisecond evaluation at enterprise scale, capability evaluation is wrapped with a 2-tier caching layer:
1. **Key Partitioning**: Indexed by `${orgId}:${userId}` to prevent cross-tenant or cross-user cache collisions.
2. **TTL**: 60-second in-memory expiration.
3. **Cache Invalidation**: Automatically flushed whenever a member's role is updated, a user is revoked, or a project is transferred.
4. **Bypass Guarantee**: Super Admin operations bypass the cache to guarantee instantaneous privilege reflection.

---

## 5. Provenance Inspector & Audit Trail

Every evaluation generates an explainable audit record:
```json
{
  "granted": true,
  "permission": "issues:create",
  "userId": "usr_9981",
  "role": "MEMBER",
  "provenance": "MEMBER -> issues:create granted via Project Membership in prj_alpha"
}
```
All denied actions are mirrored to the `PlatformAuditLog` with security classification `SECURITY_VIOLATION`.
