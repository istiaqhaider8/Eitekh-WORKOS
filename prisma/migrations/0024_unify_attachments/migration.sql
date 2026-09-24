-- Unify Attachment model: allow attachments to belong to either an Issue or a Ticket.
-- Zero ticket attachment rows existed prior to this migration.

-- AlterTable: make issueId optional, add ticketId
ALTER TABLE "Attachment" ALTER COLUMN "issueId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "ticketId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Attachment_ticketId_idx" ON "Attachment"("ticketId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Attachment_ticketId_fkey'
    ) THEN
        ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Drop duplicate TicketAttachment table if it exists
DROP TABLE IF EXISTS "TicketAttachment" CASCADE;
