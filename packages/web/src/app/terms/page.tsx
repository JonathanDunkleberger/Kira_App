import React from 'react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-tokyo-bg text-gray-900 dark:text-tokyo-fg p-8 md:p-16">
      <div className="max-w-3xl mx-auto prose dark:prose-invert">
        <h1>Terms of Service for Kira AI</h1>

        <h2>1. Acceptance of Terms</h2>
        <p>By accessing Kira AI, you agree to these Terms. If you do not agree, do not use the service.</p>

        <h2>2. Description of Service</h2>
        <p>Kira AI is a prototype conversational AI application. It is provided "as is" and "as available." We make no guarantees regarding uptime, accuracy of AI responses, or latency.</p>

        <h2>3. Subscriptions and Limits</h2>
        <ul>
          <li><strong>Free Tier:</strong> Limited to approximately 15 minutes of usage per day.</li>
          <li><strong>Pro Subscription:</strong> Costs $4.99/month. Grants approximately 4 hours of usage per day.</li>
          <li><strong>Cancellation:</strong> You may cancel your subscription at any time via your Profile settings. Access remains through the end of the billing period. No refunds are issued for partial months.</li>
        </ul>

        <h2>4. User Conduct</h2>
        <p>You agree not to use the AI to generate illegal, harmful, or abusive content. We reserve the right to terminate accounts that violate this policy without refund.</p>

        <h2>5. Disclaimer of Warranties</h2>
        <p>This project is in active development. The AI may hallucinate, produce incorrect information, or experience downtime. We are not liable for any damages resulting from the use of this service.</p>

        <h2>6. Changes to Terms</h2>
        <p>We reserve the right to modify these terms at any time. Continued use constitutes acceptance of the new terms.</p>
      </div>
    </div>
  );
}
