"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2, CreditCard, LogOut, ArrowLeft } from "lucide-react";

export default function ProfilePage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/");
    }
  }, [isLoaded, isSignedIn, router]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const handleSubscription = async () => {
    try {
      const portalRes = await fetch("/api/stripe/portal", { method: "POST" });
      
      if (portalRes.ok) {
        const data = await portalRes.json();
        window.location.href = data.url;
        return;
      }

      if (portalRes.status === 404) {
        const checkoutRes = await fetch("/api/stripe/checkout", { method: "POST" });
        if (checkoutRes.ok) {
          const data = await checkoutRes.json();
          window.location.href = data.url;
          return;
        }
      }

      console.error("Failed to handle subscription");
    } catch (error) {
      console.error("Subscription error:", error);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      setIsDeleting(true);
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
      await signOut();
      router.push("/");
    } catch (error) {
      console.error("Delete account error:", error);
      alert("Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isLoaded || !user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0D1117",
          color: "rgba(201,209,217,0.4)",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Loading...
      </div>
    );
  }

  const actionBtnStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 18px",
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.02)",
    color: "rgba(201,209,217,0.7)",
    fontSize: 15,
    fontWeight: 400,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "'DM Sans', sans-serif",
    textAlign: "left" as const,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "32px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 48 }}>
          <Link
            href="/"
            style={{
              padding: 8,
              borderRadius: 8,
              color: "rgba(201,209,217,0.5)",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ArrowLeft size={24} />
          </Link>
          <h1
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 28,
              fontWeight: 400,
              color: "#E2E8F0",
              margin: 0,
            }}
          >
            Profile
          </h1>
        </div>

        {/* User Info Card */}
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            padding: "28px 24px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginBottom: 32,
          }}
        >
          <img
            src={user.imageUrl}
            alt={user.fullName || "User"}
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: "1px solid rgba(107,125,179,0.2)",
            }}
          />
          <div>
            <h2
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 22,
                fontWeight: 400,
                color: "#E2E8F0",
                margin: "0 0 4px",
              }}
            >
              {user.fullName}
            </h2>
            <p
              style={{
                fontSize: 14,
                fontWeight: 300,
                color: "rgba(201,209,217,0.4)",
                margin: 0,
              }}
            >
              {user.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={handleSubscription}
            style={actionBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            <CreditCard size={18} style={{ color: "rgba(139,157,195,0.5)" }} />
            Manage Subscription
          </button>

          <button
            onClick={handleSignOut}
            style={{ ...actionBtnStyle, color: "rgba(201,209,217,0.35)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            <LogOut size={18} style={{ color: "rgba(201,209,217,0.25)" }} />
            Sign Out
          </button>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{ ...actionBtnStyle, color: "rgba(201,209,217,0.25)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            >
              <Trash2 size={18} style={{ color: "rgba(201,209,217,0.2)" }} />
              Delete Account
            </button>
          ) : (
            <div
              style={{
                padding: 16,
                background: "rgba(200,55,55,0.08)",
                borderRadius: 12,
                border: "1px solid rgba(200,55,55,0.15)",
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  color: "rgba(255,120,120,0.8)",
                  marginBottom: 14,
                  marginTop: 0,
                }}
              >
                Are you sure? This action cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: "none",
                    background: "rgba(200,55,55,0.75)",
                    color: "rgba(255,255,255,0.9)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    opacity: isDeleting ? 0.5 : 1,
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  {isDeleting ? "Deleting..." : "Yes, Delete"}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "transparent",
                    color: "rgba(201,209,217,0.6)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
