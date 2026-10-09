import { Component, lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  MoveUpRight,
  MoveUpLeft,
  QrCode,
  LifeBuoy,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Check,
  Volume2,
} from "lucide-react";
import { guidance, instructionDuration } from "../shared/guidance";
import { findRoute } from "../shared/navigation";
import type { HospitalMap, Journey, Room } from "../shared/types";
import { useNavigationTracking } from "./useNavigationTracking";
const Scene = lazy(() => import("./CorridorScene"));
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    const context = c.getContext("webgl2");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
export function Navigation3D({
  map,
  journey,
  destination,
  route,
  dark,
  voice,
  onSpeak,
}: {
  map: HospitalMap;
  journey: Journey;
  destination?: Room;
  route: ReturnType<typeof findRoute>;
  dark: boolean;
  voice: boolean;
  onSpeak: (text: string) => void;
}) {
  const { t, i18n } = useTranslation(),
    steps = useMemo(
      () => guidance(map, route?.nodes ?? []),
      [map, route?.nodes.map((n) => n.id).join("|")],
    );
  const [demo, setDemo] = useState(false),
    [paused, setPaused] = useState(false),
    [index, setIndex] = useState(0),
    [progress, setProgress] = useState(0),
    [webgl, setWebgl] = useState(supportsWebGL);
  const [manual, setManual] = useState(false);
  const tracking = useNavigationTracking(
    map,
    journey,
    route?.nodes ?? [],
    !demo &&
      !manual &&
      !(
        destination &&
        journey.location === destination.nodeId &&
        journey.confirmedCheckpointId
      ),
  );
  const liveSteps = demo ? steps : tracking.tracker.steps;
  const liveIndex = demo ? index : tracking.tracker.index;
  const liveProgress = demo ? progress : tracking.tracker.estimatedProgress;
  const step = liveSteps[liveIndex],
    finished = demo && step?.type === "ARRIVAL",
    confirmed =
      !!destination &&
      journey.location === destination.nodeId &&
      !!journey.confirmedCheckpointId &&
      map.checkpoints.some(
        (q) =>
          q.id === journey.confirmedCheckpointId &&
          q.nodeId === destination.nodeId,
      );
  const name = destination?.names[i18n.language] ?? destination?.names.ar ?? "";
  const upcoming = !demo ? tracking.tracker.approaching : undefined;
  const instruction = !step
    ? t("noRoute")
    : step.type === "ARRIVAL" && !demo && !confirmed
      ? t("trackingEstimatedArrival")
      : !demo && liveProgress >= 1
        ? t("trackingJunction")
        : upcoming?.type.includes("RIGHT")
          ? t("trackingApproachRight", {
              distance: Math.ceil(step.distance * (1 - liveProgress)),
            })
          : upcoming?.type.includes("LEFT")
            ? t("trackingApproachLeft", {
                distance: Math.ceil(step.distance * (1 - liveProgress)),
              })
            : upcoming?.type === "ARRIVAL"
              ? t("trackingNearDestination")
              : t(step.key, {
                  distance: Math.ceil(step.distance * (1 - liveProgress)),
                  floor: step.floor,
                  name,
                });
  const headingMismatch =
    tracking.motion.headingReliable &&
    tracking.motion.routeHeading != null &&
    step &&
    Math.abs(
      Math.atan2(
        Math.sin(tracking.motion.routeHeading - step.heading - step.angle),
        Math.cos(tracking.motion.routeHeading - step.heading - step.angle),
      ),
    ) >
      Math.PI / 3;
  useEffect(() => {
    setIndex(0);
    setProgress(0);
    setPaused(false);
  }, [
    journey.location,
    journey.confirmedAt,
    destination?.nodeId,
    journey.accessible,
  ]);
  useEffect(() => {
    if (!demo || paused || !step || step.type === "ARRIVAL") return;
    let previous = performance.now();
    const id = setInterval(() => {
      const now = performance.now(),
        delta = Math.min((now - previous) / 1000, 0.3);
      previous = now;
      setProgress((p) => Math.min(1, p + delta / instructionDuration(step)));
    }, 100);
    return () => clearInterval(id);
  }, [demo, paused, index, step]);
  useEffect(() => {
    if (demo && progress >= 1 && index < steps.length - 1) {
      setIndex((i) => i + 1);
      setProgress(0);
    }
  }, [progress, demo, index, steps.length]);
  useEffect(() => {
    if (voice) onSpeak(instruction);
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, [
    liveIndex,
    Math.ceil((step?.distance ?? 0) * (1 - liveProgress)),
    journey.location,
    voice,
    i18n.language,
  ]);
  const arrowStep =
    !demo && tracking.tracker.approaching ? tracking.tracker.approaching : step;
  const Icon =
    arrowStep?.type === "TURN_LEFT"
      ? ArrowLeft
      : arrowStep?.type === "TURN_RIGHT"
        ? ArrowRight
        : arrowStep?.type === "SLIGHT_LEFT"
          ? MoveUpLeft
          : arrowStep?.type === "SLIGHT_RIGHT"
            ? MoveUpRight
            : arrowStep?.type === "ARRIVAL"
              ? Check
              : ArrowUp;
  const fallback = (
    <div className="corridor-fallback">
      <div className="perspective-hall">
        <Icon size={96} />
      </div>
      <p>{t("navFallback")}</p>
    </div>
  );
  if (!destination || !step)
    return (
      <div className="alert">
        {t("noRoute")}
        <Link to="/journey">{t("journey")}</Link>
      </div>
    );
  return (
    <section className="navigation-3d" aria-label={t("nav3d")}>
      <div className="nav-mode" role="group" aria-label={t("navMode")}>
        <button
          aria-pressed={!demo && !manual}
          onClick={() => {
            setDemo(false);
            setManual(false);
            setIndex(0);
            setProgress(0);
          }}
        >
          {t("navQrMode")}
        </button>
        <button
          aria-pressed={demo}
          onClick={() => {
            setDemo(true);
            setManual(false);
            setPaused(false);
            setIndex(0);
            setProgress(0);
          }}
        >
          {t("navDemo")}
        </button>
        <button
          aria-pressed={manual}
          onClick={() => {
            setDemo(false);
            setManual(true);
          }}
        >
          {t("trackingManual")}
        </button>
      </div>
      {!demo && (
        <div className="motion-action">
          {!manual && !confirmed && (
            <button
              className="button primary"
              disabled={tracking.motion.status === "requesting"}
              onClick={() => {
                if (["tracking", "stale"].includes(tracking.motion.status))
                  tracking.motion.stop();
                else void tracking.motion.start();
              }}
            >
              {t(
                ["tracking", "stale"].includes(tracking.motion.status)
                  ? "navPause"
                  : "trackingEnable",
              )}
            </button>
          )}
        </div>
      )}
      <div className="nav-instruction" aria-live="polite">
        <Icon size={54} />
        <div>
          <strong>{finished ? t("navDemoDone") : instruction}</strong>
          <small>
            {name} · {t("room")} {destination.number}
          </small>
          <small>
            {t("remaining")}: ≈{" "}
            {Math.ceil(
              liveSteps
                .slice(liveIndex)
                .reduce((sum, s) => sum + s.distance, 0) -
                step.distance * liveProgress,
            )}{" "}
            {t("meters")}
          </small>
        </div>
        <button aria-label={t("voice")} onClick={() => onSpeak(instruction)}>
          <Volume2 />
        </button>
      </div>
      <div className="corridor-viewport" aria-label={t("nav3d")}>
        <div className="scene-label">{t(demo ? "navDemo" : "navQrMode")}</div>
        {webgl ? (
          <SceneBoundary fallback={fallback}>
            <Suspense
              fallback={
                <div className="scene-loading">{t("navPreparing")}</div>
              }
            >
              <Scene
                anchor={`${journey.location}|${journey.confirmedAt}|${destination.nodeId}`}
                steps={liveSteps}
                step={step}
                progress={liveProgress}
                animate={demo && !paused && !finished}
                dark={dark}
                onUnavailable={() => setWebgl(false)}
                destination={destination}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          fallback
        )}
        {demo && ["ELEVATOR", "FLOOR_CHANGE"].includes(step.type) && (
          <div
            className="floor-transition"
            style={{ opacity: Math.sin(progress * Math.PI) }}
          >
            {t("navFloor", { floor: step.floor })}
          </div>
        )}
        <div className="door-label">
          {step.type === "ARRIVAL"
            ? `${name} · ${destination.number}`
            : t(
                step.type === "ELEVATOR"
                  ? "lift"
                  : step.type === "STAIRS"
                    ? "stairs"
                    : "navFollowArrows",
              )}
        </div>
      </div>
      {!demo && (
        <div className="card tracking-panel">
          <p className="hint">{t("trackingWarning")}</p>
          <p aria-live="polite">
            {t("trackingStatus")}: {t("sensor_" + tracking.motion.status)}
          </p>
          <p>
            {t("trackingSteps")}: {tracking.detector.steps} · ≈{" "}
            {tracking.detector.estimatedDistance.toFixed(1)} {t("meters")}
          </p>
          <p>
            {t("trackingConfidence")}:{" "}
            {t("confidence_" + tracking.tracker.positionConfidence)}
          </p>
          <details>
            <summary>{t("trackingCalibration")}</summary>
            <label>
              {t("trackingStepLength")}
              <input
                type="number"
                min="0.3"
                max="1.2"
                step="0.05"
                value={tracking.detector.stepLength}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 0.3 && n <= 1.2) {
                    tracking.detector.configure(n);
                    tracking.update();
                  }
                }}
              />
            </label>
            <label>
              {t("trackingKnownDistance")}
              <input type="number" min="1" id="calibration-distance" />
            </label>
            <button
              disabled={!tracking.detector.steps}
              onClick={() => {
                const input = document.getElementById(
                  "calibration-distance",
                ) as HTMLInputElement;
                try {
                  input.setCustomValidity("");
                  tracking.detector.calibrate(Number(input.value));
                  tracking.update();
                } catch {
                  input.setCustomValidity(t("invalidInput"));
                  input.reportValidity();
                }
              }}
            >
              {t("trackingCalibration")}
            </button>
            <p>{t("trackingHeadingHint")}</p>
            <p>
              {t("trackingHeading")}:{" "}
              {t(
                tracking.motion.headingReliable
                  ? "confidence_estimated"
                  : "confidence_low",
              )}
            </p>
            <button
              disabled={!tracking.motion.orientationAvailable}
              onClick={() => {
                tracking.motion.calibrate(step.heading);
              }}
            >
              {t("trackingHeading")}
            </button>
          </details>
          {headingMismatch && (
            <p className="alert">{t("trackingHeadingMismatch")}</p>
          )}
          {tracking.tracker.positionConfidence === "low" ? (
            <p className="alert">{t("trackingCorrection")}</p>
          ) : (
            (manual || tracking.tracker.blocked) &&
            step.type !== "ARRIVAL" && (
              <button
                className="button secondary"
                onClick={() => {
                  tracking.tracker.confirm();
                  tracking.update();
                }}
              >
                {t(manual ? "navNext" : "trackingConfirm")}
              </button>
            )
          )}
        </div>
      )}
      {confirmed && !demo && (
        <div className="arrival-inline" role="status">
          <p>{t("trackingArrivalProcessing")}</p>
        </div>
      )}
      {finished && (
        <div className="arrival-inline">
          <h2>{t("navDemoDone")}</h2>
          <p>
            {name} · {t("room")} {destination.number} · {t("floor")}{" "}
            {destination.floor}
          </p>
          <small>{t("navDemoHint")}</small>
        </div>
      )}
      {demo && (
        <div className="simulation-controls">
          <button
            aria-label={t("navPrevious")}
            disabled={index === 0}
            onClick={() => {
              setIndex((i) => i - 1);
              setProgress(0);
            }}
          >
            <SkipBack />
          </button>
          <button
            aria-label={t(paused ? "navResume" : "navPause")}
            disabled={finished}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play /> : <Pause />}
          </button>
          <button
            aria-label={t("navRestart")}
            onClick={() => {
              setIndex(0);
              setProgress(0);
              setPaused(false);
            }}
          >
            <RotateCcw />
          </button>
          <button
            aria-label={t("navNext")}
            disabled={index === steps.length - 1}
            onClick={() => {
              setIndex((i) => i + 1);
              setProgress(0);
            }}
          >
            <SkipForward />
          </button>
          <progress
            value={index + progress}
            max={Math.max(1, steps.length - 1)}
            aria-label={t("navProgress")}
          />
        </div>
      )}
      <div className="nav-actions">
        <Link className="button primary" to="/scan">
          <QrCode />
          {t("scan")}
        </Link>
        <Link className="button secondary" to="/lost">
          <LifeBuoy />
          {t("lost")}
        </Link>
      </div>
      <p className="hint nav-footnote">
        {t(demo ? "navDemoHint" : "navQrHint")}
      </p>
    </section>
  );
}
