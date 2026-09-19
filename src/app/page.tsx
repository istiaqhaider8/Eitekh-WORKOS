import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Find first project strictly assigned to the user (or owned by the user)
  const firstProject = await prisma.project.findFirst({
    where: user.isSuperAdmin
      ? {}
      : {
          OR: [
            { members: { some: { userId: user.id } } },
            { ownerId: user.id },
          ],
        },
    orderBy: { createdAt: "asc" },
  });

  if (firstProject) {
    redirect(`/projects/${firstProject.id}`);
  }

  if (user.isSuperAdmin) {
    const anyProject = await prisma.project.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (anyProject) {
      redirect(`/projects/${anyProject.id}`);
    }
    redirect("/super-admin");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        <h1 className="text-xl font-bold">Welcome to Eitekh WorkOS</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">No projects found. Please create your first project.</p>
      </div>
    </div>
  );
}
