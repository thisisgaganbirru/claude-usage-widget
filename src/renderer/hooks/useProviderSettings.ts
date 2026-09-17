/**
 * One provider's settings block, read and written through the patch API.
 *
 * Writes go out as `{ providers: { [id]: { thresholds } } }` rather than a
 * whole settings object, so a card that only edits thresholds cannot revert
 * an interval the settings window changed a second earlier.
 */
import { useCallback, useEffect, useState } from "react";
import { tryBridge } from "@renderer/ipc/bridge";
import type { ProviderSettings } from "@shared/types";
import type { ProviderId } from "@shared/usage";

export interface ProviderSettingsView {
  /** null until the first read lands, or if the bridge is missing. */
  settings: ProviderSettings | null;
  isSaving: boolean;
  update: (patch: Partial<ProviderSettings>) => Promise<void>;
}

export function useProviderSettings(
  providerId: ProviderId,
): ProviderSettingsView {
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await tryBridge()?.settings.get();
        if (!cancelled && loaded) setSettings(loaded.providers[providerId]);
      } catch {
        // Leave it null; the card renders without the threshold editor.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const update = useCallback(
    async (patch: Partial<ProviderSettings>) => {
      const previous = settings;
      // Optimistic, so the buttons respond on click rather than on round trip.
      if (previous) setSettings({ ...previous, ...patch });
      setIsSaving(true);
      try {
        const result = await tryBridge()?.settings.update({
          providers: { [providerId]: patch },
        });
        if (result?.settings)
          setSettings(result.settings.providers[providerId]);
      } catch {
        // Main rejected it, so put back what we last knew to be stored.
        if (previous) setSettings(previous);
      } finally {
        setIsSaving(false);
      }
    },
    [providerId, settings],
  );

  return { settings, isSaving, update };
}
