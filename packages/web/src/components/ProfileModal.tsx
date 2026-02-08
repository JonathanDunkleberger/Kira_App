"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2, CreditCard, LogOut, X, User, MessageCircle } from "lucide-react";
import Link from "next/link";
import ConversationHistory from "./ConversationHistory";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPro?: boolean;
}

export default function ProfileModal({ isOpen, onClose, isPro = false }: ProfileModalProps) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut, openSignIn } = useClerk();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
    onClose();
  };

  const handleSignIn = () => {
    openSignIn({
      afterSignInUrl: "/",
      afterSignUpUrl: "/",
    });
    onClose();
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
        } else {
            console.error("Checkout failed with status:", checkoutRes.status);
            alert("Failed to start checkout. Please try again later.");
        }
      } else {
        console.error("Portal failed with status:", portalRes.status);
        alert("Failed to open subscription portal. Please try again later.");
      }

      console.error("Failed to handle subscription");
    } catch (error) {
      console.error("Subscription error:", error);
      alert("An error occurred. Please try again.");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      setIsDeleting(true);
      const res = await fetch("/api/user/delete", {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete account");
      }

      await signOut();
      router.push("/");
      onClose();
    } catch (error) {
      console.error("Delete account error:", error);
      alert("Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;
  if (!isLoaded) return null;

  const actionBtnStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 10,
    border: "none",
    background: "rgba(255,255,255,0.02)",
    color: "rgba(201,209,217,0.7)",
    fontSize: 14,
    fontWeight: 400,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "'DM Sans', sans-serif",
    textAlign: "left" as const,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(12px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#0D1117",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16,
          padding: "32px 28px",
          width: "100%",
          maxWidth: 400,
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          position: "relative",
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            color: "rgba(201,209,217,0.3)",
            cursor: "pointer",
            fontSize: 18,
            padding: 4,
          }}
        >
          <X size={20} />
        </button>

        {/* User Info */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          {isSignedIn && user ? (
            <>
              <img
                src={user.imageUrl}
                alt={user.fullName || "User"}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: "1px solid rgba(107,125,179,0.2)",
                }}
              />
              <div>
                <h3 style={{
                  fontSize: 20,
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 400,
                  color: "#E2E8F0",
                  marginBottom: 4,
                  marginTop: 0,
                }}>
                  {user.fullName}
                </h3>
                <p style={{
                  fontSize: 13,
                  fontWeight: 300,
                  color: "rgba(201,209,217,0.4)",
                  margin: 0,
                }}>
                  {user.primaryEmailAddress?.emailAddress}
                </p>
              </div>
            </>
          ) : (
            <>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <User size={24} style={{ color: "rgba(201,209,217,0.3)" }} />
              </div>
              <div>
                <h3 style={{
                  fontSize: 20,
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 400,
                  color: "#E2E8F0",
                  marginBottom: 4,
                  marginTop: 0,
                }}>
                  Guest User
                </h3>
                <p style={{
                  fontSize: 13,
                  fontWeight: 300,
                  color: "rgba(201,209,217,0.4)",
                  margin: 0,
                }}>
                  Sign in to save your progress
                </p>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {isSignedIn ? (
            <>
              {/* Subscription */}
              <div style={{
                fontSize: 11,
                fontWeight: 500,
                color: "rgba(107,125,179,0.5)",
                textTransform: "uppercase" as const,
                letterSpacing: "0.12em",
                marginBottom: 6,
                marginTop: 4,
              }}>
                Subscription
              </div>

              {isPro ? (
                <button
                  onClick={handleSubscription}
                  style={actionBtnStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                >
                  <CreditCard size={16} style={{ color: "rgba(139,157,195,0.5)" }} />
                  Manage Subscription
                </button>
              ) : (
                <button
                  onClick={handleSubscription}
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
                    fontFamily: "'DM Sans', sans-serif",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "linear-gradient(135deg, rgba(107,125,179,0.4), rgba(107,125,179,0.25))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "linear-gradient(135deg, rgba(107,125,179,0.3), rgba(107,125,179,0.15))";
                  }}
                >
                  Upgrade to Pro
                </button>
              )}

              {/* Account section */}
              <div style={{
                fontSize: 11,
                fontWeight: 500,
                color: "rgba(107,125,179,0.5)",
                textTransform: "uppercase" as const,
                letterSpacing: "0.12em",
                marginBottom: 6,
                marginTop: 16,
              }}>
                Account
              </div>

              {/* Past Conversations */}
              <button
                onClick={() => setShowHistory(true)}
                style={actionBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              >
                <MessageCircle size={16} style={{ color: "rgba(139,157,195,0.5)" }} />
                Past Conversations
              </button>

              {/* Sign Out */}
              <button
                onClick={handleSignOut}
                style={{ ...actionBtnStyle, color: "rgba(201,209,217,0.35)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              >
                <LogOut size={16} style={{ color: "rgba(201,209,217,0.25)" }} />
                Sign Out
              </button>

              {/* Delete Account */}
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{ ...actionBtnStyle, color: "rgba(201,209,217,0.25)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                >
                  <Trash2 size={16} style={{ color: "rgba(201,209,217,0.2)" }} />
                  Delete Account
                </button>
              ) : (
                <div style={{
                  padding: "14px",
                  background: "rgba(200,55,55,0.08)",
                  borderRadius: 10,
                  border: "1px solid rgba(200,55,55,0.15)",
                }}>
                  <p style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "rgba(255,120,120,0.8)",
                    marginBottom: 12,
                    marginTop: 0,
                  }}>
                    Are you sure? This action cannot be undone.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={isDeleting}
                      style={{
                        flex: 1,
                        padding: "8px 0",
                        borderRadius: 8,
                        border: "none",
                        background: "rgba(200,55,55,0.75)",
                        color: "rgba(255,255,255,0.9)",
                        fontSize: 13,
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
                        padding: "8px 0",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "transparent",
                        color: "rgba(201,209,217,0.6)",
                        fontSize: 13,
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
            </>
          ) : (
            /* Sign In */
            <button
              onClick={handleSignIn}
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
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.2s",
              }}
            >
              Sign In
            </button>
          )}

          {/* Legal Links */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 20,
            paddingTop: 16,
            marginTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}>
            <Link
              href="/privacy"
              onClick={onClose}
              style={{
                fontSize: 13,
                color: "rgba(201,209,217,0.25)",
                textDecoration: "none",
                fontWeight: 300,
                transition: "color 0.2s",
              }}
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              onClick={onClose}
              style={{
                fontSize: 13,
                color: "rgba(201,209,217,0.25)",
                textDecoration: "none",
                fontWeight: 300,
                transition: "color 0.2s",
              }}
            >
              Terms
            </Link>
          </div>
        </div>
      </div>

      {/* Conversation History Overlay */}
      {showHistory && (
        <ConversationHistory onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
