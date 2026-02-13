import { PrismaClient } from "@prisma/client";

// Shared PrismaClient instance — prevents multiple connection pools
const prisma = new PrismaClient();

export default prisma;
