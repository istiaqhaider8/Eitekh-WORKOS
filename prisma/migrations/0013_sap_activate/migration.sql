-- CreateTable
CREATE TABLE "ActivateProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "methodologyVersion" TEXT NOT NULL DEFAULT '2024',
    "currentPhaseKey" TEXT,
    "configJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivatePhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivatePhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivateWorkstream" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivateWorkstream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivateDeliverableLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "workstreamId" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "acceleratorKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivateDeliverableLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivateGate" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivateGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivateGateCriterion" (
    "id" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "criterion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidenceRef" TEXT,
    "evidenceIssueId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivateGateCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivateGateApproval" (
    "id" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivateGateApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivateProfile_projectId_key" ON "ActivateProfile"("projectId");

-- CreateIndex
CREATE INDEX "ActivatePhase_projectId_idx" ON "ActivatePhase"("projectId");

-- CreateIndex
CREATE INDEX "ActivatePhase_projectId_position_idx" ON "ActivatePhase"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ActivatePhase_projectId_key_key" ON "ActivatePhase"("projectId", "key");

-- CreateIndex
CREATE INDEX "ActivateWorkstream_projectId_idx" ON "ActivateWorkstream"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivateWorkstream_projectId_key_key" ON "ActivateWorkstream"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ActivateDeliverableLink_issueId_key" ON "ActivateDeliverableLink"("issueId");

-- CreateIndex
CREATE INDEX "ActivateDeliverableLink_phaseId_idx" ON "ActivateDeliverableLink"("phaseId");

-- CreateIndex
CREATE INDEX "ActivateDeliverableLink_workstreamId_idx" ON "ActivateDeliverableLink"("workstreamId");

-- CreateIndex
CREATE INDEX "ActivateGate_phaseId_idx" ON "ActivateGate"("phaseId");

-- CreateIndex
CREATE INDEX "ActivateGateCriterion_gateId_idx" ON "ActivateGateCriterion"("gateId");

-- CreateIndex
CREATE INDEX "ActivateGateApproval_gateId_idx" ON "ActivateGateApproval"("gateId");

-- CreateIndex
CREATE INDEX "ActivateGateApproval_approverId_idx" ON "ActivateGateApproval"("approverId");

-- AddForeignKey
ALTER TABLE "ActivateProfile" ADD CONSTRAINT "ActivateProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivatePhase" ADD CONSTRAINT "ActivatePhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivatePhase" ADD CONSTRAINT "ActivatePhase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateWorkstream" ADD CONSTRAINT "ActivateWorkstream_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateWorkstream" ADD CONSTRAINT "ActivateWorkstream_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateDeliverableLink" ADD CONSTRAINT "ActivateDeliverableLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateDeliverableLink" ADD CONSTRAINT "ActivateDeliverableLink_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ActivatePhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateDeliverableLink" ADD CONSTRAINT "ActivateDeliverableLink_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "ActivateWorkstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateGate" ADD CONSTRAINT "ActivateGate_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ActivatePhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateGateCriterion" ADD CONSTRAINT "ActivateGateCriterion_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "ActivateGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateGateCriterion" ADD CONSTRAINT "ActivateGateCriterion_evidenceIssueId_fkey" FOREIGN KEY ("evidenceIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateGateApproval" ADD CONSTRAINT "ActivateGateApproval_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "ActivateGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivateGateApproval" ADD CONSTRAINT "ActivateGateApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

