const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sprints = await prisma.sprint.findMany({
    include: {
      issues: {
        include: { status: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  console.log('Total sprints in DB:', sprints.length);
  sprints.forEach(s => {
    const doneIssues = s.issues.filter(i => i.status?.category === 'DONE');
    const donePts = doneIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const totalPts = s.issues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    console.log({
      id: s.id,
      name: s.name,
      status: s.status,
      projectId: s.projectId,
      totalIssues: s.issues.length,
      doneIssues: doneIssues.length,
      donePts,
      totalPts
    });
  });
}

main().finally(() => prisma.$disconnect());
