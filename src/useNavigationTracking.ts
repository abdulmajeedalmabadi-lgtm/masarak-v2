import { useEffect, useMemo, useRef, useState } from "react";
import type { HospitalMap, Journey, Node } from "../shared/types";
import { MotionTrackingService } from "./services/MotionTrackingService";
import { StepDetectionService } from "./services/StepDetectionService";
import { NavigationTrackingService } from "./services/NavigationTrackingService";
export function useNavigationTracking(
  map: HospitalMap,
  journey: Journey,
  path: Node[],
  enabled: boolean,
) {
  const [, render] = useState(0);
  const update = () => render((n) => n + 1);
  const tracker = useMemo(
    () =>
      new NavigationTrackingService(
        map.nodes.find((n) => n.id === journey.location) ?? path[0],
        map,
        path,
      ),
    [
      map.version,
      journey.location,
      journey.confirmedAt,
      path.map((n) => `${n.id}:${n.x}:${n.y}`).join("|"),
    ],
  );
  const detector = useMemo(() => new StepDetectionService(), [tracker]);
  const current = useRef({ tracker, detector, enabled });
  current.current = { tracker, detector, enabled };
  const motion = useMemo(
    () =>
      new MotionTrackingService((sample) => {
        const c = current.current;
        if (c.enabled && c.detector.ingest(sample)) {
          c.tracker.advance(c.detector.stepLength);
          update();
        }
      }, update),
    [],
  );
  useEffect(() => {
    motion.stop(motion.status !== "idle");
    return () => motion.stop(false);
  }, [motion, tracker, enabled]);
  return { tracker, detector, motion, update };
}
