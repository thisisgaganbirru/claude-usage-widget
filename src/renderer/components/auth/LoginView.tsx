import React, { useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";

// ─── Static feature list shown in the branding panel ─────────────────────────
const FEATURES: { icon: string; label: string }[] = [
  { icon: "⚡", label: "Live 5-hour session & 7-day rolling usage" },
  { icon: "🎨", label: "Per-model breakdown — Opus, Sonnet & Haiku" },
  { icon: "🔔", label: "Desktop alerts at custom usage thresholds" },
  { icon: "📊", label: "Compact system-tray widget, always in reach" },
];

// ─── Gradient used for the logo ring, button, and accent chips ───────────────
const GRADIENT = "linear-gradient(135deg, #C15F3C 0%, #a8492c 100%)";
const GRADIENT_HOVER = "linear-gradient(135deg, #d06a44 0%, #C15F3C 100%)";

export function LoginView(): React.ReactElement {
  const { setAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Logic — kept exactly as original ────────────────────────────────────────
  const handleLogin = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // Check if window.electron is available
      if (!window.electron || !window.electron.ipcRenderer) {
        throw new Error(
          "IPC bridge not available. Please restart the application.",
        );
      }

      const result = await window.electron.ipcRenderer.invoke("auth:login");

      if (result.success && result.isAuthenticated) {
        setAuthenticated(true);
      } else {
        setError("Login failed. Please try again.");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unexpected error occurred";
      console.error("[LoginView] Login error:", errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "800px",
        height: "600px",
        display: "flex",
        backgroundColor: "#0c0c0d",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Window controls ── */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 16,
          display: "flex",
          gap: 8,
          zIndex: 10,
        }}
      >
        <button
          onClick={() =>
            (window as any).electron?.ipcRenderer?.invoke("app:minimize")
          }
          title="Minimize"
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: 18,
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "rgba(255,255,255,0.5)";
          }}
        >
          ─
        </button>
        <button
          onClick={() =>
            (window as any).electron?.ipcRenderer?.invoke("app:quit")
          }
          title="Quit"
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: 18,
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "rgba(255,255,255,0.5)";
          }}
        >
          ✕
        </button>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>

      {/* ── LEFT — Branding panel ─────────────────────────────────────────── */}
      <div
        style={{
          width: "400px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "52px 48px",
          position: "relative",
          // very subtle purple radial glow so the panel doesn't feel flat
          background:
            "radial-gradient(ellipse at 15% 45%, rgba(193,95,60,0.09) 0%, transparent 65%), #0c0c0d",
          animation: "fadeUp 0.45s ease both",
        }}
      >
        {/* Real Claude logo */}
        <img
          src={claudeIcon}
          style={{
            width: 56,
            height: 56,
            borderRadius: "16px",
            marginBottom: 28,
            flexShrink: 0,
            boxShadow: "0 0 24px rgba(193,95,60,0.35)",
          }}
          alt="Claude"
        />

        {/* App name */}
        <h1
          style={{
            margin: "0 0 10px",
            fontSize: 26,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-0.4px",
            lineHeight: 1.2,
          }}
        >
          Claude Usage
          <br />
          <span
            style={{
              background: GRADIENT,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Widget
          </span>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            margin: "0 0 36px",
            fontSize: 14,
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.6,
            maxWidth: 270,
          }}
        >
          Monitor your Claude API usage in real-time, right from your desktop.
        </p>

        {/* Feature bullets */}
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {FEATURES.map(({ icon, label }) => (
            <li
              key={label}
              style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
            >
              {/* Gradient-tinted icon chip */}
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "rgba(193,95,60,0.12)",
                  border: "1px solid rgba(193,95,60,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {icon}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.6)",
                  lineHeight: 1.5,
                }}
              >
                {label}
              </span>
            </li>
          ))}
        </ul>

        {/* Bottom version / attribution chip */}
        <div
          style={{
            position: "absolute",
            bottom: 28,
            left: 48,
            fontSize: 11,
            color: "rgba(255,255,255,0.2)",
            letterSpacing: "0.3px",
          }}
        >
          Claude Usage Widget
        </div>
      </div>

      {/* ── VERTICAL DIVIDER ─────────────────────────────────────────────────── */}
      <div
        style={{
          width: 1,
          flexShrink: 0,
          // gradient fade so it vanishes toward top and bottom edges
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.07) 20%, rgba(255,255,255,0.07) 80%, transparent 100%)",
        }}
      />

      {/* ── RIGHT — Login form panel ──────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "52px 48px",
          animation: "fadeUp 0.5s 0.07s ease both",
          opacity: 0, // reset by animation fill-mode
        }}
      >
        {/* Form card */}
        <div
          style={{
            width: "100%",
            maxWidth: 296,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Heading */}
          <h2
            style={{
              margin: "0 0 6px",
              fontSize: 22,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: "-0.3px",
            }}
          >
            Welcome back
          </h2>
          <p
            style={{
              margin: "0 0 32px",
              fontSize: 13,
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.5,
            }}
          >
            Sign in with your Claude account to start tracking your API usage.
          </p>

          {/* Error banner — only rendered when there is an error */}
          {error && (
            <div
              style={{
                marginBottom: 20,
                borderRadius: 10,
                backgroundColor: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                padding: "11px 14px",
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
              }}
            >
              {/* Red dot indicator */}
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#ef4444",
                  flexShrink: 0,
                  marginTop: 3,
                  boxShadow: "0 0 6px #ef4444",
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: "#fca5a5",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </span>
            </div>
          )}

          {/* Login button */}
          <button
            onClick={handleLogin}
            disabled={isLoading}
            style={{
              width: "100%",
              borderRadius: 10,
              background: GRADIENT,
              padding: "13px 16px",
              fontWeight: 600,
              color: "white",
              border: "none",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.55 : 1,
              fontSize: 14,
              transition: "opacity 0.2s, box-shadow 0.2s",
              boxShadow: isLoading
                ? "none"
                : "0 4px 18px rgba(193,95,60,0.35)",
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  GRADIENT_HOVER;
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 6px 22px rgba(193,95,60,0.5)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isLoading) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  GRADIENT;
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 4px 18px rgba(193,95,60,0.35)";
              }
            }}
          >
            {isLoading ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                }}
              >
                <span
                  style={{
                    width: 15,
                    height: 15,
                    border: "2px solid rgba(255,255,255,0.35)",
                    borderTopColor: "#ffffff",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                    flexShrink: 0,
                  }}
                />
                Logging in…
              </span>
            ) : (
              "Login with Claude"
            )}
          </button>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: "rgba(255,255,255,0.06)",
              margin: "24px 0",
            }}
          />

          {/* Security note */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
            }}
          >
            {/* Lock icon — SVG so no icon lib needed */}
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.3)",
              }}
            >
              Your credentials are secure and never stored
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
