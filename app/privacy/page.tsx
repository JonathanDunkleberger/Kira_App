export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-white/90">
      <h1 className="text-3xl font-semibold mb-6">Privacy Policy</h1>
      <div className="space-y-6 text-sm leading-6">
        <section>
          <h2 className="text-xl font-semibold mb-2">Data Collection</h2>
          <p>
            We collect the email address you sign up with and the content of your conversations with Kira. This
            may include text and audio transcripts you provide.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold mb-2">Data Usage</h2>
          <p>
            We use your data to provide, maintain, and improve the service, including generating responses, detecting
            abuse, and enhancing quality. We may use aggregated, anonymized data to improve our models and product
            experience.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold mb-2">Data Sharing</h2>
          <p>
            To process AI features, we may share data with providers such as OpenAI, Google, or Azure. These
            providers process the data to generate responses or perform speech-to-text and text-to-speech. We do not
            sell your personal data.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold mb-2">User Rights</h2>
          <p>
            You can delete your account at any time, which will remove your profile and conversations. To delete
            your data, go to your profile and use the Delete Account option. If you have any questions, contact us.
          </p>
        </section>
      </div>
    </main>
  );
}
