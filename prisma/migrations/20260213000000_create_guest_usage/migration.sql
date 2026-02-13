-- CreateTable: GuestUsage
-- Tracks daily usage seconds for guest (unauthenticated) users.
CREATE TABLE IF NOT EXISTS "GuestUsage" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GuestUsage_guestId_date_key" ON "GuestUsage"("guestId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GuestUsage_guestId_idx" ON "GuestUsage"("guestId");
