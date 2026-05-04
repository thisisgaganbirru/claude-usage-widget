import React, { useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";

const FEATURES: { icon: string; label: string }[] = [
  { icon: "⚡", label: "Live 5-hour session & 7-day rolling usage" },
  { icon: "🎨", label: "Per-model breakdown — Opus, Sonnet & Haiku" },
  { icon: "🔔", label: "Desktop alerts at custom usage thresholds" },
  { icon: "📊", label: "Compact system-tray widget, always in reach" },
];

export function LoginView(): React.ReactElement {
  const { setAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [windowOpened, setWindowOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (): Promise<void> => {
    setIsLoading(true);
    setWindowOpened(false);
    setError(null);

    const onWindowOpened = () => setWindowOpened(true);
    window.electron?.ipcRenderer?.on("auth:login-window-opened", onWindowOpened);

    try {
      if (!window.electron || !window.electron.ipcRenderer) {
        throw new Error(
          "IPC bridge not available. Please restart the application.",
        );
      }

      const result = await window.electron.ipcRenderer.invoke("auth:login");

      if (result.success && result.isAuthenticated) {
        setAuthenticated(true);
      } else {
        setError("Login cancelled. Please try again.");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unexpected error occurred";
      console.error("[LoginView] Login error:", errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setWindowOpened(false);
      window.electron?.ipcRenderer?.removeListener(
        "auth:login-window-opened",
        onWindowOpened,
      );
    }
  };

  return (
    <div
      data-widget-card
      className="relative flex h-[600px] w-[800px] overflow-hidden bg-[#0c0c0d] font-['Segoe_UI',_Roboto,_sans-serif]"
    >
      <div className="absolute right-4 top-3.5 z-10 flex gap-2">
        <button
          onClick={() => (window as any).electron?.ipcRenderer?.invoke("app:quit")}
          title="Quit"
          className="px-1 text-lg leading-none text-white/50 transition-colors hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="relative flex w-[400px] shrink-0 flex-col justify-center bg-[radial-gradient(ellipse_at_15%_45%,rgba(193,95,60,0.09)_0%,transparent_65%),#0c0c0d] px-12 py-[52px]">
        <img
          src={claudeIcon}
          className="mb-7 h-14 w-14 shrink-0 rounded-2xl shadow-[0_0_24px_rgba(193,95,60,0.35)]"
          alt="Claude"
        />

        <h1 className="mb-2.5 text-[26px] font-bold leading-[1.2] tracking-[-0.4px] text-white">
          Claude Usage
          <br />
          <span className="bg-[linear-gradient(135deg,#C15F3C_0%,#a8492c_100%)] bg-clip-text text-transparent">
            Widget
          </span>
        </h1>

        <p className="mb-9 max-w-[270px] text-sm leading-[1.6] text-white/50">
          Monitor your Claude API usage in real-time, right from your desktop.
        </p>

        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {FEATURES.map(({ icon, label }) => (
            <li key={label} className="flex items-start gap-3">
              <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#C15F3C]/20 bg-[#C15F3C]/12 text-[13px]">
                {icon}
              </span>
              <span className="text-[13px] leading-[1.5] text-white/60">
                {label}
              </span>
            </li>
          ))}
        </ul>

        <div className="absolute bottom-7 left-12 text-[11px] tracking-[0.3px] text-white/20">
          Claude Usage Widget
        </div>
      </div>

      <div className="w-px shrink-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(255,255,255,0.07)_20%,rgba(255,255,255,0.07)_80%,transparent_100%)]" />

      <div className="flex flex-1 flex-col items-center justify-center px-12 py-[52px]">
        <div className="flex w-full max-w-[296px] flex-col">
          <h2 className="mb-1.5 text-[22px] font-bold tracking-[-0.3px] text-white">
            Welcome back
          </h2>
          <p className="mb-8 text-[13px] leading-[1.5] text-white/45">
            Sign in with your Claude account to start tracking your API usage.
          </p>

          {error && (
            <div className="mb-5 flex items-start gap-[9px] rounded-[10px] border border-red-500/25 bg-red-500/10 px-[14px] py-[11px]">
              <span className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full bg-red-500 shadow-[0_0_6px_#ef4444]" />
              <span className="text-xs leading-[1.5] text-red-300">{error}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full rounded-[10px] bg-[linear-gradient(135deg,#C15F3C_0%,#a8492c_100%)] px-4 py-[13px] text-sm font-semibold text-white shadow-[0_4px_18px_rgba(193,95,60,0.35)] transition-[opacity,box-shadow,background] hover:bg-[linear-gradient(135deg,#d06a44_0%,#C15F3C_100%)] hover:shadow-[0_6px_22px_rgba(193,95,60,0.5)] disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:shadow-none"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-[9px]">
                <span className="h-[15px] w-[15px] shrink-0 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                {windowOpened
                  ? "Complete login in the opened window…"
                  : "Opening login window…"}
              </span>
            ) : (
              "Login with Claude"
            )}
          </button>

          <div className="my-6 h-px bg-white/5" />

          <div className="flex items-center justify-center gap-[7px]">
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
            <span className="text-xs text-white/30">
              Your credentials are secure and never stored
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
