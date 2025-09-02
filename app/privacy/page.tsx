export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0b0b12] text-white p-4 md:p-8">
      <div className="w-full max-w-2xl mx-auto prose prose-invert">
        <h1>Privacy Policy for Kira AI</h1>
        <p>Last updated: September 1, 2025</p>

        <h2>1. Data We Collect</h2>
        <p>To provide our service, we collect the following information:</p>
        <ul>
          <li><b>Account Information:</b> Your email address when you register.</li>
          <li><b>Conversation Data:</b> The content of your voice conversations with Kira, including audio files and their text transcriptions.</li>
          <li><b>Payment Information:</b> We use Stripe to process payments. We do not store your credit card details on our servers.</li>
        </ul>

        <h2>2. How We Use Your Data</h2>
        <p>Your data is used to:</p>
        <ul>
          <li>Provide and maintain the Kira AI service.</li>
          <li>Process your subscription payments through Stripe.</li>
          <li>Improve the quality and accuracy of our AI models. All data used for improvement is anonymized where possible.</li>
          <li>Communicate with you for support and service updates.</li>
        </ul>

        <h2>3. Third-Party Sharing</h2>
        <p>Kira AI relies on third-party services to function. We share data with the following providers solely for the purpose of operating the application:</p>
        <ul>
          <li><b>Supabase:</b> For database hosting and user authentication.</li>
          <li><b>Stripe:</b> For secure payment processing.</li>
          <li><b>OpenAI, Google, Microsoft Azure:</b> For Speech-to-Text (STT), AI language model (LLM) responses, and Text-to-Speech (TTS) services.</li>
        </ul>
        <p>We do not sell your personal data to any third parties.</p>

        <h2>4. Data Deletion</h2>
        <p>You can delete your account and all associated conversation data at any time from your account page. This action is irreversible.</p>
        
        <h2>5. Contact Us</h2>
        <p>If you have any questions about this privacy policy, please contact us at <a href="mailto:support@kira-ai.app">support@kira-ai.app</a>.</p>
      </div>
    </main>
  );
}
