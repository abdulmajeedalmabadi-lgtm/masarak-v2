// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../src/i18n";
import { QrManager } from "../src/QrManager";
import { createHospital } from "../shared/hospital";
import { checkpointForNode } from "../shared/checkpoints";
import { api } from "../src/api";
import type { HospitalMap, Checkpoint } from "../shared/types";
let map: HospitalMap;
const bundle = (q: Checkpoint) => ({
  checkpoint: q,
  payload: `http://localhost:5173/?hospital=${q.hospitalId}&checkpoint=${q.id}`,
  image: "data:image/png;base64,aGVsbG8=",
  svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
});
vi.mock("../src/api", () => ({
  base: "",
  api: vi.fn(
    async (path: string, _token?: string, body?: any, method?: string) => {
      if (path === "/map") return structuredClone(map);
      if (path === "/admin/checkpoints" && body) {
        const q = checkpointForNode(
          map,
          map.nodes.find((n) => n.id === body.nodeId)!,
          body.id,
          body.names,
        );
        map.checkpoints.push(q);
        map.version++;
        return q;
      }
      if (path === "/admin/checkpoints/print/all")
        return { labels: map.checkpoints.map(bundle) };
      const fields = path.split("/"),
        id = decodeURIComponent(fields[3] ?? "");
      if (fields[4] === "qr")
        return bundle(map.checkpoints.find((q) => q.id === id)!);
      if (method === "DELETE") {
        map.checkpoints = map.checkpoints.filter((q) => q.id !== id);
        map.version++;
        return { ok: true };
      }
      if (method === "PUT") {
        const index = map.checkpoints.findIndex((q) => q.id === id);
        map.checkpoints[index] = checkpointForNode(
          map,
          map.nodes.find((n) => n.id === body.nodeId)!,
          id,
          body.names,
        );
        map.version++;
        return map.checkpoints[index];
      }
      return { ok: true };
    },
  ),
}));
beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  map = createHospital();
  await i18n.changeLanguage("ar");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function Harness() {
  const [state, setState] = useState(map);
  return (
    <QrManager
      map={state}
      token="admin-token"
      admin
      run={async (fn) => {
        await fn();
      }}
      busy={false}
      onChanged={async () => setState(await api("/map"))}
    />
  );
}
describe("QR administration UI", () => {
  it("creates a named checkpoint at a valid node through the connected API", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "إضافة نقطة QR" }));
    await user.clear(screen.getByRole("textbox", { name: "معرّف نقطة QR" }));
    await user.type(
      screen.getByRole("textbox", { name: "معرّف نقطة QR" }),
      "QR-UI-NEW",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "موقع نقطة QR" }),
      "door-lab",
    );
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() =>
      expect(
        map.checkpoints.some(
          (q) => q.id === "QR-UI-NEW" && q.nodeId === "door-lab",
        ),
      ).toBe(true),
    );
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([p, , b]) =>
            p === "/admin/checkpoints" && (b as any).nodeId === "door-lab",
        ),
    ).toBe(true);
  });
  it("previews a selected floor, generates downloads and confirms checkpoint deletion", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const target = Array.from(
      document.querySelectorAll(".checkpoint-list button"),
    ).find((b) =>
      b.textContent?.includes("QR-door-radiology"),
    ) as HTMLButtonElement;
    await user.click(target);
    const svg = screen.getByRole("img", { name: "الخريطة" });
    expect(
      svg.querySelector('[data-checkpoint-id="QR-door-radiology"]'),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "توليد الرمز" }));
    expect(
      await screen.findByRole("button", { name: "تنزيل PNG" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "تنزيل SVG" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "حذف نقطة QR" }));
    expect(
      screen.getByText(
        "سيتوقف هذا الرمز عن تحديد الموقع. لن تُحذف عقدة الخريطة أو الرحلات.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "تأكيد الحذف" }));
    await waitFor(() =>
      expect(map.checkpoints.some((q) => q.id === "QR-door-radiology")).toBe(
        false,
      ),
    );
    expect(map.nodes.some((n) => n.id === "door-radiology")).toBe(true);
  });
  it("opens a printable document containing every checkpoint and an A4 page layout", async () => {
    const write = vi.fn(),
      popup = {
        document: { open: vi.fn(), write, close: vi.fn() },
        close: vi.fn(),
      };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<Harness />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "طباعة جميع النقاط" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    const html = write.mock.calls[0][0];
    expect(html).toContain("@page{size:A4");
    expect((html.match(/<article>/g) ?? []).length).toBe(37);
    expect(html).toContain("QR-f1-c6");
  });
});
