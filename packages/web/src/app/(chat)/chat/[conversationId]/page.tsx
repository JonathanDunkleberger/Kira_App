import nextDynamic from "next/dynamic";

export const dynamic = 'force-dynamic';

const DynamicChatClient = nextDynamic(() => import("./ChatClient"), {
  ssr: false,
});

export default function ChatPage() {
  return <DynamicChatClient />;
}
