import { useEffect, useRef, useState } from "react";
import {
  Link,
  Routes,
  Route,
  useNavigate,
  useLocation,
  Navigate,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { io, Socket } from "socket.io-client";
import type { Html5Qrcode } from "html5-qrcode";
import {
  Navigation,
  Map as MapIcon,
  QrCode,
  Settings,
  ArrowLeft,
  ArrowRight,
  Check,
  Sun,
  Moon,
  LifeBuoy,
  Bell,
  History,
  Volume2,
  LocateFixed,
  LogOut,
  Plus,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import { api, base } from "./api";
import { languages } from "./i18n";
import { HospitalMapView } from "./Map";
import { findRoute } from "../shared/navigation";
import {
  parseCheckpointPayload,
  checkpointForNode,
} from "../shared/checkpoints";
import { Navigation3D } from "./Navigation3D";
import { QrManager } from "./QrManager";
import type {
  HospitalMap,
  Journey,
  Ticket,
  Notice,
  Room,
} from "../shared/types";
type Patient = {
  journey: Journey;
  ticket: Ticket | null;
  ahead: number;
  waitMinutes: number;
  clinic?: { status: string };
  notifications: Notice[];
};
type Preferences = {
  theme: string;
  large: boolean;
  contrast: boolean;
  voice: boolean;
  accessible: boolean;
  sound: boolean;
};
const readPrefs = (): Preferences => {
  try {
    return {
      theme: "light",
      large: false,
      contrast: false,
      voice: false,
      accessible: false,
      sound: false,
      ...JSON.parse(localStorage.getItem("masarak.preferences") ?? "{}"),
    };
  } catch {
    return {
      theme: "light",
      large: false,
      contrast: false,
      voice: false,
      accessible: false,
      sound: false,
    };
  }
};
export function App() {
  const { t, i18n } = useTranslation(),
    nav = useNavigate(),
    loc = useLocation();
  const [prefs, setPrefs] = useState(readPrefs),
    [token, setToken] = useState(
      () => sessionStorage.getItem("masarak.journey") ?? "",
    ),
    [staffToken, setStaffToken] = useState(
      () => sessionStorage.getItem("masarak.staff") ?? "",
    );
  const [map, setMap] = useState<HospitalMap | null>(null),
    [patient, setPatient] = useState<Patient | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false);
  const [arrivalRoom, setArrivalRoom] = useState<Room | null>(null);
  const arrivalRequests = useRef(new Set<string>());
  const seen = useRef(new Set<string>()),
    soundContext = useRef<AudioContext | null>(null),
    socket = useRef<Socket | null>(null);
  const roomName = (r?: Room) =>
    r ? (r.names[i18n.language] ?? r.names.ar) : "";
  const active = patient?.journey.stages.find((s) => s.status === "active"),
    destination = map?.rooms.find((r) => r.id === active?.roomId);
  const currentNode = map?.nodes.find(
    (n) => n.id === patient?.journey.location,
  );
  const confirmedPoint = map?.checkpoints.find(
    (q) => q.id === patient?.journey.confirmedCheckpointId,
  );
  const currentLabel =
    confirmedPoint?.names[i18n.language] ??
    (map && currentNode
      ? checkpointForNode(map, currentNode, "QR-preview").names[i18n.language]
      : "");
  const route =
    map && patient && destination
      ? findRoute(
          map,
          patient.journey.location,
          destination.nodeId,
          patient.journey.accessible,
        )
      : null;
  const refresh = async () => {
    const [m, p] = await Promise.all([
      api<HospitalMap>("/map"),
      token ? api<Patient>("/journey", token) : Promise.resolve(null),
    ]);
    setMap(m);
    if (p) setPatient(p);
  };
  useEffect(() => {
    if (
      !patient ||
      !destination ||
      !active ||
      loc.pathname !== "/navigate" ||
      patient.journey.location !== destination.nodeId ||
      !map?.checkpoints.some(
        (q) =>
          q.id === patient.journey.confirmedCheckpointId &&
          q.nodeId === destination.nodeId,
      )
    )
      return;
    const key = `${patient.journey.id}|${active.id}|${patient.journey.confirmedAt}`;
    if (arrivalRequests.current.has(key)) return;
    arrivalRequests.current.add(key);
    void run(async () => {
      try {
        await api("/arrival", token, { stageId: active.id });
        setArrivalRoom(destination);
        await refresh();
        nav("/arrival", { replace: true });
      } catch (e) {
        arrivalRequests.current.delete(key);
        throw e;
      }
    });
  }, [patient, destination, loc.pathname]);
  useEffect(() => {
    if (patient)
      setPrefs((p) => ({ ...p, accessible: patient.journey.accessible }));
  }, [patient?.journey.accessible]);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (success) setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    document.documentElement.lang =
      i18n.language === "ar" ? "ar-SA" : i18n.language;
    document.documentElement.dir = ["ar", "ur"].includes(i18n.language)
      ? "rtl"
      : "ltr";
    localStorage.setItem("masarak.language", i18n.language);
  }, [i18n.language]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.classList.toggle("large", prefs.large);
    document.documentElement.classList.toggle("contrast", prefs.contrast);
    localStorage.setItem("masarak.preferences", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const journey = q.get("journey"),
      checkpoint = q.get("checkpoint");
    if (journey) {
      void run(async () => {
        await api("/journey", journey);
        const pending = sessionStorage.getItem("masarak.pending-checkpoint");
        if (pending) {
          await api("/location", journey, { checkpoint: pending });
          sessionStorage.removeItem("masarak.pending-checkpoint");
          setMessage("locationUpdated");
        }
        setToken(journey);
        sessionStorage.setItem("masarak.journey", journey);
        nav(pending ? "/navigate" : "/journey", { replace: true });
      });
    } else if (checkpoint && token)
      void run(async () => {
        await api("/location", token, {
          checkpoint,
          hospitalId: q.get("hospital") ?? undefined,
        });
        await refresh();
        nav("/navigate", { replace: true });
      });
    else if (checkpoint) {
      sessionStorage.setItem(
        "masarak.pending-checkpoint",
        window.location.href,
      );
      setMessage("needJourneyForQr");
      nav("/scan", { replace: true });
    }
  }, [loc.search, token]);
  useEffect(() => {
    void run(refresh);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const s = io(base || undefined, { auth: { token } });
    socket.current = s;
    s.on("connect", () => {
      setConnected(true);
      void run(refresh);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));
    s.on("update", () => void run(refresh));
    const fallback = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      15000,
    );
    return () => {
      s.disconnect();
      clearInterval(fallback);
    };
  }, [token]);
  useEffect(() => {
    if (!patient) return;
    for (const n of patient.notifications) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.key === "yourTurn" && patient.ticket?.status === "called") {
        if ("Notification" in window && Notification.permission === "granted")
          new Notification(t("yourTurn"), {
            body: roomName(map?.rooms.find((r) => r.id === n.roomId)),
            tag: n.id,
          });
        if (prefs.sound) {
          navigator.vibrate?.([200, 100, 200]);
          const ctx = soundContext.current;
          if (ctx && ctx.state === "running") {
            const osc = ctx.createOscillator(),
              gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = 0.08;
            osc.frequency.value = 660;
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
          }
        }
      }
    }
  }, [patient, prefs.sound, i18n.language]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const preferences = (
    <PreferencesView
      prefs={prefs}
      onChange={(p) => {
        setPrefs(p);
        if (p.accessible !== prefs.accessible && token)
          void run(async () => {
            await api("/accessibility", token, { accessible: p.accessible });
            await refresh();
          });
        if (p.sound && !prefs.sound) {
          soundContext.current = new AudioContext();
          void soundContext.current.resume();
        }
      }}
    />
  );
  const locate = async (nodeId: string) => {
    if (
      !map ||
      !patient ||
      !destination ||
      !findRoute(map, nodeId, destination.nodeId, patient.journey.accessible)
    )
      throw Error("noRoute");
    await api("/location", token, { nodeId });
    await refresh();
    setMessage("navLocationSelected");
    nav("/navigate");
  };
  const checkpoint = async (q: string) => {
    await api("/location", token, { checkpoint: q });
    await refresh();
    setMessage("locationUpdated");
    nav("/navigate");
  };
  const enableNotifications = async () => {
    if (
      !("Notification" in window) ||
      (await Notification.requestPermission()) !== "granted"
    )
      throw Error("notificationDenied");
    const { publicKey } = await api("/push/key");
    if (
      publicKey &&
      token &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    ) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw Error("notificationDenied");
      const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      await api("/push/subscribe", token, {
        ...subscription.toJSON(),
        language: i18n.language,
      });
    }
  };
  const openCode = async (value: string) => {
    let parsed: URL | undefined;
    try {
      parsed = new URL(value);
    } catch {}
    const journey = parsed?.searchParams.get("journey");
    const decoded = parseCheckpointPayload(value);
    if (decoded) {
      if (!token) {
        sessionStorage.setItem("masarak.pending-checkpoint", value);
        setMessage("needJourneyForQr");
        nav("/scan");
        return;
      }
      await checkpoint(value);
      return;
    }
    if (
      journey ||
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    ) {
      const next = journey ?? value;
      await api("/journey", next);
      const pending = sessionStorage.getItem("masarak.pending-checkpoint");
      if (pending) {
        await api("/location", next, { checkpoint: pending });
        sessionStorage.removeItem("masarak.pending-checkpoint");
        setMessage("locationUpdated");
      }
      sessionStorage.setItem("masarak.journey", next);
      setToken(next);
      nav(pending ? "/navigate" : "/journey");
    } else {
      throw Error("invalidCheckpoint");
    }
  };
  const patientGuard = (content: React.ReactNode) =>
    !token ? (
      <StartScreen openCode={(v) => run(() => openCode(v))} busy={busy} />
    ) : !patient ? (
      <div className="card">
        <p>{t(error ? "unauthorized" : "loading")}</p>
        <button onClick={() => void run(refresh)}>{t("retry")}</button>
        <Link to="/scan">{t("enterCode")}</Link>
      </div>
    ) : (
      content
    );
  const journeyView =
    patient && map ? (
      <>
        <div className="page-heading">
          <span className="eyebrow">MASARAK / {t("journey")}</span>
          <h1>{t("journey")}</h1>
          <p>{patient.journey.alias}</p>
        </div>
        <div className="journey-list">
          {patient.journey.stages.map((s) => {
            const r = map.rooms.find((r) => r.id === s.roomId);
            return (
              <div className={`stage ${s.status}`} key={s.id}>
                <span className="stage-dot">
                  {["complete", "skipped"].includes(s.status) ? (
                    <Check size={14} />
                  ) : s.status === "active" ? (
                    <Stethoscope size={18} />
                  ) : null}
                </span>
                <div>
                  <strong>{roomName(r)}</strong>
                  <small>
                    {t(s.status)} · {t("room")} {r?.number}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
        {destination ? (
          <>
            <DestinationCard
              room={destination}
              name={roomName(destination)}
              distance={route?.distance}
              seconds={route?.seconds}
            />
            <Link className="button primary" to="/location">
              <Navigation size={19} />
              {t("navigate")}
            </Link>
          </>
        ) : (
          <div className="card success">
            <Check />
            {t("done")}
          </div>
        )}
        <Link className="button secondary" to="/lost">
          <LifeBuoy size={19} />
          {t("lost")}
        </Link>
      </>
    ) : null;
  const locationView =
    patient && map ? (
      <section className="location-selection">
        <h1>{t("navSelectLocation")}</h1>
        <p>{t(loc.pathname === "/lost" ? "navLostSelect" : "navSelectHint")}</p>
        <h2>{t("navWhere")}</h2>
        <p className="hint">
          {t("currentLocation")}: {currentLabel}
        </p>
        <small>
          {roomName(destination)} · {t("room")} {destination?.number}
        </small>
        <HospitalMapView
          map={map}
          location={patient.journey.location}
          destination={destination?.id}
          path={[]}
          showCheckpoints
          onLocate={(nodeId) => {
            if (!busy) void run(() => locate(nodeId));
          }}
        />
        <select
          aria-label={t("currentLocation")}
          value=""
          disabled={busy}
          onChange={(e) => void run(() => locate(e.target.value))}
        >
          <option value="" disabled>
            {t("currentLocation")}
          </option>
          {map.nodes
            .filter((n) => !patient.journey.accessible || n.accessible)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {checkpointForNode(map, n, "preview").names[i18n.language]}
              </option>
            ))}
        </select>
        {busy && <p role="status">{t("navPreparing")}</p>}
        <div className="location-tools">
          <Link to="/scan" className="button primary">
            <QrCode />
            {t("scan")}
          </Link>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(() => api("/assistance", token, {}), "assistanceSent")
            }
          >
            <Users />
            {t("requestHelp")}
          </button>
        </div>
      </section>
    ) : null;
  const mapView = locationView;
  return (
    <div
      className={
        loc.pathname.startsWith("/staff")
          ? "app staff-app"
          : loc.pathname === "/navigate"
            ? "app navigation-app"
            : "app"
      }
    >
      <header className="header">
        <Link to={token ? "/journey" : "/"} className="wordmark">
          <span className="logo">
            <Plus size={22} />
          </span>
          <span>
            {t("brand")}
            <small>MASARAK</small>
          </span>
        </Link>
        <div className="header-actions">
          <button
            aria-label={t(prefs.theme === "light" ? "dark" : "light")}
            onClick={() =>
              setPrefs({
                ...prefs,
                theme: prefs.theme === "light" ? "dark" : "light",
              })
            }
          >
            {prefs.theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <Link aria-label={t("settings")} to="/settings">
            <Settings size={20} />
          </Link>
        </div>
      </header>
      {error && (
        <div className="alert" role="alert">
          {t(error.split(":")[0])}
          <button aria-label={t("cancel")} onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>
            {t(message)}
            {message === "navLocationSelected" && <small>{currentLabel}</small>}
          </span>
        </div>
      )}
      {token && (
        <div
          className={`connection ${connected ? "connected" : ""}`}
          role="status"
        >
          <i />
          {t(connected ? "online" : "offline")}
        </div>
      )}
      <main aria-busy={busy}>
        <Routes>
          <Route
            path="/"
            element={
              <div className="splash">
                <div className="splash-pattern" />
                <div className="hero-logo">
                  <Plus size={58} />
                </div>
                <h1>{t("brand")}</h1>
                <p>{t("tagline")}</p>
                <Link className="button primary" to="/onboarding">
                  {t("start")}
                  <ArrowLeft size={18} />
                </Link>
                <Link className="quiet" to="/staff">
                  {t("staff")}
                </Link>
              </div>
            }
          />
          <Route
            path="/onboarding"
            element={
              <>
                <div className="page-heading">
                  <h1>{t("welcome")}</h1>
                  <p>{t("tagline")}</p>
                </div>
                {preferences}
                <Link className="button primary" to="/scan">
                  {t("continue")}
                </Link>
              </>
            }
          />
          <Route
            path="/scan"
            element={
              <>
                <Scanner
                  onCode={(value) => run(() => openCode(value))}
                  busy={busy}
                />
                {token && map && (
                  <section className="card">
                    <h3>{t("demoQR")}</h3>
                    <p className="hint">{t("demoHint")}</p>
                    <select
                      id="checkpoint-test"
                      aria-label={t("checkpoint")}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {t("checkpoint")}
                      </option>
                      {map.checkpoints.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.names[i18n.language] ?? q.locationName} ·{" "}
                          {t("floor")} {q.floor}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const q = (
                          document.getElementById(
                            "checkpoint-test",
                          ) as HTMLSelectElement
                        ).value;
                        if (q) void run(() => checkpoint(q));
                      }}
                      disabled={busy}
                    >
                      {t("scan")}
                    </button>
                  </section>
                )}
              </>
            }
          />
          <Route path="/journey" element={patientGuard(journeyView)} />
          <Route path="/map" element={patientGuard(mapView)} />
          <Route
            path="/navigate"
            element={patientGuard(
              patient && map ? (
                <Navigation3D
                  map={map}
                  journey={patient.journey}
                  dark={prefs.theme === "dark"}
                  destination={destination}
                  route={route}
                  voice={prefs.voice}
                  onSpeak={(text) => {
                    if (!("speechSynthesis" in window)) return;
                    const u = new SpeechSynthesisUtterance(text);
                    u.lang = i18n.language === "ar" ? "ar-SA" : i18n.language;
                    speechSynthesis.cancel();
                    speechSynthesis.speak(u);
                  }}
                />
              ) : null,
            )}
          />
          <Route path="/lost" element={patientGuard(locationView)} />
          <Route path="/location" element={patientGuard(locationView)} />
          <Route
            path="/updated"
            element={<Navigate to="/navigate" replace />}
          />
          <Route
            path="/arrival"
            element={patientGuard(
              <>
                {arrivalRoom || patient?.ticket ? (
                  <>
                    <div className="arrival-mark">
                      <Check size={60} />
                    </div>
                    <h1>{t("navArrivalSuccess")}</h1>
                    <DestinationCard
                      room={arrivalRoom ?? destination}
                      name={roomName(arrivalRoom ?? destination)}
                    />
                    <p>
                      {t("floor")} {(arrivalRoom ?? destination)?.floor}
                    </p>
                    {patient?.ticket &&
                      patient.ticket.roomId ===
                        (arrivalRoom ?? destination)?.id && (
                        <div className="card" aria-live="polite">
                          <p
                            className={`status ${patient.clinic?.status ?? "waiting"}`}
                          >
                            {t(patient.clinic?.status ?? "waiting")}
                          </p>
                          <p>
                            {t("patientsAhead")}:{" "}
                            <strong>{patient.ahead}</strong>
                          </p>
                          <p>
                            {t("estimatedWait")}:{" "}
                            <strong>
                              {patient.waitMinutes} {t("minutes")}
                            </strong>
                          </p>
                          <p>{t(patient.ticket.status)}</p>
                          {patient.ticket.status === "called" && (
                            <Link className="button primary" to="/turn">
                              {t("yourTurn")}
                            </Link>
                          )}
                        </div>
                      )}
                  </>
                ) : (
                  <>
                    <h1>{t("navScanArrival")}</h1>
                    <Link className="button primary" to="/scan">
                      {t("scan")}
                    </Link>
                  </>
                )}
                <Link className="button secondary" to="/journey">
                  {t("journey")}
                </Link>
              </>,
            )}
          />
          <Route
            path="/waiting"
            element={patientGuard(
              patient ? (
                <>
                  <h1>{t("wait")}</h1>
                  <DestinationCard
                    room={destination}
                    name={roomName(destination)}
                  />
                  <div className="card">
                    <span
                      className={`status ${patient.clinic?.status ?? "waiting"}`}
                    >
                      {t(patient.clinic?.status ?? "waiting")}
                    </span>
                    <div className="stat-row">
                      <Users />
                      <div>
                        {t("patientsAhead")}
                        <strong>{patient.ahead}</strong>
                      </div>
                    </div>
                    <div className="stat-row">
                      <History />
                      <div>
                        {t("estimatedWait")}
                        <strong>
                          {patient.waitMinutes} {t("minutes")}
                        </strong>
                      </div>
                    </div>
                    {patient.ticket && <p>{t(patient.ticket.status)}</p>}
                  </div>
                  <p className="hint">{t("priorityHint")}</p>
                  {patient.ticket?.status === "called" && (
                    <Link to="/turn" className="button primary">
                      {t("yourTurn")}
                    </Link>
                  )}
                  <Link to="/journey" className="button secondary">
                    {t("journey")}
                  </Link>
                </>
              ) : null,
            )}
          />
          <Route
            path="/turn"
            element={patientGuard(
              patient?.ticket?.status === "called" ? (
                <TurnScreen
                  ticket={patient.ticket}
                  destination={destination}
                  onExtra={() =>
                    void run(
                      () => api("/extra-time", token, {}),
                      "extraRequested",
                    )
                  }
                />
              ) : (
                <div className="card">
                  <p>{t(patient?.ticket?.status ?? "waiting")}</p>
                  <Link to="/waiting">{t("wait")}</Link>
                </div>
              ),
            )}
          />
          <Route path="/next" element={patientGuard(journeyView)} />
          <Route
            path="/notifications"
            element={patientGuard(
              <>
                <h1>{t("notifications")}</h1>
                {patient?.notifications.length ? (
                  patient.notifications
                    .slice()
                    .reverse()
                    .map((n) => (
                      <div className="card notice" key={n.id}>
                        <Bell size={20} />
                        <div>
                          <strong>{t(n.key)}</strong>
                          <small>
                            {roomName(
                              map?.rooms.find((r) => r.id === n.roomId),
                            )}
                          </small>
                          <time>
                            {new Date(n.createdAt).toLocaleString(
                              i18n.language,
                            )}
                          </time>
                        </div>
                      </div>
                    ))
                ) : (
                  <p>{t("empty")}</p>
                )}
              </>,
            )}
          />
          <Route
            path="/history"
            element={patientGuard(
              <>
                <h1>{t("history")}</h1>
                {patient?.journey.stages.map((s) => (
                  <div className="card" key={s.id}>
                    <strong>
                      {roomName(map?.rooms.find((r) => r.id === s.roomId))}
                    </strong>
                    <small>{t(s.status)}</small>
                    {s.startedAt && (
                      <time>
                        {new Date(s.startedAt).toLocaleString(i18n.language)}
                      </time>
                    )}
                    {s.completedAt && (
                      <time>
                        {" "}
                        →{" "}
                        {new Date(s.completedAt).toLocaleString(i18n.language)}
                      </time>
                    )}
                  </div>
                ))}
              </>,
            )}
          />
          <Route
            path="/settings"
            element={
              <>
                <h1>{t("settings")}</h1>
                {preferences}
                <button
                  className="button secondary"
                  onClick={() => void run(enableNotifications, "saved")}
                >
                  <Bell />
                  {t("enableNotifications")}
                </button>
                <Link className="button secondary" to="/help">
                  <LifeBuoy />
                  {t("help")}
                </Link>
                <Link className="button secondary" to="/history">
                  <History />
                  {t("history")}
                </Link>
                <Link className="quiet" to="/staff">
                  {t("staff")}
                </Link>
              </>
            }
          />
          <Route
            path="/help"
            element={
              <>
                <h1>{t("help")}</h1>
                <div className="card">
                  <p>{t("helpText")}</p>
                </div>
                {preferences}
                {token && (
                  <Link to="/lost" className="button primary">
                    {t("lost")}
                  </Link>
                )}
              </>
            }
          />
          <Route
            path="/staff/*"
            element={
              <StaffDashboard
                map={map}
                token={staffToken}
                setToken={(value) => {
                  setStaffToken(value);
                  if (value) sessionStorage.setItem("masarak.staff", value);
                  else sessionStorage.removeItem("masarak.staff");
                }}
                run={run}
                busy={busy}
                onMapChange={async () => setMap(await api<HospitalMap>("/map"))}
              />
            }
          />
          <Route
            path="*"
            element={
              <>
                <h1>{t("notFound")}</h1>
                <Link to="/">{t("back")}</Link>
              </>
            }
          />
        </Routes>
      </main>
      {patient?.ticket?.status === "called" &&
        loc.pathname !== "/turn" &&
        !loc.pathname.startsWith("/staff") && (
          <Link className="turn-banner" to="/turn">
            <Bell size={20} />
            {t("yourTurn")}
            <ArrowLeft size={18} />
          </Link>
        )}
      {!loc.pathname.startsWith("/staff") && loc.pathname !== "/" && (
        <nav className="bottom-nav" aria-label={t("journey")}>
          <Link
            className={loc.pathname === "/journey" ? "current" : ""}
            to="/journey"
          >
            <Navigation size={21} />
            {t("journey")}
          </Link>
          <Link className={loc.pathname === "/map" ? "current" : ""} to="/map">
            <MapIcon size={21} />
            {t("map")}
          </Link>
          <Link
            className={loc.pathname === "/lost" ? "current" : ""}
            to="/lost"
          >
            <LifeBuoy size={21} />
            {t("lost")}
          </Link>
          <Link
            className={loc.pathname === "/notifications" ? "current" : ""}
            to="/notifications"
          >
            <Bell size={21} />
            {t("notifications")}
          </Link>
        </nav>
      )}
    </div>
  );
}
function PreferencesView({
  prefs,
  onChange,
}: {
  prefs: Preferences;
  onChange: (p: Preferences) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <section className="card">
        <h3>{t("language")}</h3>
        <div className="language-grid">
          {languages.map(([code, label]) => (
            <button
              aria-pressed={i18n.language === code}
              className={i18n.language === code ? "selected" : ""}
              key={code}
              onClick={() => void i18n.changeLanguage(code)}
            >
              <span>{label}</span>
              {i18n.language === code && <Check size={17} />}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>{t("accessibility")}</h3>
        {(["accessible", "large", "contrast", "voice", "sound"] as const).map(
          (key) => (
            <label className="toggle-row" key={key}>
              <span>
                {t(
                  {
                    accessible: "wheelchair",
                    large: "largeText",
                    contrast: "contrast",
                    voice: "voice",
                    sound: "sound",
                  }[key],
                )}
              </span>
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(e) =>
                  onChange({ ...prefs, [key]: e.target.checked })
                }
              />
            </label>
          ),
        )}
      </section>
    </>
  );
}
function StartScreen({
  openCode,
  busy,
}: {
  openCode: (value: string) => unknown;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="start-art">
        <QrCode size={80} />
        <span>MASARAK</span>
      </div>
      <h1>{t("start")}</h1>
      <p className="lead">{t("scanHint")}</p>
      <Link to="/scan" className="button primary">
        <QrCode />
        {t("scan")}
      </Link>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          openCode(String(data.get("code")));
        }}
      >
        <label>
          {t("enterCode")}
          <input name="code" required placeholder={t("code")} />
        </label>
        <button className="button secondary" disabled={busy}>
          {t("open")}
        </button>
      </form>
      <Link className="quiet" to="/staff">
        {t("staff")}
      </Link>
    </>
  );
}
function Scanner({
  onCode,
  busy,
}: {
  onCode: (value: string) => unknown;
  busy: boolean;
}) {
  const { t } = useTranslation(),
    scanner = useRef<Html5Qrcode | null>(null),
    [running, setRunning] = useState(false),
    [cameraError, setCameraError] = useState(false),
    processing = useRef(false);
  const stop = async () => {
    if (scanner.current?.isScanning) await scanner.current.stop();
    setRunning(false);
  };
  useEffect(
    () => () => {
      if (scanner.current?.isScanning)
        void scanner.current.stop().catch(() => {});
    },
    [],
  );
  const start = async () => {
    setCameraError(false);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      scanner.current ??= new Html5Qrcode("scanner");
      await scanner.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (value) => {
          if (processing.current) return;
          processing.current = true;
          void stop()
            .then(() => onCode(value))
            .finally(() => {
              processing.current = false;
            });
        },
        () => {},
      );
      setRunning(true);
    } catch {
      setCameraError(true);
    }
  };
  return (
    <>
      <h1>{t("scan")}</h1>
      <p>{t("scanHint")}</p>
      <div className="scanner-wrap">
        <div id="scanner" />
        {!running && <QrCode className="scanner-placeholder" size={100} />}
      </div>
      {cameraError && <p className="alert">{t("cameraError")}</p>}
      <button
        className="button primary"
        disabled={busy}
        onClick={() => void (running ? stop() : start())}
      >
        {t(running ? "stopCamera" : "camera")}
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCode(String(new FormData(e.currentTarget).get("code")));
        }}
      >
        <label>
          {t("enterCode")}
          <textarea name="code" required rows={2} placeholder={t("code")} />
        </label>
        <button className="button secondary" disabled={busy}>
          {t("open")}
        </button>
      </form>
    </>
  );
}
function DestinationCard({
  room,
  name,
  distance,
  seconds,
}: {
  room?: Room;
  name: string;
  distance?: number;
  seconds?: number;
}) {
  const { t } = useTranslation();
  if (!room) return null;
  return (
    <section className="card destination-card">
      <div className="department-icon">
        <Stethoscope size={27} />
      </div>
      <div>
        <h3>{name}</h3>
        <p>
          {t("room")} {room.number}
        </p>
        {distance !== undefined && (
          <small>
            {distance} {t("meters")} ·{" "}
            {Math.max(1, Math.ceil((seconds ?? 0) / 60))} {t("minutes")}
          </small>
        )}
        <small>{t(room.floor === 0 ? "ground" : "first")}</small>
      </div>
    </section>
  );
}
function TurnScreen({
  ticket,
  destination,
  onExtra,
}: {
  ticket: Ticket;
  destination?: Room;
  onExtra: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(
    0,
    Math.ceil((Date.parse(ticket.deadline ?? "") - time) / 1000),
  );
  return (
    <section className="turn-screen">
      <div className="bell-circle">
        <Bell size={52} />
      </div>
      <h1>{t("yourTurn")}</h1>
      <p>
        {destination?.names[i18n.language] ?? destination?.names.ar} ·{" "}
        {t("room")} {destination?.number}
      </p>
      <div className="countdown">
        <small>{t("timeLeft")}</small>
        <strong dir="ltr">
          {String(Math.floor(left / 60)).padStart(2, "0")}:
          {String(left % 60).padStart(2, "0")}
        </strong>
      </div>
      {left === 0 && <p>{t("timeExpired")}</p>}
      <Link to="/location" className="button turn-white">
        <Navigation />
        {t("navigate")}
      </Link>
      <button
        className="button turn-outline"
        onClick={onExtra}
        disabled={ticket.extraTime}
      >
        {t(ticket.extraTime ? "extraRequested" : "extraTime")}
      </button>
    </section>
  );
}
type Run = (fn: () => Promise<unknown>, success?: string) => Promise<void>;
function StaffDashboard({
  map,
  token,
  setToken,
  run,
  busy,
  onMapChange,
}: {
  map: HospitalMap | null;
  token: string;
  setToken: (t: string) => void;
  run: Run;
  busy: boolean;
  onMapChange: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<any>(null),
    [tab, setTab] = useState("journeys"),
    [qr, setQr] = useState(""),
    [link, setLink] = useState(""),
    [selectedRooms, setSelectedRooms] = useState<string[]>([
      "triage",
      "doctor",
      "lab",
      "pharmacy",
    ]),
    [clinic, setClinic] = useState("triage"),
    [editor, setEditor] = useState(""),
    [replaceId, setReplaceId] = useState("");
  const name = (id: string) => {
    const r = map?.rooms.find((r) => r.id === id);
    return r?.names[i18n.language] ?? r?.names.ar ?? id;
  };
  const load = async () => {
    const d = await api("/staff", token);
    setData(d);
    if (d.user.role === "CLINIC") setClinic(d.user.roomId);
  };
  useEffect(() => {
    if (!token) {
      setData(null);
      return;
    }
    void run(load);
    const s = io(base || undefined, { auth: { token } });
    s.on("update", () => void run(load));
    const timer = setInterval(() => void load().catch(() => {}), 15000);
    return () => {
      s.disconnect();
      clearInterval(timer);
    };
  }, [token]);
  useEffect(() => {
    if (map) setEditor(JSON.stringify(map, null, 2));
  }, [map]);
  const act = (path: string, body: unknown, method?: string) =>
    run(async () => {
      await api(path, token, body, method);
      await load();
    }, "saved");
  const generate = async (value: string) => {
    const q = await api("/qr?value=" + encodeURIComponent(value), token);
    setQr(q.image);
  };
  if (!token)
    return (
      <div className="login-card card">
        <div className="department-icon">
          <ShieldCheck />
        </div>
        <h1>{t("staff")}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const b = Object.fromEntries(new FormData(e.currentTarget));
            void run(async () => {
              const r = await api("/login", undefined, b);
              setToken(r.token);
            });
          }}
        >
          <label>
            {t("username")}
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            {t("password")}
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy} className="button primary">
            {t("login")}
          </button>
        </form>
        <p className="hint">admin.demo · reception.demo · triage.demo</p>
        <Link to="/">{t("back")}</Link>
      </div>
    );
  if (!data || !map)
    return (
      <div className="card">
        <p>{t("loading")}</p>
        <button onClick={() => setToken("")}>{t("logout")}</button>
      </div>
    );
  const isAdmin = data.user.role === "ADMIN",
    reception = isAdmin || data.user.role === "RECEPTION",
    clinicRole = isAdmin || data.user.role === "CLINIC";
  const tabs = [
    ...(reception ? ["journeys", "assistance"] : []),
    ...(clinicRole ? ["queue"] : []),
    ...(isAdmin ? ["mapAdmin", "staffAccounts"] : []),
    ...(reception ? ["qrGenerator"] : []),
  ];
  const currentTab = tabs.includes(tab) ? tab : tabs[0];
  const formJourney = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const b = new FormData(e.currentTarget);
        void run(async () => {
          if (replaceId) {
            await api(`/journeys/${replaceId}/destinations`, token, {
              rooms: selectedRooms,
            });
            setReplaceId("");
          } else {
            const r = await api("/journeys", token, {
              alias: b.get("alias"),
              rooms: selectedRooms,
              accessible: b.get("accessible") === "on",
            });
            setLink(r.url);
            await generate(r.url);
          }
          await load();
        }, "saved");
      }}
    >
      {!replaceId && (
        <label>
          {t("alias")}
          <input name="alias" required maxLength={40} />
        </label>
      )}
      <label>{t("stages")}</label>
      <div className="stage-chips">
        {selectedRooms.map((id, i) => (
          <button
            type="button"
            key={i}
            onClick={() =>
              setSelectedRooms(selectedRooms.filter((_, n) => i !== n))
            }
          >
            {i + 1}. {name(id)} ×
          </button>
        ))}
      </div>
      <select
        aria-label={t("add")}
        value=""
        onChange={(e) => setSelectedRooms([...selectedRooms, e.target.value])}
      >
        <option value="" disabled>
          {t("add")}
        </option>
        {map.rooms
          .filter((r) => !selectedRooms.includes(r.id) && r.type !== "waiting")
          .map((r) => (
            <option key={r.id} value={r.id}>
              {name(r.id)}
            </option>
          ))}
      </select>
      {!replaceId && (
        <label className="toggle-row">
          <span>{t("wheelchair")}</span>
          <input type="checkbox" name="accessible" />
        </label>
      )}
      <button
        disabled={busy || !selectedRooms.length}
        className="button primary"
      >
        {t(replaceId ? "save" : "create")}
      </button>
      {replaceId && (
        <button type="button" onClick={() => setReplaceId("")}>
          {t("cancel")}
        </button>
      )}
    </form>
  );
  return (
    <div className="dashboard">
      <aside className="staff-sidebar">
        <h2>{t(data.user.role)}</h2>
        <small>{data.user.username}</small>
        {tabs.map((key) => (
          <button
            className={currentTab === key ? "selected" : ""}
            onClick={() => setTab(key)}
            key={key}
          >
            {t(key === "journeys" ? "activeJourneys" : key)}
          </button>
        ))}
        <button onClick={() => setToken("")}>
          <LogOut size={18} />
          {t("logout")}
        </button>
      </aside>
      <div className="staff-content">
        <div className="dashboard-title">
          <div>
            <span className="eyebrow">MASARAK / {t(data.user.role)}</span>
            <h1>
              {t(currentTab === "journeys" ? "activeJourneys" : currentTab)}
            </h1>
          </div>
          <div className="metrics">
            <span>
              {t("journey")}
              <strong>{data.stats.journeys}</strong>
            </span>
            <span>
              {t("assistance")}
              <strong>{data.stats.requests}</strong>
            </span>
            <span>
              {t("navigationUpdates")}
              <strong>{data.stats.navigationUpdates}</strong>
            </span>
          </div>
        </div>
        {currentTab === "journeys" && (
          <div className="dashboard-grid">
            <section className="card">
              <h2>{t(replaceId ? "replaceDestinations" : "newJourney")}</h2>
              {formJourney}
            </section>
            <section>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("alias")}</th>
                      <th>{t("destination")}</th>
                      <th>{t("journey")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.journeys.map((j: Journey) => (
                      <tr key={j.id}>
                        <td>{j.alias}</td>
                        <td>
                          {name(
                            j.stages.find((s) => s.status === "active")
                              ?.roomId ?? "",
                          )}
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              void run(async () => {
                                const r = await api(
                                  `/journeys/${j.id}/link`,
                                  token,
                                );
                                setLink(r.url);
                                await generate(r.url);
                              })
                            }
                          >
                            {t("accessLink")}
                          </button>
                          <button
                            onClick={() => {
                              setReplaceId(j.id);
                              setSelectedRooms(
                                j.stages
                                  .filter((s) =>
                                    ["pending", "active"].includes(s.status),
                                  )
                                  .map((s) => s.roomId),
                              );
                            }}
                          >
                            {t("replaceDestinations")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {link && (
                <div className="card qr-result">
                  <h3>{t("accessLink")}</h3>
                  <a href={link} target="_blank" rel="noreferrer">
                    {link}
                  </a>
                  {qr && <img src={qr} alt={t("accessLink")} />}
                </div>
              )}
            </section>
          </div>
        )}
        {currentTab === "assistance" && (
          <div className="card">
            {data.assistance
              .filter((a: any) => !a.resolved)
              .map((a: any) => (
                <div className="staff-row" key={a.id}>
                  <div>
                    <strong>
                      {
                        data.journeys.find((j: Journey) => j.id === a.journeyId)
                          ?.alias
                      }
                    </strong>
                    <small>{a.location}</small>
                  </div>
                  <button
                    onClick={() => void act(`/assistance/${a.id}/resolve`, {})}
                  >
                    {t("resolve")}
                  </button>
                </div>
              ))}
            {!data.assistance.some((a: any) => !a.resolved) && (
              <p>{t("empty")}</p>
            )}
          </div>
        )}
        {currentTab === "queue" && (
          <>
            <section className="card clinic-toolbar">
              <select
                aria-label={t("destination")}
                value={clinic}
                onChange={(e) => setClinic(e.target.value)}
                disabled={!isAdmin}
              >
                {data.clinics
                  .filter((c: any) => isAdmin || c.roomId === data.user.roomId)
                  .map((c: any) => (
                    <option key={c.roomId} value={c.roomId}>
                      {name(c.roomId)}
                    </option>
                  ))}
              </select>
              <select
                aria-label={t("wait")}
                value={
                  data.clinics.find((c: any) => c.roomId === clinic)?.status ??
                  "available"
                }
                onChange={(e) =>
                  void act(
                    `/clinics/${clinic}`,
                    { status: e.target.value },
                    "PUT",
                  )
                }
              >
                {[
                  "available",
                  "busy",
                  "closed",
                  "paused",
                  "waiting",
                  "ready",
                ].map((v) => (
                  <option value={v} key={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                className="primary"
                onClick={() => void act(`/clinics/${clinic}/call`, {})}
              >
                <Bell size={18} />
                {t("callNext")}
              </button>
            </section>
            <p className="hint">{t("priorityHint")}</p>
            <div className="ticket-grid">
              {data.tickets
                .filter((x: Ticket) => x.roomId === clinic)
                .sort(
                  (a: Ticket, b: Ticket) =>
                    b.priority - a.priority ||
                    a.createdAt.localeCompare(b.createdAt),
                )
                .map((ticket: Ticket) => (
                  <section className="card ticket" key={ticket.id}>
                    <div className="staff-row">
                      <strong>
                        {
                          data.journeys.find(
                            (j: Journey) => j.id === ticket.journeyId,
                          )?.alias
                        }
                      </strong>
                      <span className="status">{t(ticket.status)}</span>
                    </div>
                    {ticket.extraTime && (
                      <p className="alert">{t("extraRequested")}</p>
                    )}
                    {ticket.expiredReported && (
                      <p className="alert">{t("timeExpired")}</p>
                    )}
                    {ticket.status === "waiting" && (
                      <label>
                        {t("priority")}
                        <select
                          value={ticket.priority}
                          onChange={(e) =>
                            void act(`/tickets/${ticket.id}/action`, {
                              action: "priority",
                              priority: Number(e.target.value),
                            })
                          }
                        >
                          {[0, 1, 2, 3, 4, 5].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="ticket-actions">
                      {ticket.status === "called" && (
                        <>
                          <button
                            onClick={() =>
                              void act(`/tickets/${ticket.id}/action`, {
                                action: "arrived",
                              })
                            }
                          >
                            {t("confirm")}
                          </button>
                          <button
                            onClick={() =>
                              void act(`/tickets/${ticket.id}/action`, {
                                action: "extend",
                              })
                            }
                          >
                            {t("extend")}
                          </button>
                          <button
                            onClick={() =>
                              void act(`/tickets/${ticket.id}/action`, {
                                action: "missed",
                              })
                            }
                          >
                            {t("markMissed")}
                          </button>
                        </>
                      )}
                      {ticket.status === "arrived" && (
                        <button
                          onClick={() =>
                            void act(`/tickets/${ticket.id}/action`, {
                              action: "start",
                            })
                          }
                        >
                          {t("startConsultation")}
                        </button>
                      )}
                      {ticket.status === "consulting" && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const nextRoom = String(
                              new FormData(e.currentTarget).get("nextRoom") ??
                                "",
                            );
                            void act(`/tickets/${ticket.id}/action`, {
                              action: "complete",
                              ...(nextRoom ? { nextRoom } : {}),
                            });
                          }}
                        >
                          <select
                            name="nextRoom"
                            aria-label={t("nextDestination")}
                          >
                            <option value="">{t("continue")}</option>
                            {map.rooms
                              .filter((r) => r.type !== "waiting")
                              .map((r) => (
                                <option value={r.id} key={r.id}>
                                  {name(r.id)}
                                </option>
                              ))}
                          </select>
                          <button className="primary">
                            {t("completeConsultation")}
                          </button>
                        </form>
                      )}
                      {["missed", "called"].includes(ticket.status) && (
                        <button
                          onClick={() =>
                            void act(`/tickets/${ticket.id}/action`, {
                              action: "recall",
                            })
                          }
                        >
                          {t("recall")}
                        </button>
                      )}
                      {!["complete", "missed"].includes(ticket.status) && (
                        <button
                          onClick={() =>
                            void act(`/tickets/${ticket.id}/action`, {
                              action: "notify",
                            })
                          }
                        >
                          {t("sendNotice")}
                        </button>
                      )}
                    </div>
                  </section>
                ))}
            </div>
          </>
        )}
        {currentTab === "mapAdmin" && (
          <section className="card">
            <p>{t("mapEditorHint")}</p>
            <textarea
              className="map-editor"
              dir="ltr"
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
              aria-label={t("mapAdmin")}
            />
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  let value: unknown;
                  try {
                    value = JSON.parse(editor);
                  } catch {
                    throw Error("invalidInput");
                  }
                  await api("/admin/map", token, value, "PUT");
                  await onMapChange();
                  await load();
                }, "saved")
              }
            >
              {t("publish")}
            </button>
          </section>
        )}
        {currentTab === "staffAccounts" && (
          <div className="dashboard-grid">
            <section className="card">
              <h2>{t("create")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    b = Object.fromEntries(f);
                  void act("/admin/staff", b);
                }}
              >
                <label>
                  {t("username")}
                  <input
                    name="username"
                    required
                    pattern="[a-zA-Z0-9_.-]{3,50}"
                  />
                </label>
                <label>
                  {t("password")}
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  {t("role")}
                  <select name="role">
                    {["RECEPTION", "CLINIC", "ADMIN"].map((r) => (
                      <option key={r} value={r}>
                        {t(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("destination")}
                  <select name="roomId">
                    {data.clinics.map((c: any) => (
                      <option key={c.roomId} value={c.roomId}>
                        {name(c.roomId)}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy} className="button primary">
                  {t("create")}
                </button>
              </form>
            </section>
            <section className="card">
              {data.staff.map((u: any) => (
                <div className="staff-row" key={u.id}>
                  <div>
                    <strong>{u.username}</strong>
                    <small>
                      {t(u.role)} · {u.active ? "●" : "○"}
                    </small>
                  </div>
                  <button
                    disabled={u.id === data.user.id}
                    onClick={() => void act(`/admin/staff/${u.id}/toggle`, {})}
                  >
                    {t("toggle")}
                  </button>
                </div>
              ))}
            </section>
          </div>
        )}
        {currentTab === "qrGenerator" && (
          <QrManager
            map={map}
            token={token}
            admin={isAdmin}
            run={run}
            busy={busy}
            onChanged={async () => {
              await onMapChange();
              await load();
            }}
          />
        )}
      </div>
    </div>
  );
}
