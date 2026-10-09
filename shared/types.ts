export type Role = "ADMIN" | "RECEPTION" | "CLINIC";
export type Node = {
  id: string;
  x: number;
  y: number;
  floor: number;
  kind: "corridor" | "intersection" | "door" | "elevator" | "stairs";
  accessible: boolean;
};
export type Edge = {
  id: string;
  from: string;
  to: string;
  distance: number;
  accessible: boolean;
  kind: "corridor" | "elevator" | "stairs";
};
export type Room = {
  id: string;
  names: Record<string, string>;
  number: string;
  floor: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeId: string;
  type: string;
  accessible: boolean;
};
export type Corridor = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Checkpoint = {
  id: string;
  hospitalId: string;
  floorId: string;
  floor: number;
  nodeId: string;
  x: number;
  y: number;
  locationName: string;
  names: Record<string, string>;
};
export type HospitalMap = {
  id: string;
  name: string;
  version: number;
  floors: { id: number; name: string; corridors: Corridor[] }[];
  nodes: Node[];
  edges: Edge[];
  rooms: Room[];
  checkpoints: Checkpoint[];
};
export type Stage = {
  id: string;
  roomId: string;
  status: "pending" | "active" | "complete" | "skipped";
  startedAt?: string;
  completedAt?: string;
};
export type Ticket = {
  id: string;
  journeyId: string;
  roomId: string;
  status:
    "waiting" | "called" | "arrived" | "consulting" | "complete" | "missed";
  priority: number;
  createdAt: string;
  calledAt?: string;
  deadline?: string;
  extraTime: boolean;
  expiredReported?: boolean;
};
export type Journey = {
  id: string;
  alias: string;
  tokenVersion: number;
  expiresAt: string;
  location: string;
  confirmedAt?: string;
  confirmedCheckpointId?: string;
  accessible: boolean;
  stages: Stage[];
  createdAt: string;
};
export type Notice = {
  id: string;
  journeyId: string;
  key: string;
  createdAt: string;
  roomId?: string;
};
export type Staff = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  roomId?: string;
  active: boolean;
};
export type Push = {
  id: string;
  journeyId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  language: string;
};
export type State = {
  map: HospitalMap;
  staff: Staff[];
  journeys: Journey[];
  tickets: Ticket[];
  clinics: { roomId: string; status: string }[];
  notifications: Notice[];
  subscriptions: Push[];
  assistance: {
    id: string;
    journeyId: string;
    location: string;
    resolved: boolean;
    createdAt: string;
  }[];
  audit: { id: string; actor: string; action: string; createdAt: string }[];
};
