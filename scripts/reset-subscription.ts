import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Try to load .env from root
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  console.log(`Loading .env from ${envPath}`);
  dotenv.config({ path: envPath });
} else {
    console.log('.env file not found at ' + envPath);
}

const prisma = new PrismaClient();

async function main() {
  const email = 'jonny.dunk52@gmail.com';
  console.log(`Looking for user with email: ${email}`);

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.log('User not found.');
    return;
  }

  console.log(`Found user: ${user.id}`);
  console.log(`Current Stripe Customer ID: ${user.stripeCustomerId}`);
  console.log(`Current Subscription ID: ${user.stripeSubscriptionId}`);

  const updatedUser = await prisma.user.update({
    where: { email },
    data: {
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeCurrentPeriodEnd: null,
    },
  });

  console.log('User updated successfully.');
  console.log(`New Stripe Customer ID: ${updatedUser.stripeCustomerId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
