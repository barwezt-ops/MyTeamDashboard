import { useRef, useState } from "react";
import type { AttendancePreview as Preview } from "../../../server/src/sync/attendancePreview";
import { api, message } from "../api";
import { ErrorNotice, Section } from "../components/ui";

export function AttendancePreview({ allowUpload }: { allowUpload: boolean }) {
  const [result, setResult] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    setUploading(true);
    setUploaded(false);
    setError("");
    setResult(undefined);
    try {
      await api("/attendance/upload", "POST", file);
      setUploaded(true);
    } catch (error) {
      setError(message(error));
    } finally {
      setUploading(false);
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await api<Preview>("/sync/attendance-preview", "POST"));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Attendance dry run">
      <div className="panel-body source-details" aria-live="polite">
        <div className="button-row">
          <button
            className="secondary"
            disabled={busy || uploading}
            onClick={() => void run()}
          >
            {busy ? "Reading attendance…" : "Dry-run attendance"}
          </button>
          {allowUpload && (
            <>
              <input
                hidden
                type="file"
                accept=".csv,text/csv"
                ref={input}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void upload(file);
                }}
              />
              <button
                className="secondary"
                disabled={busy || uploading}
                onClick={() => input.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload attendance CSV"}
              </button>
            </>
          )}
        </div>
        {uploaded && <p>CSV added to the attendance inbox.</p>}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {result && (
          <>
            <p>Preview based on the current roster and schedule.</p>
            <dl>
              <div>
                <dt>Layout</dt>
                <dd>{result.layout}</dd>
              </div>
              <div>
                <dt>Source rows</dt>
                <dd>{result.dataRows}</dd>
              </div>
              <div>
                <dt>Matched team rows</dt>
                <dd>{result.matchedRows}</dd>
              </div>
              <div>
                <dt>Unmatched team rows</dt>
                <dd>
                  {result.layout === "wide"
                    ? result.unmatchedTeamRows
                    : "Unavailable by code"}
                </dd>
              </div>
              <div>
                <dt>Other keyed rows</dt>
                <dd>{result.otherRows}</dd>
              </div>
              <div>
                <dt>Team rows with an invalid date</dt>
                <dd>{result.invalidDateRows}</dd>
              </div>
              <div>
                <dt>Records that would be stored</dt>
                <dd>{result.records}</dd>
              </div>
              <div>
                <dt>Date range</dt>
                <dd>
                  {result.dateRange
                    ? result.dateRange.from + " to " + result.dateRange.to
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Sample statuses</dt>
                <dd>{result.sampleStatuses.join(", ") || "None"}</dd>
              </div>
              <div>
                <dt>Discrepancies by rule</dt>
                <dd>
                  {Object.entries(result.findingsByRule)
                    .map(([rule, count]) => rule + " " + count)
                    .join(", ")}
                </dd>
              </div>
              {result.flaggedFirstNames && (
                <div>
                  <dt>Flagged first names</dt>
                  <dd>{result.flaggedFirstNames.join(", ") || "None"}</dd>
                </div>
              )}
            </dl>
            {!!result.warnings.length && (
              <ul className="warnings">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
