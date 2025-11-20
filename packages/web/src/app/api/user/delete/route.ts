import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE() {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 1. Delete from Database (Prisma)
    // Due to onDelete: Cascade in schema, this should delete conversations and messages too.
    await prisma.user.delete({
      where: {
        clerkId: userId,
      },
    });

    // 2. Delete from Clerk
    await clerkClient.users.deleteUser(userId);

    return new NextResponse("User deleted", { status: 200 });
  } catch (error) {
    console.error("[DELETE_ACCOUNT]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
