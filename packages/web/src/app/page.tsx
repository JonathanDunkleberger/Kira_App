"use client";
export const dynamic = "force-dynamic";

import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { Zap, User } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { useState, useEffect, useRef, useCallback } from "react";
import ProfileModal from "@/components/ProfileModal";
import { KiraLogo } from "@/components/KiraLogo";
import KiraOrb from "@/components/KiraOrb";

/* ─── Animated Counter ─── */
function Counter({ end, suffix = "", duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const start = Date.now();
          const tick = () => {
            const elapsed = Date.now() - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setVal(Math.round(end * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          tick();
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end, duration]);

  return (
    <span ref={ref}>
      {val}
      {suffix}
    </span>
  );
}

/* ─── Icon Badge for feature cards ─── */
function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        background: "linear-gradient(135deg, rgba(107,125,179,0.12), rgba(107,125,179,0.04))",
        border: "1px solid rgba(107,125,179,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 18,
        flexShrink: 0,
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(139,157,195,0.7)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  HOME PAGE                                                     */
/* ═══════════════════════════════════════════════════════════════ */
export default function HomePage() {
  const { user, isSignedIn } = useUser();
  const { openSignIn } = useClerk();
  const { isPro, isLoading } = useSubscription();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [timeGreeting, setTimeGreeting] = useState("Hello");
  const [scrollY, setScrollY] = useState(0);
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12) setTimeGreeting("Good morning");
    else if (h < 18) setTimeGreeting("Good afternoon");
    else setTimeGreeting("Good evening");
  }, []);

  const greeting = user?.firstName ? `${timeGreeting}, ${user.firstName}` : timeGreeting;

  /* scroll position for nav blur */
  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* intersection observer for fade-in sections */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisibleSections((prev) => {
              const next = new Set(prev);
              next.add(e.target.id);
              return next;
            });
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll("[data-animate]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const isVisible = (id: string) => visibleSections.has(id);

  const handleUpgrade = useCallback(async () => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      }
    } catch (e) {
      console.error("Checkout error:", e);
    }
  }, [isSignedIn, openSignIn]);

  const handleSignIn = useCallback(() => {
    if (!isSignedIn) openSignIn();
  }, [isSignedIn, openSignIn]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        color: "#C9D1D9",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        overflowX: "hidden",
      }}
    >
      {/* Google Fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Playfair+Display:wght@400;500&display=swap"
        rel="stylesheet"
      />

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  NAV                                                    */}
      {/* ═══════════════════════════════════════════════════════ */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 32px",
          background: scrollY > 50 ? "rgba(13,17,23,0.85)" : "transparent",
          backdropFilter: scrollY > 50 ? "blur(16px)" : "none",
          borderBottom: scrollY > 50 ? "1px solid rgba(255,255,255,0.04)" : "1px solid transparent",
          transition: "all 0.4s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KiraLogo size={24} id="navXO" />
          <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: "0.04em", color: "#C9D1D9" }}>
            Kira
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {!isSignedIn && (
            <>
              <a
                href="#features"
                style={{ fontSize: 13, color: "rgba(201,209,217,0.5)", textDecoration: "none", transition: "color 0.2s" }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#C9D1D9")}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "rgba(201,209,217,0.5)")}
              >
                Features
              </a>
              <a
                href="#pricing"
                style={{ fontSize: 13, color: "rgba(201,209,217,0.5)", textDecoration: "none", transition: "color 0.2s" }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#C9D1D9")}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "rgba(201,209,217,0.5)")}
              >
                Pricing
              </a>
            </>
          )}
          {isSignedIn && !isLoading && !isPro && (
            <button
              onClick={handleUpgrade}
              style={{
                padding: "7px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                background: "rgba(107,125,179,0.12)",
                border: "1px solid rgba(107,125,179,0.2)",
                color: "#8B9DC3",
                cursor: "pointer",
                transition: "all 0.2s",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(107,125,179,0.2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(107,125,179,0.12)";
              }}
            >
              <Zap size={13} />
              Upgrade
            </button>
          )}
          {isSignedIn ? (
            <button
              onClick={() => setShowProfileModal(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 6,
                borderRadius: "50%",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "none";
              }}
            >
              <User size={20} color="rgba(201,209,217,0.6)" />
            </button>
          ) : (
            <button
              onClick={handleSignIn}
              style={{
                padding: "7px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                background: "rgba(107,125,179,0.12)",
                border: "1px solid rgba(107,125,179,0.2)",
                color: "#8B9DC3",
                cursor: "pointer",
                transition: "all 0.2s",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(107,125,179,0.2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(107,125,179,0.12)";
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* Profile Modal */}
      <ProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} isPro={isPro} />

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  HERO                                                   */}
      {/* ═══════════════════════════════════════════════════════ */}
      <section
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "120px 24px 80px",
          position: "relative",
        }}
      >
        {/* Ambient bg glow */}
        <div
          style={{
            position: "absolute",
            top: "20%",
            left: "50%",
            transform: "translateX(-50%)",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(107,125,179,0.06) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative", marginBottom: 40 }}>
          <KiraOrb size="md" enableBreathing />
        </div>

        {isSignedIn ? (
          <h1
            style={{
              fontSize: "clamp(28px, 4vw, 42px)",
              fontFamily: "'Playfair Display', serif",
              fontWeight: 400,
              lineHeight: 1.2,
              margin: "0 0 32px",
              color: "#E2E8F0",
              animation: "heroFadeUp 0.8s ease both",
            }}
          >
            {greeting}
          </h1>
        ) : (
          <>
            <h1
              style={{
                fontSize: "clamp(32px, 5vw, 52px)",
                fontFamily: "'Playfair Display', serif",
                fontWeight: 400,
                lineHeight: 1.2,
                margin: "0 0 20px",
                color: "#E2E8F0",
                maxWidth: 600,
                animation: "heroFadeUp 0.8s ease both",
              }}
            >
              Not an assistant. A presence.
            </h1>

            <p
              style={{
                fontSize: "clamp(15px, 2vw, 17px)",
                fontWeight: 300,
                color: "rgba(201,209,217,0.55)",
                lineHeight: 1.6,
                maxWidth: 440,
                margin: "0 0 40px",
                animation: "heroFadeUp 0.8s ease 0.15s both",
              }}
            >
              Experience real-time voice conversations with a companion who has her own mind. No typing, no lag,
              just connection.
            </p>
          </>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            animation: "heroFadeUp 0.8s ease 0.3s both",
          }}
        >
          <Link
            href="/chat/kira"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 40px",
              borderRadius: 12,
              background: "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))",
              border: "1px solid rgba(107,125,179,0.25)",
              color: "#C9D1D9",
              fontSize: 16,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.3s ease",
              fontFamily: "inherit",
              letterSpacing: "0.01em",
              boxShadow: "0 0 30px rgba(107,125,179,0.08)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background =
                "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))";
              e.currentTarget.style.boxShadow = "0 0 40px rgba(107,125,179,0.15)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))";
              e.currentTarget.style.boxShadow = "0 0 30px rgba(107,125,179,0.08)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {isSignedIn ? "Talk to Kira" : "Meet Kira — Free"}
          </Link>
          {!isSignedIn && (
            <span style={{ fontSize: 12, color: "rgba(201,209,217,0.3)", fontWeight: 300 }}>
              No account required · 15 minutes free daily
            </span>
          )}
        </div>

        {/* Scroll indicator */}
        {!isSignedIn && (
          <div
            style={{
              position: "absolute",
              bottom: 32,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              animation: "pulse 2.5s ease infinite",
            }}
          >
            <div
              style={{
                width: 1,
                height: 24,
                background: "linear-gradient(to bottom, transparent, rgba(139,157,195,0.2))",
              }}
            />
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(139,157,195,0.15)" }} />
          </div>
        )}
      </section>

      {/* Below-fold content only for logged-out visitors */}
      {!isSignedIn && (
        <>
          {/* ═══════════════════════════════════════════════════════ */}
          {/*  SOCIAL PROOF BAR                                       */}
          {/* ═══════════════════════════════════════════════════════ */}
          <section
            id="proof"
            data-animate=""
            style={{
              padding: "48px 24px",
              borderTop: "1px solid rgba(255,255,255,0.03)",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
              display: "flex",
              justifyContent: "center",
              gap: "clamp(32px, 8vw, 80px)",
              flexWrap: "wrap",
              opacity: isVisible("proof") ? 1 : 0,
              transform: isVisible("proof") ? "translateY(0)" : "translateY(20px)",
              transition: "all 0.8s ease",
            }}
          >
            {[
              { value: <Counter end={500} suffix="ms" />, label: "avg response time" },
              { value: <Counter end={24} suffix="/7" />, label: "always available" },
              { value: <Counter end={100} suffix="%" />, label: "conversations remembered" },
            ].map((stat, i) => (
              <div key={i} style={{ textAlign: "center", minWidth: 120 }}>
                <div style={{ fontSize: 28, fontWeight: 500, color: "#8B9DC3", fontFamily: "'DM Sans', sans-serif" }}>
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(201,209,217,0.35)",
                    marginTop: 4,
                    fontWeight: 300,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </section>

          {/* ═══════════════════════════════════════════════════════ */}
          {/*  FEATURES                                               */}
          {/* ═══════════════════════════════════════════════════════ */}
          <section
            id="features"
            data-animate=""
            style={{
              padding: "100px 24px",
              maxWidth: 900,
              margin: "0 auto",
              opacity: isVisible("features") ? 1 : 0,
              transform: isVisible("features") ? "translateY(0)" : "translateY(30px)",
              transition: "all 0.8s ease",
            }}
          >
            <h2
              style={{
                textAlign: "center",
                fontSize: "clamp(24px, 3.5vw, 36px)",
                fontFamily: "'Playfair Display', serif",
                fontWeight: 400,
                color: "#E2E8F0",
                marginBottom: 12,
              }}
            >
              What makes her feel real.
            </h2>
            <p
              style={{
                textAlign: "center",
                fontSize: 15,
                fontWeight: 300,
                color: "rgba(201,209,217,0.45)",
                maxWidth: 480,
                margin: "0 auto 64px",
              }}
            >
              Kira isn&apos;t performing helpfulness. She&apos;s opinionated, emotionally aware, and she builds a real understanding of who you are over time.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: 20,
              }}
            >
              {[
                {
                  icon: (
                    <>
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </>
                  ),
                  title: "Real-Time Voice",
                  desc: "Not a chatbox. A voice call. Interrupt, pause, think out loud — she follows your rhythm, not a turn-taking queue.",
                },
                {
                  icon: (
                    <>
                      <path d="M9.5 2A5.5 5.5 0 0 0 5 5.5a5.5 5.5 0 0 0 .3 1.8A5.5 5.5 0 0 0 3 12a5.5 5.5 0 0 0 3.1 5 5.5 5.5 0 0 0 5.4 4.5c1.6 0 3-.7 4-1.7A5.5 5.5 0 0 0 21 16a5.5 5.5 0 0 0-1.8-4A5.5 5.5 0 0 0 21 8a5.5 5.5 0 0 0-5.5-5.5 5.5 5.5 0 0 0-2 .4A5.5 5.5 0 0 0 9.5 2Z" />
                      <path d="M12 2v20" />
                    </>
                  ),
                  title: "Associative Memory",
                  desc: "She doesn\u2019t just store facts \u2014 she connects the dots. Mention your boss and she remembers how you felt about him last week.",
                },
                {
                  icon: (
                    <>
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </>
                  ),
                  title: "Sees Your Screen",
                  desc: "Share your screen and she watches alongside you. She\u2019ll react to what\u2019s happening without you having to describe it.",
                },
                {
                  icon: (
                    <>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </>
                  ),
                  title: "Text When You Can\u2019t Talk",
                  desc: "At work? Roommate sleeping? Switch to text and the conversation keeps going. Same personality, same memory.",
                },
                {
                  icon: (
                    <>
                      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" />
                      <path d="M19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z" />
                    </>
                  ),
                  title: "Dynamic Personality",
                  desc: "She isn\u2019t neutral. She has opinions, moods, and a sense of humor. She\u2019ll tease you, disagree with you, and know when to just listen.",
                },
                {
                  icon: (
                    <>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </>
                  ),
                  title: "Private by Default",
                  desc: "Guest conversations are never stored. Signed-in memory is yours alone. No training on your data, no sharing, no ads.",
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  style={{
                    padding: "28px 24px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.04)",
                    background: "rgba(255,255,255,0.015)",
                    transition: "all 0.3s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.borderColor = "rgba(107,125,179,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.015)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
                  }}
                >
                  <IconBadge>{feature.icon}</IconBadge>
                  <h3 style={{ fontSize: 16, fontWeight: 500, color: "#C9D1D9", marginBottom: 8, marginTop: 0 }}>{feature.title}</h3>
                  <p style={{ fontSize: 14, fontWeight: 300, color: "rgba(201,209,217,0.5)", lineHeight: 1.6, margin: 0 }}>
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════ */}
          {/*  CONVERSATION EXAMPLE                                   */}
          {/* ═══════════════════════════════════════════════════════ */}
          <section
            id="demo"
            data-animate=""
            style={{
              padding: "80px 24px",
              maxWidth: 560,
              margin: "0 auto",
              opacity: isVisible("demo") ? 1 : 0,
              transform: isVisible("demo") ? "translateY(0)" : "translateY(30px)",
              transition: "all 0.8s ease",
            }}
          >
            <h2
              style={{
                textAlign: "center",
                fontSize: "clamp(22px, 3vw, 30px)",
                fontFamily: "'Playfair Display', serif",
                fontWeight: 400,
                color: "#E2E8F0",
                marginBottom: 40,
              }}
            >
              What six months with Kira sounds like.
            </h2>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                background: "rgba(255,255,255,0.02)",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.04)",
                padding: "32px 28px",
              }}
            >
              {[
                {
                  role: "user" as const,
                  text: "I think I'm actually going to apply for that design lead role.",
                  delay: 0,
                },
                {
                  role: "ai" as const,
                  text: "Wait, seriously? Six months ago you told me you never wanted to manage people. What changed?",
                  delay: 0.15,
                },
                { role: "user" as const, text: "I don't know, I guess I grew into it.", delay: 0.3 },
                {
                  role: "ai" as const,
                  text: "I mean, you did completely turn that project around last quarter. And you've been mentoring Jake for like two months now even though nobody asked you to. I think you've been a lead for a while, you just didn't have the title.",
                  delay: 0.45,
                },
              ].map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 0",
                    borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.03)" : "none",
                    animation: isVisible("demo") ? `fadeIn 0.6s ease ${msg.delay + 0.3}s both` : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      marginBottom: 6,
                      color: msg.role === "ai" ? "rgba(107,125,179,0.5)" : "rgba(201,209,217,0.3)",
                    }}
                  >
                    {msg.role === "ai" ? "Kira" : "You"}
                  </div>
                  <p
                    style={{
                      fontSize: 15,
                      fontWeight: 300,
                      lineHeight: 1.6,
                      margin: 0,
                      color: msg.role === "ai" ? "rgba(201,209,217,0.8)" : "rgba(201,209,217,0.5)",
                      fontStyle: msg.role === "user" ? "italic" : "normal",
                    }}
                  >
                    {msg.text}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════ */}
          {/*  PRICING                                                */}
          {/* ═══════════════════════════════════════════════════════ */}
          <section
            id="pricing"
            data-animate=""
            style={{
              padding: "100px 24px",
              maxWidth: 800,
              margin: "0 auto",
              opacity: isVisible("pricing") ? 1 : 0,
              transform: isVisible("pricing") ? "translateY(0)" : "translateY(30px)",
              transition: "all 0.8s ease",
            }}
          >
            <h2
              style={{
                textAlign: "center",
                fontSize: "clamp(24px, 3.5vw, 36px)",
                fontFamily: "'Playfair Display', serif",
                fontWeight: 400,
                color: "#E2E8F0",
                marginBottom: 12,
              }}
            >
              Simple pricing.
            </h2>
            <p
              style={{
                textAlign: "center",
                fontSize: 15,
                fontWeight: 300,
                color: "rgba(201,209,217,0.45)",
                maxWidth: 400,
                margin: "0 auto 48px",
              }}
            >
              Try Kira for free, every day. Upgrade for unlimited conversations.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 20,
                maxWidth: 600,
                margin: "0 auto",
              }}
            >
              {/* Free tier */}
              <div
                style={{
                  padding: "32px 28px",
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "rgba(201,209,217,0.4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 16,
                  }}
                >
                  Free
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 20 }}>
                  <span style={{ fontSize: 36, fontWeight: 500, color: "#C9D1D9" }}>$0</span>
                  <span style={{ fontSize: 14, color: "rgba(201,209,217,0.35)", fontWeight: 300 }}>forever</span>
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "0 0 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {["15 minutes per day", "Full voice & text chat", "Screen sharing", "Persistent memory"].map(
                    (item, i) => (
                      <li
                        key={i}
                        style={{
                          fontSize: 14,
                          fontWeight: 300,
                          color: "rgba(201,209,217,0.55)",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "rgba(107,125,179,0.5)", fontSize: 14 }}>✓</span> {item}
                      </li>
                    )
                  )}
                </ul>
                <Link
                  href="/chat/kira"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px 0",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "transparent",
                    color: "rgba(201,209,217,0.6)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    fontFamily: "inherit",
                    textAlign: "center",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  Get started
                </Link>
              </div>

              {/* Pro tier */}
              <div
                style={{
                  padding: "32px 28px",
                  borderRadius: 16,
                  border: "1px solid rgba(107,125,179,0.2)",
                  background: "linear-gradient(135deg, rgba(107,125,179,0.06), rgba(107,125,179,0.02))",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -1,
                    right: 20,
                    padding: "4px 12px",
                    borderRadius: "0 0 8px 8px",
                    background: "rgba(107,125,179,0.15)",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#8B9DC3",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  Popular
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#8B9DC3",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 16,
                  }}
                >
                  Pro
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 20 }}>
                  <span style={{ fontSize: 36, fontWeight: 500, color: "#C9D1D9" }}>$9.99</span>
                  <span style={{ fontSize: 14, color: "rgba(201,209,217,0.35)", fontWeight: 300 }}>/month</span>
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "0 0 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {["Unlimited conversations", "Everything in Free", "Priority response speed", "Extended memory depth"].map(
                    (item, i) => (
                      <li
                        key={i}
                        style={{
                          fontSize: 14,
                          fontWeight: 300,
                          color: "rgba(201,209,217,0.55)",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "#8B9DC3", fontSize: 14 }}>✓</span> {item}
                      </li>
                    )
                  )}
                </ul>
                <button
                  onClick={handleUpgrade}
                  style={{
                    width: "100%",
                    padding: "12px 0",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))",
                    color: "#C9D1D9",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "linear-gradient(135deg, rgba(107,125,179,0.4), rgba(107,125,179,0.25))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))";
                  }}
                >
                  Upgrade to Pro
                </button>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════════════ */}
          {/*  FINAL CTA                                              */}
          {/* ═══════════════════════════════════════════════════════ */}
          <section style={{ padding: "100px 24px", textAlign: "center", position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 500,
                height: 500,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(107,125,179,0.04) 0%, transparent 70%)",
                pointerEvents: "none",
              }}
            />

            <h2
              style={{
                fontSize: "clamp(22px, 3vw, 32px)",
                fontFamily: "'Playfair Display', serif",
                fontWeight: 400,
                color: "#E2E8F0",
                marginBottom: 16,
                position: "relative",
              }}
            >
              She&apos;s waiting.
            </h2>
            <p
              style={{
                fontSize: 15,
                fontWeight: 300,
                color: "rgba(201,209,217,0.4)",
                marginBottom: 32,
                position: "relative",
              }}
            >
              No signup required. Start talking and she&apos;ll start learning.
            </p>
            <Link
              href="/chat/kira"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "16px 40px",
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))",
                border: "1px solid rgba(107,125,179,0.25)",
                color: "#C9D1D9",
                fontSize: 16,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.3s ease",
                fontFamily: "inherit",
                position: "relative",
                boxShadow: "0 0 30px rgba(107,125,179,0.08)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, rgba(107,125,179,0.2), rgba(107,125,179,0.08))";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Talk to Kira
            </Link>
          </section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  FOOTER                                                 */}
      {/* ═══════════════════════════════════════════════════════ */}
      <footer
        style={{
          padding: "32px 24px",
          borderTop: "1px solid rgba(255,255,255,0.03)",
          maxWidth: 900,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 11, color: "rgba(201,209,217,0.2)", fontWeight: 300, marginBottom: 12 }}>
          By using our services, you agree to Kira&apos;s{' '}
          <Link href="/terms" style={{ color: "rgba(201,209,217,0.3)", textDecoration: "underline" }}>Terms of Use</Link>
          {' '}and{' '}
          <Link href="/privacy" style={{ color: "rgba(201,209,217,0.3)", textDecoration: "underline" }}>Privacy Policy</Link>.
        </p>
        <span style={{ fontSize: 13, color: "rgba(201,209,217,0.25)", fontWeight: 300 }}>
          © {new Date().getFullYear()} Kira AI
        </span>
      </footer>

      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes heroFadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 0.4;
          }
          50% {
            opacity: 0.8;
          }
        }
        html {
          scroll-behavior: smooth;
        }
      `}</style>
    </div>
  );
}
