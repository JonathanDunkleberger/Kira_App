-- AlterTable: Remove foreign key constraint on MemoryFact.userId
ALTER TABLE "MemoryFact" DROP CONSTRAINT IF EXISTS "MemoryFact_userId_fkey";
