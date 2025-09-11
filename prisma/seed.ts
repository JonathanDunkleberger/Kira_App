import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { id: 'seed-user-1' },
    update: {},
    create: {
      id: 'seed-user-1',
      email: 'seed@example.com',
      // plan defaults to FREE
    },
  });

  const convo = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: 'Seed Conversation',
      messages: {
        create: [
          { role: 'user', text: 'Hello there!' },
          { role: 'assistant', text: 'Hi! How can I help you today?' },
        ],
      },
    },
    include: { messages: true },
  });

  console.log('Seeded user id:', user.id);
  console.log('Conversation id:', convo.id, 'messages:', convo.messages.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
