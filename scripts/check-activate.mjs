import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const profiles = await p.activateProfile.findMany({include:{project:{select:{key:true,name:true}}}});
console.log("Activate profiles:", JSON.stringify(profiles, null, 2));
console.log("Activate phases:", await p.activatePhase.count());
console.log("Activate deliverable links:", await p.activateDeliverableLink.count());
console.log("Activate gates:", await p.activateGate.count());
console.log("Activate gate criteria:", await p.activateGateCriterion.count());
console.log("Activate workstreams:", await p.activateWorkstream.count());
// List all projects
const projects = await p.project.findMany({ select: { id: true, key: true, name: true } });
console.log("\nAll projects:", JSON.stringify(projects, null, 2));
await p.$disconnect();
