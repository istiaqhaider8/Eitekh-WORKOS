import { prisma } from './prisma';
import { logger } from './logger';
import { logAuditEvent } from './audit-logger';
import { pbacStore, type StoredRole } from './pbac-store';

export interface PermissionItem {
  key: string;
  label: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface PermissionCategory {
  id: string;
  name: string;
  description: string;
  permissions: PermissionItem[];
}

// 18 Canonical Permission Modules (SRS §PBAC)
export const PBAC_PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: 'projects',
    name: '1. PROJECT (Projects & Workspaces)',
    description: 'Control project workspace creation, architecture layout, settings and lifecycle.',
    permissions: [
      { key: 'projects:view', label: 'View Projects', description: 'Browse and view project details', riskLevel: 'LOW' },
      { key: 'projects:create', label: 'Create Projects', description: 'Create new project boards and workspaces', riskLevel: 'MEDIUM' },
      { key: 'projects:edit', label: 'Edit Projects', description: 'Modify project configurations and metadata', riskLevel: 'MEDIUM' },
      { key: 'projects:manage_members', label: 'Manage Members & Access', description: 'Assign project members, manage access roles, and invite users to project', riskLevel: 'CRITICAL' },
      { key: 'projects:archive', label: 'Archive Projects', description: 'Archive inactive projects', riskLevel: 'HIGH' },
      { key: 'projects:delete', label: 'Delete Projects', description: 'Permanently remove projects and boards', riskLevel: 'CRITICAL' },
    ],
  },
  {
    id: 'issues',
    name: '2. ISSUES (Issues & Work Items)',
    description: 'Create, modify, transition and manage issues, bugs, tasks, and stories.',
    permissions: [
      { key: 'issues:view', label: 'View Issues', description: 'Read issue details, descriptions and history', riskLevel: 'LOW' },
      { key: 'issues:create', label: 'Create Issues', description: 'File new tasks, bugs, and stories', riskLevel: 'LOW' },
      { key: 'issues:edit', label: 'Edit Issues', description: 'Update issue title, description, priority', riskLevel: 'LOW' },
      { key: 'issues:transition', label: 'Transition Status', description: 'Move issues through workflow states', riskLevel: 'LOW' },
      { key: 'issues:assign', label: 'Assign Issues', description: 'Reassign issues to team members', riskLevel: 'LOW' },
      { key: 'issues:comment', label: 'Comment on Issues', description: 'Post comments and @mention teammates', riskLevel: 'LOW' },
      { key: 'issues:bulk_edit', label: 'Bulk Edit Issues', description: 'Batch update multiple issues at once', riskLevel: 'HIGH' },
      { key: 'issues:delete', label: 'Delete Issues', description: 'Permanently remove issues from project', riskLevel: 'HIGH' },
    ],
  },
  {
    id: 'tasks',
    name: '3. TASKS (Subtasks & Checklists)',
    description: 'Granular subtask breakdowns and checklist action items.',
    permissions: [
      { key: 'tasks:view', label: 'View Subtasks', description: 'View checklist subtasks', riskLevel: 'LOW' },
      { key: 'tasks:create', label: 'Create Subtasks', description: 'Add subtasks to parent issues', riskLevel: 'LOW' },
      { key: 'tasks:edit', label: 'Edit Subtasks', description: 'Update subtasks and mark done', riskLevel: 'LOW' },
      { key: 'tasks:delete', label: 'Delete Subtasks', description: 'Delete subtasks from issues', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'epics',
    name: '4. EPICS (Roadmaps & Milestones)',
    description: 'High-level initiatives, quarterly milestones and epic management.',
    permissions: [
      { key: 'epics:view', label: 'View Epics', description: 'Explore epics and roadmap milestones', riskLevel: 'LOW' },
      { key: 'epics:create', label: 'Create Epics', description: 'Define new roadmap epics', riskLevel: 'MEDIUM' },
      { key: 'epics:edit', label: 'Edit Epics', description: 'Modify epic targets and scopes', riskLevel: 'MEDIUM' },
      { key: 'epics:delete', label: 'Delete Epics', description: 'Delete epics from roadmap', riskLevel: 'HIGH' },
    ],
  },
  {
    id: 'sprints',
    name: '5. SPRINTS (Agile Iterations)',
    description: 'Agile sprint planning, starting, completing and burndown tracking.',
    permissions: [
      { key: 'sprints:view', label: 'View Sprints', description: 'Inspect active and future sprint rosters', riskLevel: 'LOW' },
      { key: 'sprints:create', label: 'Create Sprints', description: 'Plan upcoming sprint cycles', riskLevel: 'MEDIUM' },
      { key: 'sprints:start', label: 'Start Sprints', description: 'Launch active sprint cycles', riskLevel: 'MEDIUM' },
      { key: 'sprints:complete', label: 'Complete Sprints', description: 'Close sprints and rollover tasks', riskLevel: 'HIGH' },
      { key: 'sprints:delete', label: 'Delete Sprints', description: 'Delete planned or abandoned sprints', riskLevel: 'HIGH' },
    ],
  },
  {
    id: 'backlog',
    name: '6. BACKLOG (Backlog & Grooming)',
    description: 'Backlog grooming, story point estimation and priority reordering.',
    permissions: [
      { key: 'backlog:view', label: 'View Backlog', description: 'Inspect product backlog items', riskLevel: 'LOW' },
      { key: 'backlog:groom', label: 'Groom Backlog', description: 'Prioritize and organize backlog', riskLevel: 'LOW' },
      { key: 'backlog:estimate', label: 'Estimate Story Points', description: 'Provide story points or hour estimates', riskLevel: 'LOW' },
    ],
  },
  {
    id: 'kanban',
    name: '7. KANBAN (Board & WIP Limits)',
    description: 'Interactive Kanban board views, column WIP thresholds, and lane rules.',
    permissions: [
      { key: 'kanban:view', label: 'View Kanban Board', description: 'View Kanban board and card lanes', riskLevel: 'LOW' },
      { key: 'kanban:configure_columns', label: 'Configure Columns', description: 'Customize board columns and states', riskLevel: 'MEDIUM' },
      { key: 'kanban:manage_wip', label: 'Manage WIP Limits', description: 'Enforce WIP limits per column', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'list',
    name: '8. LIST (List & Grid Views)',
    description: 'List view filtering, column sorting, inline updates, and custom views.',
    permissions: [
      { key: 'list:view', label: 'View List', description: 'Browse issues in table list view', riskLevel: 'LOW' },
      { key: 'list:customize_views', label: 'Customize Views', description: 'Save custom view column layouts and filters', riskLevel: 'LOW' },
      { key: 'list:export_view', label: 'Export Current View', description: 'Quick export active list view', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'calendar',
    name: '9. CALENDAR (Milestones & Schedules)',
    description: 'Calendar view planning, due date alignments and scheduling.',
    permissions: [
      { key: 'calendar:view', label: 'View Calendar', description: 'View calendar schedules and milestones', riskLevel: 'LOW' },
      { key: 'calendar:reschedule', label: 'Reschedule Dates', description: 'Drag-drop adjust due dates on calendar', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'timeline',
    name: '10. TIMELINE (Gantt & Dependencies)',
    description: 'Gantt chart execution, critical path and dependency links.',
    permissions: [
      { key: 'timeline:view', label: 'View Timeline', description: 'Inspect Gantt timeline and milestones', riskLevel: 'LOW' },
      { key: 'timeline:manage_deps', label: 'Manage Dependencies', description: 'Link blocking and finish-to-start dependencies', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'workload',
    name: '11. WORKLOAD (Resource Allocation)',
    description: 'Capacity balancing, team utilization and workload distribution charts.',
    permissions: [
      { key: 'workload:view', label: 'View Workload', description: 'View team capacity distribution', riskLevel: 'LOW' },
      { key: 'workload:balance', label: 'Rebalance Workload', description: 'Reassign tasks to optimize capacity', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'reports',
    name: '12. REPORTS (Executive Summaries)',
    description: 'Generate sprint retrospectives, SLA compliance and executive summaries.',
    permissions: [
      { key: 'reports:view', label: 'View Reports', description: 'Read generated project reports', riskLevel: 'LOW' },
      { key: 'reports:generate', label: 'Generate Reports', description: 'Generate automated project reports', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'analytics',
    name: '13. ANALYTICS (Telemetry & Insights)',
    description: 'Velocity trends, CFD diagrams, cycle time and KPI widgets.',
    permissions: [
      { key: 'analytics:view', label: 'View Analytics', description: 'Inspect project analytics dashboards', riskLevel: 'LOW' },
      { key: 'analytics:configure', label: 'Configure Analytics', description: 'Customize metric charts and goals', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'teams',
    name: '14. TEAMS (Team Rosters & Leads)',
    description: 'Manage cross-functional squads, assign leads and roster members.',
    permissions: [
      { key: 'teams:view', label: 'View Teams', description: 'View squads and member allocations', riskLevel: 'LOW' },
      { key: 'teams:manage', label: 'Manage Teams', description: 'Create squads, add members, assign leads', riskLevel: 'MEDIUM' },
    ],
  },
  {
    id: 'users',
    name: '15. USERS (Identity & Membership)',
    description: 'Directory inspection, profile administration and membership status.',
    permissions: [
      { key: 'users:view', label: 'View Users', description: 'Search and inspect user directory', riskLevel: 'LOW' },
      { key: 'users:manage', label: 'Manage Users', description: 'Invite, edit, or suspend users', riskLevel: 'CRITICAL' },
    ],
  },
  {
    id: 'settings',
    name: '16. SETTINGS (Workflows & Automations)',
    description: 'Custom fields, workflow statuses, automations, and webhooks.',
    permissions: [
      { key: 'settings:view', label: 'View Settings', description: 'Inspect project settings', riskLevel: 'LOW' },
      { key: 'settings:workflows', label: 'Manage Workflows', description: 'Create and edit custom workflow states', riskLevel: 'HIGH' },
      { key: 'settings:custom_fields', label: 'Manage Custom Fields', description: 'Create and configure schema custom fields', riskLevel: 'HIGH' },
      { key: 'settings:automations', label: 'Manage Automations', description: 'Create automation trigger-action rules', riskLevel: 'HIGH' },
    ],
  },
  {
    id: 'audit',
    name: '17. AUDIT (Ledger & Governance)',
    description: 'Inspect permission matrices, run provenance checks and audit logs.',
    permissions: [
      { key: 'audit:view', label: 'View Audit Logs', description: 'Read platform and project audit ledger', riskLevel: 'MEDIUM' },
      { key: 'audit:inspect_access', label: 'Inspect Access Provenance', description: 'Inspect "Why access is granted" traces', riskLevel: 'HIGH' },
    ],
  },
  {
    id: 'export',
    name: '18. EXPORT (Data Portability)',
    description: 'Export CSV, Excel, PDF reports, and import external issue trackers.',
    permissions: [
      { key: 'export:csv', label: 'Export CSV Data', description: 'Download CSV datasets and reports', riskLevel: 'MEDIUM' },
      { key: 'export:excel', label: 'Export Excel Data', description: 'Download Excel-compatible spreadsheets', riskLevel: 'MEDIUM' },
      { key: 'export:pdf', label: 'Export PDF Reports', description: 'Download formatted PDF summaries', riskLevel: 'MEDIUM' },
      { key: 'export:import_data', label: 'Import External Data', description: 'Import issues from CSV or external tools', riskLevel: 'HIGH' },
    ],
  },
];

export const ALL_PBAC_PERMISSION_KEYS = PBAC_PERMISSION_CATEGORIES.flatMap((c) =>
  c.permissions.map((p) => p.key)
);

export const HIGH_RISK_PERMISSIONS = PBAC_PERMISSION_CATEGORIES.flatMap((c) =>
  c.permissions.filter((p) => p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL').map((p) => p.key)
);

// VIEWER-level permissions: the baseline for users without any assigned PBAC role.
// Only Super Admin can bypass permission restrictions. All other users without
// explicit role assignments are restricted to these read-only capabilities.
export const VIEWER_PERMISSION_KEYS = [
  'projects:view',
  'issues:view',
  'tasks:view',
  'epics:view',
  'sprints:view',
  'backlog:view',
  'kanban:view',
  'list:view',
  'calendar:view',
  'timeline:view',
  'workload:view',
  'reports:view',
  'analytics:view',
];

// Role hierarchy: higher number = more privilege. Used to prevent escalation.
const ROLE_HIERARCHY: Record<string, number> = {
  'viewer': 10,
  'member': 20,
  'project-manager': 30,
  'project-admin': 40,
  'org-admin': 50,
  'super-admin': 60,
};

function getRoleLevel(slug: string): number {
  return ROLE_HIERARCHY[slug] ?? 0;
}

export interface PBACRole {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  scope: 'PROJECT' | 'WORKSPACE' | 'ORG';
  projectId?: string | null;
  projectName?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  permissions: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PBACAuditRecord {
  id: string;
  orgId: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entityType: 'ROLE' | 'USER_ROLE' | 'SYSTEM';
  entityId: string;
  entityName?: string;
  previousState?: any;
  newState?: any;
  status: 'SUCCESS' | 'FAILURE';
  errorDetails?: string;
  createdAt: string;
}

class UnifiedPBACEngine {
  private roles: Map<string, PBACRole> = new Map();
  /**
   * Organizations confirmed to exist, so the existence check in
   * ensureOrgSeeded() costs one query per org per process rather than one per
   * call — ensureOrgSeeded runs on nearly every PBAC operation.
   */
  private verifiedOrgIds: Set<string> = new Set();
  // Map of userId -> Set of roleIds
  private userRoleAssignments: Map<string, Set<string>> = new Map();
  // Audit records are written straight to the database (PROD-3). This array is
  // no longer the source of truth and is kept only as a small in-process buffer
  // for the handful of callers that read it synchronously.
  private auditLogs: PBACAuditRecord[] = [];
  private initializedOrgs: Set<string> = new Set();
  // High-throughput In-Memory Capability Cache for scale (100k+ users)
  private capabilityCache: Map<string, { permissions: Set<string>; roles: Array<{ id: string; name: string; isSystem: boolean }>; timestamp: number }> = new Map();

  // Returns the highest role hierarchy level the actor holds in the given org.
  public getActorLevel(orgId: string, actorId: string, isSuperAdmin?: boolean): number {
    if (isSuperAdmin) return ROLE_HIERARCHY['super-admin'];
    const roleIds = this.userRoleAssignments.get(actorId);
    if (!roleIds) return 0;
    let max = 0;
    for (const rId of roleIds) {
      const r = this.roles.get(rId);
      if (r && r.orgId === orgId && r.status === 'ACTIVE') {
        const level = getRoleLevel(r.slug);
        if (level > max) max = level;
      }
    }
    return max;
  }

  // Throws if actor tries to assign a role at or above their own level.
  private enforceHierarchy(orgId: string, actorId: string, targetRoleId: string, isSuperAdmin?: boolean): void {
    if (isSuperAdmin) return;
    const targetRole = this.roles.get(targetRoleId);
    if (!targetRole) return;
    const actorLevel = this.getActorLevel(orgId, actorId, isSuperAdmin);
    const targetLevel = getRoleLevel(targetRole.slug);
    if (targetLevel >= actorLevel) {
      throw new Error(
        `Privilege escalation denied: you cannot assign the '${targetRole.name}' role (requires higher authority)`
      );
    }
  }

  /**
   * Invalidate an organization's derived permissions EVERYWHERE, not just here
   * (PROD-3).
   *
   * `invalidateUserCache` below clears only the calling process. That is why
   * the admin panel's "refresh cache" button used to affect nothing but the
   * one instance that happened to serve the click — on every other instance
   * the stale permissions survived. Bumping the shared version makes every
   * instance reload on its next check, and makes every capability-cache key
   * computed from the old model unreachable.
   */
  public async invalidateOrgAcrossInstances(orgId: string): Promise<void> {
    if (!orgId) {
      this.invalidateUserCache();
      return;
    }
    await pbacStore.bumpVersion(orgId);
    this.loadedOrgVersions.delete(orgId);
    this.invalidateUserCache();
  }

  public invalidateUserCache(userId?: string) {
    if (userId) {
      for (const key of this.capabilityCache.keys()) {
        if (key === userId || key.endsWith(`:${userId}`) || key.includes(userId)) {
          this.capabilityCache.delete(key);
        }
      }
    } else {
      this.capabilityCache.clear();
    }
  }

  constructor() {
    // Nothing to load here any more (PROD-3). The authorization model lives in
    // Postgres and is loaded per organization, on demand, by ensureOrgLoaded().
    // The constructor used to read `.data/pbac-store.json` synchronously, which
    // is what made every instance's permission model its own.
  }

  /**
   * Which role ids belong to which organization, as this process last saw it.
   *
   * Needed because `userRoleAssignments` is keyed by user across all
   * organizations: to refresh one org's assignments without disturbing another
   * org's, the reload has to know which ids it owns.
   */
  private orgRoleIds: Map<string, Set<string>> = new Map();

  /** orgId -> the model version this process currently holds. */
  private loadedOrgVersions: Map<string, number> = new Map();

  /** In-flight loads, so concurrent requests do not each issue the same query. */
  private inFlightLoads: Map<string, Promise<void>> = new Map();

  /**
   * Make sure this process holds a current copy of an organization's model.
   *
   * Reloads when the shared version has moved, which is how a role change on
   * one instance reaches the others. `pbacStore.getVersion` only touches the
   * database every PBAC_VERSION_POLL_MS, so calling this on the read path is
   * cheap; between checks it is an in-memory comparison.
   */
  private async ensureOrgLoaded(orgId: string, force = false): Promise<void> {
    if (!orgId) return;

    const loaded = this.loadedOrgVersions.get(orgId);
    if (!force && loaded !== undefined) {
      const current = await pbacStore.getVersion(orgId);
      if (current === loaded) return;
    }

    const existing = this.inFlightLoads.get(orgId);
    if (existing) return existing;

    const load = (async () => {
      try {
        const snapshot = await pbacStore.loadOrg(orgId);

        // Replace only this organization's roles. Ids that have gone away are
        // dropped, which is the point: a role deleted on another instance must
        // stop existing here too.
        const previousIds = this.orgRoleIds.get(orgId) ?? new Set<string>();
        const nextIds = new Set(snapshot.roles.map((r) => r.id));
        for (const id of previousIds) {
          if (!nextIds.has(id)) this.roles.delete(id);
        }
        for (const role of snapshot.roles) {
          this.roles.set(role.id, role as PBACRole);
        }
        this.orgRoleIds.set(orgId, nextIds);

        // Same for assignments: strip every grant that belongs to this org,
        // then apply the snapshot. Grants from other organizations are left
        // untouched, so a user who belongs to two tenants keeps both.
        const ownedIds = new Set<string>([...previousIds, ...nextIds]);
        for (const [, roleSet] of this.userRoleAssignments) {
          for (const id of ownedIds) roleSet.delete(id);
        }
        for (const [userId, roleIds] of snapshot.assignments) {
          let set = this.userRoleAssignments.get(userId);
          if (!set) {
            set = new Set<string>();
            this.userRoleAssignments.set(userId, set);
          }
          for (const id of roleIds) set.add(id);
        }

        if (snapshot.seeded) this.initializedOrgs.add(orgId);
        this.loadedOrgVersions.set(orgId, snapshot.version);

        // Anything computed from the previous model is now suspect.
        this.invalidateUserCache();
      } catch (e) {
        logger.error('PBAC_LOAD_FAILED', `Could not load the PBAC model for org ${orgId}`, e, { orgId });
        throw e;
      } finally {
        this.inFlightLoads.delete(orgId);
      }
    })();

    this.inFlightLoads.set(orgId, load);
    return load;
  }

  /**
   * Record that this process's copy of an org is current as of the version its
   * own write just produced, and drop derived caches.
   *
   * Called after every mutation. Without it the writer would keep serving the
   * pre-write model until its next version poll — it would be the last to see
   * its own change.
   */
  private async afterMutation(orgId: string): Promise<void> {
    if (!orgId) return;
    const version = await pbacStore.getVersion(orgId, true);
    this.loadedOrgVersions.set(orgId, version);
    this.invalidateUserCache();
  }

  /** Convert the engine's role shape to the store's. They are structurally the same. */
  private toStored(role: PBACRole): StoredRole {
    return role as StoredRole;
  }

  public async ensureOrgSeeded(orgId: string) {
    // Pull this organization's model, reloading if another instance has
    // changed it. Replaces the synchronous read of .data/pbac-store.json.
    await this.ensureOrgLoaded(orgId);

    // Refuse to provision a tenant that does not exist.
    //
    // This method used to seed a full system role set for ANY string it was
    // handed. Combined with callers that defaulted a missing orgId to the
    // literal 'default-org', that quietly created role sets for tenants that
    // had never existed — the store had accumulated 79 roles across 13 "orgs"
    // when only one was real, and a stale role whose id and orgId disagreed
    // was surfacing in the roles UI as a duplicate MEMBER entry.
    //
    // Seeding is now gated on the organization actually being present, so a
    // stray or deleted orgId yields no roles rather than inventing them.
    if (!orgId) return;
    if (!this.verifiedOrgIds.has(orgId)) {
      try {
        const org = await prisma.organization.findUnique({
          where: { id: orgId },
          select: { id: true },
        });
        if (!org) {
          logger.warn(
            'PBAC_SEED_SKIPPED_UNKNOWN_ORG',
            `Refused to seed PBAC roles for an organization that does not exist: ${orgId}`,
            { orgId }
          );
          return;
        }
        this.verifiedOrgIds.add(orgId);
      } catch (e) {
        // If the lookup itself fails, do not guess — seeding on a failed check
        // is what allowed phantom tenants to be created.
        console.error('PBAC: organization existence check failed for', orgId, e);
        return;
      }
    }

    const isOrgInitialized = this.initializedOrgs.has(orgId);
    this.initializedOrgs.add(orgId);

    const now = new Date().toISOString();

    const defaultRoles: Array<Omit<PBACRole, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>> = [
      {
        name: 'Super Admin',
        slug: 'super-admin',
        description: 'Unrestricted platform & tenant administrative authority across all organizations, workspaces, and projects.',
        scope: 'ORG',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        createdBy: 'System Provisioning',
        permissions: [...ALL_PBAC_PERMISSION_KEYS],
      },
      {
        name: 'Organization ADMIN',
        slug: 'org-admin',
        description: 'Organization-wide governance, workspace provisioning, project architecture, member directory, audit, and settings.',
        scope: 'ORG',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        createdBy: 'System Provisioning',
        permissions: [...ALL_PBAC_PERMISSION_KEYS],
      },
      {
        name: 'PROJECT ADMIN',
        slug: 'project-admin',
        description: 'Full administrative control over project scope, workflows, settings, WIP limits, sprints, and team access.',
        scope: 'PROJECT',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        createdBy: 'System Provisioning',
        permissions: [
          // projects:create is what gates "New Project" in the sidebar. A Project
          // Admin is one of the four roles permitted to provision a project, so
          // the permission has to be held rather than inferred from membership.
          'projects:view', 'projects:create', 'projects:edit', 'projects:manage_members', 'projects:archive',
          'issues:view', 'issues:create', 'issues:edit', 'issues:transition', 'issues:assign', 'issues:comment', 'issues:bulk_edit', 'issues:delete',
          'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete',
          'epics:view', 'epics:create', 'epics:edit', 'epics:delete',
          'sprints:view', 'sprints:create', 'sprints:start', 'sprints:complete', 'sprints:delete',
          'backlog:view', 'backlog:groom', 'backlog:estimate',
          'kanban:view', 'kanban:configure_columns', 'kanban:manage_wip',
          'list:view', 'list:customize_views', 'list:export_view',
          'calendar:view', 'calendar:reschedule',
          'timeline:view', 'timeline:manage_deps',
          'workload:view', 'workload:balance',
          'reports:view', 'reports:generate',
          'analytics:view', 'analytics:configure',
          'teams:view', 'teams:manage',
          'users:view',
          'settings:view', 'settings:workflows', 'settings:custom_fields', 'settings:automations',
          'audit:view', 'audit:inspect_access',
          'export:csv', 'export:excel', 'export:pdf', 'export:import_data'
        ],
      },
      {
        name: 'PROJECT MANAGER',
        slug: 'project-manager',
        description: 'Leads roadmap initiatives, product backlogs, epic definitions, sprint planning, and release reports.',
        scope: 'PROJECT',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        createdBy: 'System Provisioning',
        permissions: [
          // A Project Manager is one of the four roles permitted to use New
          // Project, Assign, Project Settings, Bulk Upload and Teams, so it holds
          // the five permissions those actions are gated on:
          // projects:create, projects:edit, projects:manage_members,
          // teams:manage and export:import_data. Without them the role could see
          // the controls only if the UI gate disagreed with the API gate, which
          // is the bypass this set exists to prevent.
          'projects:view', 'projects:create', 'projects:edit', 'projects:manage_members',
          'issues:view', 'issues:create', 'issues:edit', 'issues:transition', 'issues:assign', 'issues:comment', 'issues:bulk_edit',
          'tasks:view', 'tasks:create', 'tasks:edit',
          'epics:view', 'epics:create', 'epics:edit',
          'sprints:view', 'sprints:create', 'sprints:start', 'sprints:complete',
          'backlog:view', 'backlog:groom', 'backlog:estimate',
          'kanban:view', 'kanban:manage_wip',
          'list:view', 'list:customize_views', 'list:export_view',
          'calendar:view', 'calendar:reschedule',
          'timeline:view', 'timeline:manage_deps',
          'workload:view', 'workload:balance',
          'reports:view', 'reports:generate',
          'analytics:view',
          'teams:view', 'teams:manage',
          'users:view',
          'export:csv', 'export:excel', 'export:pdf', 'export:import_data'
        ],
      },
      {
        name: 'MEMBER',
        slug: 'member',
        description: 'Core team contributor with capabilities to create, edit assigned work items, log subtasks, transition statuses, and collaborate.',
        scope: 'PROJECT',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        createdBy: 'System Provisioning',
        permissions: [
          'projects:view',
          'issues:view', 'issues:create', 'issues:edit', 'issues:transition', 'issues:assign', 'issues:comment',
          'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete',
          'epics:view',
          'sprints:view',
          'backlog:view', 'backlog:estimate',
          'kanban:view',
          'list:view',
          'calendar:view',
          'timeline:view',
          'workload:view',
          'reports:view',
          'analytics:view',
          'teams:view',
          'export:csv'
        ],
      },
      {
        name: 'VIEWER',
        slug: 'viewer',
        description: 'Read-only stakeholder visibility across boards, backlogs, sprints, timelines, calendars, reports, and analytics dashboards.',
        scope: 'PROJECT',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        createdBy: 'System Provisioning',
        permissions: [
          'projects:view',
          'issues:view',
          'tasks:view',
          'epics:view',
          'sprints:view',
          'backlog:view',
          'kanban:view',
          'list:view',
          'calendar:view',
          'timeline:view',
          'workload:view',
          'reports:view',
          'analytics:view'
        ],
      },
    ];

    let storeUpdated = false;

    for (const r of defaultRoles) {
      const id = `role_${orgId}_${r.slug}`;
      const existingRole = this.roles.get(id);
      if (!existingRole) {
        this.roles.set(id, {
          ...r,
          id,
          orgId,
          createdAt: now,
          updatedAt: now,
        });
        storeUpdated = true;
      } else if (existingRole.isSystem) {
        const mergedPerms = Array.from(new Set([...existingRole.permissions, ...r.permissions]));
        if (mergedPerms.length > existingRole.permissions.length || (r.slug === 'super-admin' && existingRole.permissions.length !== r.permissions.length)) {
          existingRole.permissions = r.permissions;
          storeUpdated = true;
        }
      }
    }

    // Ensure platform super admins always hold the super-admin role for THIS org.
    // This runs on every ensureOrgSeeded() call (not gated by !isOrgInitialized)
    // so that super admins added after the org was first initialized are still covered.
    try {
      const superAdminRoleId = `role_${orgId}_super-admin`;
      const orgAdminRoleId = `role_${orgId}_org-admin`;
      const projectAdminRoleId = `role_${orgId}_project-admin`;

      const superAdminUsers = await prisma.user.findMany({
        where: { isSuperAdmin: true },
        select: { id: true },
      });

      for (const u of superAdminUsers) {
        if (!this.userRoleAssignments.has(u.id)) {
          this.userRoleAssignments.set(u.id, new Set<string>());
        }
        const userRoles = this.userRoleAssignments.get(u.id)!;
        if (!userRoles.has(superAdminRoleId)) {
          userRoles.add(superAdminRoleId);
          userRoles.add(orgAdminRoleId);
          userRoles.add(projectAdminRoleId);
          storeUpdated = true;
        }
      }
    } catch (e) {
      console.error('Error ensuring super admin roles:', e);
    }

    if (!isOrgInitialized) {
      // Seed initial role assignments for non-super-admin users
      try {
        const existingUsers = await prisma.user.findMany({
          where: { isSuperAdmin: false },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
          },
        });

        const memberRoleId = `role_${orgId}_member`;

        for (const u of existingUsers) {
          if (!this.userRoleAssignments.has(u.id)) {
            this.userRoleAssignments.set(u.id, new Set<string>());
          }
          const userRoles = this.userRoleAssignments.get(u.id)!;
          if (userRoles.size === 0) {
            userRoles.add(memberRoleId);
          }
        }
      } catch (e) {
        console.error('Error seeding initial user roles', e);
      }
      storeUpdated = true;
    }

    if (storeUpdated) {
      // Persist the seeded model for this organization. Roles and grants are
      // written per entity, so a concurrent seed on another instance converges
      // rather than clobbering.
      const orgRoles = Array.from(this.roles.values()).filter((r) => r.orgId === orgId);
      await pbacStore.upsertRoles(orgRoles.map((r) => this.toStored(r)));

      const orgRoleIdSet = new Set(orgRoles.map((r) => r.id));
      const pairs: Array<{ userId: string; roleId: string }> = [];
      for (const [userId, roleSet] of this.userRoleAssignments) {
        for (const roleId of roleSet) {
          if (orgRoleIdSet.has(roleId)) pairs.push({ userId, roleId });
        }
      }
      await pbacStore.addAssignments(orgId, pairs);
      await pbacStore.markSeeded(orgId);
      await this.afterMutation(orgId);
    }
  }

  // Audit Logging
  public recordAudit(record: Omit<PBACAuditRecord, 'id' | 'createdAt'>) {
    const log: PBACAuditRecord = {
      ...record,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 2000) {
      this.auditLogs = this.auditLogs.slice(0, 2000);
    }
    // The durable copy. The in-process array above is now only a buffer: the
    // old 2000-entry ring inside a JSON file meant the record of who changed
    // permissions was both lossy and per-instance.
    void pbacStore.recordAudit(log);

    // Mirror to PlatformAuditLog database table for super-admin compliance & unified ledger
    try {
      const isCritical = record.action.includes('DELETE') || record.action.includes('REVOKE');
      const isNotice = record.action.includes('UPDATE') || record.action.includes('CLONE') || record.action.includes('ASSIGN');
      logAuditEvent({
        actorId: record.actorId || 'system',
        actorName: record.actorName,
        actorEmail: record.actorEmail,
        action: record.action,
        category: 'PBAC',
        severity: isCritical ? 'CRITICAL' : isNotice ? 'NOTICE' : 'INFO',
        status: record.status || 'SUCCESS',
        targetResource: `${record.entityType}:${record.entityName || record.entityId}`,
        orgId: record.orgId,
        previousState: record.previousState,
        newState: record.newState,
        details: {
          entityType: record.entityType,
          entityId: record.entityId,
          entityName: record.entityName,
          errorDetails: record.errorDetails,
        },
      }).catch((err) => console.error('Failed to write PBAC audit log to PlatformAuditLog:', err));
    } catch (e) {
      // Fire-and-forget
    }
  }

  // Role Management
  public async getRoles(orgId: string, projectId?: string) {
    await this.ensureOrgSeeded(orgId);
    let orgRoles = Array.from(this.roles.values()).filter((r) => r.orgId === orgId);

    if (projectId && projectId !== 'ALL' && projectId !== 'all') {
      orgRoles = orgRoles.filter((r) => !r.projectId || r.projectId === projectId);
    }

    // Calculate assigned user counts
    return orgRoles.map((r) => {
      let assignedCount = 0;
      for (const [userId, roleSet] of this.userRoleAssignments.entries()) {
        if (roleSet.has(r.id)) {
          assignedCount++;
        }
      }

      return {
        ...r,
        assignedUserCount: assignedCount,
        permissionCount: r.permissions.length,
      };
    });
  }

  public async getRole(orgId: string, roleId: string) {
    await this.ensureOrgSeeded(orgId);
    const role = this.roles.get(roleId);
    if (!role || role.orgId !== orgId) return null;

    const assignedUserIds: string[] = [];
    for (const [userId, roleSet] of this.userRoleAssignments.entries()) {
      if (roleSet.has(role.id)) {
        assignedUserIds.push(userId);
      }
    }

    const assignedUsers = await prisma.user.findMany({
      where: { id: { in: assignedUserIds } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        jobTitle: true,
        company: true,
        status: true,
      },
    });

    return {
      ...role,
      assignedUserCount: assignedUsers.length,
      assignedUsers,
      permissionCount: role.permissions.length,
    };
  }

  public async saveRole(
    orgId: string,
    data: {
      id?: string;
      name: string;
      description?: string;
      scope?: 'PROJECT' | 'WORKSPACE' | 'ORG';
      projectId?: string | null;
      projectName?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
      permissions: string[];
    },
    actor?: { id: string; name: string; email: string }
  ): Promise<PBACRole> {
    await this.ensureOrgSeeded(orgId);

    if (actor) {
      const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const roleLevel = getRoleLevel(slug);
      const actorLevel = this.getActorLevel(orgId, actor.id);
      if (roleLevel >= actorLevel) {
        throw new Error(
          `Privilege escalation denied: you cannot create or edit the '${data.name}' role (requires higher authority)`
        );
      }
      const actorPerms = await this.getUserCapabilities(orgId, actor.id);
      for (const p of data.permissions) {
        if (!actorPerms.has(p)) {
          throw new Error(`Cannot grant permission '${p}' that you do not hold`);
        }
      }
    }

    const now = new Date().toISOString();
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = data.id || `role_${orgId}_${slug}_${Date.now()}`;

    const existing = this.roles.get(id);
    const role: PBACRole = {
      id,
      orgId,
      name: data.name,
      slug: existing?.slug || slug,
      description: data.description || '',
      scope: data.scope || 'PROJECT',
      projectId: data.projectId !== undefined ? data.projectId : existing?.projectId || null,
      projectName: data.projectName !== undefined ? data.projectName : existing?.projectName || null,
      status: data.status || existing?.status || 'ACTIVE',
      isSystem: existing?.isSystem || false,
      permissions: Array.from(new Set(data.permissions)),
      createdBy: existing?.createdBy || actor?.name || 'Administrator',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.roles.set(id, role);
    await pbacStore.upsertRole(this.toStored(role));
    await this.afterMutation(orgId);

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: data.id ? 'ROLE_UPDATED' : 'ROLE_CREATED',
      entityType: 'ROLE',
      entityId: id,
      entityName: role.name,
      previousState: existing || null,
      newState: role,
      status: 'SUCCESS',
    });

    return role;
  }

  public async cloneRole(
    orgId: string,
    sourceRoleId: string,
    newData: {
      name: string;
      description?: string;
      permissions?: string[];
      projectId?: string | null;
      projectName?: string | null;
    },
    actor?: { id: string; name: string; email: string }
  ): Promise<PBACRole> {
    await this.ensureOrgSeeded(orgId);
    const source = this.roles.get(sourceRoleId);
    if (!source) throw new Error('Source role not found');

    if (actor) {
      this.enforceHierarchy(orgId, actor.id, sourceRoleId);
      const finalPermissions = newData.permissions ? Array.from(new Set(newData.permissions)) : [...source.permissions];
      const actorPerms = await this.getUserCapabilities(orgId, actor.id);
      for (const p of finalPermissions) {
        if (!actorPerms.has(p)) {
          throw new Error(`Cannot grant permission '${p}' that you do not hold`);
        }
      }
    }

    const now = new Date().toISOString();
    const slug = newData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = `role_${orgId}_${slug}_${Date.now()}`;

    const cloned: PBACRole = {
      id,
      orgId,
      name: newData.name,
      slug,
      description: newData.description || `Cloned from ${source.name}`,
      scope: source.scope,
      projectId: newData.projectId !== undefined ? newData.projectId : source.projectId || null,
      projectName: newData.projectName !== undefined ? newData.projectName : source.projectName || null,
      status: 'ACTIVE',
      isSystem: false,
      permissions: newData.permissions ? Array.from(new Set(newData.permissions)) : [...source.permissions],
      createdBy: actor?.name || 'Administrator',
      createdAt: now,
      updatedAt: now,
    };

    this.roles.set(id, cloned);
    await pbacStore.upsertRole(this.toStored(cloned));
    await this.afterMutation(orgId);

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'ROLE_CLONED',
      entityType: 'ROLE',
      entityId: id,
      entityName: cloned.name,
      previousState: { sourceRoleId: source.id, sourceRoleName: source.name },
      newState: cloned,
      status: 'SUCCESS',
    });

    return cloned;
  }

  public async toggleRoleStatus(
    orgId: string,
    roleId: string,
    status: 'ACTIVE' | 'INACTIVE',
    actor?: { id: string; name: string; email: string }
  ) {
    const role = this.roles.get(roleId);
    if (!role || role.orgId !== orgId) throw new Error('Role not found');
    if (role.isSystem && status === 'INACTIVE') {
      throw new Error('System-defined default roles cannot be deactivated.');
    }

    const previousStatus = role.status;
    role.status = status;
    role.updatedAt = new Date().toISOString();
    await pbacStore.upsertRole(this.toStored(role));
    await this.afterMutation(orgId);

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: status === 'ACTIVE' ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED',
      entityType: 'ROLE',
      entityId: roleId,
      entityName: role.name,
      previousState: { status: previousStatus },
      newState: { status: role.status },
      status: 'SUCCESS',
    });

    return role;
  }

  public async deleteRole(orgId: string, roleId: string, actor?: { id: string; name: string; email: string }, force: boolean = false) {
    const role = this.roles.get(roleId);
    if (!role || role.orgId !== orgId) throw new Error('Role not found');
    if (role.isSystem && !force) {
      throw new Error('System-defined default roles require force deletion.');
    }

    // Check if any users have this role assigned
    let assignedCount = 0;
    for (const [userId, roleSet] of this.userRoleAssignments.entries()) {
      if (roleSet.has(roleId)) assignedCount++;
    }

    if (assignedCount > 0) {
      if (!force) {
        throw new Error(`Cannot delete role '${role.name}' because it is assigned to ${assignedCount} user(s). Unassign assigned users first or confirm force deletion.`);
      }

      // Unassign all users from this role
      for (const [userId, roleSet] of this.userRoleAssignments.entries()) {
        if (roleSet.has(roleId)) {
          roleSet.delete(roleId);
          this.invalidateUserCache(userId);
        }
      }
    }

    this.roles.delete(roleId);
    await pbacStore.deleteRole(orgId, roleId);
    await this.afterMutation(orgId);

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'ROLE_DELETED',
      entityType: 'ROLE',
      entityId: roleId,
      entityName: role.name,
      previousState: role,
      newState: null,
      status: 'SUCCESS',
    });

    return true;
  }

  // User-Role Operations
  public async addUserToRole(
    orgId: string,
    roleId: string,
    userId: string,
    actor?: { id: string; name: string; email: string }
  ) {
    await this.ensureOrgSeeded(orgId);
    const role = this.roles.get(roleId);
    if (!role) throw new Error('Role not found');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found in system directory');

    if (actor) {
      this.enforceHierarchy(orgId, actor.id, roleId);
    }

    if (!this.userRoleAssignments.has(userId)) {
      this.userRoleAssignments.set(userId, new Set<string>());
    }

    const set = this.userRoleAssignments.get(userId)!;
    if (set.has(roleId)) {
      return { added: false, message: 'User already has this role' };
    }

    set.add(roleId);
    await pbacStore.addAssignments(orgId, [{ userId, roleId }]);
    await this.afterMutation(orgId);

    // Sync PostgreSQL DB membership
    try {
      if (role.projectId) {
        await prisma.projectMember.upsert({
          where: { projectId_userId: { projectId: role.projectId, userId } },
          update: { role: role.id },
          create: { projectId: role.projectId, userId, role: role.id },
        });
      } else if (role.scope === 'PROJECT') {
        const orgProjects = await prisma.project.findMany({
          where: { workspace: { orgId } },
          select: { id: true },
        });
        for (const p of orgProjects) {
          await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: p.id, userId } },
            update: { role: role.id },
            create: { projectId: p.id, userId, role: role.id },
          });
        }
      } else if (role.scope === 'ORG') {
        const orgRole = (role.slug === 'org-admin' || role.slug === 'super-admin') ? 'ADMIN' : 'MEMBER';
        await prisma.organizationMember.upsert({
          where: { orgId_userId: { orgId, userId } },
          update: { role: orgRole },
          create: { orgId, userId, role: orgRole },
        });
      }
    } catch (e) {
      console.error('Database role sync error in addUserToRole:', e);
    }

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'USER_ADDED_TO_ROLE',
      entityType: 'USER_ROLE',
      entityId: `${userId}_${roleId}`,
      entityName: `${user.firstName} ${user.lastName} ➔ ${role.name}`,
      previousState: null,
      newState: { userId, roleId, roleName: role.name },
      status: 'SUCCESS',
    });

    return { added: true, user, role };
  }

  public async removeUserFromRole(
    orgId: string,
    roleId: string,
    userId: string,
    actor?: { id: string; name: string; email: string }
  ) {
    await this.ensureOrgSeeded(orgId);

    if (actor) {
      this.enforceHierarchy(orgId, actor.id, roleId);
    }

    const role = this.roles.get(roleId);
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (this.userRoleAssignments.has(userId)) {
      this.userRoleAssignments.get(userId)!.delete(roleId);
      await pbacStore.removeAssignments(orgId, [{ userId, roleId }]);
      await this.afterMutation(orgId);
    }

    // Sync PostgreSQL DB membership
    try {
      if (role && role.projectId) {
        await prisma.projectMember.updateMany({
          where: { projectId: role.projectId, userId, role: roleId },
          data: { role: 'MEMBER' },
        });
      } else if (role && role.scope === 'PROJECT') {
        await prisma.projectMember.updateMany({
          where: { project: { workspace: { orgId } }, userId, role: roleId },
          data: { role: 'MEMBER' },
        });
      } else if (role && role.scope === 'ORG') {
        await prisma.organizationMember.updateMany({
          where: { orgId, userId },
          data: { role: 'MEMBER' },
        });
      }
    } catch (e) {
      console.error('Database role sync error in removeUserFromRole:', e);
    }

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'USER_REMOVED_FROM_ROLE',
      entityType: 'USER_ROLE',
      entityId: `${userId}_${roleId}`,
      entityName: `${user?.firstName || userId} ${user?.lastName || ''} ✖ ${role?.name || roleId}`,
      previousState: { userId, roleId },
      newState: null,
      status: 'SUCCESS',
    });

    return { removed: true };
  }

  public async bulkAddUsersToRole(
    orgId: string,
    roleId: string,
    userIds: string[],
    actor?: { id: string; name: string; email: string }
  ) {
    await this.ensureOrgSeeded(orgId);
    const role = this.roles.get(roleId);
    if (!role) throw new Error('Role not found');

    if (actor) {
      this.enforceHierarchy(orgId, actor.id, roleId);
    }

    let addedCount = 0;
    let skippedCount = 0;
    const addedPairs: Array<{ userId: string; roleId: string }> = [];

    for (const uId of userIds) {
      if (!this.userRoleAssignments.has(uId)) {
        this.userRoleAssignments.set(uId, new Set<string>());
      }
      const set = this.userRoleAssignments.get(uId)!;
      if (!set.has(roleId)) {
        set.add(roleId);
        addedCount++;
        addedPairs.push({ userId: uId, roleId });
        // DB sync per user
        try {
          if (role.projectId) {
            await prisma.projectMember.upsert({
              where: { projectId_userId: { projectId: role.projectId, userId: uId } },
              update: { role: role.id },
              create: { projectId: role.projectId, userId: uId, role: role.id },
            });
          } else if (role.scope === 'ORG') {
            const orgRole = (role.slug === 'org-admin' || role.slug === 'super-admin') ? 'ADMIN' : 'MEMBER';
            await prisma.organizationMember.upsert({
              where: { orgId_userId: { orgId, userId: uId } },
              update: { role: orgRole },
              create: { orgId, userId: uId, role: orgRole },
            });
          }
        } catch (e) {
          // ignore individual sync failure
        }
      } else {
        skippedCount++;
      }
    }

    await pbacStore.addAssignments(orgId, addedPairs);
    await this.afterMutation(orgId);

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'BULK_USERS_ADDED_TO_ROLE',
      entityType: 'USER_ROLE',
      entityId: roleId,
      entityName: role.name,
      previousState: null,
      newState: { addedCount, skippedCount, totalRequested: userIds.length },
      status: 'SUCCESS',
    });

    return { addedCount, skippedCount, total: userIds.length };
  }

  public async bulkRemoveUsersFromRole(
    orgId: string,
    roleId: string,
    userIds: string[],
    actor?: { id: string; name: string; email: string }
  ) {
    await this.ensureOrgSeeded(orgId);
    const role = this.roles.get(roleId);
    let removedCount = 0;
    const removedPairs: Array<{ userId: string; roleId: string }> = [];

    for (const uId of userIds) {
      if (this.userRoleAssignments.has(uId)) {
        const set = this.userRoleAssignments.get(uId)!;
        if (set.has(roleId)) {
          set.delete(roleId);
          removedCount++;
          removedPairs.push({ userId: uId, roleId });
          // DB sync per user
          try {
            if (role && role.projectId) {
              await prisma.projectMember.updateMany({
                where: { projectId: role.projectId, userId: uId, role: roleId },
                data: { role: 'MEMBER' },
              });
            } else if (role && role.scope === 'ORG') {
              await prisma.organizationMember.updateMany({
                where: { orgId, userId: uId },
                data: { role: 'MEMBER' },
              });
            }
          } catch (e) {
            // ignore individual sync failure
          }
        }
      }
    }

    await pbacStore.removeAssignments(orgId, removedPairs);
    await this.afterMutation(orgId);

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'BULK_USERS_REMOVED_FROM_ROLE',
      entityType: 'USER_ROLE',
      entityId: roleId,
      entityName: role?.name || roleId,
      previousState: null,
      newState: { removedCount, totalRequested: userIds.length },
      status: 'SUCCESS',
    });

    return { removedCount, total: userIds.length };
  }

  public async assignRolesToUser(
    orgId: string,
    userId: string,
    roleIds: string[],
    actor?: { id: string; name: string; email: string }
  ) {
    await this.ensureOrgSeeded(orgId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    if (actor) {
      for (const rId of roleIds) {
        this.enforceHierarchy(orgId, actor.id, rId);
      }
      const currentRoles = this.userRoleAssignments.get(userId) || new Set<string>();
      const removedRoles = [...currentRoles].filter(r => !roleIds.includes(r));
      for (const rId of removedRoles) {
        this.enforceHierarchy(orgId, actor.id, rId);
      }
    }

    const previousRoleIds = Array.from(this.userRoleAssignments.get(userId) || []);

    // Keep grants that belong to other organizations. Replacing the whole set
    // here used to wipe them.
    const thisOrgRoleIds = this.orgRoleIds.get(orgId) ?? new Set<string>();
    const retained = previousRoleIds.filter((rId) => {
      const role = this.roles.get(rId);
      return role ? role.orgId !== orgId : !thisOrgRoleIds.has(rId);
    });
    this.userRoleAssignments.set(userId, new Set([...retained, ...roleIds]));

    await pbacStore.replaceUserAssignments(orgId, userId, roleIds);
    await this.afterMutation(orgId);

    // DB Sync
    for (const rId of roleIds) {
      const r = this.roles.get(rId);
      if (r && r.projectId) {
        try {
          await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: r.projectId, userId } },
            update: { role: r.id },
            create: { projectId: r.projectId, userId, role: r.id },
          });
        } catch (e) {
          // ignore
        }
      }
    }

    this.recordAudit({
      orgId,
      actorId: actor?.id || 'system',
      actorName: actor?.name || 'Administrator',
      actorEmail: actor?.email || 'admin@eitekh.local',
      action: 'USER_ROLES_REPLACED',
      entityType: 'USER_ROLE',
      entityId: userId,
      entityName: `${user.firstName} ${user.lastName}`,
      previousState: { roleIds: previousRoleIds },
      newState: { roleIds },
      status: 'SUCCESS',
    });

    this.invalidateUserCache(userId);
    return { success: true, userId, roleIds };
  }

  // Helper to map project role name to canonical PBAC role slug or exact role ID
  public getRoleSlugForProjectRole(projectRole: string): string {
    if (!projectRole) return 'member';
    const norm = projectRole.trim();

    // 1. Direct match on role ID in memory
    if (this.roles.has(norm)) {
      return this.roles.get(norm)!.slug;
    }

    // 2. Direct match on role ID, slug or name
    const found = Array.from(this.roles.values()).find(
      (r) => r.id === norm || r.slug === norm || r.name.toUpperCase() === norm.toUpperCase()
    );
    if (found) return found.slug;

    // 3. Standard fallback mappings
    const upper = norm.toUpperCase();
    if (upper === 'PROJECT_ADMIN' || upper === 'ADMIN') return 'project-admin';
    if (upper === 'PROJECT_MANAGER' || upper === 'MANAGER' || upper === 'LEAD' || upper === 'PM') return 'project-manager';
    if (upper === 'VIEWER' || upper === 'GUEST') return 'viewer';
    return 'member';
  }

  // Synchronize a project member's role into PBAC store and invalidate cache
  public async syncProjectMemberRole(orgId: string, userId: string, projectRole: string, projectId?: string) {
    await this.ensureOrgSeeded(orgId);
    let targetRoleId: string;
    // Resolve the incoming role by slug/name only — never trust a raw role id
    // supplied by the caller, which could name an org- or super-admin role.
    const targetSlug = this.getRoleSlugForProjectRole(projectRole);
    const found = Array.from(this.roles.values()).find(
      (r) => r.orgId === orgId && (r.slug === targetSlug || r.name.toUpperCase() === projectRole.toUpperCase())
    );
    targetRoleId = found ? found.id : `role_${orgId}_${targetSlug}`;

    // Refuse to assign anything that is not a PROJECT-scoped role. This is the
    // backstop against privilege escalation: a project membership must never
    // grant an ORG- or SUPER-scoped role.
    const resolved = this.roles.get(targetRoleId);
    if (resolved && resolved.scope !== "PROJECT") {
      throw new Error(
        `Refusing to assign non-project role "${targetRoleId}" (scope ${resolved.scope}) via project membership`
      );
    }
    if (resolved && resolved.orgId !== orgId) {
      throw new Error(`Refusing to assign role from a different organization`);
    }

    if (!this.userRoleAssignments.has(userId)) {
      this.userRoleAssignments.set(userId, new Set<string>());
    }
    const roleSet = this.userRoleAssignments.get(userId)!;

    // Clear all existing project-scoped roles for this user so targetRoleId applies strictly
    for (const rId of Array.from(roleSet)) {
      const rObj = this.roles.get(rId);
      if (rObj && rId !== targetRoleId && rObj.scope === 'PROJECT') {
        roleSet.delete(rId);
      }
    }
    roleSet.add(targetRoleId);

    await pbacStore.replaceUserAssignments(
      orgId,
      userId,
      Array.from(roleSet).filter((rId) => this.roles.get(rId)?.orgId === orgId)
    );
    await this.afterMutation(orgId);
  }

  // Synchronize an org member's role into PBAC store and invalidate cache
  public async syncOrgMemberRole(orgId: string, userId: string, orgRole: string) {
    await this.ensureOrgSeeded(orgId);
    const norm = (orgRole || '').toUpperCase().trim();
    const isOrgAdmin = norm === 'OWNER' || norm === 'ADMIN';

    if (!this.userRoleAssignments.has(userId)) {
      this.userRoleAssignments.set(userId, new Set<string>());
    }
    const roleSet = this.userRoleAssignments.get(userId)!;

    if (isOrgAdmin) {
      roleSet.add(`role_${orgId}_org-admin`);
    } else {
      roleSet.delete(`role_${orgId}_org-admin`);
      if (roleSet.size === 0) {
        roleSet.add(`role_${orgId}_member`);
      }
    }

    await pbacStore.replaceUserAssignments(
      orgId,
      userId,
      Array.from(roleSet).filter((rId) => this.roles.get(rId)?.orgId === orgId)
    );
    await this.afterMutation(orgId);
  }

  // High-Throughput Cached Capability Resolution for Scale (100k+ Users)
  public async getUserCapabilities(
    orgId: string,
    userId: string,
    context?: { projectRole?: string; projectId?: string }
  ): Promise<Set<string>> {
    if (!userId) return new Set<string>();

    const projectRole = context?.projectRole;
    const projectId = context?.projectId;

    // Pick up another instance's changes before consulting the derived cache.
    // This is cheap: the version is polled at most every PBAC_VERSION_POLL_MS
    // and is an in-memory comparison in between.
    //
    // It has to happen BEFORE the cache lookup. Checking afterwards would mean
    // a cached entry is returned without the version ever being consulted, so
    // a permission revoked on another instance would still be honoured here
    // for the full TTL on every repeat call.
    await this.ensureOrgLoaded(orgId);
    const modelVersion = this.loadedOrgVersions.get(orgId) ?? 0;

    // projectId is part of the key because the derived roles below are scoped to
    // it. Keying only on projectRole would let a result computed for one project
    // be served for another.
    //
    // The model version is part of the key so that a role change anywhere in
    // the organization makes every previously computed answer unreachable,
    // with no sweep to get wrong.
    const cacheKey = `${orgId}:v${modelVersion}:${userId}:${projectId || "-"}:${projectRole || "-"}`;
    const cached = this.capabilityCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 5000) { // 5s TTL — a second bound, under the version key
      return cached.permissions;
    }

    await this.ensureOrgSeeded(orgId);

    // Check if user is Super Admin
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isSuperAdmin: true, email: true },
      });
      if (dbUser?.isSuperAdmin) {
        const superPerms = new Set<string>(ALL_PBAC_PERMISSION_KEYS);
        this.capabilityCache.set(cacheKey, {
          permissions: superPerms,
          roles: [{ id: `role_${orgId}_super-admin`, name: 'Super Admin', isSystem: true }],
          timestamp: now,
        });
        return superPerms;
      }
    } catch (e) {
      console.error('Error checking super admin for capabilities:', e);
    }

    // Roles implied by org and project membership are derived from the database
    // on every resolution, and deliberately NOT written into
    // `userRoleAssignments`.
    //
    // They used to be, and only when the stored set was empty — making it a
    // write-once cache that never noticed a membership change. That cut both
    // ways. It denied permissions a user had genuinely been granted: a member
    // promoted to PROJECT_ADMIN kept resolving as MEMBER, so an org-scoped check
    // such as `projects:create` (which has no project to pass as context) said
    // no. Worse, it ran the other way too — a user demoted from PROJECT_ADMIN
    // kept the cached project-admin role, so the demotion did not take effect.
    // A stale grant is a permission bypass, which is why this is derived fresh
    // rather than repaired in place.
    //
    // `userRoleAssignments` now holds only roles granted explicitly through the
    // admin UI. Those are still honoured; the derived ones are unioned on top
    // for this call alone. The 5s capability cache above keeps the extra query
    // off the hot path.
    const derivedRoleIds = new Set<string>();
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          isSuperAdmin: true,
          orgMemberships: { where: { orgId }, select: { role: true } },
          // Scope to the project in context when there is one, so a role held on
          // one project cannot leak into another. Without a projectId there is no
          // project to scope to (an org-level action), so every project role in
          // this org is considered — that is what lets a Project Admin create a
          // project, and it is bounded by the organisation either way.
          projectMemberships: {
            where: projectId
              ? { projectId }
              : { project: { workspace: { orgId } } },
            select: { role: true },
          },
        },
      });

      if (dbUser) {
        if (dbUser.isSuperAdmin) {
          derivedRoleIds.add(`role_${orgId}_super-admin`);
        } else {
          const orgRole = dbUser.orgMemberships[0]?.role;
          if (orgRole === 'OWNER' || orgRole === 'ADMIN') {
            derivedRoleIds.add(`role_${orgId}_org-admin`);
          }
          for (const pm of dbUser.projectMemberships) {
            const targetSlug = this.getRoleSlugForProjectRole(pm.role);
            const found = Array.from(this.roles.values()).find(
              (r) => r.orgId === orgId && (r.id === pm.role || r.slug === targetSlug || r.slug === pm.role)
            );
            derivedRoleIds.add(found ? found.id : `role_${orgId}_${targetSlug}`);
          }
        }
      }
    } catch (e) {
      // Deny rather than guess: leaving derivedRoleIds empty falls through to
      // the explicit assignments, and then to the read-only VIEWER baseline.
      console.error('Error resolving membership-derived PBAC roles:', e);
    }

    const assignedRoleIds = new Set<string>([
      ...(this.userRoleAssignments.get(userId) || []),
      ...derivedRoleIds,
    ]);

    // If a projectRole is explicitly active in this context, enforce its permissions
    if (projectRole) {
      let targetRoleId = projectRole;
      if (this.roles.has(projectRole)) {
        targetRoleId = projectRole;
      } else {
        const targetSlug = this.getRoleSlugForProjectRole(projectRole);
        const found = Array.from(this.roles.values()).find(
          (r) => r.orgId === orgId && (r.id === projectRole || r.slug === targetSlug || r.slug === projectRole || r.name.toUpperCase() === projectRole.toUpperCase())
        );
        targetRoleId = found ? found.id : `role_${orgId}_${targetSlug}`;
      }

      // Remove existing project-scoped roles so context projectRole takes strict precedence
      for (const rId of Array.from(assignedRoleIds)) {
        const rObj = this.roles.get(rId);
        if (rObj && rId !== targetRoleId && rObj.scope === 'PROJECT') {
          assignedRoleIds.delete(rId);
        }
      }
      assignedRoleIds.add(targetRoleId);
    }

    const activeRoles = Array.from(assignedRoleIds)
      .map((rId) => this.roles.get(rId))
      .filter((r): r is PBACRole => Boolean(r && r.orgId === orgId && r.status === 'ACTIVE'));

    const perms = new Set<string>();

    if (activeRoles.length === 0) {
      // No assigned roles → VIEWER-only fallback (read-only baseline)
      for (const p of VIEWER_PERMISSION_KEYS) {
        perms.add(p);
      }
    } else {
      for (const r of activeRoles) {
        for (const p of r.permissions) {
          perms.add(p);
        }
      }

      // Check if user has super admin privileges
      if (activeRoles.some((r) => r.slug === 'super-admin')) {
        for (const p of ALL_PBAC_PERMISSION_KEYS) {
          perms.add(p);
        }
      }
    }

    this.capabilityCache.set(cacheKey, {
      permissions: perms,
      roles: activeRoles.length > 0
        ? activeRoles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }))
        : [{ id: `role_${orgId}_viewer`, name: 'VIEWER', isSystem: true }],
      timestamp: now,
    });

    return perms;
  }

  public async hasPermission(
    orgId: string,
    userId: string,
    permissionKey: string,
    projectRole?: string,
    projectId?: string
  ): Promise<boolean> {
    const perms = await this.getUserCapabilities(orgId, userId, { projectRole, projectId });
    return perms.has(permissionKey);
  }

  // Users Directory & Effective Access Resolution
  public async getUsersWithRoles(
    orgId: string,
    filters?: {
      search?: string;
      roleId?: string;
      status?: string;
      workspaceId?: string;
      projectId?: string;
      page?: number;
      limit?: number | 'all';
    }
  ) {
    await this.ensureOrgSeeded(orgId);

    const where: any = {};
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      where.OR = [
        { email: { contains: s, mode: "insensitive" } },
        { firstName: { contains: s, mode: "insensitive" } },
        { lastName: { contains: s, mode: "insensitive" } },
        { jobTitle: { contains: s, mode: "insensitive" } },
      ];
    }
    if (filters?.status && filters.status !== 'all') {
      where.status = filters.status;
    }

    // Fetch live users with memberships
    const allDbUsers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        jobTitle: true,
        company: true,
        timezone: true,
        status: true,
        isSuperAdmin: true,
        createdAt: true,
        workspaceMemberships: {
          select: {
            workspace: {
              select: { id: true, name: true, slug: true },
            },
            role: true,
          },
        },
        projectMemberships: {
          select: {
            project: {
              select: { id: true, name: true, key: true },
            },
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Populate direct roles & calculate effective permissions
    const populated = allDbUsers.map((u) => {
      const assignedRoleIds = Array.from(this.userRoleAssignments.get(u.id) || []);
      let assignedRoles = assignedRoleIds
        .map((rId) => this.roles.get(rId))
        .filter((r): r is PBACRole => Boolean(r && r.orgId === orgId));

      // If a specific project is selected, filter out roles scoped to other projects
      if (filters?.projectId && filters.projectId !== 'all' && filters.projectId !== 'ALL') {
        assignedRoles = assignedRoles.filter(
          (r) => !r.projectId || r.projectId === filters.projectId
        );
      }

      const effectivePermSet = new Set<string>();
      if (u.isSuperAdmin) {
        // isSuperAdmin DB flag bypasses PBAC role layer — all capabilities are effective
        ALL_PBAC_PERMISSION_KEYS.forEach((p) => effectivePermSet.add(p));
      } else if (assignedRoles.length === 0) {
        // No assigned roles → VIEWER-only fallback (read-only baseline)
        VIEWER_PERMISSION_KEYS.forEach((p) => effectivePermSet.add(p));
      } else {
        for (const r of assignedRoles) {
          if (r.status === 'ACTIVE') {
            r.permissions.forEach((p) => effectivePermSet.add(p));
          }
        }
      }

      const highRiskCount = Array.from(effectivePermSet).filter((p) =>
        HIGH_RISK_PERMISSIONS.includes(p)
      ).length;

      return {
        ...u,
        assignedRoles,
        effectivePermissionsCount: effectivePermSet.size,
        highRiskPermissionsCount: highRiskCount,
        hasSuperAdminBypass: u.isSuperAdmin,
      };
    });

    // Filter by roleId if requested
    let filtered = populated;
    if (filters?.roleId && filters.roleId !== 'all') {
      filtered = populated.filter((u) => u.assignedRoles.some((r) => r.id === filters.roleId));
    }

    // Filter by project membership if requested and not matching all
    if (filters?.projectId && filters.projectId !== 'all' && filters.projectId !== 'ALL') {
      // Keep users who have roles applicable to this project or are direct members
      filtered = filtered.filter(
        (u) =>
          u.isSuperAdmin ||
          u.projectMemberships.some((pm: any) => pm.project.id === filters.projectId) ||
          u.assignedRoles.some((r) => r.projectId === filters.projectId || r.scope === 'ORG')
      );
    }

    const totalRecords = filtered.length;

    // Handle Pagination
    if (filters?.limit === 'all') {
      return { users: filtered, totalRecords, page: 1, limit: 'all' };
    }

    const pageSize = typeof filters?.limit === 'number' ? filters.limit : 25;
    const pageNumber = filters?.page || 1;
    const startIndex = (pageNumber - 1) * pageSize;
    const pagedUsers = filtered.slice(startIndex, startIndex + pageSize);

    return {
      users: pagedUsers,
      totalRecords,
      page: pageNumber,
      limit: pageSize,
    };
  }

  public async getUserRoles(orgId: string, userId: string): Promise<PBACRole[]> {
    await this.ensureOrgSeeded(orgId);
    const roleIds = Array.from(this.userRoleAssignments.get(userId) || []);
    return roleIds
      .map((rId) => this.roles.get(rId))
      .filter((r): r is PBACRole => Boolean(r && r.orgId === orgId));
  }

  // Pre-flight Bulk Assignment Simulation
  public async simulateBulkAssignment(orgId: string, userIds: string[], roleId: string) {
    await this.ensureOrgSeeded(orgId);
    const targetRole = this.roles.get(roleId);
    if (!targetRole) throw new Error('Target role not found');

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });

    let newAssignments = 0;
    let alreadyAssigned = 0;
    let cannotBeAssigned = 0;
    const conflicts: string[] = [];

    for (const u of users) {
      if (u.status === 'SUSPENDED') {
        cannotBeAssigned++;
        conflicts.push(`User ${u.firstName} ${u.lastName} (${u.email}) is SUSPENDED.`);
        continue;
      }

      const assigned = this.userRoleAssignments.get(u.id);
      if (assigned && assigned.has(roleId)) {
        alreadyAssigned++;
      } else {
        newAssignments++;
      }
    }

    return {
      totalSelected: userIds.length,
      roleName: targetRole.name,
      rolePermissionsCount: targetRole.permissions.length,
      newAssignments,
      alreadyAssigned,
      cannotBeAssigned,
      conflicts,
    };
  }

  // Execute Bulk Role Action
  public async executeBulkAssignment(
    orgId: string,
    action: 'ASSIGN_ROLE' | 'REMOVE_ROLE',
    userIds: string[],
    roleId: string,
    actor?: { id: string; name: string; email: string }
  ) {
    if (action === 'ASSIGN_ROLE') {
      return this.bulkAddUsersToRole(orgId, roleId, userIds, actor);
    } else {
      return this.bulkRemoveUsersFromRole(orgId, roleId, userIds, actor);
    }
  }

  // Inspector & Provenance Tracing (Why does this user have access?)
  public async getInspectorData(orgId: string, userId: string, projectId?: string) {
    await this.ensureOrgSeeded(orgId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        jobTitle: true,
        company: true,
        status: true,
        isSuperAdmin: true,
        workspaceMemberships: {
          select: {
            workspace: { select: { id: true, name: true, slug: true } },
            role: true,
          },
        },
        projectMemberships: {
          select: {
            project: { select: { id: true, name: true, key: true } },
            role: true,
          },
        },
      },
    });

    if (!user) throw new Error('User not found');

    let scopedProject: any = null;
    if (projectId && projectId !== 'all' && projectId !== 'ALL') {
      scopedProject = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, key: true },
      });
    }

    // Super Admin platform bypass: isSuperAdmin DB flag grants ALL permissions regardless
    // of any PBAC role assignment. Surface this explicitly in the inspector so the
    // provenance trace shows the real grant source, not the (viewer-only) PBAC role.
    if (user.isSuperAdmin) {
      const superAdminRole: PBACRole = {
        id: `role_${orgId}_super-admin`,
        orgId,
        name: 'Super Admin',
        slug: 'super-admin',
        description: 'Unrestricted platform authority granted via isSuperAdmin DB flag.',
        scope: 'ORG',
        projectId: null,
        projectName: null,
        status: 'ACTIVE',
        isSystem: true,
        permissions: [...ALL_PBAC_PERMISSION_KEYS],
        createdBy: 'System Provisioning',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const permsByCategory = PBAC_PERMISSION_CATEGORIES.map((cat) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        totalPermissions: cat.permissions.length,
        grantedPermissions: cat.permissions.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          riskLevel: p.riskLevel,
          sources: [{ roleId: superAdminRole.id, roleName: superAdminRole.name }],
        })),
      }));

      const provenanceTraces = PBAC_PERMISSION_CATEGORIES.flatMap((cat) =>
        cat.permissions.map((p) => ({
          permissionKey: p.key,
          permissionLabel: p.label,
          category: cat.name,
          riskLevel: p.riskLevel,
          grantedByRoles: [{ id: superAdminRole.id, name: superAdminRole.name, status: 'ACTIVE', isSystem: true, projectId: null, projectName: null }],
          tracePath: [
            { node: 'Identity', detail: `User: ${user.firstName} ${user.lastName} (${user.email}) [Status: ${user.status}]` },
            { node: 'Permission Role', detail: 'Platform Super Admin Authority (isSuperAdmin DB flag — bypasses PBAC role layer)' },
            { node: 'Capability Grant', detail: `All Capabilities Granted: '${p.label}' [${p.key}] (Risk: ${p.riskLevel})` },
            { node: 'Project Scope Boundary', detail: scopedProject ? `Effective in Project '${scopedProject.name}' (${scopedProject.key})` : 'Global — All Organizations, Workspaces, and Projects' },
          ],
          reasoning: `Granted because user '${user.firstName} ${user.lastName}' holds the platform Super Admin designation (isSuperAdmin=true). This flag bypasses the PBAC role layer entirely and unconditionally grants all ${ALL_PBAC_PERMISSION_KEYS.length} capabilities.`,
        }))
      );

      const assignedPbacRoleIds = Array.from(this.userRoleAssignments.get(userId) || []);
      const assignedPbacRoles = assignedPbacRoleIds
        .map((rId) => this.roles.get(rId))
        .filter((r): r is PBACRole => Boolean(r && r.orgId === orgId));

      return {
        user: {
          id: user.id,
          name: `${user.firstName} ${user.lastName}`.trim() || user.email,
          email: user.email,
          jobTitle: user.jobTitle,
          company: user.company,
          avatarUrl: user.avatarUrl,
          status: user.status,
          isSuperAdmin: true,
          superAdminBypass: true,
        },
        assignedRoles: assignedPbacRoles,
        superAdminBypassActive: true,
        scopedProject,
        totalEffectivePermissions: ALL_PBAC_PERMISSION_KEYS.length,
        effectivePermissionsCount: ALL_PBAC_PERMISSION_KEYS.length,
        accessibleProjects: user.projectMemberships?.map((pm) => pm.project) || [],
        accessibleWorkspaces: user.workspaceMemberships?.map((wm) => wm.workspace) || [],
        permissionsByCategory: permsByCategory,
        provenanceTraces,
      };
    }

    const assignedRoleIds = Array.from(this.userRoleAssignments.get(userId) || []);
    let assignedRoles = assignedRoleIds
      .map((rId) => this.roles.get(rId))
      .filter((r): r is PBACRole => Boolean(r && r.orgId === orgId));

    if (scopedProject) {
      assignedRoles = assignedRoles.filter((r) => !r.projectId || r.projectId === scopedProject.id);
    }

    // No assigned roles → inject synthetic VIEWER role for provenance tracing
    const isViewerFallback = assignedRoles.length === 0;
    if (isViewerFallback) {
      const viewerRoleId = `role_${orgId}_viewer`;
      const existingViewer = this.roles.get(viewerRoleId);
      if (existingViewer) {
        assignedRoles = [existingViewer];
      } else {
        assignedRoles = [{
          id: viewerRoleId,
          orgId,
          name: 'VIEWER',
          slug: 'viewer',
          description: 'Default read-only fallback for users without assigned permission roles.',
          scope: 'PROJECT',
          projectId: null,
          projectName: null,
          status: 'ACTIVE',
          isSystem: true,
          permissions: [...VIEWER_PERMISSION_KEYS],
          createdBy: 'System Provisioning',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }];
      }
    }

    // Calculate effective permissions & Provenance resolution traces
    const effectivePermissionsMap = new Map<string, {
      permission: string;
      category: string;
      riskLevel: string;
      grantedByRoles: Array<{ id: string; name: string; status: string; isSystem: boolean; projectId?: string | null; projectName?: string | null }>;
      provenanceTrace: {
        step1_Identity: string;
        step2_RoleAssignment: string[];
        step3_PermissionGrant: string;
        step4_BoundaryIsolation: string[];
      };
    }>();

    for (const cat of PBAC_PERMISSION_CATEGORIES) {
      for (const p of cat.permissions) {
        const grantingRoles = assignedRoles.filter(
          (r) => r.status === 'ACTIVE' && r.permissions.includes(p.key)
        );

        if (grantingRoles.length > 0) {
          const boundaryList = scopedProject
            ? [
                `Project Scope: '${scopedProject.name}' (${scopedProject.key})`,
                user.projectMemberships.some((pm) => pm.project.id === scopedProject.id)
                  ? `Active Direct Project Member (Role: ${user.projectMemberships.find((pm) => pm.project.id === scopedProject.id)?.role || 'MEMBER'})`
                  : 'Granted via Global / Organization Administrative Authority',
              ]
            : user.projectMemberships.length > 0
            ? user.projectMemberships.map((pm) => `Enforced in Project '${pm.project.name}' (${pm.project.key})`)
            : ['Global Organization Scope (All Projects)'];

          effectivePermissionsMap.set(p.key, {
            permission: p.key,
            category: cat.name,
            riskLevel: p.riskLevel,
            grantedByRoles: grantingRoles.map((r) => ({
              id: r.id,
              name: r.name,
              status: r.status,
              isSystem: r.isSystem,
              projectId: r.projectId,
              projectName: r.projectName,
            })),
            provenanceTrace: {
              step1_Identity: `User: ${user.firstName} ${user.lastName} (${user.email}) [Status: ${user.status}]`,
              step2_RoleAssignment: grantingRoles.map((r) => `Role Binding: '${r.name}' (${r.scope}${r.projectName ? ` - ${r.projectName}` : ''})`),
              step3_PermissionGrant: `Explicitly Granted Capability: '${p.label}' [${p.key}] (Risk: ${p.riskLevel})`,
              step4_BoundaryIsolation: boundaryList,
            },
          });
        }
      }
    }

    const allPerms = PBAC_PERMISSION_CATEGORIES.flatMap((c) => c.permissions);
    const provenanceTraces = Array.from(effectivePermissionsMap.values()).map((ep) => {
      const permDef = allPerms.find((p) => p.key === ep.permission);
      return {
        permissionKey: ep.permission,
        permissionLabel: permDef?.label || ep.permission,
        category: ep.category,
        riskLevel: ep.riskLevel,
        grantedByRoles: ep.grantedByRoles,
        tracePath: [
          { node: 'Identity', detail: ep.provenanceTrace.step1_Identity },
          { node: 'Permission Role', detail: ep.provenanceTrace.step2_RoleAssignment.join(' | ') },
          { node: 'Capability Grant', detail: ep.provenanceTrace.step3_PermissionGrant },
          { node: 'Project Scope Boundary', detail: ep.provenanceTrace.step4_BoundaryIsolation.join(' | ') },
        ],
        reasoning: `Granted because user '${user.firstName} ${user.lastName}' is directly assigned to active role(s) [${ep.grantedByRoles.map((r) => r.name).join(', ')}] which includes permission '${ep.permission}'${scopedProject ? ` within project '${scopedProject.name}'` : ''}.`,
      };
    });

    const permissionsByCategory = PBAC_PERMISSION_CATEGORIES.map((cat) => {
      const granted = cat.permissions
        .filter((p) => effectivePermissionsMap.has(p.key))
        .map((p) => {
          const ep = effectivePermissionsMap.get(p.key)!;
          return {
            key: p.key,
            label: p.label,
            description: p.description,
            riskLevel: p.riskLevel,
            sources: ep.grantedByRoles.map((r) => ({ roleId: r.id, roleName: r.name })),
          };
        });
      return {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        totalPermissions: cat.permissions.length,
        grantedPermissions: granted,
      };
    });

    return {
      user: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        email: user.email,
        jobTitle: user.jobTitle,
        company: user.company,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
      assignedRoles,
      viewerFallbackActive: isViewerFallback,
      scopedProject,
      totalEffectivePermissions: effectivePermissionsMap.size,
      effectivePermissionsCount: effectivePermissionsMap.size,
      accessibleProjects: user.projectMemberships?.map((pm) => pm.project) || [],
      accessibleWorkspaces: user.workspaceMemberships?.map((wm) => wm.workspace) || [],
      permissionsByCategory,
      provenanceTraces,
    };
  }

  // Access Matrix Generation
  public async getAccessMatrix(
    orgId: string,
    filters?: {
      search?: string;
      roleId?: string;
      status?: string;
      workspaceId?: string;
      projectId?: string;
      page?: number;
      limit?: number | 'all';
    }
  ) {
    const { users, totalRecords, page, limit } = await this.getUsersWithRoles(orgId, filters);
    const roles = await this.getRoles(orgId, filters?.projectId);

    const matrix = users.map((u: any) => {
      const userPermKeys = new Set<string>();
      if (u.hasSuperAdminBypass) {
        ALL_PBAC_PERMISSION_KEYS.forEach((p) => userPermKeys.add(p));
      } else if (u.assignedRoles.length === 0) {
        VIEWER_PERMISSION_KEYS.forEach((p) => userPermKeys.add(p));
      } else {
        for (const r of u.assignedRoles) {
          if (r.status === 'ACTIVE') {
            r.permissions.forEach((p: string) => userPermKeys.add(p));
          }
        }
      }

      return {
        userId: u.id,
        userName: `${u.firstName} ${u.lastName}`,
        userEmail: u.email,
        jobTitle: u.jobTitle || 'Team Member',
        status: u.status,
        roles: u.assignedRoles.length > 0
          ? u.assignedRoles.map((r: any) => ({ id: r.id, name: r.name, status: r.status }))
          : [{ id: `role_${orgId}_viewer`, name: 'VIEWER', status: 'ACTIVE' }],
        permissions: ALL_PBAC_PERMISSION_KEYS.reduce((acc, pKey) => {
          acc[pKey] = userPermKeys.has(pKey);
          return acc;
        }, {} as Record<string, boolean>),
        totalGranted: userPermKeys.size,
      };
    });

    return {
      matrix,
      categories: PBAC_PERMISSION_CATEGORIES,
      allKeys: ALL_PBAC_PERMISSION_KEYS,
      roles,
      totalRecords,
      page,
      limit,
    };
  }

  // Multi-Format Export (CSV, Excel, PDF Report)
  public async generateExport(
    orgId: string,
    format: 'csv' | 'excel' | 'pdf',
    filters?: { search?: string; roleId?: string }
  ) {
    const { matrix, allKeys, categories } = await this.getAccessMatrix(orgId, {
      ...filters,
      limit: 'all',
    });

    if (format === 'csv' || format === 'excel') {
      const headers = ['User ID', 'Name', 'Email', 'Job Title', 'Status', 'Assigned Roles', ...allKeys];
      const rows = matrix.map((m) => {
        const rowData = [
          m.userId,
          `"${m.userName}"`,
          m.userEmail,
          `"${m.jobTitle}"`,
          m.status,
          `"${m.roles.map((r: any) => r.name).join(', ')}"`,
          ...allKeys.map((k) => (m.permissions[k] ? 'YES' : 'NO')),
        ];
        return rowData.join(',');
      });

      return {
        contentType: format === 'excel' ? 'application/vnd.ms-excel' : 'text/csv',
        filename: `eitekh-access-matrix-${Date.now()}.${format === 'excel' ? 'csv' : 'csv'}`,
        data: [headers.join(','), ...rows].join('\n'),
      };
    }

    // HTML / PDF Printable Format
    const htmlReport = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Eitekh WorkOS — Access Governance & PBAC Audit Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 24px; color: #1e293b; }
    h1 { font-size: 20px; margin-bottom: 4px; color: #0f172a; }
    .subtitle { font-size: 12px; color: #64748b; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    .granted { background: #dcfce7; color: #166534; font-weight: bold; text-align: center; }
    .denied { color: #94a3b8; text-align: center; }
    .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: right; }
  </style>
</head>
<body>
  <h1>Eitekh WorkOS — Access Governance & PBAC Matrix</h1>
  <div class="subtitle">Generated on ${new Date().toUTCString()} | Organization ID: ${orgId}</div>
  <table>
    <thead>
      <tr>
        <th>User</th>
        <th>Email</th>
        <th>Assigned Roles</th>
        <th>Total Granted</th>
      </tr>
    </thead>
    <tbody>
      ${matrix
        .map(
          (m) => `
        <tr>
          <td><strong>${m.userName}</strong><br><small>${m.jobTitle}</small></td>
          <td>${m.userEmail}</td>
          <td>${m.roles.map((r: any) => r.name).join(', ') || '<em>No Roles Assigned</em>'}</td>
          <td>${m.totalGranted} / ${allKeys.length}</td>
        </tr>`
        )
        .join('')}
    </tbody>
  </table>
  <div class="footer">Certified PBAC Deterministic Access Resolution — Eitekh WorkOS</div>
</body>
</html>`;

    const res = {
      contentType: 'text/html',
      mimeType: 'text/html',
      filename: `eitekh-access-governance-report-${Date.now()}.html`,
      data: htmlReport,
      content: htmlReport,
    };
    return res;
  }

  public async exportData(
    orgId: string,
    format: 'csv' | 'excel' | 'pdf',
    filters?: { search?: string; roleId?: string }
  ) {
    const res = await this.generateExport(orgId, format, filters);
    return {
      ...res,
      content: res.data,
      mimeType: res.contentType,
    };
  }

  // Audit Logs
  public async getAuditLogs(
    orgId: string,
    filters?: {
      search?: string;
      action?: string;
      limit?: number;
    }
  ) {
    await this.ensureOrgSeeded(orgId);

    // Read the durable record, not this process's buffer (PROD-3). The buffer
    // holds only what this instance happened to write since it started, so
    // before this change the audit trail an admin saw depended on which
    // instance served the request — and a restart erased it.
    const logs0 = (await pbacStore.getAuditRecords(orgId, 2000)) as unknown as PBACAuditRecord[];
    let logs = logs0;

    if (filters?.search) {
      const s = filters.search.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.actorName.toLowerCase().includes(s) ||
          l.actorEmail.toLowerCase().includes(s) ||
          (l.entityName || '').toLowerCase().includes(s) ||
          l.action.toLowerCase().includes(s)
      );
    }

    if (filters?.action && filters.action !== 'all') {
      logs = logs.filter((l) => l.action === filters.action);
    }

    const max = filters?.limit || 100;
    return logs.slice(0, max);
  }

  public async getAuditLedger(
    orgId: string,
    filters?: { search?: string; action?: string; limit?: number }
  ) {
    return this.getAuditLogs(orgId, filters);
  }

  public async getEffectiveUserAccess(orgId: string, userId: string, projectId?: string) {
    return this.getInspectorData(orgId, userId, projectId);
  }
}

export const pbacEngine = new UnifiedPBACEngine();
