import React from "react";
import Link from "next/link";

export default function TermsPage() {
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
            marginBottom: 48,
            lineHeight: 1.2,
          }}
        >
          Terms of Service
        </h1>

        {/* Sections */}
        {[
          {
            title: "1. Acceptance of Terms",
            content:
              "By accessing Kira AI, you agree to these Terms. If you do not agree, do not use the service.",
          },
          {
            title: "2. Description of Service",
            content:
              'Kira AI is a prototype conversational AI application. It is provided "as is" and "as available." We make no guarantees regarding uptime, accuracy of AI responses, or latency.',
          },
          {
            title: "3. Subscriptions and Limits",
            content: null,
            list: [
              { label: "Free Tier", text: "Limited to approximately 15 minutes of usage per day." },
              { label: "Pro Subscription", text: "Costs $9.99/month. Grants unlimited conversations subject to our Fair Use Policy (see below)." },
              { label: "Cancellation", text: "You may cancel your subscription at any time via your Profile settings. Access remains through the end of the billing period. No refunds are issued for partial months." },
            ],
          },
          {
            title: "4. Fair Use Policy",
            content: "Pro subscriptions are marketed as \"unlimited\" and are intended for generous personal use. To ensure a quality experience for all users, Pro accounts are subject to a soft monthly cap of approximately 100 hours of conversation time per calendar month. If you reach this limit, access will resume on the 1st of the following month. This cap is well beyond what the vast majority of users will ever approach. We reserve the right to adjust fair-use thresholds as the service evolves.",
          },
          {
            title: "5. User Conduct",
            content:
              "You agree not to use the AI to generate illegal, harmful, or abusive content. We reserve the right to terminate accounts that violate this policy without refund.",
          },
          {
            title: "6. Disclaimer of Warranties",
            content:
              "This project is in active development. The AI may hallucinate, produce incorrect information, or experience downtime. We are not liable for any damages resulting from the use of this service.",
          },
          {
            title: "7. Changes to Terms",
            content:
              "We reserve the right to modify these terms at any time. Continued use constitutes acceptance of the new terms.",
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
                    <strong style={{ color: "rgba(201,209,217,0.8)", fontWeight: 500 }}>
                      {item.label}:
                    </strong>{" "}
                    {item.text}
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
