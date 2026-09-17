import React, { useMemo, useState, useEffect } from "react";
import { providerLabel } from "@shared/provider-labels";
import { PROVIDER_IDS, type ProviderId } from "@shared/usage";
import type {
  ProviderSettings,
  SettingsPatch,
  WidgetSettings,
} from "@shared/types";

interface SettingsPanelProps {
  settings: WidgetSettings;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (patch: SettingsPatch) => Promise<void>;
  onLogout: () => Promise<void>;
  onQuit: () => void;
}

type SettingsTab = "general" | "providers" | "notifications" | "appearance";

const TAB_ORDER: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
];

/** Mirrors POLLING_INTERVAL_{MIN,MAX}_SEC; main clamps whatever arrives. */
const INTERVAL_MIN_SEC = 30;
const INTERVAL_MAX_SEC = 300;

const THRESHOLD_CHOICES = [50, 75, 90, 95, 100];

/** The flat, non-provider settings this panel edits. */
const SCALAR_KEYS = [
  "enableDesktopNotifications",
  "enableBannerNotifications",
  "startOnBoot",
  "keepInTray",
  "quickEntryShortcut",
  "theme",
] as const;

function sameNumbers(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Only what the user actually changed.
 *
 * The panel could send its whole draft, but it read that draft when the window
 * opened: anything a widget card wrote in the meantime would be reverted by
 * fields the user never touched. A diff means an untouched field is not a
 * write at all.
 */
export function diffSettings(
  base: WidgetSettings,
  draft: WidgetSettings,
): SettingsPatch {
  const patch: SettingsPatch = {};

  for (const key of SCALAR_KEYS) {
    if (draft[key] !== base[key]) {
      // Each key's value type matches its own slot; the loop erases that.
      Object.assign(patch, { [key]: draft[key] });
    }
  }

  const providers: NonNullable<SettingsPatch["providers"]> = {};
  for (const id of PROVIDER_IDS) {
    const from = base.providers[id];
    const to = draft.providers[id];
    const block: Partial<ProviderSettings> = {};
    if (to.enabled !== from.enabled) block.enabled = to.enabled;
    if (to.intervalSec !== from.intervalSec) block.intervalSec = to.intervalSec;
    if (!sameNumbers(to.thresholds, from.thresholds)) {
      block.thresholds = to.thresholds;
    }
    if (Object.keys(block).length > 0) providers[id] = block;
  }
  if (Object.keys(providers).length > 0) patch.providers = providers;

  return patch;
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-4 w-8 rounded-full transition-colors duration-200 ${
        checked ? "bg-[#cc785c]" : "bg-fg/20"
      }`}
    >
      <div
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-fg transition-all duration-200 ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function ShortcutRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    if (!isRecording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const keys: string[] = [];
      if (e.ctrlKey) keys.push("Control");
      if (e.altKey) keys.push("Alt");
      if (e.shiftKey) keys.push("Shift");
      if (e.metaKey) keys.push("Command");
      if (!["Control", "Alt", "Shift", "Meta", "Tab"].includes(e.key)) {
        keys.push(
          e.key === " "
            ? "Space"
            : e.key.charAt(0).toUpperCase() + e.key.slice(1),
        );
        onChange(keys.join("+"));
        setIsRecording(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isRecording, onChange]);

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-fg">Global Shortcut</span>
        <span className="text-xs text-[#777]">
          {isRecording ? "Recording..." : value}
        </span>
      </div>
      <button
        onClick={() => setIsRecording(!isRecording)}
        className="text-xs font-bold text-[#cc785c] hover:opacity-80"
      >
        {isRecording ? "Cancel" : "Change"}
      </button>
    </div>
  );
}

/**
 * One provider's polling and alerting. Every provider gets the same controls,
 * so P2 through P4 add rows here by adding a provider id, not a tab.
 */
function ProviderSection({
  id,
  block,
  onChange,
}: {
  id: ProviderId;
  block: ProviderSettings;
  onChange: (patch: Partial<ProviderSettings>) => void;
}): React.ReactElement {
  const toggleThreshold = (value: number): void => {
    const next = block.thresholds.includes(value)
      ? block.thresholds.filter((entry) => entry !== value)
      : [...block.thresholds, value].sort((a, b) => a - b);
    onChange({ thresholds: next });
  };

  return (
    <section className="border-t border-fg/5 py-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-fg">{providerLabel(id)}</span>
        <Toggle
          checked={block.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
      </div>

      <div
        className={
          block.enabled
            ? "space-y-4"
            : "space-y-4 opacity-40 pointer-events-none"
        }
      >
        <div>
          <div className="mb-2 flex justify-between">
            <span className="text-xs text-[#777]">Check every</span>
            <span className="text-xs font-bold text-[#cc785c]">
              {block.intervalSec}s
            </span>
          </div>
          <input
            type="range"
            min={INTERVAL_MIN_SEC}
            max={INTERVAL_MAX_SEC}
            step={5}
            value={block.intervalSec}
            onChange={(e) =>
              onChange({ intervalSec: parseInt(e.target.value, 10) })
            }
            className="h-0.5 w-full appearance-none bg-fg/15 accent-[#cc785c]"
          />
        </div>

        <div>
          <div className="mb-2 text-xs text-[#777]">
            Alert at, for every limit this provider reports
          </div>
          <div className="grid grid-cols-5 gap-x-4">
            {THRESHOLD_CHOICES.map((value) => {
              const on = block.thresholds.includes(value);
              return (
                <button
                  key={value}
                  onClick={() => toggleThreshold(value)}
                  className="flex flex-col items-center gap-2 text-xs transition-all"
                >
                  <span
                    className={`font-medium ${on ? "text-fg" : "text-[#555]"}`}
                  >
                    {value}%
                  </span>
                  <div
                    className={`h-1 w-1 rounded-full transition-all ${
                      on ? "bg-[#cc785c]" : "bg-fg/15"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsPanel({
  settings,
  isSaving,
  error,
  onClose,
  onSave,
  onLogout,
  onQuit,
}: SettingsPanelProps): React.ReactElement {
  const [draft, setDraft] = useState<WidgetSettings>(settings);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // Main normalizes what it stores, so a save can come back with a value the
  // draft does not have (an interval clamped, a threshold deduped). Without
  // this the panel would keep offering to save a change it already made.
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const patch = useMemo(() => diffSettings(settings, draft), [settings, draft]);
  const hasChanges = Object.keys(patch).length > 0;

  const updateProvider = (
    id: ProviderId,
    block: Partial<ProviderSettings>,
  ): void => {
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [id]: { ...prev.providers[id], ...block },
      },
    }));
  };

  return (
    <div
      data-widget-card
      className="flex h-[600px] w-[800px] overflow-hidden bg-sunken font-sans text-fg/80"
    >
      <aside className="flex w-[220px] flex-col border-r border-fg/5 py-8">
        <div className="mb-8 px-8">
          <h2 className="text-lg font-bold tracking-tight text-fg leading-tight">
            Widget
            <br />
            Controls
          </h2>
        </div>

        <nav className="flex-1 space-y-0.5 px-4">
          <div className="mb-3 px-4">
            <h1 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#333]">
              App
            </h1>
          </div>
          {TAB_ORDER.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-lg px-4 py-1.5 text-left text-sm font-medium transition-all ${
                  active ? "text-fg bg-fg/5" : "text-[#555] hover:text-[#888]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="px-8 pb-2">
          <button
            onClick={() => void onLogout()}
            className="flex w-full items-center gap-2 py-1.5 text-xs font-bold text-[#444] transition-colors hover:text-fg"
          >
            Sign out
          </button>
          <button
            onClick={onQuit}
            className="flex w-full items-center gap-2 py-1.5 text-xs font-bold text-[#444] transition-colors hover:text-fg"
          >
            Quit Widget
          </button>
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[72px] shrink-0 items-center justify-end px-12">
          <button
            onClick={onClose}
            className="text-[#333] transition-colors hover:text-fg"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-12 pb-24 pt-0 custom-scrollbar">
          <div className="max-w-[540px]">
            {activeTab === "general" && (
              <div className="space-y-6">
                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">
                    Shortcuts
                  </h3>
                  <div className="border-t border-fg/5 pt-2">
                    <ShortcutRecorder
                      value={draft.quickEntryShortcut}
                      onChange={(val) =>
                        setDraft((prev) => ({
                          ...prev,
                          quickEntryShortcut: val,
                        }))
                      }
                    />
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">
                    Behavior
                  </h3>
                  <div className="space-y-0 border-t border-fg/5">
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-fg">
                          Start on boot
                        </p>
                        <p className="text-[11px] text-[#555]">
                          Launch when your computer starts
                        </p>
                      </div>
                      <Toggle
                        checked={draft.startOnBoot}
                        onChange={(v) =>
                          setDraft((prev) => ({ ...prev, startOnBoot: v }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between border-t border-fg/5 py-3">
                      <div>
                        <p className="text-sm font-medium text-fg">
                          Keep in tray
                        </p>
                        <p className="text-[11px] text-[#555]">
                          Minimize to tray instead of quitting
                        </p>
                      </div>
                      <Toggle
                        checked={draft.keepInTray}
                        onChange={(v) =>
                          setDraft((prev) => ({ ...prev, keepInTray: v }))
                        }
                      />
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "providers" && (
              <div>
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">
                  Providers
                </h3>
                <p className="mb-2 text-[11px] text-[#555]">
                  A provider that is off is never polled and never alerts.
                </p>
                {PROVIDER_IDS.map((id) => (
                  <ProviderSection
                    key={id}
                    id={id}
                    block={draft.providers[id]}
                    onChange={(block) => updateProvider(id, block)}
                  />
                ))}
              </div>
            )}

            {activeTab === "notifications" && (
              <section>
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">
                  Display
                </h3>
                <p className="mb-2 text-[11px] text-[#555]">
                  Which levels raise an alert is set per provider, under
                  Providers.
                </p>
                <div className="space-y-0 border-t border-fg/5">
                  <div className="flex items-center justify-between py-3">
                    <p className="text-sm font-medium text-fg">
                      Desktop notifications
                    </p>
                    <Toggle
                      checked={draft.enableDesktopNotifications}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          enableDesktopNotifications: v,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-fg/5 py-3">
                    <p className="text-sm font-medium text-fg">
                      Banner notifications
                    </p>
                    <Toggle
                      checked={draft.enableBannerNotifications}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          enableBannerNotifications: v,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>
            )}

            {activeTab === "appearance" && (
              <section>
                <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[#333]">
                  Theme
                </h3>
                <div className="grid grid-cols-3 gap-8 border-t border-fg/5 pt-6">
                  {(["auto", "dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, theme: t }))
                      }
                      className="group flex flex-col items-center gap-3"
                    >
                      <div
                        className={`h-8 w-full rounded border transition-all ${
                          draft.theme === t
                            ? "border-[#cc785c] bg-[#cc785c]/10"
                            : "border-fg/5 bg-fg/[0.06] group-hover:border-fg/10"
                        }`}
                      />
                      <span
                        className={`text-[11px] font-bold capitalize ${draft.theme === t ? "text-fg" : "text-[#555]"}`}
                      >
                        {t}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="absolute bottom-10 right-12 z-20">
          <div className="flex items-center gap-6">
            {error ? (
              <span role="alert" className="text-xs text-red-400">
                {error}
              </span>
            ) : null}
            <button
              onClick={() => setDraft(settings)}
              disabled={!hasChanges || isSaving}
              className="text-xs font-bold text-[#444] hover:text-[#777] disabled:opacity-0 transition-all"
            >
              Reset
            </button>
            <button
              onClick={() => void onSave(patch)}
              disabled={!hasChanges || isSaving}
              className="rounded-full bg-fg px-8 py-2.5 text-xs font-bold text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-0 disabled:pointer-events-none"
            >
              {isSaving ? "Saving" : "Save changes"}
            </button>
          </div>
        </footer>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222; }
      `}</style>
    </div>
  );
}
