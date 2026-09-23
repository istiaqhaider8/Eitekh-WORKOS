-- Template-level deliverables and their task checklists.
--
-- Until now a methodology template carried phases, workstreams, gates and
-- gate criteria — the shape of a project — but nothing about the work. The
-- 57 deliverables and 213 tasks that make the plan usable lived in a seed
-- script, so every new project began with six empty phases.
--
-- These two tables let the template carry the plan itself. They are
-- template-scoped, never project-scoped: a project's own deliverables stay
-- in activate_deliverable_links against real issues, so editing a project
-- plan cannot reach back and rewrite the methodology for every other tenant.

CREATE TABLE "TemplateDeliverable" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workstreamKey" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateDeliverable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateDeliverableTask" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateDeliverableTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TemplateDeliverable_phaseId_idx" ON "TemplateDeliverable"("phaseId");
CREATE INDEX "TemplateDeliverableTask_deliverableId_idx" ON "TemplateDeliverableTask"("deliverableId");

-- Cascades, so retiring a template or a phase never strands its content.
ALTER TABLE "TemplateDeliverable"
    ADD CONSTRAINT "TemplateDeliverable_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "TemplatePhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TemplateDeliverableTask"
    ADD CONSTRAINT "TemplateDeliverableTask_deliverableId_fkey"
    FOREIGN KEY ("deliverableId") REFERENCES "TemplateDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
