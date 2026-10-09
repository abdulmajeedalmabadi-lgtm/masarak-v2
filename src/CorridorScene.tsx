import { useMemo, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTranslation } from "react-i18next";
import { RoundedBox, Html } from "@react-three/drei";
import * as THREE from "three";
import type { Guidance } from "../shared/guidance";
import type { Node, Room } from "../shared/types";
function ContextStatus({ onUnavailable }: { onUnavailable: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onUnavailable();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onUnavailable]);
  return null;
}
const position = (n: Node): [number, number, number] => [
  n.x * 0.1,
  1.65,
  n.y * 0.1,
];
function Camera({
  step,
  progress,
  anchor,
}: {
  step: Guidance;
  progress: number;
  anchor: string;
}) {
  const visual = useRef({ key: "", progress: 0, heading: 0, anchor: "" });
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [step, progress, invalidate]);
  useFrame(({ camera }, delta) => {
    const key = `${anchor}:${step.type}:${step.from.id}:${step.to.id}`;
    if (visual.current.key !== key)
      visual.current = {
        key,
        progress,
        anchor,
        heading:
          visual.current.anchor === anchor
            ? visual.current.heading
            : step.heading,
      };
    visual.current.progress = THREE.MathUtils.damp(
      visual.current.progress,
      progress,
      18,
      delta,
    );
    const a = position(step.from),
      b = position(step.to),
      turning = step.type.includes("LEFT") || step.type.includes("RIGHT");
    // Position is proportional to estimated route distance, not eased distance.
    const p = visual.current.progress,
      targetYaw = step.heading + (turning ? step.angle * p : 0);
    const yawDelta = Math.atan2(
      Math.sin(targetYaw - visual.current.heading),
      Math.cos(targetYaw - visual.current.heading),
    );
    visual.current.heading += yawDelta * (1 - Math.exp(-18 * delta));
    const yaw = visual.current.heading;
    camera.position.set(
      a[0] +
        (b[0] - a[0]) * p -
        (step.type === "ARRIVAL" ? Math.cos(yaw) * 3.5 : 0),
      1.65 + (step.type === "STAIRS" ? Math.sin(p * Math.PI) * 0.8 : 0),
      a[2] +
        (b[2] - a[2]) * p -
        (step.type === "ARRIVAL" ? Math.sin(yaw) * 3.5 : 0),
    );
    camera.lookAt(
      camera.position.x + Math.cos(yaw),
      camera.position.y,
      camera.position.z + Math.sin(yaw),
    );
    if (
      Math.abs(visual.current.progress - progress) > 0.001 ||
      Math.abs(yawDelta) > 0.001
    )
      invalidate();
  });
  return null;
}
function Arrow({
  x,
  z,
  heading,
  dark,
  animate,
}: {
  x: number;
  z: number;
  heading: number;
  dark: boolean;
  animate: boolean;
}) {
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (material.current)
      material.current.emissiveIntensity = animate
        ? 0.35 + Math.sin(clock.elapsedTime * 3) * 0.2
        : 0.3;
  });
  return (
    <group position={[x, 0.035, z]} rotation={[0, -heading, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry
          args={[
            useMemo(() => {
              const s = new THREE.Shape();
              s.moveTo(1, 0);
              s.lineTo(-0.4, 0.55);
              s.lineTo(-0.15, 0);
              s.lineTo(-0.4, -0.55);
              s.closePath();
              return s;
            }, []),
          ]}
        />
        <meshStandardMaterial
          ref={material}
          color={dark ? "#6affda" : "#00a699"}
          emissive="#00bda6"
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
function Environment({
  steps,
  step,
  dark,
  animate,
  destination,
  progress,
}: {
  steps: Guidance[];
  step: Guidance;
  dark: boolean;
  animate: boolean;
  destination?: Room;
  progress: number;
}) {
  const { i18n, t } = useTranslation();
  const segments = useMemo(() => {
    const corridors = steps.filter(
      (s) => s.type === "FORWARD" && s.floor === step.from.floor,
    );
    if (corridors.length) return corridors;
    return [
      {
        ...step,
        type: "FORWARD" as const,
        from: {
          ...step.from,
          x: step.from.x - Math.cos(step.heading) * 60,
          y: step.from.y - Math.sin(step.heading) * 60,
        },
        to: step.from,
        distance: 6,
      },
    ];
  }, [steps, step.from.floor]);
  const wall = dark ? "#344858" : "#e7eff2",
    accent = dark ? "#56d9c4" : "#008f91";
  return (
    <>
      <color attach="background" args={[dark ? "#192d3c" : "#dde9ef"]} />
      <fog attach="fog" args={[dark ? "#192d3c" : "#dde9ef", 18, 70]} />
      <ambientLight intensity={dark ? 1.3 : 2} />
      <hemisphereLight args={["#e2f8ff", "#6b8a95", 2]} />
      {segments.map((s, i) => {
        const a = position(s.from),
          b = position(s.to),
          length = Math.hypot(b[0] - a[0], b[2] - a[2]),
          count = Math.max(1, Math.floor(Math.max(1, length - 4.8) / 4));
        return (
          <group
            key={i}
            position={[(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2]}
            rotation={[0, -s.heading, 0]}
          >
            <mesh position={[0, -0.06, 0]}>
              <boxGeometry args={[length + 1, 0.12, 4.8]} />
              <meshStandardMaterial
                color={dark ? "#607583" : "#cad8dd"}
                roughness={0.6}
              />
            </mesh>
            <mesh position={[0, 3.3, 0]}>
              <boxGeometry args={[length + 1, 0.15, 4.8]} />
              <meshStandardMaterial color={wall} />
            </mesh>
            {length > 6 &&
              [-1, 1].map((side) => (
                <group key={side}>
                  {Array.from({ length: count }, (_, j) => (
                    <group
                      key={j}
                      position={[
                        ((j + 0.5) * (length - 4.8)) / count -
                          (length - 4.8) / 2,
                        0,
                        side * 2.4,
                      ]}
                    >
                      <mesh position={[0, 1.6, 0]}>
                        <boxGeometry
                          args={[
                            Math.max(0.8, (length - 4.8) / count - 0.1),
                            3.2,
                            0.12,
                          ]}
                        />
                        <meshStandardMaterial color={wall} />
                      </mesh>
                      <RoundedBox
                        args={[1.2, 2.4, 0.15]}
                        radius={0.05}
                        smoothness={2}
                        position={[0, 1.2, -side * 0.1]}
                      >
                        <meshStandardMaterial color={accent} />
                      </RoundedBox>
                      <mesh position={[0.4, 1.1, -side * 0.22]}>
                        <sphereGeometry args={[0.06, 8, 8]} />
                        <meshStandardMaterial color="#dde5e9" metalness={0.6} />
                      </mesh>
                      <mesh position={[0, 2.65, -side * 0.12]}>
                        <boxGeometry args={[1.1, 0.3, 0.12]} />
                        <meshStandardMaterial color={accent} />
                      </mesh>
                    </group>
                  ))}
                </group>
              ))}
            {Array.from({ length: count }, (_, j) => (
              <mesh
                key={j}
                position={[
                  ((j + 0.5) * (length - 4.8)) / count - (length - 4.8) / 2,
                  3.19,
                  0,
                ]}
              >
                <boxGeometry args={[1.6, 0.025, 0.65]} />
                <meshStandardMaterial
                  color="#f5ffff"
                  emissive="#d1f9ff"
                  emissiveIntensity={1}
                />
              </mesh>
            ))}
          </group>
        );
      })}
      {segments.flatMap((s, i) => {
        const a = position(s.from),
          b = position(s.to),
          count = Math.max(
            1,
            Math.floor(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2.5),
          );
        return Array.from({ length: count }, (_, j) => (
          <Arrow
            key={`${i}-${j}`}
            x={a[0] + ((b[0] - a[0]) * (j + 0.5)) / count}
            z={a[2] + ((b[2] - a[2]) * (j + 0.5)) / count}
            heading={s.heading}
            dark={dark}
            animate={animate}
          />
        ));
      })}
      {step.type === "ELEVATOR" && (
        <group position={position(step.from)} rotation={[0, -step.heading, 0]}>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[
                2,
                0,
                side * (0.8 + Math.sin(progress * Math.PI) * 1.3),
              ]}
            >
              <boxGeometry args={[0.12, 3, 1.6]} />
              <meshStandardMaterial
                color="#97acb7"
                metalness={0.6}
                roughness={0.3}
              />
            </mesh>
          ))}
          <Html position={[1.8, 1.2, 0]} center>
            <span className="world-sign">
              {t("lift")} ↑ {step.floor}
            </span>
          </Html>
        </group>
      )}
      {step.type === "STAIRS" && (
        <group position={position(step.from)} rotation={[0, -step.heading, 0]}>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[i * 0.45, -1.6 + i * 0.18, 0]}>
              <boxGeometry args={[0.45, 0.2, 2.8]} />
              <meshStandardMaterial color={wall} />
            </mesh>
          ))}
        </group>
      )}
      {destination && destination.floor === step.from.floor && (
        <group
          position={[
            destination.x * 0.1 + destination.width * 0.05,
            0,
            steps.at(-1)!.to.y * 0.1,
          ]}
        >
          <RoundedBox
            args={[1.8, 2.7, 0.2]}
            position={[0, 1.35, 0]}
            radius={0.05}
            smoothness={2}
          >
            <meshStandardMaterial color={accent} />
          </RoundedBox>
          <Html position={[0, 2.9, 0]} center>
            <span className="world-sign">
              {destination.names[i18n.language] ?? destination.names.ar} ·{" "}
              {destination.number}
            </span>
          </Html>
          <mesh position={[0, 2.9, 0]}>
            <boxGeometry args={[2, 0.3, 0.22]} />
            <meshStandardMaterial color="#00ab9e" />
          </mesh>
        </group>
      )}
    </>
  );
}
export default function CorridorScene(props: {
  steps: Guidance[];
  step: Guidance;
  progress: number;
  dark: boolean;
  animate: boolean;
  destination?: Room;
  onUnavailable: () => void;
  anchor: string;
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={props.animate ? "always" : "demand"}
      camera={{ fov: 65, near: 0.1, far: 100 }}
      gl={{ antialias: false, powerPreference: "low-power" }}
    >
      <ContextStatus onUnavailable={props.onUnavailable} />
      <Camera
        step={props.step}
        progress={props.progress}
        anchor={props.anchor}
      />
      <Environment {...props} />
    </Canvas>
  );
}
