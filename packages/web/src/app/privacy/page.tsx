import React from "react";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        color: "#C9D1D9",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        fontWeight: 300,
        lineHeight: 1.8,
      }}
    >
      {/* Nav */}
      <nav
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "32px 24px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: 15,
            color: "rgba(139,157,195,0.5)",
            textDecoration: "none",
            fontWeight: 400,
          }}
        >
          ← Back
        </Link>
      </nav>

      {/* Content */}
      <article
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "48px 24px 80px",
        }}
      >
        <h1
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 32,
            fontWeight: 400,
            color: "#E2E8F0",
            marginBottom: 8,
            lineHeight: 1.2,
          }}
        >
          Privacy Policy
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "rgba(201,209,217,0.3)",
            marginBottom: 48,
          }}
        >
          Last Updated: November 25, 2025
        </p>

        {/* Sections */}
        {[
          {
            title: "1. Introduction",
            content:
              "Welcome to Kira AI. This Privacy Policy explains how we collect, use, and protect your information when you use our conversational AI application.",
          },
          {
            title: "2. Information We Collect",
            content: null,
            list: [
              { label: "Audio Data", text: "To enable voice conversation, we transmit your audio input to our third-party processors." },
              { label: "Visual Data", text: "If you use vision capabilities, image data is processed to allow the AI to \"see\" your context." },
              { label: "Account Information", text: "If you subscribe, we collect your email and payment status (handled securely via Stripe)." },
            ],
          },
          {
            title: "3. How We Use Your Data",
            content: "We use your data solely to provide the conversational service.",
            list: [
              { label: "Audio & Text", text: "Sent to Deepgram (transcription), OpenAI (intelligence), and Microsoft Azure (text-to-speech) to generate responses." },
              { label: "Infrastructure", text: "Hosted on Vercel and Render." },
            ],
          },
          {
            title: "4. Guest User Data",
            content:
              "When you use Kira without creating an account, we assign a random anonymous identifier stored in your browser. We use this identifier to remember context from your previous conversations so Kira can provide a more natural, personalized experience, and to track daily usage for free tier limits.",
          },
          {
            title: "5. Guest Data Retention",
            content:
              "Guest conversation data is stored for up to 30 days and then automatically deleted. This data is not linked to your name, email, or any personally identifiable information. If you create an account, your guest conversation history may be transferred to your account to preserve continuity. To delete your guest data at any time, clear your browser's local storage for our site, which will remove the anonymous identifier and disconnect you from any stored conversation history.",
          },
          {
            title: "6. Registered User Data",
            content:
              "When you create an account, we store conversation summaries and extracted preferences (such as topics you've discussed, interests you've mentioned, and your name if provided) to personalize your experience with Kira. Full conversation transcripts are stored for active conversations and may be summarized and compressed over time. You can delete your account and all associated data at any time from your account settings. Deletion is immediate and permanent.",
          },
          {
            title: "7. General Data Retention",
            content:
              "We aim to minimize data storage. However, conversation logs may be temporarily processed to maintain conversation context. We do not sell your personal data to third parties.",
          },
          {
            title: "8. Third-Party Services",
            content: "We utilize the following third-party APIs. Their privacy policies govern their handling of your data:",
            list: [
              { label: "", text: "OpenAI" },
              { label: "", text: "Deepgram" },
              { label: "", text: "Microsoft Azure" },
            ],
          },
          {
            title: "9. Contact",
            content:
              "For privacy concerns, please contact us at: info@elsaresearch.co",
          },
        ].map((section, i) => (
          <div key={i}>
            {i > 0 && (
              <div
                style={{
                  height: 1,
                  background: "rgba(255,255,255,0.04)",
                  margin: "32px 0",
                }}
              />
            )}
            <h2
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 20,
                fontWeight: 400,
                color: "#E2E8F0",
                marginBottom: 12,
              }}
            >
              {section.title}
            </h2>
            {section.content && (
              <p style={{ color: "rgba(201,209,217,0.6)", margin: "0 0 12px" }}>
                {section.content}
              </p>
            )}
            {section.list && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {section.list.map((item, j) => (
                  <li
                    key={j}
                    style={{
                      color: "rgba(201,209,217,0.6)",
                      paddingLeft: 16,
                      position: "relative",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        color: "rgba(139,157,195,0.4)",
                      }}
                    >
                      ·
                    </span>
                    {item.label ? (
                      <>
                        <strong style={{ color: "rgba(201,209,217,0.8)", fontWeight: 500 }}>
                          {item.label}:
                        </strong>{" "}
                        {item.text}
                      </>
                    ) : (
                      item.text
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </article>

      {/* Footer */}
      <footer
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "24px 24px 48px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          textAlign: "center",
          fontSize: 13,
          color: "rgba(201,209,217,0.2)",
        }}
      >
        © {new Date().getFullYear()} Kira AI
      </footer>
    </div>
  );
}
