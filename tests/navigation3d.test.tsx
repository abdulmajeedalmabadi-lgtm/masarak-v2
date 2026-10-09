import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { createHospital } from "../shared/hospital";
import { findRoute } from "../shared/navigation";
import { guidance } from "../shared/guidance";
import { NavigationTrackingService } from "../src/services/NavigationTrackingService";
import { Navigation3D } from "../src/Navigation3D";
import i18n from "../src/i18n";
import type { Journey } from "../shared/types";
// @vitest-environment jsdom
const map = createHospital(),
  room = map.rooms.find((r) => r.id === "triage")!;
const journey: Journey = {
  id: "navigation-test",
  alias: "Test",
  tokenVersion: 1,
  expiresAt: "2099-01-01",
  createdAt: "2026-01-01",
  location: "f0-c4",
  accessible: false,
  stages: [{ id: "s", roomId: room.id, status: "active" }],
};
const route = findRoute(map, journey.location, room.nodeId, false)!;
function mount(j = journey, r = route) {
  return render(
    <BrowserRouter>
      <Navigation3D
        map={map}
        journey={j}
        destination={room}
        route={r}
        dark={false}
        voice={false}
        onSpeak={() => {}}
      />
    </BrowserRouter>,
  );
}
beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await i18n.changeLanguage("ar");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("renders QR guidance and fallback without a 2D map", () => {
  mount();
  expect(screen.queryByRole("img", { name: "الخريطة" })).toBeNull();
  expect(
    screen.getByText(
      i18n.t("navForward", {
        distance: new NavigationTrackingService(
          route.nodes[0],
          map,
          route.nodes,
        ).step.distance,
      }),
    ),
  ).toBeTruthy();
  expect(screen.getByText(/العرض ثلاثي الأبعاد غير متاح/)).toBeTruthy();
});
it("demo controls traverse computed turns and finish without confirming patient arrival", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "وضع المحاكاة" }));
  const types = guidance(map, route.nodes);
  for (let i = 1; i < types.length; i++)
    fireEvent.click(screen.getByRole("button", { name: "التعليمة التالية" }));
  expect(screen.getAllByText("اكتملت محاكاة الرحلة").length).toBe(2);
  expect(screen.queryByText("وصلت إلى وجهتك بنجاح")).toBeNull();
  expect(journey.location).toBe("f0-c4");
  fireEvent.click(screen.getByRole("button", { name: "التعليمة السابقة" }));
  fireEvent.click(screen.getByRole("button", { name: "إعادة المحاكاة" }));
  expect(screen.getByText("تابع للأمام لمسافة تقريبية 30 متر")).toBeTruthy();
});
it("simulation advances and pause freezes progress", () => {
  vi.useFakeTimers();
  mount();
  fireEvent.click(screen.getByRole("button", { name: "وضع المحاكاة" }));
  const before = screen.getByRole("progressbar").getAttribute("value");
  act(() => vi.advanceTimersByTime(1000));
  expect(
    Number(screen.getByRole("progressbar").getAttribute("value")),
  ).toBeGreaterThan(Number(before));
  fireEvent.click(screen.getByRole("button", { name: "إيقاف مؤقت" }));
  expect(screen.getByRole("button", { name: "استئناف" })).toBeTruthy();
  const paused = screen.getByRole("progressbar").getAttribute("value");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe(paused);
});
it("requires a destination checkpoint for the real arrival interface", () => {
  const j = { ...journey, location: room.nodeId };
  const r = findRoute(map, room.nodeId, room.nodeId, false)!;
  const view = mount(j, r);
  expect(screen.getByText(i18n.t("trackingEstimatedArrival"))).toBeTruthy();
  view.unmount();
  mount({ ...j, confirmedCheckpointId: "QR-door-triage" }, r);
  expect(screen.getByText(i18n.t("trackingArrivalProcessing"))).toBeTruthy();
  expect(screen.queryByText(i18n.t("navArrivalSuccess"))).toBeNull();
});
it("changes navigation language immediately", async () => {
  mount();
  await i18n.changeLanguage("en");
  expect(
    await screen.findByText(
      i18n.t("navForward", {
        distance: new NavigationTrackingService(
          route.nodes[0],
          map,
          route.nodes,
        ).step.distance,
      }),
    ),
  ).toBeTruthy();
});
it("moves from sensor samples, retains estimates across map refreshes, and isolates demo mode", async () => {
  const motionProperty = Object.getOwnPropertyDescriptor(
    window,
    "DeviceMotionEvent",
  );
  const secureProperty = Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext",
  );
  Object.defineProperty(window, "DeviceMotionEvent", {
    configurable: true,
    value: { requestPermission: async () => "granted" },
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  const view = mount();
  try {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("trackingEnable") }),
      );
    });
    const samples = (offset: number) => {
      for (let time = 0; time < 1800; time += 20) {
        const e = new Event("devicemotion");
        Object.defineProperty(e, "timeStamp", { value: offset + time });
        Object.assign(e, {
          accelerationIncludingGravity: {
            x: 0,
            y: 0,
            z: 9.81 + Math.sin((time / 600) * Math.PI * 2) * 2.8,
          },
        });
        window.dispatchEvent(e);
      }
    };
    act(() => samples(100));
    const counter = () =>
      screen.getByText(new RegExp(i18n.t("trackingSteps"))).textContent;
    const measured = counter();
    expect(measured).toContain("3");
    view.rerender(
      <BrowserRouter>
        <Navigation3D
          map={JSON.parse(JSON.stringify(map))}
          journey={{ ...journey }}
          destination={room}
          route={route}
          dark={false}
          voice={false}
          onSpeak={() => {}}
        />
      </BrowserRouter>,
    );
    expect(counter()).toBe(measured);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("navDemo") }));
    act(() => samples(3000));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("navQrMode") }));
    expect(counter()).toBe(measured);
    expect(journey.location).toBe("f0-c4");
  } finally {
    view.unmount();
    if (motionProperty)
      Object.defineProperty(window, "DeviceMotionEvent", motionProperty);
    else Reflect.deleteProperty(window, "DeviceMotionEvent");
    if (secureProperty)
      Object.defineProperty(window, "isSecureContext", secureProperty);
    else Reflect.deleteProperty(window, "isSecureContext");
  }
});
