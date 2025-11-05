import dynamic from "next/dynamic";

const DynamicChatClient = dynamic(() => import("./ChatClient"), {
  ssr: false,
});

export default function ChatPage() {
  return <DynamicChatClient />;
}
