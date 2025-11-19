import { config } from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// Load env from packages/web/.env.local
const envPath = path.resolve(__dirname, '../packages/web/.env.local');
console.log(`Loading env from: ${envPath}`);
config({ path: envPath });

const prisma = new PrismaClient();

async function test() {
    try {
        console.log('Testing Database Connection...');
        const count = await prisma.user.count();
        console.log(`✅ Database connected. User count: ${count}`);
    } catch (error: any) {
        console.error('❌ Database Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

test();
