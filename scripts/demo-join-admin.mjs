/**
 * Create an admin in the demo database and make them a member of everything.
 *
 * WHY THIS IS NOT JUST `prisma/seed.js`
 *
 * BOTH seeders wipe the database before they write — `seed-volume.js` clears
 * 29 tables including `user`, and `seed.js` does the same. So they cannot be
 * combined in either order: run base-then-volume and the admin is deleted;
 * run volume-then-base and the 3,000 issues are deleted. Discovering that
 * costs one full seed run in each direction.
 *
 * This script writes the admin WITHOUT wiping, so it can run after the volume
 * seeder and leave its data intact.
 *
 * WHY MEMBERSHIP HAS TO BE GRANTED SEPARATELY
 *
 * Being a super admin is NOT the same as being a member. The volume seeder
 * creates its own organisations populated with vol-user-N accounts, so an
 * admin can reach the super-admin screens and still see nothing on a board —
 * every project view is scoped by membership. That is tenant isolation
 * working exactly as designed, not a bug.
 *
 * Demo database only. It refuses anything else, so it can never touch
 * eitekh_workos.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const EMAIL = process.env.ADMIN_EMAIL || "cocofbd@gmail.com";
// Same value seed.js uses, so the credentials are the ones already documented.
const PASSWORD = process.env.ADMIN_PASSWORD || "AdminPass123!";

if (!/eitekh_demo/.test(process.env.DATABASE_URL || "")) {
  console.error("Refusing to run: DATABASE_URL does not point at eitekh_demo.");
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient();

  // Upsert rather than create: this script is safe to re-run after any
  // reseed, which is the whole point of it existing separately.
  const admin = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash: bcrypt.hashSync(PASSWORD, 10), status: "ACTIVE" },
    create: {
      email: EMAIL,
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      firstName: "Super",
      lastName: "Administrator",
      jobTitle: "Platform Admin",
      isSuperAdmin: true,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`admin ready: ${admin.email}`);

  {
    let orgs = 0;
    let workspaces = 0;
    let projects = 0;

    for (const org of await prisma.organization.findMany({ select: { id: true } })) {
      const existing = await prisma.organizationMember.findFirst({
        where: { orgId: org.id, userId: admin.id },
      });
      if (!existing) {
        await prisma.organizationMember.create({
          data: { orgId: org.id, userId: admin.id, role: "OWNER" },
        });
        orgs += 1;
      }
    }

    for (const ws of await prisma.workspace.findMany({ select: { id: true } })) {
      const existing = await prisma.workspaceMember.findFirst({
        where: { workspaceId: ws.id, userId: admin.id },
      });
      if (!existing) {
        await prisma.workspaceMember.create({
          data: { workspaceId: ws.id, userId: admin.id, role: "WORKSPACE_ADMIN" },
        });
        workspaces += 1;
      }
    }

    for (const p of await prisma.project.findMany({ select: { id: true } })) {
      const existing = await prisma.projectMember.findFirst({
        where: { projectId: p.id, userId: admin.id },
      });
      if (!existing) {
        await prisma.projectMember.create({
          data: { projectId: p.id, userId: admin.id, role: "PROJECT_ADMIN" },
        });
        projects += 1;
      }
    }

    console.log(`${EMAIL} joined: ${orgs} org(s), ${workspaces} workspace(s), ${projects} project(s)`);
    await prisma.$disconnect();
  }
}
