-- CreateTable
CREATE TABLE "PbacRole" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'ORG',
    "projectId" TEXT,
    "projectName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PbacRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PbacUserRoleAssignment" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PbacUserRoleAssignment_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "PbacOrgState" (
    "orgId" TEXT NOT NULL,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PbacOrgState_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "PbacAuditRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "previousState" JSONB,
    "newState" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PbacAuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PbacRole_orgId_idx" ON "PbacRole"("orgId");

-- CreateIndex
CREATE INDEX "PbacRole_orgId_projectId_idx" ON "PbacRole"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "PbacRole_orgId_slug_idx" ON "PbacRole"("orgId", "slug");

-- CreateIndex
CREATE INDEX "PbacUserRoleAssignment_orgId_idx" ON "PbacUserRoleAssignment"("orgId");

-- CreateIndex
CREATE INDEX "PbacUserRoleAssignment_userId_idx" ON "PbacUserRoleAssignment"("userId");

-- CreateIndex
CREATE INDEX "PbacUserRoleAssignment_roleId_idx" ON "PbacUserRoleAssignment"("roleId");

-- CreateIndex
CREATE INDEX "PbacAuditRecord_orgId_createdAt_idx" ON "PbacAuditRecord"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "PbacAuditRecord_actorId_idx" ON "PbacAuditRecord"("actorId");

-- AddForeignKey
ALTER TABLE "PbacUserRoleAssignment" ADD CONSTRAINT "PbacUserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "PbacRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
