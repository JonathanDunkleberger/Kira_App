import SimpleConversation from '@/components/SimpleConversation'

export default function Page() {
  return (
    <main className="min-h-screen bg-[#0b0b12] text-white">
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold mb-6">Simple Conversation (Preview)</h1>
        <SimpleConversation />
      </div>
    </main>
  )
}
