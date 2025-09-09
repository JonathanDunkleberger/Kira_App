import { PrismaClient } from '@prisma/client';

// Lazy singleton accessor to avoid connecting during module evaluation in build step
const globalForPrisma = globalThis as unknown as { _prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma._prisma) {
    globalForPrisma._prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return globalForPrisma._prisma;
}

// Backwards compat named export (deprecated): import { prisma } from '...'
export const prisma: PrismaClient = getPrisma();
