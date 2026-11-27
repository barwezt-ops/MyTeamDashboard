import { useState, type FormEvent } from "react";
import type {
  Correction,
  CorrectionListRow,
} from "../../../server/src/db/corrections";
import { statusLabel } from "../../../server/src/db/corrections";
import type { StatusMapView } from "../../../server/src/v2/statusMap";
import { fullDate } from "../../../server/src/v2/templates";
import { api } from "../api";
import { DataTable, Empty, ErrorNotice, Section } from "../components/ui";
import { useView } from "./context";
import { useSave } from "./dialogs";

const path = (code: string, date: string) =>
  `/v2/corrections/${encodeURIComponent(code)}/${date}`;

export function CorrectStatus({
  code,
  date,
  correction,
  done,
}: {
  code: string;
  date: string;
  correction: Correction | null;
  done: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(correction?.label ?? "");
  const [note, setNote] = useState(
    correction?.source === "app" ? correction.note : "",
  );
  const statuses = useView<StatusMapView>("/v2/status-map");
  const { save, busy, error } = useSave();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      await save(
        () => api(path(code, date), "PUT", { label, note }),
        "Status corrected.",
      )
    )
      done();
  }
  return (
    <div className="correction-form">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {editing ? (
        <form className="record-form" onSubmit={submit}>
          <label>
            Correct status
            <select
              aria-label="Correct status"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            >
              <option value="">Choose status</option>
              {statuses.data?.entries
                .filter(([, status]) => status !== "Unknown")
                .map(([value]) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
            </select>
          </label>
          {statuses.error && (
            <ErrorNotice retry={statuses.reload}>{statuses.error}</ErrorNotice>
          )}
          <label>
            Correction note
            <textarea
              required
              maxLength={10000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="quiet">
            Saved locally. Sync keeps your correction. Undo returns to the
            sheet.
          </p>
          <div className="button-row">
            <button className="primary" disabled={busy}>
              Save correction
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="secondary"
          onClick={() => setEditing(true)}
        >
          Correct status
        </button>
      )}
      {correction?.source === "app" && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            void save(
              () => api(path(code, date), "DELETE"),
              "Correction undone; using the sheet.",
            ).then((saved) => {
              if (saved) done();
            })
          }
        >
          Undo correction
        </button>
      )}
    </div>
  );
}

export function Corrections() {
  const result = useView<CorrectionListRow[]>("/v2/corrections");
  const { save, busy, error } = useSave();
  return (
    <Section title="Corrections">
      <p className="panel-body quiet">
        Every corrected or explained day. Comments and notes stay local and are
        excluded from exports and backups.
      </p>
      {(result.error || error) && (
        <ErrorNotice retry={result.reload}>{result.error || error}</ErrorNotice>
      )}
      {result.data?.length ? (
        <DataTable label="Corrections">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Date</th>
              <th>WFM → used status</th>
              <th>Source</th>
              <th>Note</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((row) => (
              <tr key={row.code + row.date}>
                <td>{row.name}</td>
                <td>{fullDate(row.date)}</td>
                <td>
                  {row.display}
                  {row.warning && (
                    <small className="correction-note">{row.warning}</small>
                  )}
                </td>
                <td>{row.source}</td>
                <td>{row.note}</td>
                <td>
                  {row.source === "app" && (
                    <button
                      type="button"
                      className="secondary small"
                      disabled={busy}
                      onClick={() =>
                        void save(
                          () => api(path(row.code, row.date), "DELETE"),
                          "Correction undone.",
                        )
                      }
                    >
                      Undo correction
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <Empty>
          {result.data
            ? "No corrected or explained days."
            : "Loading corrections…"}
        </Empty>
      )}
    </Section>
  );
}
