import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        messages: {
          take: 4, // First few messages for preview
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    return NextResponse.json(conversations);
  } catch (error) {
    console.error("[CONVERSATIONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
