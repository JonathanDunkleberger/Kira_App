import { currentUser } from '@clerk/nextjs/server';

import { prisma } from './prisma';

export async function ensureUser() {
  const cu = await currentUser();
  if (!cu) return null;
  const email = cu.emailAddresses?.[0]?.emailAddress || `${cu.id}@placeholder.local`;
  const user = await prisma.user.upsert({
    where: { id: cu.id },
    create: { id: cu.id, email },
    update: { email },
  });
  return user;
}
