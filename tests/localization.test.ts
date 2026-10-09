import { describe, it, expect, vi } from "vitest";
import { createHospital } from "../shared/hospital";
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
const {
  messages,
  languages,
  resources,
  default: i18n,
} = await import("../src/i18n");
describe("Complete UI resources", () => {
  it("defaults and falls back to Arabic", () => {
    expect(i18n.language).toBe("ar");
    expect(i18n.options.fallbackLng).toEqual(["ar"]);
  });
  it("has nonempty text and matching interpolation in all six languages", () => {
    for (const [key, row] of Object.entries(messages)) {
      expect(row.length, key).toBe(6);
      const slots = (s: string) => (s.match(/\{\{[^}]+\}\}/g) ?? []).sort();
      for (const text of row) {
        expect(text.length, key).toBeGreaterThan(0);
        expect(slots(text), key).toEqual(slots(row[0]));
      }
    }
  });
  it("switches immediately and translates room names", async () => {
    for (const [code] of languages) {
      await i18n.changeLanguage(code);
      expect(i18n.t("start")).toBe(resources[code].translation.start);
      for (const room of createHospital().rooms)
        expect(room.names[code]).toBeTruthy();
    }
    await i18n.changeLanguage("ar");
  });
});
