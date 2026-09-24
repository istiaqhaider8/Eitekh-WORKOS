-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "ticketCounter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "ticketKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdById" TEXT NOT NULL,
    "assignedManagerId" TEXT,
    "resolutionNote" TEXT,
    "rejectionReason" TEXT,
    "convertedIssueId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketStatusHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_convertedIssueId_key" ON "Ticket"("convertedIssueId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_ticketKey_idx" ON "Ticket"("ticketKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_projectId_status_idx" ON "Ticket"("projectId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_projectId_createdById_idx" ON "Ticket"("projectId", "createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_projectId_assignedManagerId_idx" ON "Ticket"("projectId", "assignedManagerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_projectId_priority_idx" ON "Ticket"("projectId", "priority");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_projectId_createdAt_idx" ON "Ticket"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_projectId_ticketNumber_key" ON "Ticket"("projectId", "ticketNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketComment_authorId_idx" ON "TicketComment"("authorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketStatusHistory_ticketId_timestamp_idx" ON "TicketStatusHistory"("ticketId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketStatusHistory_actorId_idx" ON "TicketStatusHistory"("actorId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_projectId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_createdById_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_assignedManagerId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_convertedIssueId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_convertedIssueId_fkey" FOREIGN KEY ("convertedIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketComment_ticketId_fkey') THEN
    ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketComment_authorId_fkey') THEN
    ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketStatusHistory_ticketId_fkey') THEN
    ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketStatusHistory_actorId_fkey') THEN
    ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketAttachment_ticketId_fkey') THEN
    ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketAttachment_uploaderId_fkey') THEN
    ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
