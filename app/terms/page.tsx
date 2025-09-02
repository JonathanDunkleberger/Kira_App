// app/terms/page.tsx

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0b0b12] text-white p-4 md:p-8">
      <div className="w-full max-w-2xl mx-auto prose prose-invert">
        <h1>Terms of Service for Kira AI</h1>
        <p>Last updated: September 1, 2025</p>
        <p>
          By accessing or using Kira AI ("Service"), you agree to be bound by these Terms. If you disagree with any part of the terms, then you may not access the Service.
        </p>

        <h2>Subscriptions</h2>
        <p>
          Some parts of the Service are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis ("Billing Cycle"). Billing cycles are set on a monthly basis.
        </p>
        <p>
          Your Subscription will automatically renew under the exact same conditions unless you cancel it or we cancel it. You may cancel your Subscription renewal through your online account management page provided by our third-party payment processor, Stripe.
        </p>

        <h2>Accounts</h2>
        <p>
          When you create an account with us, you must provide us with information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.
        </p>

        <h2>Termination</h2>
        <p>
          We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.
        </p>

        <h2>Changes</h2>
        <p>
          We reserve the right, at our sole discretion, to modify or replace these Terms at any time.
        </p>

        <h2>Contact Us</h2>
        <p>
          If you have any questions about these Terms, please contact us at <a href="mailto:info@elsaresearch.co">info@elsaresearch.co</a>.
        </p>
      </div>
    </main>
  );
}
