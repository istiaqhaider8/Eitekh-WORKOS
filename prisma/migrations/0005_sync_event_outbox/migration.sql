-- CreateTable
CREATE TABLE "SyncEventOutbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "originId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncEventOutbox_createdAt_idx" ON "SyncEventOutbox"("createdAt");

-- CreateIndex
CREATE INDEX "SyncEventOutbox_projectId_createdAt_idx" ON "SyncEventOutbox"("projectId", "createdAt");
