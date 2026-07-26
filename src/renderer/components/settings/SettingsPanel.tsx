import React, { useMemo, useState, useEffect } from "react";
import { ProviderType, WidgetSettings } from "@shared/types";
import { useUsageData } from "@renderer/hooks/useUsageData";

interface SettingsPanelProps {
  settings: WidgetSettings;
  isSaving: boolean;
  error: string | null;
  provider: ProviderType;
  onClose: () => void;
  onSave: (next: WidgetSettings) => Promise<void>;
  onLogout: () => Promise<void>;
  onQuit: () => void;
}

type SettingsTab = "general" | "notifications" | "appearance" | "profile" | "changelog";

const TAB_ORDER: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "profile", label: "Profile" },
];

const SUPPORT_TABS: { id: SettingsTab; label: string }[] = [
  { id: "changelog", label: "Release Notes" },
];

const SESSION_THRESHOLDS = [50, 75, 90, 95];
const WEEKLY_THRESHOLDS = [50, 75, 90, 100];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-4 w-8 rounded-full transition-colors duration-200 ${
        checked ? "bg-[#cc785c]" : "bg-[#333]"
      }`}
    >
      <div
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-200 ${
          checked ? "left-4.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (val: string) => void }) {
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
        keys.push(e.key === " " ? "Space" : e.key.charAt(0).toUpperCase() + e.key.slice(1));
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
        <span className="text-sm font-medium text-white">Global Shortcut</span>
        <span className="text-xs text-[#777]">{isRecording ? "Recording..." : value}</span>
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

export function SettingsPanel({
  settings,
  isSaving,
  error,
  provider,
  onClose,
  onSave,
  onLogout,
  onQuit,
}: SettingsPanelProps): React.ReactElement {
  const [draft, setDraft] = useState<WidgetSettings>(settings);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { usageData } = useUsageData(provider);

  const hasChanges = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings),
    [draft, settings],
  );

  const toggleThreshold = (field: keyof WidgetSettings, value: number) => {
    const current = (draft[field] as number[]) || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value].sort((a, b) => a - b);
    setDraft((prev) => ({ ...prev, [field]: next }));
  };

  return (
    <div 
      data-widget-card
      className="flex h-[600px] w-[800px] overflow-hidden bg-[#0c0c0c] font-sans text-[#d1d1d1]"
    >
      <aside className="flex w-[220px] flex-col border-r border-white/5 py-8">
        <div className="mb-8 px-8">
          <h2 className="text-lg font-bold tracking-tight text-white leading-tight">Widget<br/>Controls</h2>
        </div>

        <nav className="flex-1 space-y-0.5 px-4">
          <div className="mb-3 px-4">
            <h1 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#333]">App</h1>
          </div>
          {TAB_ORDER.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-lg px-4 py-1.5 text-left text-sm font-medium transition-all ${
                  active ? "text-white bg-white/5" : "text-[#555] hover:text-[#888]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}

          <div className="mb-3 mt-8 px-4">
            <h1 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#333]">Support</h1>
          </div>
          {SUPPORT_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-lg px-4 py-1.5 text-left text-sm font-medium transition-all ${
                  active ? "text-white bg-white/5" : "text-[#555] hover:text-[#888]"
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
            className="flex w-full items-center gap-2 py-1.5 text-xs font-bold text-[#444] transition-colors hover:text-white"
          >
            Sign out
          </button>
          <button
            onClick={onQuit}
            className="flex w-full items-center gap-2 py-1.5 text-xs font-bold text-[#444] transition-colors hover:text-white"
          >
            Quit Widget
          </button>
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[72px] shrink-0 items-center justify-end px-12">
          <button onClick={onClose} className="text-[#333] transition-colors hover:text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-12 pb-24 pt-0 custom-scrollbar">
          <div className="max-w-[540px]">
            {activeTab === "general" && (
              <div className="space-y-6">
                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">Synchronization</h3>
                  <div className="py-2">
                    <div className="mb-3 flex justify-between">
                      <span className="text-sm font-medium text-white">Polling Frequency</span>
                      <span className="text-xs font-bold text-[#cc785c]">{draft.pollingInterval}s</span>
                    </div>
                    <input
                      type="range" min={30} max={300} step={5}
                      value={draft.pollingInterval}
                      onChange={(e) => setDraft(prev => ({ ...prev, pollingInterval: parseInt(e.target.value) }))}
                      className="h-0.5 w-full appearance-none bg-[#222] accent-[#cc785c]"
                    />
                  </div>
                  <div className="mt-2 border-t border-white/5 pt-2">
                    <ShortcutRecorder 
                      value={draft.quickEntryShortcut} 
                      onChange={(val) => setDraft(prev => ({ ...prev, quickEntryShortcut: val }))} 
                    />
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">Behavior</h3>
                  <div className="space-y-0 border-t border-white/5">
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-white">Start on boot</p>
                        <p className="text-[11px] text-[#555]">Launch when your computer starts</p>
                      </div>
                      <Toggle checked={draft.startOnBoot} onChange={(v) => setDraft(prev => ({ ...prev, startOnBoot: v }))} />
                    </div>
                    <div className="flex items-center justify-between border-t border-white/5 py-3">
                      <div>
                        <p className="text-sm font-medium text-white">Keep in tray</p>
                        <p className="text-[11px] text-[#555]">Minimize to tray instead of quitting</p>
                      </div>
                      <Toggle checked={draft.keepInTray} onChange={(v) => setDraft(prev => ({ ...prev, keepInTray: v }))} />
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="space-y-8">
                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">Display</h3>
                  <div className="space-y-0 border-t border-white/5">
                    <div className="flex items-center justify-between py-3">
                      <p className="text-sm font-medium text-white">Desktop notifications</p>
                      <Toggle checked={draft.enableDesktopNotifications} onChange={(v) => setDraft(prev => ({ ...prev, enableDesktopNotifications: v }))} />
                    </div>
                    <div className="flex items-center justify-between border-t border-white/5 py-3">
                      <p className="text-sm font-medium text-white">Banner notifications</p>
                      <Toggle checked={draft.enableBannerNotifications} onChange={(v) => setDraft(prev => ({ ...prev, enableBannerNotifications: v }))} />
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">Session Thresholds</h3>
                  <div className="grid grid-cols-4 gap-x-4 border-t border-white/5 pt-4">
                    {SESSION_THRESHOLDS.map(val => (
                      <button
                        key={val}
                        onClick={() => toggleThreshold("notificationThresholds", val)}
                        className="flex flex-col items-center gap-2 text-xs transition-all"
                      >
                        <span className={`font-medium ${draft.notificationThresholds.includes(val) ? "text-white" : "text-[#555]"}`}>
                          {val}%
                        </span>
                        <div className={`h-1 w-1 rounded-full transition-all ${draft.notificationThresholds.includes(val) ? 'bg-[#cc785c]' : 'bg-[#222]'}`} />
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#333]">Weekly Thresholds</h3>
                  <div className="grid grid-cols-4 gap-x-4 border-t border-white/5 pt-4">
                    {WEEKLY_THRESHOLDS.map(val => (
                      <button
                        key={val}
                        onClick={() => toggleThreshold("weeklyNotificationThresholds", val)}
                        className="flex flex-col items-center gap-2 text-xs transition-all"
                      >
                        <span className={`font-medium ${draft.weeklyNotificationThresholds.includes(val) ? "text-white" : "text-[#555]"}`}>
                          {val}%
                        </span>
                        <div className={`h-1 w-1 rounded-full transition-all ${draft.weeklyNotificationThresholds.includes(val) ? 'bg-[#cc785c]' : 'bg-[#222]'}`} />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeTab === "appearance" && (
              <section>
                <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[#333]">Theme</h3>
                <div className="grid grid-cols-3 gap-8 border-t border-white/5 pt-6">
                  {(["auto", "dark", "light"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setDraft(prev => ({ ...prev, theme: t }))}
                      className="group flex flex-col items-center gap-3"
                    >
                      <div className={`h-8 w-full rounded border transition-all ${
                        draft.theme === t ? "border-[#cc785c] bg-[#cc785c]/10" : "border-white/5 bg-[#111] group-hover:border-white/10"
                      }`} />
                      <span className={`text-[11px] font-bold capitalize ${draft.theme === t ? "text-white" : "text-[#555]"}`}>{t}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "profile" && (
              <div className="space-y-6">
                <section>
                  <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[#333]">Identity</h3>
                  <div className="flex items-center gap-6 border-t border-white/5 py-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a1a1a] text-lg font-bold text-white border border-white/5">
                      {usageData?.userName?.charAt(0) || "U"}
                    </div>
                    <div>
                      <p className="text-base font-bold text-white">{usageData?.userName || "User"}</p>
                      <button className="mt-0.5 text-xs font-bold text-[#cc785c] hover:underline">Update profile</button>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[#333]">Emails</h3>
                  <div className="border-t border-white/5 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-white">{usageData?.userName?.toLowerCase().replace(/\s/g, '.') || 'user'}@gmail.com</p>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#cc785c]">Primary</span>
                    </div>
                    <button className="text-xs font-bold text-[#444] hover:text-white">+ Add email address</button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "changelog" && (
              <div className="space-y-6 border-t border-white/5 pt-6">
                {[
                  { v: "1.0.3", note: "Clean minimalist redesign focused on transparency and space." },
                  { v: "1.0.2", note: "Improved usage polling with adaptive backoff logic." },
                  { v: "1.0.1", note: "Initial release with desktop notification support." }
                ].map((item) => (
                  <div key={item.v} className="group">
                    <p className="text-xs font-bold text-white">v{item.v}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#666]">{item.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="absolute bottom-10 right-12 z-20">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setDraft(settings)}
              disabled={!hasChanges || isSaving}
              className="text-xs font-bold text-[#444] hover:text-[#777] disabled:opacity-0 transition-all"
            >
              Reset
            </button>
            <button
              onClick={() => void onSave(draft)}
              disabled={!hasChanges || isSaving}
              className="rounded-full bg-white px-8 py-2.5 text-xs font-bold text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-0 disabled:pointer-events-none"
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
