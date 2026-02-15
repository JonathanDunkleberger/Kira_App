import React from "react";
import Link from "next/link";

/* ── shared inline styles ─────────────────────────────────── */
const sectionDivider: React.CSSProperties = {
  height: 1,
  background: "rgba(255,255,255,0.04)",
  margin: "32px 0",
};
const h2Style: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 400,
  color: "#E2E8F0",
  marginBottom: 12,
};
const h3Style: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: "rgba(201,209,217,0.85)",
  marginBottom: 8,
  marginTop: 20,
};
const pStyle: React.CSSProperties = {
  color: "rgba(201,209,217,0.6)",
  margin: "0 0 12px",
};
const bulletStyle: React.CSSProperties = {
  color: "rgba(201,209,217,0.6)",
  paddingLeft: 16,
  position: "relative",
  marginBottom: 8,
};
const dotStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  color: "rgba(139,157,195,0.4)",
};
const boldStyle: React.CSSProperties = {
  color: "rgba(201,209,217,0.8)",
  fontWeight: 500,
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  margin: "12px 0",
  fontSize: 14,
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  color: "rgba(201,209,217,0.8)",
  fontWeight: 500,
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  color: "rgba(201,209,217,0.55)",
  verticalAlign: "top",
};
const ulStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: "0 0 12px" };

