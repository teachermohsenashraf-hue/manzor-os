-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'NO_RESPONSE', 'INTERESTED', 'DEFERRED', 'QUOTE_REQUESTED', 'NEGOTIATING', 'ACCEPTED', 'DECLINED', 'CLIENT');


-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');


-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('CALL', 'MESSAGE', 'NOTE', 'STATUS', 'FOLLOW_UP', 'CONVERSION');


-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "communicatorId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "capacityLimit" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "sector" TEXT,
    "phone" TEXT,
    "phoneNorm" TEXT,
    "whatsapp" TEXT,
    "whatsappNorm" TEXT,
    "socialUrl" TEXT,
    "socialNorm" TEXT,
    "source" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "teamId" TEXT NOT NULL,
    "lastContactAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "ContactActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "statusBefore" "LeadStatus",
    "statusAfter" "LeadStatus",
    "outcome" TEXT,
    "note" TEXT,
    "followUpAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,

    CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "Team_communicatorId_active_idx" ON "Team"("communicatorId", "active");


-- CreateIndex
CREATE INDEX "Team_executorId_active_idx" ON "Team"("executorId", "active");


-- CreateIndex
CREATE INDEX "Lead_teamId_status_nextFollowUpAt_idx" ON "Lead"("teamId", "status", "nextFollowUpAt");


-- CreateIndex
CREATE INDEX "Lead_teamId_priority_createdAt_idx" ON "Lead"("teamId", "priority", "createdAt");


-- CreateIndex
CREATE INDEX "Lead_phoneNorm_idx" ON "Lead"("phoneNorm");


-- CreateIndex
CREATE INDEX "Lead_whatsappNorm_idx" ON "Lead"("whatsappNorm");


-- CreateIndex
CREATE INDEX "Lead_socialNorm_idx" ON "Lead"("socialNorm");


-- CreateIndex
CREATE UNIQUE INDEX "ContactActivity_requestId_key" ON "ContactActivity"("requestId");


-- CreateIndex
CREATE INDEX "ContactActivity_leadId_occurredAt_idx" ON "ContactActivity"("leadId", "occurredAt");


-- CreateIndex
CREATE INDEX "ContactActivity_actorId_occurredAt_idx" ON "ContactActivity"("actorId", "occurredAt");


-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_assignedAt_idx" ON "LeadAssignment"("leadId", "assignedAt");


-- CreateIndex
CREATE INDEX "LeadAssignment_teamId_endedAt_idx" ON "LeadAssignment"("teamId", "endedAt");


-- CreateIndex
CREATE UNIQUE INDEX "Client_leadId_key" ON "Client"("leadId");


-- CreateIndex
CREATE INDEX "Client_convertedAt_idx" ON "Client"("convertedAt");


-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_communicatorId_fkey" FOREIGN KEY ("communicatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Team", "Lead", "ContactActivity", "LeadAssignment", "Client" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
  REVOKE ALL ON TABLE "Team", "Lead", "ContactActivity", "LeadAssignment", "Client" FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  REVOKE ALL ON TABLE "Team", "Lead", "ContactActivity", "LeadAssignment", "Client" FROM authenticated;
 END IF;
END $$;
CREATE UNIQUE INDEX team_one_active_communicator ON "Team" ("communicatorId") WHERE "active" = true;
CREATE UNIQUE INDEX team_one_active_executor ON "Team" ("executorId") WHERE "active" = true;
CREATE UNIQUE INDEX lead_one_current_assignment ON "LeadAssignment" ("leadId") WHERE "endedAt" IS NULL;
ALTER TABLE "Team" ADD CONSTRAINT team_capacity_positive CHECK ("capacityLimit" >= 5);