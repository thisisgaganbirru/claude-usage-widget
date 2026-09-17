/**
 * Notification text.
 *
 * Every string here is built from a number and a fixed literal. Nothing a
 * vendor sent us is interpolated: a window's `label` comes from our own
 * normalizer, and the percentages are clamped numbers. A vendor that starts
 * returning HTML, or a 4 KB error string, therefore cannot end up rendered in
 * a desktop notification.
 */
import { providerLabel } from "@shared/provider-labels";
import type { ThresholdCrossedEvent } from "@shared/types";

export interface NotificationText {
  title: string;
  body: string;
}

export function thresholdNotification(
  event: ThresholdCrossedEvent,
): NotificationText {
  const used = Math.round(event.usedPercent);
  return {
    title: `${providerLabel(event.providerId)} usage alert`,
    body: `${event.windowLabel} is at ${used}% (alert set at ${event.threshold}%).`,
  };
}
