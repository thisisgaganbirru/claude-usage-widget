import { describe, expect, it } from "vitest";
import { widgetHeight } from "../layout";

describe("widgetHeight", () => {
  it("grows with the number of providers", () => {
    const one = widgetHeight("Medium", 1);
    const three = widgetHeight("Medium", 3);
    expect(three).toBeGreaterThan(one);
  });

  it("grows with the chosen size at a fixed provider count", () => {
    expect(widgetHeight("Large", 2)).toBeGreaterThan(widgetHeight("Small", 2));
  });

  it("reserves a row even with nothing reporting", () => {
    // Otherwise the window collapses to the chrome and the "no providers"
    // line has nowhere to render.
    expect(widgetHeight("Small", 0)).toBe(widgetHeight("Small", 1));
  });

  it("stops growing before the window leaves the screen", () => {
    // Six providers at the largest size is the real worst case; a hundred is
    // not, but the clamp should hold regardless.
    expect(widgetHeight("Large", 100)).toBeLessThanOrEqual(900);
  });
});
