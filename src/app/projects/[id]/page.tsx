import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProjectClient } from "./ProjectClient";

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
        orderBy: { createdAt: "desc" },
      },
      issues: {
        include: {
          status: true,
          assignee: true,
          labels: { include: { label: true } },
          team: { select: { id: true, name: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      },
      members: {
        include: {
          user: true,
        },
      },
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
              <a
                href="/"
                className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                Go to My Assigned Projects
              </a>
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

  return (
    <ProjectClient
      currentUser={user}
      currentOrg={project.workspace.organization}
      project={project}
      allProjects={allProjects}
    />
  );
}
