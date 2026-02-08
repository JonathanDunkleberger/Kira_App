"use client";
export const dynamic = "force-dynamic";

import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import {
  Phone,
  Zap,
  User,
  Brain,
  AudioLines,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import ProfileModal from "@/components/ProfileModal";

/* ─── Waveform Visualiser (inside the glassmorphism card) ─── */
function Waveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const w = 280;
    const h = 64;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const bars = 48;
    const barW = 3;
    const gap = (w - bars * barW) / (bars - 1);

    const render = () => {
      const t = Date.now() / 1000;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < bars; i++) {
        const norm = i / bars;
        const envelope = Math.sin(norm * Math.PI) * 0.85 + 0.15;
        const wave =
          Math.sin(t * 3.2 + i * 0.35) * 0.3 +
          Math.sin(t * 5.1 + i * 0.22) * 0.2 +
          Math.sin(t * 1.8 + i * 0.6) * 0.15;
        const amp = (0.35 + wave) * envelope;
        const barH = Math.max(3, amp * h * 0.85);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;

        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, "rgba(168,130,255,0.9)");
        grad.addColorStop(0.5, "rgba(122,162,247,0.8)");
        grad.addColorStop(1, "rgba(168,130,255,0.6)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 1.5);
        ctx.fill();
      }
      animRef.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 280, height: 64 }}
      className="opacity-90"
    />
  );
}

