-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('WAITING_REQUIREMENTS', 'TREATMENT', 'WAITING_APPROVAL', 'READY', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'CLIENT_PREVIEW', 'REVISIONS', 'READY_DELIVERY', 'DELIVERED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProductionAssetKind" AS ENUM ('SCRIPT', 'TREATMENT');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('SCRIPT', 'TREATMENT', 'PREVIEW', 'FINAL_DELIVERY');

-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('INCLUDED', 'CORRECTION', 'SCOPE_CHANGE', 'PAID_EXTRA');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('REQUIREMENT', 'SCRIPT', 'PREVIEW', 'REVISION', 'FINAL', 'SOURCE');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "notes" TEXT,
    "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL',
    "requirementsComplete" BOOLEAN NOT NULL DEFAULT false,
    "stage" "ProjectStage" NOT NULL DEFAULT 'WAITING_REQUIREMENTS',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "productionStartedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "subscriptionCycleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProductionAssetKind" NOT NULL,
    "number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "reviewNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "versionId" TEXT,
    "deliverableId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "RevisionKind" NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "RevisionStatus" NOT NULL DEFAULT 'OPEN',
    "outputVersionId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "errors" TEXT,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,

    CONSTRAINT "ProductionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPause" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "justified" BOOLEAN NOT NULL,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedById" TEXT,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_teamId_stage_dueAt_idx" ON "Project"("teamId", "stage", "dueAt");

-- CreateIndex
CREATE INDEX "Project_executorId_stage_dueAt_idx" ON "Project"("executorId", "stage", "dueAt");

-- CreateIndex
CREATE INDEX "Project_clientId_createdAt_idx" ON "Project"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectId_assignedAt_idx" ON "ProjectAssignment"("projectId", "assignedAt");

-- CreateIndex
CREATE INDEX "ProjectAssignment_executorId_endedAt_idx" ON "ProjectAssignment"("executorId", "endedAt");

-- CreateIndex
CREATE INDEX "ProductionTask_projectId_doneAt_idx" ON "ProductionTask"("projectId", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionVersion_projectId_kind_number_key" ON "ProductionVersion"("projectId", "kind", "number");

-- CreateIndex
CREATE INDEX "Approval_projectId_kind_approvedAt_idx" ON "Approval"("projectId", "kind", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_projectId_number_key" ON "Revision"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Deliverable_projectId_version_key" ON "Deliverable"("projectId", "version");

-- CreateIndex
CREATE INDEX "QualityReview_projectId_createdAt_idx" ON "QualityReview"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionEvent_requestId_key" ON "ProductionEvent"("requestId");

-- CreateIndex
CREATE INDEX "ProductionEvent_projectId_occurredAt_idx" ON "ProductionEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectPause_projectId_endedAt_idx" ON "ProjectPause"("projectId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_projectId_kind_idx" ON "Attachment"("projectId", "kind");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionVersion" ADD CONSTRAINT "ProductionVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReview" ADD CONSTRAINT "QualityReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionEvent" ADD CONSTRAINT "ProductionEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPause" ADD CONSTRAINT "ProjectPause_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Server-only tables. No direct Supabase anon/authenticated access.
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductionTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductionVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Approval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Revision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deliverable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductionEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectPause" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Project", "ProjectAssignment", "ProductionTask", "ProductionVersion", "Approval", "Revision", "Deliverable", "QualityReview", "ProductionEvent", "ProjectPause", "Attachment" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "Project", "ProjectAssignment", "ProductionTask", "ProductionVersion", "Approval", "Revision", "Deliverable", "QualityReview", "ProductionEvent", "ProjectPause", "Attachment" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "Project", "ProjectAssignment", "ProductionTask", "ProductionVersion", "Approval", "Revision", "Deliverable", "QualityReview", "ProductionEvent", "ProjectPause", "Attachment" FROM authenticated;
  END IF;
END $$;
CREATE UNIQUE INDEX project_one_current_assignment ON "ProjectAssignment" ("projectId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX project_one_active_pause ON "ProjectPause" ("projectId") WHERE "endedAt" IS NULL;
ALTER TABLE "Attachment" ADD CONSTRAINT attachment_nonnegative_size CHECK ("sizeBytes" >= 0);
