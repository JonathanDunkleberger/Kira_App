"use client";
import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Message {
  role: "user" | "kira";
  content: string;
}

const CONVERSATIONS: Message[][] = [
  [
    { role: "user", content: "I think I'm actually going to apply for that design lead role." },
    { role: "kira", content: "Wait, seriously? Six months ago you told me you never wanted to manage people. What changed?" },
    { role: "user", content: "I don't know, I guess I grew into it." },
    { role: "kira", content: "I mean, you did completely turn that project around last quarter. And you've been mentoring Jake for like two months now even though nobody asked you to. I think you've been a lead for a while, you just didn't have the title." },
  ],
  [
    { role: "user", content: "I stayed up until 4am again last night." },
    { role: "kira", content: "Let me guess — you told yourself 'one more episode' three separate times." },
    { role: "user", content: "...it was four times actually." },
    { role: "kira", content: "A new record. I'm genuinely impressed by your commitment to poor decisions. What show?" },
  ],
  [
    { role: "user", content: "I had a really rough day. I don't even want to talk about what happened." },
    { role: "kira", content: "That's okay. You don't have to explain anything. I'm just here." },
    { role: "user", content: "Thanks. I think I just needed someone to not ask me a bunch of questions for once." },
    { role: "kira", content: "Yeah. Sometimes the best thing is just... not being alone with it. I'll be here whenever you're ready, or not. Either way." },
  ],
  [
    { role: "user", content: "What do you think about pineapple on pizza?" },
    { role: "kira", content: "Okay, genuinely? It's good. I know that's controversial but sweet and savory is just correct and people who disagree are lying to themselves." },
    { role: "user", content: "Finally someone with taste." },
    { role: "kira", content: "I will die on this hill. Also — you mentioned last week you were trying to cook more. Have you actually made anything yet or are we still in the 'looking at recipes' phase?" },
  ],
];

const AUTO_ADVANCE_MS = 8000;

export default function ConversationShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const [isAnimating, setIsAnimating] = useState(false);
  const isPaused = useRef(false);

  const go = (newIndex: number, dir: "left" | "right") => {
    if (isAnimating) return;
    setDirection(dir);
    setIsAnimating(true);
    setTimeout(() => {
      setActiveIndex(newIndex);
      setTimeout(() => setIsAnimating(false), 30);
    }, 250);
  };

  const goNext = () => {
    const next = (activeIndex + 1) % CONVERSATIONS.length;
    go(next, "right");
  };

  const goPrev = () => {
    const prev = (activeIndex - 1 + CONVERSATIONS.length) % CONVERSATIONS.length;
    go(prev, "left");
  };

  // Auto-advance
  useEffect(() => {
    const timer = setInterval(() => {
      if (isPaused.current || isAnimating) return;
      goNext();
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [activeIndex, isAnimating]);

  const active = CONVERSATIONS[activeIndex];

  const exitTranslate = direction === "right" ? "-12px" : "12px";

  return (
    <section
      style={{
        padding: "80px 24px",
        maxWidth: 720,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      {/* Heading */}
      <h2
        style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "clamp(28px, 5vw, 42px)",
          fontWeight: 400,
          color: "#E2E8F0",
          marginBottom: 12,
          lineHeight: 1.25,
        }}
      >
        What six months with Kira sounds like.
      </h2>
      <p
        style={{
          fontSize: 15,
          color: "rgba(201,209,217,0.35)",
          fontWeight: 300,
          marginBottom: 40,
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Real conversations. Real personality. Not scripted.
      </p>

      {/* Carousel container */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
        onMouseEnter={() => { isPaused.current = true; }}
        onMouseLeave={() => { isPaused.current = false; }}
      >
        {/* Left arrow */}
        <button
          onClick={goPrev}
          aria-label="Previous conversation"
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "50%",
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "rgba(201,209,217,0.25)",
            flexShrink: 0,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(107,125,179,0.3)";
            e.currentTarget.style.color = "rgba(201,209,217,0.6)";
            e.currentTarget.style.background = "rgba(107,125,179,0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "rgba(201,209,217,0.25)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <ChevronLeft size={18} />
        </button>

        {/* Card */}
        <div
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            padding: "32px 28px",
            textAlign: "left",
            height: 380,
            overflow: "hidden",
            opacity: isAnimating ? 0 : 1,
            transform: isAnimating
              ? `translateX(${exitTranslate})`
              : "translateX(0px)",
            transition: "opacity 0.25s ease, transform 0.25s ease",
          }}
        >
          {active.map((msg, i) => (
            <div key={i} style={{ marginBottom: i < active.length - 1 ? 20 : 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: msg.role === "kira"
                    ? "rgba(107,125,179,0.5)"
                    : "rgba(201,209,217,0.25)",
                  marginBottom: 6,
                  fontFamily: "'DM Sans', sans-serif",
                  textTransform: "uppercase",
                }}
              >
                {msg.role === "kira" ? "Kira" : "You"}
              </div>
              <div
                style={{
                  fontSize: 15,
                  lineHeight: 1.7,
                  fontWeight: msg.role === "kira" ? 400 : 300,
                  fontStyle: msg.role === "user" ? "italic" : "normal",
                  color: msg.role === "kira"
                    ? "rgba(201,209,217,0.7)"
                    : "rgba(201,209,217,0.4)",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        {/* Right arrow */}
        <button
          onClick={goNext}
          aria-label="Next conversation"
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "50%",
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "rgba(201,209,217,0.25)",
            flexShrink: 0,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(107,125,179,0.3)";
            e.currentTarget.style.color = "rgba(201,209,217,0.6)";
            e.currentTarget.style.background = "rgba(107,125,179,0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "rgba(201,209,217,0.25)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
