CREATE TABLE "MutationRequest" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MutationRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MutationRequest_actorId_createdAt_idx" ON "MutationRequest"("actorId", "createdAt");
ALTER TABLE "MutationRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MutationRequest" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "MutationRequest" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "MutationRequest" FROM authenticated; END IF;
END $$;
