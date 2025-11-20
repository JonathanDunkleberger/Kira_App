import dynamic from "next/dynamic";

export const dynamic = 'force-dynamic';

const DynamicChatClient = dynamic(() => import("./ChatClient"), {
  ssr: false,
});

export default function ChatPage() {
  return <DynamicChatClient />;
}
