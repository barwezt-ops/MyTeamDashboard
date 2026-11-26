import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Eyebrow,
  HeatCell,
  HeatLegend,
  InkHero,
  KpiTile,
  Modal,
  ProgressRing,
  SegmentedControl,
  Severity,
  Summary,
  Toast,
  UrgentStrip,
  heatStatuses,
} from "../components/design";
import {
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Pill,
  Section,
} from "../components/ui";

const people = [
  { name: "Avery Sample", code: "99001" },
  { name: "Jordan Sample", code: "99002" },
  { name: "Riley Sample", code: "99005" },
  { name: "Drew Sample", code: "99008" },
];
export function Styleguide() {
  const [period, setPeriod] = useState("Yesterday");
  const [state, setState] = useState("Ready");
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState(false);
  const closeToast = useCallback(() => setToast(false), []);
  return (
    <>
      <PageHeader
        title="A calmer kind of clarity."
        description="Floor / Design system · Phase 1 · All examples below use synthetic data."
      >
        <button className="primary" onClick={() => setDrawer(true)}>
          Open sample drawer
        </button>
      </PageHeader>
      <div className="design-intro">
        <Eyebrow>The essentials</Eyebrow>
        <Summary>Paper, ink, and a little room to think.</Summary>
        <p>Yesterday's results. Today's plan. Every number has a time frame.</p>
      </div>
      <UrgentStrip count={1}>
        <span>
          Avery Sample · 4 lateness incidents this cycle · sample flag at 3
        </span>
        <button className="urgent-action" onClick={() => setDrawer(true)}>
          Review sample
        </button>
      </UrgentStrip>
      <div className="design-metrics">
        <InkHero count={3} total={4} avatars={people}>
          1 off · 0 on leave · synthetic schedule
        </InkHero>
        <div className="design-kpis">
          <KpiTile
            label="Late yesterday"
            value="3"
            delta="▲ 1 vs cycle avg"
            subline="62 min across the team"
            values={[2, 1, 3, 2, 1, 2, 3]}
            tone="warn"
          />
          <KpiTile
            label="Missing time yesterday"
            value="1h 34m"
            delta="▲ 2× cycle avg"
            subline="2 sample agents"
            values={[40, 35, 52, 30, 45, 48, 94]}
            tone="bad"
          />
          <KpiTile
            label="Break exceeds yesterday"
            value="4"
            delta="— vs cycle avg"
            subline="4 incidents yesterday"
            values={[3, 5, 4, 2, 4, 5, 4]}
          />
          <KpiTile
            label="QA average · cycle"
            value="92.4%"
            delta="▲ 1.2 vs last cycle"
            subline="Last cycle 91.2% · synthetic"
            values={[90, 91, 90, 92, 91, 92, 92.4]}
            tone="good"
          />
        </div>
        <section className="panel coaching-sample" aria-label="Coaching KPI">
          <Eyebrow>Coaching KPI</Eyebrow>
          <ProgressRing done={9} total={32} expected={11} />
          <p>
            <strong className="tone-warn semantic">2 behind pace</strong> · 7
            agents at 0
          </p>
          <small>Gold tick = expected pace today</small>
        </section>
      </div>
      <div className="design-grid">
        <Section
          title="People & priorities"
          number="01"
          action={<span className="muted">Sample components</span>}
        >
          <div className="sample-body">
            {(["URGENT", "SOON", "LATER"] as const).map((level, i) => (
              <div
                key={level}
                className={`sample-person ${i === 0 ? "highlight" : ""}`}
              >
                <Avatar {...people[i]} />
                <div>
                  <strong>{people[i].name}</strong> <Severity level={level} />
                  <p>
                    {
                      [
                        "4 lateness incidents this cycle",
                        "Follow-up due today",
                        "Attendance record available",
                      ][i]
                    }
                  </p>
                  <small>
                    {
                      [
                        "Flag at 3 · 38 min total · synthetic",
                        "From a sample coaching conversation",
                        "Facts only, no composite score",
                      ][i]
                    }
                  </small>
                </div>
                <button
                  className={i === 0 ? "danger" : "secondary"}
                  onClick={() => setDrawer(true)}
                >
                  View
                </button>
              </div>
            ))}
            <div className="sample-pills">
              <Pill status="Present" />
              <Pill status="Off Day" />
              <Pill status="PTO" />
              <Pill status="Sick" />
              <Pill status="Absent" />
              <Pill status="Scheduled" shift="15:45" />
            </div>
          </div>
        </Section>
        <Section title="A week, at a glance" number="02">
          <div className="sample-body">
            <Summary>Every status has a name, too.</Summary>
            <div className="sample-heatmap">
              <div className="heatmap-row">
                <span>Sample agent</span>
                {["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"].map((d) => (
                  <small key={d}>{d}</small>
                ))}
              </div>
              {people.map((person, i) => (
                <div className="heatmap-row" key={person.code}>
                  <span>{person.name}</span>
                  {heatStatuses.map((_, j) => (
                    <HeatCell
                      key={j}
                      status={heatStatuses[(i + j) % heatStatuses.length]}
                    />
                  ))}
                </div>
              ))}
            </div>
            <HeatLegend />
          </div>
        </Section>
      </div>
      <Section
        title="Yesterday, in sample rows"
        number="03"
        action={
          <SegmentedControl
            label="Sample time frame"
            value={period}
            options={["Yesterday", "Cycle"]}
            onChange={setPeriod}
          />
        }
      >
        <DataTable label="Synthetic exceptions">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Code</th>
              <th>Queue</th>
              <th>Status</th>
              <th className="numeric">
                {period === "Yesterday" ? "Late yesterday" : "Late this cycle"}
              </th>
              <th className="numeric">Missing</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, i) => (
              <tr key={person.code}>
                <td>
                  <span className="table-person">
                    <Avatar {...person} />
                    {person.name}
                  </span>
                </td>
                <td className="mono">{person.code}</td>
                <td>Sample inbound</td>
                <td>
                  <Pill status="Present" />
                </td>
                <td className="numeric mono">
                  {period === "Yesterday" ? i * 4 : i * 12}m
                </td>
                <td className="numeric mono">—</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>
      <div className="design-grid">
        <Section title="Controls, with intent" number="04">
          <div className="sample-body">
            <Eyebrow>Buttons & feedback</Eyebrow>
            <div className="button-row">
              <button className="primary" onClick={() => setDrawer(true)}>
                Primary action
              </button>
              <button className="secondary" onClick={() => setToast(true)}>
                Show toast
              </button>
              <button className="danger" onClick={() => setToast(true)}>
                Danger action
              </button>
              <button className="secondary" disabled>
                Unavailable
              </button>
            </div>
            <p className="muted">
              Ctrl K opens search. Escape closes dialogs. Tab stays inside them.
            </p>
            <Link className="text-button" to="/quality">
              View the Quality empty state →
            </Link>
          </div>
        </Section>
        <Section
          title="Always say what's happening"
          number="05"
          action={
            <SegmentedControl
              label="Panel state"
              value={state}
              options={["Ready", "Empty", "Loading", "Error"]}
              onChange={setState}
            />
          }
        >
          <div className="state-sample">
            {state === "Ready" ? (
              <Empty>Ready. Sample rows are shown above.</Empty>
            ) : state === "Empty" ? (
              <Empty>
                No evaluations yet. Connect a QA source in Settings.
              </Empty>
            ) : state === "Loading" ? (
              <Loading />
            ) : (
              <ErrorNotice retry={() => setState("Ready")}>
                Sample connection interrupted. Your saved data is safe.
              </ErrorNotice>
            )}
          </div>
        </Section>
      </div>
      <Section title="The palette" number="06">
        <div className="swatches">
          {[
            "paper",
            "surface",
            "surface-2",
            "line",
            "ink",
            "muted",
            "faint",
            "forest",
            "accent",
            "gold",
            "good",
            "warn",
            "bad",
            "info",
          ].map((token) => (
            <div key={token}>
              <span style={{ background: `var(--${token})` }} />
              <code>{token}</code>
            </div>
          ))}
        </div>
        <div className="panel-body">
          <p className="muted">
            The original faint token is decorative. Small labels use muted ink
            to meet 4.5:1 contrast.
          </p>
        </div>
      </Section>
      {drawer && (
        <Modal
          title="Sample agent details"
          close={() => setDrawer(false)}
          drawer
        >
          <div className="sample-body">
            <Avatar {...people[0]} />
            <h2>Avery Sample</h2>
            <p className="mono">99001 · Sample inbound</p>
            <Severity level="URGENT" />
            <Summary>4 lateness incidents this cycle.</Summary>
            <p>
              38 minutes in total. Latest incident: 16 minutes yesterday.
              Synthetic facts for design review.
            </p>
            <button
              className="primary"
              onClick={() => {
                setDrawer(false);
                setToast(true);
              }}
            >
              Done reviewing
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <Toast close={closeToast}>
          Sample action complete. No data was changed.
        </Toast>
      )}
    </>
  );
}
