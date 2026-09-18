import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { ProjectClient } from "./ProjectClient";

/**
 * How many issues are embedded in the server-rendered payload.
 *
 * This bounds first paint. Projects with more issues get the remainder from
 * ProjectClient immediately after mount, so the board is still complete — it
 * just is not paid for in the initial HTML.
 */
const INITIAL_ISSUE_LIMIT = 200;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      workspace: {
        include: {
          organization: true,
        },
      },
      workflows: {
        include: {
          statuses: {
            orderBy: { position: "asc" },
          },
        },
      },
      epics: true,
      sprints: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
      issues: {
        // Every field selected here is serialized into the HTML payload sent to
        // the browser, once per issue. Blanket `include: true` on five relations
        // made the payload 139 kB for FIVE issues (~28 kB each) and it grew
        // linearly forever. Each relation below is now narrowed to exactly the
        // fields the board/list/calendar/timeline views actually read — verified
        // by grepping their usage, not assumed.
        include: {
          status: true, // needs name, color and category
          assignee: publicUserRelation,
          epic: { select: { id: true, name: true, color: true, status: true } },
          sprint: { select: { id: true, name: true } },
          // Kanban shows "n/m subtasks done", so only the completion flag is
          // needed — full subtask rows were being shipped to render a count.
          subtasks: { select: { id: true, isCompleted: true } },
          labels: { include: { label: true } },
          team: { select: { id: true, name: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
        // Bounded first paint. The board views need the whole set to render
        // correctly, so ProjectClient tops up via its existing paginated API
        // when the project has more than this; see INITIAL_ISSUE_LIMIT there.
        take: INITIAL_ISSUE_LIMIT,
      },
      members: {
        include: {
          user: publicUserRelation,
        },
      },
      // Lets the client detect that the embedded issue list was truncated
      // without it having to guess from the array length.
      _count: { select: { issues: true } },
    },
  });

  if (!project) {
    notFound();
  }

  // Tenant & Project Assignment Isolation Guard
  let isOrgAdmin = user.isSuperAdmin;

  if (!user.isSuperAdmin) {
    const orgMembership = await prisma.organizationMember.findUnique({
      where: {
        orgId_userId: {
          orgId: project.workspace.orgId,
          userId: user.id,
        },
      },
    });

    if (!orgMembership) {
      // Forbidden: Attempting to access cross-tenant project
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center space-y-2 bg-red-50 dark:bg-red-950/40 p-6 rounded-xl border border-red-200 dark:border-red-800">
            <h2 className="text-base font-bold text-red-700 dark:text-red-400">Access Denied</h2>
            <p className="text-xs text-red-600 dark:text-red-300">Cross-tenant project isolation prevents unauthorized access.</p>
          </div>
        </div>
      );
    }

    // STRICT PROJECT-BASED ACCESS CONTROL:
    // User must be explicitly assigned as a project member or be the project owner.
    const isAssigned = project.ownerId === user.id || project.members.some((m) => m.userId === user.id);

    if (!isAssigned) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-md w-full text-center space-y-4 bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-sm">
            <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
              🔒
            </div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Project Access Restricted</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Access to this project's Kanban, List, Scrum, Timeline, Calendar, Workload, and Reports is restricted. You are only authorized to view and perform actions on projects to which you are explicitly assigned.
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                Go to My Assigned Projects
              </Link>
            </div>
          </div>
        </div>
      );
    }
  }

  // Fetch strictly only the projects the user is explicitly assigned to for the sidebar switcher
  const allProjects = await prisma.project.findMany({
    where: user.isSuperAdmin
      ? {}
      : {
          workspace: { orgId: project.workspace.orgId },
          OR: [
            { members: { some: { userId: user.id } } },
            { ownerId: user.id },
          ],
        },
    select: { id: true, name: true, key: true },
    orderBy: { name: "asc" },
  });

  let capabilities: string[] = [];
  if (user.isSuperAdmin) {
    const { ALL_PBAC_PERMISSION_KEYS } = await import("@/lib/pbac-engine");
    capabilities = [...ALL_PBAC_PERMISSION_KEYS];
  } else {
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      // Resolved WITH this project's context. Without it the capability list is
      // organisation-wide, so someone who is PROJECT_ADMIN on one project
      // appeared to hold the permission on every project in the org — which is
      // what let the admin controls render on projects where the user is only a
      // MEMBER. An org OWNER/ADMIN still resolves through their org role.
      const projectRole =
        project.members?.find((m: any) => m.userId === user.id)?.role ||
        (project.ownerId === user.id ? "PROJECT_ADMIN" : undefined);
      const caps = await pbacEngine.getUserCapabilities(project.workspace.orgId, user.id, {
        projectId: project.id,
        projectRole,
      });
      capabilities = Array.from(caps);
    } catch (e) {
      console.error("Error resolving user capabilities in page.tsx:", e);
    }
  }

  const currentUserWithCaps = {
    ...user,
    capabilities,
  };

  return (
    <ProjectClient
      currentUser={currentUserWithCaps}
      currentOrg={project.workspace.organization}
      project={project}
      allProjects={allProjects}
    />
  );
}
