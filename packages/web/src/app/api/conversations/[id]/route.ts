import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId } = auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await Promise.resolve(params);

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
      select: {
        id: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("[CONVERSATION_GET] Full error:", error);
    console.error("[CONVERSATION_GET] Stack:", (error as Error).stack);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await Promise.resolve(params);

    // Verify the conversation belongs to this user
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Cascade delete handles messages automatically (onDelete: Cascade in schema)
    await prisma.conversation.delete({
      where: { id: conversationId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] Delete conversation error:", err);
    console.error("[API] Delete conversation stack:", (err as Error).stack);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
