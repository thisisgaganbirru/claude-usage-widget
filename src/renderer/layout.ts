/**
 * How big the widget window has to be.
 *
 * Its own module rather than a constant in `App.tsx` so the sizing is
 * reachable from a test without dragging React, the store and an SVG import
 * in behind it.
 */
import type { SizeOption } from "@renderer/components/widget/WidgetHeader";

/** Header, separator and footer, in pixels; the provider rows are added. */
const WIDGET_CHROME_HEIGHT = 96;

/** Row height per provider at each size. */
const ROW_HEIGHT: Record<SizeOption, number> = {
  Small: 56,
  Medium: 104,
  Large: 148,
};

export const WIDGET_WIDTH = 350;
export const MIN_WIDGET_HEIGHT = 120;
export const MAX_WIDGET_HEIGHT = 900;
export const SETTINGS_WINDOW_SIZE: [number, number] = [800, 600];

/**
 * The old sizes were three fixed pairs, which fit because the widget only ever
 * drew one provider. With a card per provider the same "Medium" is a different
 * height for a user with two providers and a user with six, so the count has
 * to be part of the sum or the last card is cut off.
 */
export function widgetHeight(size: SizeOption, providerCount: number): number {
  const rows = Math.max(providerCount, 1) * ROW_HEIGHT[size];
  return Math.min(
    Math.max(WIDGET_CHROME_HEIGHT + rows, MIN_WIDGET_HEIGHT),
    MAX_WIDGET_HEIGHT,
  );
}