/* ─── Bento Feature Card ─── */
function FeatureCard({
  icon,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-7 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-500"
    >
      {/* accent glow on hover */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/[0.04] to-blue-500/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative z-10">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center mb-5 text-violet-300">
          {icon}
        </div>
        <h3 className="text-[17px] font-medium text-white/90 mb-2 tracking-tight">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-white/45 font-light">
          {description}
        </p>
      </div>
    </motion.div>
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [timeGreeting, setTimeGreeting] = useState("Hello");

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12) setTimeGreeting("Good morning");
    else if (h < 18) setTimeGreeting("Good afternoon");
    else setTimeGreeting("Good evening");
  }, []);

  const greeting = user?.firstName
    ? `${timeGreeting}, ${user.firstName}`
    : timeGreeting;

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

  /* parallax for hero glow */
  const { scrollY } = useScroll();
  const glowY = useTransform(scrollY, [0, 600], [0, 120]);
  const glowOpacity = useTransform(scrollY, [0, 500], [1, 0.3]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-white overflow-x-hidden font-[family-name:var(--font-inter)]">
      {/* ─── Deep-Space Mesh Gradient Background ─── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {/* base noise */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(30,27,75,0.45),transparent)]" />
        {/* peach / violet glow at bottom — breathing via framer-motion */}
        <motion.div
          style={{ y: glowY, opacity: glowOpacity }}
          className="absolute left-1/2 -translate-x-1/2 bottom-[-10%] w-[140%] aspect-[2/1]"
        >
          <motion.div
            animate={{ scale: [1, 1.08, 1], opacity: [0.55, 0.75, 0.55] }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(168,130,255,0.18)_0%,rgba(255,140,105,0.08)_40%,transparent_70%)] blur-3xl"
          />
        </motion.div>
        {/* secondary accent */}
        <motion.div
          animate={{ scale: [1, 1.12, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{
            duration: 11,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2,
          }}
          className="absolute left-[20%] top-[30%] w-[40vw] aspect-square rounded-full bg-[radial-gradient(circle,rgba(122,162,247,0.07),transparent_60%)] blur-3xl"
        />
      </div>

      {/* ─── Sticky Glass Navbar ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-slate-950/60 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          {/* logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-violet-500/20">
              K
            </div>
            <span className="font-semibold text-lg tracking-tight text-white/90 group-hover:text-white transition-colors">
              Kira
            </span>
          </Link>

          {/* desktop nav */}
          <nav className="hidden sm:flex items-center gap-8">
            <button
              onClick={() => scrollTo("features")}
              className="text-sm text-white/50 hover:text-white/90 transition-colors font-light"
            >
              Features
            </button>
            <button
              onClick={() => scrollTo("pricing")}
              className="text-sm text-white/50 hover:text-white/90 transition-colors font-light"
            >
              Pricing
            </button>
            {!isLoading && !isPro && (
              <button
                onClick={handleUpgrade}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 px-4 py-2 rounded-full hover:bg-violet-500 transition-colors shadow-lg shadow-violet-600/20"
              >
                <Zap size={14} />
                Upgrade
              </button>
            )}
            <button
              onClick={() => setShowProfileModal(true)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <User size={20} className="text-white/60" />
            </button>
          </nav>

          {/* mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            {mobileMenuOpen ? (
              <X size={22} className="text-white/70" />
            ) : (
              <Menu size={22} className="text-white/70" />
            )}
          </button>
        </div>

        {/* mobile menu */}
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="sm:hidden border-t border-white/[0.06] bg-slate-950/90 backdrop-blur-xl px-5 py-4 flex flex-col gap-3"
          >
            <button
              onClick={() => scrollTo("features")}
              className="text-sm text-white/60 hover:text-white py-2 text-left"
            >
              Features
            </button>
            <button
              onClick={() => scrollTo("pricing")}
              className="text-sm text-white/60 hover:text-white py-2 text-left"
            >
              Pricing
            </button>
            {!isLoading && !isPro && (
              <button
                onClick={handleUpgrade}
                className="flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-violet-600 px-4 py-2.5 rounded-full hover:bg-violet-500 transition-colors mt-1"
              >
                <Zap size={14} />
                Upgrade
              </button>
            )}
            <button
              onClick={() => {
                setShowProfileModal(true);
                setMobileMenuOpen(false);
              }}
              className="text-sm text-white/60 hover:text-white py-2 text-left"
            >
              Profile
            </button>
          </motion.div>
        )}
      </header>

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        isPro={isPro}
      />

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  HERO SECTION                                          */}
      {/* ═══════════════════════════════════════════════════════ */}
      <section className="relative z-10 flex flex-col items-center justify-center min-h-screen px-5 pt-24 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="flex flex-col items-center text-center max-w-2xl"
        >
          {isSignedIn ? (
            <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-white/90 mb-10">
              {greeting}
            </h1>
          ) : (
            <>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.6 }}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-400/20 bg-violet-500/10 text-violet-300 text-xs font-medium tracking-wide mb-8"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live — Conversations happening now
              </motion.div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light tracking-tight leading-[1.15] text-white mb-5">
                An AI that actually
                <br />
                <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-violet-300 bg-clip-text text-transparent">
                  remembers you.
                </span>
              </h1>

              <p className="text-base sm:text-lg text-white/45 font-light max-w-md leading-relaxed mb-12">
                Real-time voice. Persistent memory.
                <br className="hidden sm:block" /> A companion, not a chatbot.
              </p>
            </>
          )}

          {/* ─── Glassmorphism "Live Call" Card ─── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35, duration: 0.6, ease: "easeOut" }}
            className="relative group"
          >
            {/* outer glow ring */}
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-violet-500/20 via-transparent to-blue-500/10 opacity-60 group-hover:opacity-100 transition-opacity duration-700" />

            <div className="relative rounded-3xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-8 sm:p-10 flex flex-col items-center gap-6 shadow-2xl shadow-violet-500/5">
              {/* call status pill */}
              <div className="flex items-center gap-2 text-xs text-white/40 font-light tracking-widest uppercase">
                <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse shadow-lg shadow-violet-400/50" />
                Kira is listening
              </div>

              {/* waveform */}
              <Waveform />

              {/* CTA */}
              <Link
                href="/chat/kira"
                className="relative inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-[15px] font-medium tracking-wide transition-all duration-300 bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-600/25 hover:shadow-violet-500/40 hover:scale-[1.03] active:scale-[0.98]"
              >
                <Phone size={18} />
                Talk to Kira
              </Link>
            </div>
          </motion.div>
        </motion.div>

        {/* scroll indicator */}
        {!isSignedIn && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            className="absolute bottom-8 flex flex-col items-center gap-2"
          >
            <span className="text-[11px] text-white/25 tracking-widest uppercase font-light">
              Scroll
            </span>
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className="w-5 h-8 rounded-full border border-white/10 flex items-start justify-center pt-1.5"
            >
              <div className="w-1 h-1.5 rounded-full bg-white/30" />
            </motion.div>
          </motion.div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  BENTO GRID FEATURES                                   */}
      {/* ═══════════════════════════════════════════════════════ */}
      {!isSignedIn && (
        <section
          id="features"
          className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 pb-28"
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-14"
          >
            <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white/85 mb-3">
              Built different.
            </h2>
            <p className="text-sm text-white/35 font-light">
              Not another wrapper. Real engineering underneath.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <FeatureCard
              icon={<Brain size={22} />}
              title="Associative Memory"
              description="She remembers your favorite movies, stressors, and inside jokes. Context that carries across every conversation."
              delay={0}
            />
            <FeatureCard
              icon={<AudioLines size={22} />}
              title="Sub-300ms Latency"
              description="Interrupt anytime. Conversations flow naturally without the awkward pauses. Just like talking to a real person."
              delay={0.1}
            />
            <FeatureCard
              icon={<ShieldCheck size={22} />}
              title="End-to-End Encrypted"
              description="Your conversations are private and owned by you. No training on your data, no sharing, no compromises."
              delay={0.2}
            />
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  PRICING — Simple one-liner CTA                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {!isSignedIn && (
        <section
          id="pricing"
          className="relative z-10 max-w-3xl mx-auto px-5 sm:px-8 pb-32"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative rounded-3xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm p-10 sm:p-14 text-center overflow-hidden"
          >
            {/* decorative glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-40 bg-violet-500/10 blur-3xl rounded-full pointer-events-none" />

            <div className="relative z-10">
              <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-white/90 mb-3">
                Ready to meet Kira?
              </h2>
              <p className="text-sm text-white/40 font-light mb-8 max-w-sm mx-auto leading-relaxed">
                Start for free. Upgrade to Pro for unlimited conversations and
                full memory.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/chat/kira"
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-2xl text-sm font-medium bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-600/20 transition-all duration-300 hover:scale-[1.03]"
                >
                  <Phone size={16} />
                  Try Free
                </Link>
                <button
                  onClick={handleUpgrade}
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-2xl text-sm font-medium border border-white/[0.1] text-white/70 hover:text-white hover:border-white/[0.2] hover:bg-white/[0.04] transition-all duration-300"
                >
                  <Zap size={16} />
                  Go Pro
                </button>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t border-white/[0.06] py-8 px-5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/25 font-light">
          <span>© {new Date().getFullYear()} Kira AI</span>
          <div className="flex gap-6">
            <Link
              href="/privacy"
              className="hover:text-white/50 transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="hover:text-white/50 transition-colors"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
