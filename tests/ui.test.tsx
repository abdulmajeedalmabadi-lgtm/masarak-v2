// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { createHospital } from "../shared/hospital";
import type { Journey } from "../shared/types";
import i18n from "../src/i18n";
import { App } from "../src/App";
import { api } from "../src/api";
import { parseCheckpointPayload } from "../shared/checkpoints";
const hospital = createHospital();
const journey: Journey = {
  id: "ui-journey",
  alias: "UI visitor",
  tokenVersion: 1,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  location: "door-reception",
  accessible: false,
  createdAt: new Date().toISOString(),
  stages: [{ id: "stage", roomId: "triage", status: "active" }],
};
vi.mock("socket.io-client", () => ({
  io: () => ({ on: () => {}, disconnect: () => {} }),
}));
vi.mock("../src/api", () => ({
  base: "",
  api: vi.fn(async (path: string, _token?: string, body?: any) => {
    if (path === "/map") return hospital;
    if (path === "/journey")
      return {
        journey: { ...journey },
        ticket: null,
        ahead: 0,
        waitMinutes: 0,
        notifications: [],
      };
    if (path === "/location") {
      journey.location =
        body.nodeId ??
        hospital.checkpoints.find(
          (q) =>
            q.id ===
            parseCheckpointPayload(body.checkpoint ?? "")?.checkpointId,
        )?.nodeId ??
        journey.location;
      journey.confirmedCheckpointId = body.checkpoint
        ? parseCheckpointPayload(body.checkpoint)?.checkpointId
        : undefined;
      return { ok: true };
    }
    if (path === "/accessibility") {
      journey.accessible = body.accessible;
      return { ok: true };
    }
    return { ok: true };
  }),
}));
beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  journey.location = "door-reception";
  journey.accessible = false;
  journey.confirmedCheckpointId = undefined;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await i18n.changeLanguage("ar");
  window.history.replaceState({}, "", "/onboarding");
});
afterEach(cleanup);
const mount = () =>
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
describe("Patient screens and preferences in a DOM environment", () => {
  it("holds a phone-camera checkpoint until a journey is opened, then confirms the location", async () => {
    window.history.replaceState(
      {},
      "",
      "/?hospital=masarak-hospital&checkpoint=QR-door-lab",
    );
    mount();
    await screen.findByText(
      "تم حفظ نقطة الموقع؛ افتح رابط رحلتك من الاستقبال للمتابعة",
    );
    expect(vi.mocked(api).mock.calls.some(([p]) => p === "/location")).toBe(
      false,
    );
    expect(sessionStorage.getItem("masarak.pending-checkpoint")).toContain(
      "QR-door-lab",
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "إدخال رمز أو رابط الرحلة" }),
      "aaa.bbb.ccc",
    );
    await user.click(screen.getByRole("button", { name: "فتح" }));
    await screen.findAllByText("تم تحديث موقعك وإعادة حساب المسار");
    await screen.findByText("المسافة المتبقية: ≈ 30 متر");
    expect(journey.location).toBe("door-lab");
    expect(sessionStorage.getItem("masarak.pending-checkpoint")).toBeNull();
  });
  it("opens in Arabic, RTL and light mode", async () => {
    mount();
    await screen.findByText("مرحبًا بك في مسارك");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar-SA");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("changes language immediately across all six languages and directions", async () => {
    mount();
    const user = userEvent.setup();
    for (const [button, code, heading, dir] of [
      ["English", "en", "Welcome to Masarak", "ltr"],
      ["اردو", "ur", "مسارک میں خوش آمدید", "rtl"],
      ["Français", "fr", "Bienvenue sur Masarak", "ltr"],
      ["Türkçe", "tr", "Masarak’a hoş geldiniz", "ltr"],
      ["Bahasa Indonesia", "id", "Selamat datang di Masarak", "ltr"],
      ["العربية", "ar", "مرحبًا بك في مسارك", "rtl"],
    ]) {
      await user.click(screen.getByRole("button", { name: button }));
      expect(await screen.findByText(heading)).toBeTruthy();
      expect(document.documentElement.dir).toBe(dir);
      expect(localStorage.getItem("masarak.language")).toBe(code);
    }
  });
  it("toggles moon/sun theme and restores preferences on remount", async () => {
    const user = userEvent.setup();
    const rendered = mount();
    await user.click(screen.getByRole("button", { name: "داكن" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "فاتح" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "حجم خط أكبر" }));
    expect(document.documentElement.classList.contains("large")).toBe(true);
    rendered.unmount();
    mount();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(
      (
        screen.getByRole("checkbox", {
          name: "حجم خط أكبر",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
  it("renders an authorized journey and navigable two-floor SVG", async () => {
    sessionStorage.setItem("masarak.journey", "test-journey-token");
    window.history.replaceState({}, "", "/map");
    mount();
    const svg = await screen.findByRole("img", { name: "الخريطة" });
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(5);
    expect(screen.getByText("حدد موقعك الحالي")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "الدور الأول" }));
    expect(svg.textContent).toContain("عيادة الباطنية");
    await user.click(screen.getByRole("button", { name: "تكبير" }));
    expect(svg.querySelector("g")?.getAttribute("transform")).toContain(
      "scale(1.2)",
    );
  });
  it("updates a wrong-turn QR checkpoint and displays the recalculated route", async () => {
    sessionStorage.setItem("masarak.journey", "test-journey-token");
    window.history.replaceState({}, "", "/scan");
    mount();
    const user = userEvent.setup();
    const test = await screen.findByRole("combobox", { name: "نقطة الموقع" });
    await user.selectOptions(test, "QR-door-lab");
    const section = test.closest("section")!;
    const button = Array.from(section.querySelectorAll("button")).find(
      (b) => b.textContent === "مسح رمز QR",
    )!;
    await user.click(button);
    await screen.findByText("تم تحديث موقعك وإعادة حساب المسار");
    await waitFor(() =>
      expect(screen.getByText("المسافة المتبقية: ≈ 30 متر")).toBeTruthy(),
    );
    expect(journey.location).toBe("door-lab");
  });
});

it("selects a current node, enters 3D, gets lost and corrects location automatically", async () => {
  sessionStorage.setItem("masarak.journey", "test-journey-token");
  window.history.replaceState({}, "", "/journey");
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("link", { name: i18n.t("navigate") }),
  );
  await screen.findByText(i18n.t("navWhere"));
  await user.selectOptions(
    screen.getByRole("combobox", { name: i18n.t("currentLocation") }),
    "f0-c4",
  );
  await screen.findByRole("group", { name: i18n.t("navMode") });
  expect(screen.queryByRole("img", { name: i18n.t("map") })).toBeNull();
  expect(window.location.pathname).toBe("/navigate");
  await user.click(screen.getAllByRole("link", { name: i18n.t("lost") })[0]);
  await screen.findByText(i18n.t("navLostSelect"));
  await user.selectOptions(
    screen.getByRole("combobox", { name: i18n.t("currentLocation") }),
    "f0-c0",
  );
  await screen.findByRole("group", { name: i18n.t("navMode") });
  expect(journey.location).toBe("f0-c0");
  expect(window.location.pathname).toBe("/navigate");
});

it("automatically processes destination QR arrival once and renders clinic queue", async () => {
  sessionStorage.setItem("masarak.journey", "test-token");
  journey.location = "door-triage";
  journey.confirmedCheckpointId = "QR-door-triage";
  journey.confirmedAt = "2026-10-09T01:00:00Z";
  window.history.replaceState({}, "", "/navigate");
  const original = vi.mocked(api).getMockImplementation()!;
  let arrived = false;
  vi.mocked(api).mockImplementation(async (path, token, body, method) => {
    if (path === "/arrival") {
      arrived = true;
      return { ticket: { id: "queue" } };
    }
    if (path === "/journey" && arrived)
      return {
        journey: { ...journey },
        ticket: { id: "queue", roomId: "triage", status: "waiting" },
        clinic: { status: "busy" },
        ahead: 3,
        waitMinutes: 12,
        notifications: [],
      };
    return original(path, token, body, method);
  });
  mount();
  await screen.findByText(i18n.t("navArrivalSuccess"));
  await waitFor(() => expect(window.location.pathname).toBe("/arrival"));
  expect(await screen.findByText(i18n.t("busy"))).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
  expect(
    vi.mocked(api).mock.calls.filter(([p]) => p === "/arrival"),
  ).toHaveLength(1);
  vi.mocked(api).mockImplementation(original);
});