function Bullet({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <li style={bulletStyle}>
      <span style={dotStyle}>·</span>
      {label ? (<><strong style={boldStyle}>{label}:</strong> {children}</>) : children}
    </li>
  );
}

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0D1117", color: "#C9D1D9", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", fontWeight: 300, lineHeight: 1.8 }}>
      <nav style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ fontSize: 15, color: "rgba(139,157,195,0.5)", textDecoration: "none", fontWeight: 400 }}>← Back</Link>
      </nav>

      <article style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 400, color: "#E2E8F0", marginBottom: 8, lineHeight: 1.2 }}>Privacy Policy</h1>
        <p style={{ fontSize: 13, color: "rgba(201,209,217,0.3)", marginBottom: 48 }}>Last Updated: February 14, 2026</p>

        {/* 1 */}
        <h2 style={h2Style}>1. Introduction</h2>
        <p style={pStyle}>Welcome to Kira AI ({"\u201C"}Kira,{"\u201D"} {"\u201C"}we,{"\u201D"} {"\u201C"}us,{"\u201D"} or {"\u201C"}our{"\u201D"}), operated by Elsa Research. This Privacy Policy explains how we collect, use, store, and protect your information when you use our voice-based AI companion application at xoxokira.com (the {"\u201C"}Service{"\u201D"}).</p>
        <p style={pStyle}>By using Kira, you agree to the collection and use of information as described in this policy. If you do not agree, please do not use the Service.</p>

        <div style={sectionDivider} />

        {/* 2 */}
        <h2 style={h2Style}>2. Information We Collect</h2>

        <h3 style={h3Style}>2.1 Voice and Audio Data</h3>
        <p style={pStyle}>When you use Kira{"\u2019"}s voice features, your microphone audio is streamed in real-time to our servers and forwarded to third-party processors for transcription and response generation. We do not permanently store raw audio recordings. Audio is processed in real-time and discarded after transcription.</p>

        <h3 style={h3Style}>2.2 Visual Data (Camera and Screen Share)</h3>
        <p style={pStyle}>If you choose to use Kira{"\u2019"}s vision features, we capture images from your camera or screen at periodic intervals (approximately every 15 seconds) and when you speak. These images are:</p>
        <ul style={ulStyle}>
          <Bullet>Downscaled and compressed before transmission</Bullet>
          <Bullet>Sent to OpenAI{"\u2019"}s API for visual understanding</Bullet>
          <Bullet>Used only during your active session to enable Kira to see and react to your environment</Bullet>
          <Bullet>Not permanently stored after the session ends</Bullet>
        </ul>
        <p style={pStyle}>You can enable or disable vision features at any time during a conversation. Camera and screen share require explicit permission through your browser.</p>

        <h3 style={h3Style}>2.3 Conversation Data and Memory</h3>
        <p style={pStyle}>Kira maintains a memory system to provide a personalized, ongoing relationship. This includes:</p>
        <ul style={ulStyle}>
          <Bullet label="In-conversation context">During a session, Kira maintains a rolling summary of your conversation to keep track of what you{"\u2019"}ve discussed.</Bullet>
          <Bullet label="Cross-session memory">After each conversation, Kira extracts key facts and stores them in a structured memory system. These facts are organized into categories including: your identity (name, background), preferences (interests, likes, dislikes), relationships (people you mention), emotional patterns, shared experiences with Kira, life context (work, school, goals), and opinions you{"\u2019"}ve expressed. Each fact is weighted by emotional significance to help Kira recall what matters most to you.</Bullet>
          <Bullet label="Conversation transcripts">Text transcripts of your conversations are stored to enable the memory system and conversation history features.</Bullet>
        </ul>

        <h3 style={h3Style}>2.4 Account Information</h3>
        <p style={pStyle}>If you create an account, we collect:</p>
        <ul style={ulStyle}>
          <Bullet>Email address (via Clerk, our authentication provider)</Bullet>
          <Bullet>Display name (if provided)</Bullet>
          <Bullet>Authentication tokens and login history</Bullet>
        </ul>

        <h3 style={h3Style}>2.5 Payment Information</h3>
        <p style={pStyle}>If you subscribe to Kira Pro, payment is processed entirely by Stripe. We do not store your credit card number, bank account details, or other sensitive financial information on our servers. We receive only your subscription status, billing period, and payment confirmation from Stripe.</p>

        <h3 style={h3Style}>2.6 Usage Data</h3>
        <p style={pStyle}>We track daily and monthly usage time to enforce free-tier limits and fair-use caps. This includes session duration and connection timestamps.</p>

        <h3 style={h3Style}>2.7 Device and Browser Information</h3>
        <p style={pStyle}>We collect basic technical information to deliver the Service, including browser type, device type (mobile or desktop), and screen resolution. This is used for rendering the Live2D avatar correctly and debugging technical issues.</p>

        <h3 style={h3Style}>2.8 Local Storage</h3>
        <p style={pStyle}>We use your browser{"\u2019"}s local storage to persist:</p>
        <ul style={ulStyle}>
          <Bullet>Guest identifiers (random anonymous IDs)</Bullet>
          <Bullet>Voice preference settings</Bullet>
          <Bullet>Visual mode preferences (avatar vs. orb)</Bullet>
          <Bullet>Debug and crash recovery data</Bullet>
        </ul>
        <p style={pStyle}>This data stays on your device and is not transmitted to our servers unless needed for session continuity.</p>

        <div style={sectionDivider} />

        {/* 3 */}
        <h2 style={h2Style}>3. How We Use Your Data</h2>
        <p style={pStyle}>We use your information solely to provide and improve the Kira experience:</p>
        <ul style={ulStyle}>
          <Bullet label="Deliver the Service">Process your voice input, generate AI responses, render the avatar, and enable vision features.</Bullet>
          <Bullet label="Personalization">Store memories and preferences so Kira can maintain a continuous relationship across sessions.</Bullet>
          <Bullet label="Usage management">Track session time for free-tier limits and Pro fair-use caps.</Bullet>
          <Bullet label="Technical operation">Debug issues, prevent abuse, and maintain service stability.</Bullet>
          <Bullet label="Communication">Send account-related emails (e.g., subscription confirmations, password resets) through Clerk.</Bullet>
        </ul>
        <p style={pStyle}>We do <strong style={boldStyle}>not</strong>:</p>
        <ul style={ulStyle}>
          <Bullet>Sell your personal data to third parties</Bullet>
          <Bullet>Use your conversations to train AI models (our third-party providers{"\u2019"} policies govern their own data handling {"\u2014"} see Section 5)</Bullet>
          <Bullet>Display advertising or share data with advertisers</Bullet>
          <Bullet>Profile you for marketing purposes beyond the Kira service</Bullet>
        </ul>

        <div style={sectionDivider} />

        {/* 4 */}
        <h2 style={h2Style}>4. Guest User Data</h2>
        <p style={pStyle}>When you use Kira without creating an account:</p>
        <ul style={ulStyle}>
          <Bullet>We assign a random anonymous identifier stored in your browser{"\u2019"}s local storage.</Bullet>
          <Bullet>This identifier allows Kira to remember context from your previous conversations and track daily usage limits.</Bullet>
          <Bullet>Guest conversation data and extracted memories are stored for up to <strong style={boldStyle}>30 days</strong> and then automatically deleted.</Bullet>
          <Bullet>This data is not linked to your name, email, or any personally identifiable information.</Bullet>
          <Bullet>If you later create an account, your guest conversation history and memories are automatically transferred to your new account to preserve continuity.</Bullet>
          <Bullet>To delete your guest data at any time, clear your browser{"\u2019"}s local storage for xoxokira.com. This removes the anonymous identifier and disconnects you from any stored conversation history.</Bullet>
        </ul>

        <div style={sectionDivider} />

        {/* 5 */}
        <h2 style={h2Style}>5. Third-Party Services</h2>
        <p style={pStyle}>We use the following third-party services to operate Kira. Each processes your data according to their own privacy policies:</p>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Service</th>
                <th style={thStyle}>Purpose</th>
                <th style={thStyle}>Data Shared</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["OpenAI", "AI conversation and vision processing", "Conversation text, images (if vision enabled)"],
                ["Deepgram", "Real-time speech-to-text", "Audio stream"],
                ["Microsoft Azure", "Text-to-speech (voice generation)", "Kira\u2019s response text"],
                ["Clerk", "Authentication and account management", "Email, name, login activity"],
                ["Stripe", "Payment processing", "Payment and subscription details"],
                ["Vercel", "Web hosting", "Standard web request data"],
                ["Render", "Voice server hosting", "WebSocket connection data"],
                ["Supabase", "Usage tracking database", "Usage minutes, anonymous identifiers"],
              ] as const).map(([service, purpose, data], i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 500, color: "rgba(201,209,217,0.75)" }}>{service}</td>
                  <td style={tdStyle}>{purpose}</td>
                  <td style={tdStyle}>{data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={pStyle}>We require all third-party providers to handle your data securely, but we encourage you to review their individual privacy policies for details on their data practices.</p>

        <div style={sectionDivider} />

        {/* 6 */}
        <h2 style={h2Style}>6. Data Retention</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Data Type</th>
                <th style={thStyle}>Retention Period</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Guest conversation data and memories", "30 days, then auto-deleted"],
                ["Registered user conversation data", "Retained until you delete your account"],
                ["Registered user memories", "Retained until you delete your account"],
                ["Voice audio", "Not stored \u2014 processed in real-time and discarded"],
                ["Camera/screen images", "Not stored \u2014 processed in real-time and discarded during session"],
                ["Payment records", "Retained per Stripe\u2019s policies and legal requirements"],
                ["Usage tracking data", "Retained while your account is active"],
              ] as const).map(([type, retention], i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 500, color: "rgba(201,209,217,0.75)" }}>{type}</td>
                  <td style={tdStyle}>{retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={sectionDivider} />

        {/* 7 */}
        <h2 style={h2Style}>7. Data Security</h2>
        <p style={pStyle}>We implement reasonable security measures to protect your information:</p>
        <ul style={ulStyle}>
          <Bullet>All data is transmitted over encrypted connections (HTTPS/WSS)</Bullet>
          <Bullet>Authentication tokens are verified on every WebSocket connection</Bullet>
          <Bullet>WebSocket connections enforce origin allowlists and payload size limits</Bullet>
          <Bullet>Per-connection rate limiting prevents abuse</Bullet>
          <Bullet>API keys and secrets are stored server-side and never exposed to clients</Bullet>
          <Bullet>Payment processing is handled entirely by Stripe{"\u2019"}s PCI-compliant infrastructure</Bullet>
        </ul>
        <p style={pStyle}>No method of electronic transmission or storage is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.</p>

        <div style={sectionDivider} />

        {/* 8 */}
        <h2 style={h2Style}>8. Your Rights and Choices</h2>
        <h3 style={h3Style}>All Users</h3>
        <ul style={ulStyle}>
          <Bullet label="Delete your account">Registered users can delete their account and all associated data (conversations, memories, usage records) at any time from Profile settings. Deletion is immediate and permanent.</Bullet>
          <Bullet label="Control vision features">Camera and screen share are always opt-in and can be disabled at any time.</Bullet>
          <Bullet label="Control voice input">You can mute your microphone at any time during a conversation.</Bullet>
          <Bullet label="Clear guest data">Clear your browser{"\u2019"}s local storage for xoxokira.com to remove your guest identifier and disconnect from stored data.</Bullet>
        </ul>

        <h3 style={h3Style}>California Residents (CCPA)</h3>
        <p style={pStyle}>If you are a California resident, you have additional rights under the California Consumer Privacy Act:</p>
        <ul style={ulStyle}>
          <Bullet label="Right to Know">You may request details about the personal information we collect, use, and disclose.</Bullet>
          <Bullet label="Right to Delete">You may request deletion of your personal information.</Bullet>
          <Bullet label="Right to Non-Discrimination">We will not discriminate against you for exercising your privacy rights.</Bullet>
          <Bullet label="Right to Opt-Out of Sale">We do not sell personal information, so this right does not apply.</Bullet>
        </ul>
        <p style={pStyle}>To exercise these rights, contact us at info@elsaresearch.co. We will respond within 45 days.</p>

        <h3 style={h3Style}>European Users (GDPR)</h3>
        <p style={pStyle}>If you are located in the European Economic Area, you may have additional rights including access, rectification, erasure, data portability, and the right to object to processing. Our servers are located in the United States. By using the Service, you consent to the transfer of your data to the US. To exercise your rights, contact us at info@elsaresearch.co.</p>

        <div style={sectionDivider} />

        {/* 9 */}
        <h2 style={h2Style}>9. Children{"\u2019"}s Privacy</h2>
        <p style={pStyle}>Kira is not intended for use by anyone under the age of <strong style={boldStyle}>18</strong>. We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided personal information to us, please contact us at info@elsaresearch.co and we will promptly delete that information.</p>

        <div style={sectionDivider} />

        {/* 10 */}
        <h2 style={h2Style}>10. Changes to This Policy</h2>
        <p style={pStyle}>We may update this Privacy Policy from time to time. When we make material changes, we will update the {"\u201C"}Last Updated{"\u201D"} date at the top of this page and, where feasible, notify you through the Service or via email. Your continued use of Kira after changes are posted constitutes acceptance of the updated policy.</p>

        <div style={sectionDivider} />

        {/* 11 */}
        <h2 style={h2Style}>11. Contact Us</h2>
        <p style={pStyle}>For privacy questions, data requests, or concerns:</p>
        <p style={pStyle}><strong style={boldStyle}>Email:</strong> info@elsaresearch.co</p>
      </article>

      <footer style={{ maxWidth: 640, margin: "0 auto", padding: "24px 24px 48px", borderTop: "1px solid rgba(255,255,255,0.04)", textAlign: "center", fontSize: 13, color: "rgba(201,209,217,0.2)" }}>
        © {new Date().getFullYear()} Kira AI — Elsa Research
      </footer>
    </div>
  );
}
