-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('SINGLE', 'BUNDLE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderDecisionKind" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderChangeKind" AS ENUM ('SCOPE', 'ADD_SERVICE', 'ADD_QUANTITY');

-- CreateEnum
CREATE TYPE "OrderChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cycleItemId" TEXT,
ADD COLUMN     "orderItemId" TEXT;

-- Link an approved commercial change to a production revision without modifying old rows
ALTER TABLE "Revision" ADD COLUMN "orderChangeId" TEXT;

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "productionType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceComponent" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ServiceComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceVersion" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "marketCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "agreementRef" TEXT,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "proposedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "priceVersionId" TEXT NOT NULL,
    "serviceNameSnapshot" TEXT NOT NULL,
    "serviceKindSnapshot" "ServiceKind" NOT NULL,
    "productionTypeSnapshot" TEXT NOT NULL,
    "componentSnapshot" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "assignedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDecision" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderDecisionKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "orderVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderChange" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "appliedItemId" TEXT,
    "serviceId" TEXT,
    "kind" "OrderChangeKind" NOT NULL,
    "status" "OrderChangeStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT NOT NULL,
    "quantityDelta" INTEGER,
    "proposedScope" TEXT,
    "priceImpactMinor" BIGINT,
    "deadlineImpactAt" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionRef" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "cycleDays" INTEGER NOT NULL,
    "renewalOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCycle" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'PLANNED',
    "deliveryPlan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleItem" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "plannedQuantity" INTEGER NOT NULL,
    "assignedQuantity" INTEGER NOT NULL DEFAULT 0,
    "deliveryPlan" TEXT,

    CONSTRAINT "CycleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_code_key" ON "Service"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceComponent_parentId_childId_key" ON "ServiceComponent"("parentId", "childId");

-- CreateIndex
CREATE INDEX "PriceVersion_marketCode_currency_effectiveFrom_idx" ON "PriceVersion"("marketCode", "currency", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PriceVersion_serviceId_marketCode_effectiveFrom_key" ON "PriceVersion"("serviceId", "marketCode", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CustomerOrder_teamId_status_createdAt_idx" ON "CustomerOrder"("teamId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrder_clientId_createdAt_idx" ON "CustomerOrder"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_serviceId_idx" ON "OrderItem"("orderId", "serviceId");

-- CreateIndex
CREATE INDEX "OrderDecision_orderId_createdAt_idx" ON "OrderDecision"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderChange_orderId_status_createdAt_idx" ON "OrderChange"("orderId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orderId_key" ON "Subscription"("orderId");

-- CreateIndex
CREATE INDEX "Subscription_status_endsAt_idx" ON "Subscription"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCycle_subscriptionId_number_key" ON "SubscriptionCycle"("subscriptionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CycleItem_cycleId_serviceId_key" ON "CycleItem"("cycleId", "serviceId");

-- CreateIndex
CREATE INDEX "Project_orderItemId_idx" ON "Project"("orderItemId");

-- CreateIndex
CREATE INDEX "Project_cycleItemId_idx" ON "Project"("cycleItemId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_subscriptionCycleId_fkey" FOREIGN KEY ("subscriptionCycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_cycleItemId_fkey" FOREIGN KEY ("cycleItemId") REFERENCES "CycleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceComponent" ADD CONSTRAINT "ServiceComponent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceComponent" ADD CONSTRAINT "ServiceComponent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceVersion" ADD CONSTRAINT "PriceVersion_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceVersion" ADD CONSTRAINT "PriceVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_priceVersionId_fkey" FOREIGN KEY ("priceVersionId") REFERENCES "PriceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDecision" ADD CONSTRAINT "OrderDecision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDecision" ADD CONSTRAINT "OrderDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_appliedItemId_fkey" FOREIGN KEY ("appliedItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_renewalOfId_fkey" FOREIGN KEY ("renewalOfId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCycle" ADD CONSTRAINT "SubscriptionCycle_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleItem" ADD CONSTRAINT "CycleItem_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleItem" ADD CONSTRAINT "CycleItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleItem" ADD CONSTRAINT "CycleItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Revision_orderChangeId_idx" ON "Revision"("orderChangeId");
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_orderChangeId_fkey" FOREIGN KEY ("orderChangeId") REFERENCES "OrderChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Commercial data is only accessed through authenticated server actions
ALTER TABLE "Service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceComponent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CycleItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Service", "ServiceComponent", "PriceVersion", "CustomerOrder", "OrderItem", "OrderDecision", "OrderChange", "Subscription", "SubscriptionCycle", "CycleItem" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "Service", "ServiceComponent", "PriceVersion", "CustomerOrder", "OrderItem", "OrderDecision", "OrderChange", "Subscription", "SubscriptionCycle", "CycleItem" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "Service", "ServiceComponent", "PriceVersion", "CustomerOrder", "OrderItem", "OrderDecision", "OrderChange", "Subscription", "SubscriptionCycle", "CycleItem" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "ServiceComponent" ADD CONSTRAINT service_component_positive CHECK ("quantity" > 0 AND "parentId" <> "childId");
ALTER TABLE "PriceVersion" ADD CONSTRAINT price_version_valid CHECK ("amountMinor" >= 0 AND "currency" ~ '^[A-Z]{3}$' AND "marketCode" ~ '^[A-Z]{2}$' AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
CREATE UNIQUE INDEX price_one_open_version ON "PriceVersion" ("serviceId", "marketCode") WHERE "effectiveTo" IS NULL;
ALTER TABLE "CustomerOrder" ADD CONSTRAINT customer_order_valid CHECK ("version" > 0 AND "totalMinor" >= 0 AND "currency" ~ '^[A-Z]{3}$' AND "marketCode" ~ '^[A-Z]{2}$');
ALTER TABLE "OrderItem" ADD CONSTRAINT order_item_positive CHECK ("quantity" > 0 AND "assignedQuantity" >= 0 AND "unitMinor" >= 0);
ALTER TABLE "OrderChange" ADD CONSTRAINT order_change_quantity_positive CHECK ("quantityDelta" IS NULL OR "quantityDelta" > 0);
ALTER TABLE "Subscription" ADD CONSTRAINT subscription_dates_valid CHECK ("endsAt" > "startsAt" AND "cycleDays" > 0);
ALTER TABLE "SubscriptionCycle" ADD CONSTRAINT cycle_dates_valid CHECK ("endsAt" > "startsAt" AND "number" > 0);
ALTER TABLE "CycleItem" ADD CONSTRAINT cycle_item_positive CHECK ("plannedQuantity" > 0 AND "assignedQuantity" >= 0 AND "assignedQuantity" <= "plannedQuantity");
