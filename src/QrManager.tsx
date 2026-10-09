import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Printer, Download, QrCode, Trash2, Pencil } from "lucide-react";
import type { HospitalMap, Checkpoint } from "../shared/types";
import { checkpointForNode } from "../shared/checkpoints";
import { api } from "./api";
import { HospitalMapView } from "./Map";
import { languages } from "./i18n";
import { downloadQr, printableQrDocument, type QRLabel } from "./printQr";
type Run = (fn: () => Promise<unknown>, success?: string) => Promise<void>;
export function QrManager({
  map,
  token,
  admin,
  run,
  busy,
  onChanged,
}: {
  map: HospitalMap;
  token: string;
  admin: boolean;
  run: Run;
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState(map.checkpoints[0]?.id ?? ""),
    [draft, setDraft] = useState<Checkpoint | null>(null),
    [editing, setEditing] = useState(false),
    [label, setLabel] = useState<QRLabel | null>(null),
    [pendingDelete, setPendingDelete] = useState(""),
    [filter, setFilter] = useState("all");
  const current = map.checkpoints.find((q) => q.id === selected),
    previewNode = draft?.nodeId ?? current?.nodeId;
  const choose = (id: string) => {
    setSelected(id);
    setLabel(null);
    setDraft(null);
    setPendingDelete("");
  };
  const nodeLabel = (nodeId: string) => {
    const n = map.nodes.find((n) => n.id === nodeId)!;
    const q = checkpointForNode(map, n, "QR-preview");
    return q.names[i18n.language] ?? q.locationName;
  };
  const move = (nodeId: string) => {
    if (!draft) return;
    const n = map.nodes.find((n) => n.id === nodeId)!;
    const prior = map.nodes.find((n) => n.id === draft.nodeId)!;
    const auto = checkpointForNode(map, prior, draft.id).names;
    const customized = languages.some(
      ([lang]) => draft.names[lang] !== auto[lang],
    );
    setDraft(
      checkpointForNode(map, n, draft.id, customized ? draft.names : undefined),
    );
  };
  const create = () => {
    const n =
      map.nodes.find(
        (n) => n.floor === (filter === "all" ? 0 : Number(filter)),
      ) ?? map.nodes[0];
    setDraft(checkpointForNode(map, n, `QR-${crypto.randomUUID()}`));
    setEditing(false);
    setLabel(null);
    setPendingDelete("");
  };
  const save = () =>
    void run(async () => {
      if (!draft) return;
      const body = {
        nodeId: draft.nodeId,
        names: draft.names,
        ...(!editing ? { id: draft.id } : {}),
      };
      const q = await api<Checkpoint>(
        editing
          ? `/admin/checkpoints/${encodeURIComponent(draft.id)}`
          : "/admin/checkpoints",
        token,
        body,
        editing ? "PUT" : "POST",
      );
      await onChanged();
      setSelected(q.id);
      setDraft(null);
      setLabel(null);
    }, "saved");
  const print = (all: boolean) => {
    const win = window.open("", "_blank");
    void run(async () => {
      if (!win) throw Error("printBlocked");
      try {
        const labels = all
          ? (
              await api<{ labels: QRLabel[] }>(
                "/admin/checkpoints/print/all",
                token,
              )
            ).labels
          : [
              await api<QRLabel>(
                `/admin/checkpoints/${encodeURIComponent(selected)}/qr`,
                token,
              ),
            ];
        win.document.open();
        win.document.write(
          printableQrDocument(
            labels,
            i18n.language,
            t("printQr"),
            t("scanLabelHint"),
          ),
        );
        win.document.close();
      } catch (e) {
        win.close();
        throw e;
      }
    });
  };
  return (
    <div className="qr-workspace">
      <section className="card">
        <div className="qr-toolbar">
          <h2>{t("qrGenerator")}</h2>
          {admin && (
            <button onClick={create}>
              <Plus size={18} />
              {t("addCheckpoint")}
            </button>
          )}
          <button
            disabled={busy || !map.checkpoints.length}
            onClick={() => print(true)}
          >
            <Printer size={18} />
            {t("printAll")}
          </button>
        </div>
        <p className="hint">{t("qrPositionHint")}</p>
        <select
          aria-label={t("floor")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t("allFloors")}</option>
          {map.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {t(f.name)}
            </option>
          ))}
        </select>
        <div className="checkpoint-list">
          {map.checkpoints
            .filter((q) => filter === "all" || q.floor === Number(filter))
            .map((q) => (
              <button
                key={q.id}
                className={selected === q.id ? "selected" : ""}
                onClick={() => choose(q.id)}
              >
                <QrCode size={18} />
                <span>
                  <strong>{q.names[i18n.language] ?? q.locationName}</strong>
                  <small dir="ltr">
                    {q.id} · {q.floorId} · ({q.x}, {q.y})
                  </small>
                </span>
              </button>
            ))}
        </div>
        {!map.checkpoints.length && <p>{t("empty")}</p>}
      </section>
      <section>
        <div className="card">
          <h2>{t("checkpointPreview")}</h2>
          <HospitalMapView
            key={(previewNode ?? "") + map.version}
            map={map}
            location=""
            path={[]}
            showCheckpoints
            selectedCheckpoint={selected}
            onCheckpoint={choose}
            onLocate={draft ? move : undefined}
            initialFloor={map.nodes.find((n) => n.id === previewNode)?.floor}
          />
          {(draft ?? current) && (
            <div className="checkpoint-meta">
              <strong>
                {(draft ?? current)!.names[i18n.language] ??
                  (draft ?? current)!.locationName}
              </strong>
              <small dir="ltr">
                {(draft ?? current)!.hospitalId} / {(draft ?? current)!.floorId}
              </small>
              <small dir="ltr">
                {(draft ?? current)!.nodeId} · X {(draft ?? current)!.x} · Y{" "}
                {(draft ?? current)!.y}
              </small>
            </div>
          )}
        </div>
        {draft ? (
          <section className="card">
            <h2>{t(editing ? "editCheckpoint" : "addCheckpoint")}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <label>
                {t("checkpointId")}
                <input
                  value={draft.id}
                  disabled={editing}
                  required
                  pattern="QR-[A-Za-z0-9_.-]{1,100}"
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                />
              </label>
              <label>
                {t("checkpointLocation")}
                <select
                  value={draft.nodeId}
                  onChange={(e) => move(e.target.value)}
                >
                  {map.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {nodeLabel(n.id)} · {n.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="checkpoint-names">
                {languages.map(([lang, name]) => (
                  <label key={lang}>
                    {name}
                    <input
                      required
                      maxLength={120}
                      value={draft.names[lang] ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          names: { ...draft.names, [lang]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="hint">{t("checkpointDerived")}</p>
              <button className="button primary" disabled={busy}>
                {t("save")}
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                {t("cancel")}
              </button>
            </form>
          </section>
        ) : (
          current && (
            <section className="card">
              <div className="qr-toolbar">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setLabel(
                        await api<QRLabel>(
                          `/admin/checkpoints/${encodeURIComponent(selected)}/qr`,
                          token,
                        ),
                      ),
                    )
                  }
                >
                  <QrCode size={18} />
                  {t("generateQr")}
                </button>
                <button disabled={busy} onClick={() => print(false)}>
                  <Printer size={18} />
                  {t("printQr")}
                </button>
                {admin && (
                  <>
                    <button
                      onClick={() => {
                        setDraft(structuredClone(current));
                        setEditing(true);
                        setLabel(null);
                      }}
                    >
                      <Pencil size={18} />
                      {t("editCheckpoint")}
                    </button>
                    <button
                      className="danger"
                      onClick={() => setPendingDelete(current.id)}
                    >
                      <Trash2 size={18} />
                      {t("deleteCheckpoint")}
                    </button>
                  </>
                )}
              </div>
              {pendingDelete === current.id && (
                <div className="delete-confirm" role="alert">
                  <p>{t("deleteCheckpointHint")}</p>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `/admin/checkpoints/${encodeURIComponent(current.id)}`,
                          token,
                          undefined,
                          "DELETE",
                        );
                        await onChanged();
                        setSelected(map.checkpoints.find(q=>q.id!==current.id&&q.floor===current.floor)?.id??'');
                        setPendingDelete("");
                        setLabel(null);
                      }, "saved")
                    }
                  >
                    {t("confirmDelete")}
                  </button>
                  <button onClick={() => setPendingDelete("")}>
                    {t("cancel")}
                  </button>
                </div>
              )}
              {label && label.checkpoint.id === selected && (
                <div className="qr-result">
                  <img
                    src={label.image}
                    alt={`${t("checkpoint")}: ${label.checkpoint.names[i18n.language] ?? label.checkpoint.locationName}`}
                  />
                  <p dir="ltr" className="qr-payload">
                    {label.payload}
                  </p>
                  <div className="qr-toolbar">
                    <button onClick={() => downloadQr(label, "png")}>
                      <Download size={18} />
                      {t("downloadPng")}
                    </button>
                    <button onClick={() => downloadQr(label, "svg")}>
                      <Download size={18} />
                      {t("downloadSvg")}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )
        )}
      </section>
    </div>
  );
}
