import React, { useMemo, useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";
import { LoginFailureReason, ProviderType } from "@shared/types";

type LoginStep = "idle" | "opening" | "waiting" | "verifying";

interface LoginViewProps {
  selectedProvider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
}

interface ProviderOption {
  provider: ProviderType;
  label: string;
  description: string;
  authUrl: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    provider: "claude",
    label: "Claude",
    description: "Track session and weekly model usage from Claude.ai.",
    authUrl: "https://claude.ai/login",
  },
  {
    provider: "chatgpt",
    label: "ChatGPT",
    description: "Track available ChatGPT usage from your signed-in session.",
    authUrl: "https://chatgpt.com/auth/login",
  },
];

function getLoginErrorMessage(
  provider: ProviderType,
  reason?: LoginFailureReason,
  message?: string,
): string {
  const providerLabel = provider === "chatgpt" ? "ChatGPT" : "Claude";
  if (reason === "token_missing") {
    return (
      message ??
      `Login finished, but no ${providerLabel} session token was captured. Try again.`
    );
  }
  if (reason === "cancelled") {
    return `${providerLabel} login was cancelled.`;
  }
  return message ?? `${providerLabel} login failed. Try again.`;
}

function getStepMessage(step: LoginStep, providerLabel: string): string {
  if (step === "opening") return `Opening ${providerLabel} sign-in`;
  if (step === "waiting") return "Waiting for browser sign-in";
  if (step === "verifying") return "Verifying local session";
  return `Continue with ${providerLabel}`;
}

export function LoginView({
  selectedProvider,
  onProviderChange,
}: LoginViewProps): React.ReactElement {
  const { loadAccounts, setAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [windowOpened, setWindowOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>("idle");
  const [slowHint, setSlowHint] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const selectedOption = useMemo(
    () =>
      PROVIDERS.find((option) => option.provider === selectedProvider) ??
      PROVIDERS[0],
    [selectedProvider],
  );

  const providerLabel = selectedOption.label;

  const copyDiagnostics = async () => {
    const diagnostics = [
      `timestamp=${new Date().toISOString()}`,
      `provider=${selectedProvider}`,
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
      window.setTimeout(() => setDiagCopied(false), 1500);
    } catch (copyError) {
      console.error("[LoginView] Failed to copy diagnostics:", copyError);
      setError("Could not copy diagnostics. Please copy logs from DevTools.");
    }
  };

  const handleLogin = async (): Promise<void> => {
    setAttempts((count) => count + 1);
    setIsLoading(true);
    setWindowOpened(false);
    setError(null);
    setDiagCopied(false);
    setSlowHint(false);
    setStep("opening");

    const slowTimer = window.setTimeout(() => setSlowHint(true), 15000);
    const onWindowOpened = (payload?: { provider?: ProviderType }) => {
      if (!payload?.provider || payload.provider === selectedProvider) {
        setWindowOpened(true);
        setStep("waiting");
      }
    };

    window.electron?.ipcRenderer?.on("auth:login-window-opened", onWindowOpened);

    try {
      if (!window.electron?.ipcRenderer) {
        throw new Error("IPC bridge not available. Please restart the app.");
      }

      const result = await window.electron.ipcRenderer.invoke(
        "auth:login",
        selectedProvider,
      );
      setStep("verifying");

      if (result?.success && result?.isAuthenticated) {
        setAuthenticated(true, selectedProvider);
        await loadAccounts(selectedProvider);
        await window.electron.ipcRenderer.invoke("poller:start", selectedProvider);
      } else {
        setError(
          getLoginErrorMessage(selectedProvider, result?.reason, result?.message),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected login error");
    } finally {
      window.clearTimeout(slowTimer);
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

  const openProviderAuth = () => {
    void window.electron?.ipcRenderer?.invoke(
      "app:openExternal",
      selectedOption.authUrl,
    );
  };

  return (
    <div
      data-widget-card
      className="relative flex h-[600px] w-[800px] overflow-hidden bg-[#101113] font-['Segoe_UI',_Roboto,_sans-serif] text-white"
    >
      <div className="absolute right-4 top-3 z-10 flex gap-1.5">
        <button
          onClick={() => window.electron?.ipcRenderer?.invoke("app:minimize")}
          title="Minimize"
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa2ff]"
        >
          -
        </button>
        <button
          onClick={() => window.electron?.ipcRenderer?.invoke("app:quit")}
          title="Quit"
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-red-500/15 hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa2ff]"
        >
          x
        </button>
      </div>

      <section className="flex w-[328px] shrink-0 flex-col border-r border-white/10 bg-[#15171a] px-8 py-8">
        <div className="mb-8 flex items-center gap-3">
          <img
            src={claudeIcon}
            className="h-10 w-10 shrink-0 rounded-xl border border-white/10 bg-white/5"
            alt=""
          />
          <div>
            <div className="text-sm font-semibold leading-tight">Usage Widget</div>
            <div className="mt-1 text-xs text-white/45">Desktop session monitor</div>
          </div>
        </div>

        <div className="mb-5">
          <h1 className="text-[28px] font-semibold leading-[1.12] text-white">
            Connect a provider
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            Choose the account you want to monitor. Sessions stay local and can
            be cleared from settings.
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          {PROVIDERS.map((option) => {
            const active = selectedProvider === option.provider;
            return (
              <button
                key={option.provider}
                onClick={() => onProviderChange(option.provider)}
                disabled={isLoading}
                className={`group rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa2ff] disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-[#7aa2ff]/45 bg-[#1b2230]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">
                    {option.label}
                  </span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      active ? "bg-[#7aa2ff]" : "bg-white/20 group-hover:bg-white/35"
                    }`}
                  />
                </div>
                <p className="mt-2 text-xs leading-5 text-white/48">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 text-[11px] leading-5 text-white/45">
          Encrypted local token storage. No passwords are stored by this app.
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col justify-center px-12 py-12">
        <div className="max-w-[360px]">
          <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/55">
            {providerLabel} selected
          </div>

          <h2 className="text-[32px] font-semibold leading-[1.12] text-white">
            Sign in to continue
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/52">
            We will open the official {providerLabel} login window, verify the
            session locally, and return you to the widget.
          </p>

          {slowHint && isLoading ? (
            <div className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-100">
              This is taking longer than expected. Finish sign-in in the browser
              window, then wait a moment while the session is verified.
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-200">
              {error}
            </div>
          ) : null}

          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-[#e0e6ef] px-4 text-sm font-semibold text-[#111316] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa2ff] disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/55"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-3">
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current" />
                {getStepMessage(step, providerLabel)}
              </span>
            ) : (
              getStepMessage("idle", providerLabel)
            )}
          </button>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={openProviderAuth}
              disabled={isLoading}
              className="h-9 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa2ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open in browser
            </button>
            <button
              onClick={() => void copyDiagnostics()}
              className="h-9 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa2ff]"
            >
              {diagCopied ? "Diagnostics copied" : "Copy diagnostics"}
            </button>
          </div>

          <div className="mt-8 border-t border-white/10 pt-5">
            <div className="grid grid-cols-3 gap-3 text-center">
              {["Local only", "Encrypted", "Official sign-in"].map((label) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-3"
                >
                  <div className="text-[11px] font-semibold text-white/70">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
