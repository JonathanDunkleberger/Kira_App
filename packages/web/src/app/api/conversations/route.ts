import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const searchQuery = request.nextUrl.searchParams.get("q")?.trim();

    // Base where clause
    const where: any = { userId };

    // If search query provided, filter by summary or message content
    if (searchQuery && searchQuery.length >= 2) {
      where.OR = [
        { summary: { contains: searchQuery, mode: "insensitive" } },
        { messages: { some: { content: { contains: searchQuery, mode: "insensitive" } } } },
      ];
    }

    let conversations;
    try {
      conversations = await prisma.conversation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          summary: true,
          messages: {
            take: 4,
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
    } catch (selectErr: any) {
      // Fallback if summary column doesn't exist yet
      if (selectErr.message?.includes("summary") || selectErr.code === "P2022") {
        console.warn("[CONVERSATIONS_GET] summary column not found — fetching without it.");
        const fallbackWhere: any = { userId };
        if (searchQuery && searchQuery.length >= 2) {
          fallbackWhere.messages = { some: { content: { contains: searchQuery, mode: "insensitive" } } };
        }
        conversations = await prisma.conversation.findMany({
          where: fallbackWhere,
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            createdAt: true,
            messages: {
              take: 4,
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
      } else {
        throw selectErr;
      }
    }

    return NextResponse.json(conversations);
  } catch (error) {
    console.error("[CONVERSATIONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
