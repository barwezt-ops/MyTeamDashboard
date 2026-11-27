import type { StatusMapView } from "../../../server/src/v2/statusMap";
import { fullDate, plural } from "../../../server/src/v2/templates";
import {
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  Section,
} from "../components/ui";
import { useView } from "../v2/context";

/** Read-only. Labels seen in the data but not mapped come first. */
export function StatusMap() {
  const result = useView<StatusMapView>("/v2/status-map");
  const view = result.data;
  return (
    <Section
      title="Status map"
      action={
        <span className="panel-note">
          Read-only · edit statusMap in the config file
        </span>
      }
    >
      {!view ? (
        result.error ? (
          <ErrorNotice retry={result.reload}>{result.error}</ErrorNotice>
        ) : (
          <Loading />
        )
      ) : (
        <>
          <h3 className="panel-subhead">Seen but not mapped</h3>
          {view.unmapped.length ? (
            <DataTable label="Statuses seen but not mapped">
              <thead>
                <tr>
                  <th>Label in the sheet</th>
                  <th>Source</th>
                  <th className="numeric">Seen</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {view.unmapped.map((row) => (
                  <tr key={row.source + row.label} className="unmapped">
                    <td>
                      <span className="tag warn mono">{row.label}</span>
                    </td>
                    <td>{row.source}</td>
                    <td className="numeric mono">
                      {plural(
                        row.count,
                        row.source === "MTD" ? "agent" : "time",
                      )}
                    </td>
                    <td className="nowrap">{fullDate(row.last)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="panel-intro">
              Every status seen for your team is mapped.
            </p>
          )}
          <h3 className="panel-subhead">Mapped labels</h3>
          {view.entries.length ? (
            <DataTable label="Status map">
              <thead>
                <tr>
                  <th>Label in the sheet</th>
                  <th>Shown as</th>
                </tr>
              </thead>
              <tbody>
                {view.entries.map(([label, shown]) => (
                  <tr key={label}>
                    <td className="mono">{label}</td>
                    <td>{shown}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <Empty>No labels are mapped.</Empty>
          )}
        </>
      )}
    </Section>
  );
}
