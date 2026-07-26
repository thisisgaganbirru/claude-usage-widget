import React, { useMemo, useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";
import { LoginFailureReason, ProviderType } from "@shared/types";

type LoginStep = "idle" | "opening" | "waiting" | "verifying";

const FEATURES: { icon: string; label: string }[] = [
  { icon: "⚡", label: "Live session and weekly usage tracking" },
  { icon: "🎨", label: "Per-model breakdown in compact/expanded widget views" },
  { icon: "🔔", label: "Desktop alerts at usage thresholds" },
  { icon: "📊", label: "Tray widget with quick glance usage visibility" },
];

function getLoginErrorMessage(
  reason?: LoginFailureReason,
  message?: string,
): string {
  if (reason === "token_missing") {
    return (
      message ??
      "Login finished, but no Claude session token was captured. Try logging in again."
    );
  }
  if (reason === "cancelled") {
    return "Login cancelled. Please try again.";
  }
  return message ?? "Login failed. Please try again.";
}

function getStepMessage(step: LoginStep): string {
  if (step === "opening") return "Opening login window...";
  if (step === "waiting") return "Complete sign-in in the opened window...";
  if (step === "verifying") return "Verifying session token...";
  return "Login with Claude";
}

interface LoginViewProps {
  selectedProvider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
}

export function LoginView({
  selectedProvider,
  onProviderChange,
}: LoginViewProps): React.ReactElement {
  const { setAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [windowOpened, setWindowOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>("idle");
  const [slowHint, setSlowHint] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showHelpActions, setShowHelpActions] = useState(false);

  const copyDiagnostics = async () => {
    const diagnostics = [
      `timestamp=${new Date().toISOString()}`,
      `step=${step}`,
      `loading=${isLoading}`,
      `window_opened=${windowOpened}`,
      `attempts=${attempts}`,
      `error=${error ?? "none"}`,
      `user_agent=${navigator.userAgent}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(diagnostics);
      setDiagCopied(true);
      setTimeout(() => setDiagCopied(false), 1500);
    } catch (copyError) {
      console.error("[LoginView] Failed to copy diagnostics:", copyError);
      setError("Could not copy diagnostics. Please copy logs from DevTools.");
    }
  };

  const providerLabel = selectedProvider === "chatgpt" ? "ChatGPT" : "Claude";
  const productName = useMemo(
    () => `${providerLabel} Usage Widget`,
    [providerLabel],
  );

  const handleLogin = async (): Promise<void> => {
    setAttempts((count) => count + 1);
    setIsLoading(true);
    setWindowOpened(false);
    setError(null);
    setDiagCopied(false);
    setSlowHint(false);
    setStep("opening");

    const slowTimer = setTimeout(() => setSlowHint(true), 15000);
    const onWindowOpened = (payload?: { provider?: ProviderType }) => {
      if (!payload?.provider || payload.provider === selectedProvider) {
        setWindowOpened(true);
        setStep("waiting");
      }
    };

    window.electron?.ipcRenderer?.on("auth:login-window-opened", onWindowOpened);

    try {
      if (!window.electron || !window.electron.ipcRenderer) {
        throw new Error("IPC bridge not available. Please restart the application.");
      }

      const result = await window.electron.ipcRenderer.invoke(
        "auth:login",
        selectedProvider,
      );
      setStep("verifying");

      if (result?.success && result?.isAuthenticated) {
        setAuthenticated(true, selectedProvider);
        await window.electron.ipcRenderer.invoke("poller:start", selectedProvider);
      } else {
        setError(getLoginErrorMessage(result?.reason, result?.message));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected login error");
    } finally {
      clearTimeout(slowTimer);
      setIsLoading(false);
      setWindowOpened(false);
      setSlowHint(false);
      setStep("idle");
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
          onClick={() => (window as any).electron?.ipcRenderer?.invoke("app:minimize")}
          title="Minimize"
          className="px-1 text-lg leading-none text-white/50 transition-colors hover:text-white"
        >
          —
        </button>
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
          alt="Widget"
        />

        <h1 className="mb-2.5 text-[26px] font-bold leading-[1.2] tracking-[-0.4px] text-white">
          {providerLabel} Usage
          <br />
          <span className="bg-[linear-gradient(135deg,#C15F3C_0%,#a8492c_100%)] bg-clip-text text-transparent">
            Widget
          </span>
        </h1>

        <p className="mb-9 max-w-[270px] text-sm leading-[1.6] text-white/50">
          Monitor your {providerLabel} usage in real-time, right from your desktop.
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
          {productName}
        </div>
      </div>

      <div className="w-px shrink-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(255,255,255,0.07)_20%,rgba(255,255,255,0.07)_80%,transparent_100%)]" />

      <div className="flex flex-1 flex-col items-center justify-center px-12 py-[52px]">
        <div className="flex w-full max-w-[320px] flex-col">
          <h2 className="mb-1.5 text-[22px] font-bold tracking-[-0.3px] text-white">
            Welcome back
          </h2>
          <p className="mb-5 text-[13px] leading-[1.5] text-white/45">
            Select a provider and sign in to track usage.
          </p>

          <div className="mb-4 flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(["claude", "chatgpt"] as ProviderType[]).map((provider) => {
              const active = selectedProvider === provider;
              return (
                <button
                  key={provider}
                  onClick={() => onProviderChange(provider)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-[#C15F3C]/20 text-[#C15F3C]"
                      : "text-white/45 hover:text-white/70"
                  }`}
                >
                  {provider === "claude" ? "Claude" : "ChatGPT"}
                </button>
              );
            })}
          </div>

          {slowHint && isLoading && (
            <div className="mb-4 rounded-[10px] border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-200">
              This is taking longer than usual. If the browser window is open,
              complete sign-in there and wait a moment for token verification.
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-[9px] rounded-[10px] border border-red-500/25 bg-red-500/10 px-[14px] py-[11px]">
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
                {getStepMessage(step)}
              </span>
            ) : (
              `Login with ${providerLabel}`
            )}
          </button>

          <div className="mt-3 text-center">
            <button
              onClick={() => setShowHelpActions((v) => !v)}
              className="text-[11px] text-white/45 underline-offset-2 transition-colors hover:text-white/70 hover:underline"
            >
              {showHelpActions ? "Hide help actions" : "Need help?"}
            </button>
            {showHelpActions && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    (window as any).electron?.ipcRenderer?.invoke(
                      "app:openExternal",
                      "https://claude.ai/login",
                    )
                  }
                  className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-white/[0.08]"
                >
                  Open Claude
                </button>
                <button
                  onClick={() => void copyDiagnostics()}
                  className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-white/[0.08]"
                >
                  {diagCopied ? "Copied" : "Copy debug"}
                </button>
              </div>
            )}
          </div>

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
              Credentials stay in provider auth pages; only encrypted session tokens are stored
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
