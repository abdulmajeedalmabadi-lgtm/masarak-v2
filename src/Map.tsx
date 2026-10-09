import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Minus, LocateFixed } from "lucide-react";
import type { HospitalMap, Node } from "../shared/types";
export function HospitalMapView({
  map,
  location,
  destination,
  path,
  onLocate,
  showCheckpoints = false,
  selectedCheckpoint,
  onCheckpoint,
  initialFloor,
}: {
  map: HospitalMap;
  location: string;
  destination?: string;
  path: Node[];
  onLocate?: (id: string) => void;
  showCheckpoints?: boolean;
  selectedCheckpoint?: string;
  onCheckpoint?: (id: string) => void;
  initialFloor?: number;
}) {
  const { t, i18n } = useTranslation(),
    current = map.nodes.find((n) => n.id === location);
  const [floor, setFloor] = useState(
      initialFloor ??
        current?.floor ??
        map.checkpoints.find((q) => q.id === selectedCheckpoint)?.floor ??
        0,
    ),
    [scale, setScale] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  const name = (r: HospitalMap["rooms"][number]) =>
    r.names[i18n.language] ?? r.names.ar;
  return (
    <section className="map-container" aria-label={t("map")}>
      <div className="map-top">
        {map.floors.map((f) => (
          <button
            className={floor === f.id ? "selected" : ""}
            key={f.id}
            onClick={() => {
              setFloor(f.id);
              setPan({ x: 0, y: 0 });
            }}
          >
            {t(f.name)}
          </button>
        ))}
      </div>
      <svg
        viewBox="0 0 760 510"
        role="img"
        aria-label={t("map")}
        onWheel={(e) =>
          setScale((s) => Math.max(0.7, Math.min(3, s - e.deltaY * 0.002)))
        }
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            px: pan.x,
            py: pan.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x,
            dy = e.clientY - drag.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 8) drag.current.moved = true;
          const ratio = 760 / e.currentTarget.getBoundingClientRect().width;
          setPan({
            x: drag.current.px + dx * ratio,
            y: drag.current.py + dy * ratio,
          });
        }}
        onPointerUp={(e) => {
          if (
            (onLocate || onCheckpoint) &&
            drag.current &&
            !drag.current.moved
          ) {
            const point = e.currentTarget.createSVGPoint();
            point.x = e.clientX;
            point.y = e.clientY;
            const p = point.matrixTransform(
              e.currentTarget.getScreenCTM()!.inverse(),
            );
            const x = (p.x - pan.x - 380) / scale + 380,
              y = (p.y - pan.y - 255) / scale + 255;
            const n = map.nodes
              .filter((n) => n.floor === floor)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
              )[0];
            const room = map.rooms.find(
              (r) =>
                r.floor === floor &&
                x >= r.x &&
                x <= r.x + r.width &&
                y >= r.y &&
                y <= r.y + r.height,
            );
            if (onLocate && room) onLocate(room.nodeId);
            else if (onLocate && n && Math.hypot(n.x - x, n.y - y) < 14)
              onLocate(n.id);
            else if (onCheckpoint) {
              const q = map.checkpoints
                .filter((q) => q.floor === floor)
                .sort(
                  (a, b) =>
                    Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
                )[0];
              if (q && Math.hypot(q.x - x, q.y - y) < 30) onCheckpoint(q.id);
            }
          }
          drag.current = null;
        }}
      >
        <defs>
          <pattern
            id="grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M20 0H0V20"
              fill="none"
              stroke="var(--map-grid)"
              strokeWidth="0.5"
            />
          </pattern>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="var(--primary)" />
          </marker>
        </defs>
        <rect width="760" height="510" fill="var(--map-bg)" />
        <g
          transform={`translate(${pan.x} ${pan.y}) translate(380 255) scale(${scale}) translate(-380 -255)`}
        >
          <rect
            x="35"
            y="60"
            width="690"
            height="430"
            rx="18"
            fill="url(#grid)"
            stroke="var(--border)"
          />
          {map.floors
            .find((f) => f.id === floor)
            ?.corridors.map((c) => (
              <rect
                key={c.id}
                x={c.x}
                y={c.y}
                width={c.width}
                height={c.height}
                fill="var(--corridor)"
              />
            ))}
          {map.edges
            .filter(
              (e) =>
                e.kind === "corridor" &&
                (map.nodes.find((n) => n.id === e.from)?.kind === "door" ||
                  map.nodes.find((n) => n.id === e.to)?.kind === "door"),
            )
            .map((e) => {
              const a = map.nodes.find((n) => n.id === e.from)!,
                b = map.nodes.find((n) => n.id === e.to)!;
              return a.floor === floor && b.floor === floor ? (
                <path
                  key={e.id}
                  d={`M${a.x} ${a.y}L${b.x} ${b.y}`}
                  stroke="var(--corridor)"
                  strokeWidth="30"
                />
              ) : null;
            })}
          {map.rooms
            .filter((r) => r.floor === floor)
            .map((r) => (
              <g key={r.id}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  rx="7"
                  fill={
                    destination === r.id
                      ? "var(--destination-bg)"
                      : "var(--room-bg)"
                  }
                  stroke={
                    destination === r.id
                      ? "var(--primary)"
                      : "var(--room-border)"
                  }
                  strokeWidth="2"
                />
                <text
                  x={r.x + r.width / 2}
                  y={r.y + 55}
                  textAnchor="middle"
                  fill="var(--text)"
                  fontSize="10"
                >
                  {name(r)}
                </text>
                <text
                  x={r.x + r.width / 2}
                  y={r.y + 77}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="14"
                >
                  {r.number}
                </text>
                <path
                  d={`M${r.x + r.width / 2 - 12} ${r.y === 350 ? r.y : r.y + r.height}h24`}
                  stroke="var(--map-bg)"
                  strokeWidth="5"
                />
              </g>
            ))}
          {map.nodes
            .filter(
              (n) =>
                n.floor === floor && ["elevator", "stairs"].includes(n.kind),
            )
            .map((n) => (
              <g key={n.id}>
                <rect
                  x={n.x - 29}
                  y="170"
                  width="58"
                  height="85"
                  rx="6"
                  fill="var(--room-bg)"
                  stroke="var(--room-border)"
                />
                <text
                  x={n.x}
                  y="208"
                  fontSize="12"
                  textAnchor="middle"
                  fill="var(--text)"
                >
                  {t(n.kind === "elevator" ? "lift" : "stairs")}
                </text>
                <text x={n.x} y="230" textAnchor="middle" fill="var(--primary)">
                  {n.kind === "elevator" ? "↕" : "▤"}
                </text>
              </g>
            ))}
          {path.slice(0, -1).map((a, i) => {
            const b = path[i + 1];
            return a.floor === floor && b.floor === floor ? (
              <path
                key={i}
                d={`M${a.x} ${a.y}L${b.x} ${b.y}`}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="7"
                strokeLinecap="round"
                markerEnd="url(#arrow)"
              />
            ) : null;
          })}
          {onLocate &&
            map.nodes
              .filter((n) => n.floor === floor)
              .map((n) => (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${t("currentLocation")} ${n.id}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onLocate(n.id);
                    }
                  }}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r="10"
                    fill="var(--primary)"
                    opacity="0.8"
                  />
                </g>
              ))}
          {map.rooms
            .filter((r) => r.id === destination && r.floor === floor)
            .map((r) => {
              const n = map.nodes.find((n) => n.id === r.nodeId)!;
              return (
                <g key={r.id} transform={`translate(${n.x} ${n.y - 10})`}>
                  <path d="M0 0C-25-25-16-40 0-40S25-25 0 0" fill="#e34d63" />
                  <circle cy="-25" r="6" fill="white" />
                </g>
              );
            })}
          {showCheckpoints &&
            map.checkpoints
              .filter((q) => q.floor === floor)
              .map((q) => (
                <g
                  key={q.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${t("checkpoint")}: ${q.names[i18n.language] ?? q.locationName}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (onLocate) onLocate(q.nodeId);
                      else onCheckpoint?.(q.id);
                    }
                  }}
                  data-checkpoint-id={q.id}
                >
                  <title>
                    {q.names[i18n.language] ?? q.locationName} · {q.id}
                  </title>
                  <rect
                    x={q.x - 10}
                    y={q.y - 10}
                    width={20}
                    height={20}
                    rx={3}
                    fill={
                      q.id === selectedCheckpoint ? "#ffb43c" : "var(--card)"
                    }
                    stroke={
                      q.id === selectedCheckpoint ? "#bc7a09" : "var(--primary)"
                    }
                    strokeWidth={q.id === selectedCheckpoint ? 4 : 2}
                  />
                  <text
                    x={q.x}
                    y={q.y + 5}
                    textAnchor="middle"
                    fill="var(--primary)"
                    fontSize={15}
                  >
                    ▦
                  </text>
                </g>
              ))}
          {current?.floor === floor && (
            <g>
              <circle
                cx={current.x}
                cy={current.y}
                r="20"
                fill="#3595ff"
                opacity="0.18"
              />
              <circle
                cx={current.x}
                cy={current.y}
                r="10"
                fill="#258bfa"
                stroke="white"
                strokeWidth="4"
              />
            </g>
          )}
        </g>
      </svg>
      <div className="map-controls">
        <button
          aria-label={t("zoomIn")}
          onClick={() => setScale((s) => Math.min(3, s + 0.2))}
        >
          <Plus size={19} />
        </button>
        <button
          aria-label={t("zoomOut")}
          onClick={() => setScale((s) => Math.max(0.7, s - 0.2))}
        >
          <Minus size={19} />
        </button>
        <button
          aria-label={t("center")}
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
            setFloor(current?.floor ?? 0);
          }}
        >
          <LocateFixed size={19} />
        </button>
      </div>
    </section>
  );
}
