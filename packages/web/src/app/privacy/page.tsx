import React from 'react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-tokyo-bg text-gray-900 dark:text-tokyo-fg p-8 md:p-16">
      <div className="max-w-3xl mx-auto prose dark:prose-invert">
        <h1>Privacy Policy for Kira AI</h1>
        <p className="text-sm text-gray-500">Last Updated: November 25, 2025</p>

        <h2>1. Introduction</h2>
        <p>Welcome to Kira AI. This Privacy Policy explains how we collect, use, and protect your information when you use our conversational AI application.</p>

        <h2>2. Information We Collect</h2>
        <ul>
          <li><strong>Audio Data:</strong> To enable voice conversation, we transmit your audio input to our third-party processors.</li>
          <li><strong>Visual Data:</strong> If you use vision capabilities, image data is processed to allow the AI to "see" your context.</li>
          <li><strong>Account Information:</strong> If you subscribe, we collect your email and payment status (handled securely via Stripe).</li>
        </ul>

        <h2>3. How We Use Your Data</h2>
        <p>We use your data solely to provide the conversational service.</p>
        <ul>
          <li><strong>Audio & Text:</strong> Sent to Deepgram (transcription/voice) and OpenAI (intelligence) to generate responses.</li>
          <li><strong>Infrastructure:</strong> Hosted on Vercel and Render, utilizing Azure services.</li>
        </ul>

        <h2>4. Data Retention</h2>
        <p>We aim to minimize data storage. However, conversation logs may be temporarily processed to maintain conversation context. We do not sell your personal data to third parties.</p>

        <h2>5. Third-Party Services</h2>
        <p>We utilize the following third-party APIs. Their privacy policies govern their handling of your data:</p>
        <ul>
          <li>OpenAI</li>
          <li>Deepgram</li>
          <li>Microsoft Azure</li>
        </ul>

        <h2>6. Contact</h2>
        <p>For privacy concerns, please contact us at: support@xoxokira.com</p>
      </div>
    </div>
  );
}
