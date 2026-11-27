// V2 read model and owner-entered records. Notes and coaching text are private:
// they are never logged and only leave through the backup the owner downloads.
import { Router, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db/db.js";
import type { Config } from "../config.js";
import { endpoint, code, day, noteId } from "../api/request.js";
import {
  coachingSchema,
  followUpStates,
  privateNoteSchema,
  readSettings,
  saveSettings,
  settingsPatch,
  settingsSchema,
} from "./settings.js";
import { dashboardData } from "./data.js";
import { counts, homeView } from "./home.js";
import { gridView } from "./grid.js";
import { teamView } from "./team.js";
import { recentCycles } from "./cycle.js";
import { profileView } from "./profile.js";
import { coachingView, prepView } from "./coaching.js";
import { qualityView } from "./quality.js";
import {
  attendanceEmail,
  cycleSummary,
  eodReport,
  rosterReport,
} from "./reports.js";
import { statusMapView } from "./statusMap.js";
import { reportDay } from "./home.js";
import { shortName } from "./templates.js";
import { boardView } from "./board.js";
import {
  agentsOf,
  attendanceOf,
  discrepanciesOf,
  eventsOf,
} from "../db/repo.js";
import { attendanceLabel } from "../db/corrections.js";
import { labelOf } from "../parse/normalize.js";
import { refreshAttendanceRules } from "../rules/index.js";
import { dayFacts, waiverLabels } from "./facts.js";

export function v2Routes(db: Db, config: Config, today: () => string) {
  const router = Router();
  const own = (agent: string) =>
    !!db
      .prepare("SELECT 1 FROM agents WHERE code=? AND owner_group='mine'")
      .get(agent);
  const notFound = (res: Response, what: string) =>
    void res.status(404).json({ error: what + " not found" });
  const refuse = (res: Response, error: string) =>
    void res.status(400).json({ error });
  const idParams = z.strictObject({ id: noteId });
  const correctionParams = z.strictObject({ code, date: day });
  const recordedDay = (agent: string, date: string) =>
    own(agent) &&
    !!db
      .prepare("SELECT 1 FROM attendance_days WHERE code=? AND date=?")
      .get(agent, date);
  router.get(
    "/corrections",
    endpoint({}, (_input, _req, res) => {
      const names = new Map(
        agentsOf(db)
          .filter((agent) => agent.ownerGroup === "mine")
          .map((agent) => [agent.code, shortName(agent)]),
      );
      // No cycle cutoff: Settings lists every corrected or explained day.
      const rows = attendanceOf(db, { from: "1000-01-01", to: "9999-12-31" });
      res.json(
        rows
          .filter((row) => row.correction && names.has(row.code))
          .map((row) => ({
            ...row.correction!,
            code: row.code,
            name: names.get(row.code)!,
            date: row.date,
            used: row.raw || row.status,
            display: attendanceLabel(row),
            waiverDisplay: waiverLabels(
              dayFacts(
                row,
                JSON.parse(
                  (
                    db
                      .prepare(
                        "SELECT fields FROM attendance_paste_details WHERE code=? AND date=?",
                      )
                      .get(row.code, row.date) as { fields: string } | undefined
                  )?.fields ?? "{}",
                ),
                config.sources.attendance.paste?.breakExceededLabel ??
                  "Exceeded",
              ),
            ),
          }))
          .sort(
            (a, b) =>
              b.date.localeCompare(a.date) || a.name.localeCompare(b.name),
          ),
      );
    }),
  );
  router.put(
    "/corrections/:code/:date",
    endpoint(
      {
        params: correctionParams,
        body: z.strictObject({
          label: z.string().trim().min(1).max(200),
          note: z.string().trim().min(1).max(10000),
        }),
      },
      ({ params, body }, _req, res) => {
        if (!recordedDay(params.code, params.date))
          return notFound(res, "Recorded day in your team");
        const label = labelOf(body.label);
        if (
          !Object.hasOwn(config.statusMap, label) ||
          config.statusMap[label] === "Unknown"
        )
          return refuse(res, "Choose a known status label");
        db.transaction(() => {
          db.prepare(
            "INSERT INTO attendance_corrections VALUES (?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET label=excluded.label,status=excluded.status,note=excluded.note",
          ).run(
            params.code,
            params.date,
            label,
            config.statusMap[label],
            body.note,
          );
          refreshAttendanceRules(
            db,
            today(),
            config.sources.attendance.enabled,
          );
        })();
        res.sendStatus(204);
      },
    ),
  );
  router.delete(
    "/corrections/:code/:date",
    endpoint({ params: correctionParams }, ({ params }, _req, res) => {
      if (!recordedDay(params.code, params.date))
        return notFound(res, "Recorded day in your team");
      db.transaction(() => {
        db.prepare(
          "DELETE FROM attendance_corrections WHERE code=? AND date=?",
        ).run(params.code, params.date);
        refreshAttendanceRules(db, today(), config.sources.attendance.enabled);
      })();
      res.sendStatus(204);
    }),
  );
  /** Returns the row's agent code when the row exists and is on the team. */
  const owned = (table: string, id: number) => {
    const row = db.prepare(`SELECT code FROM ${table} WHERE id=?`).get(id) as
      { code: string } | undefined;
    return row && own(row.code) ? row.code : null;
  };

  router.get(
    "/data",
    endpoint(
      { query: z.strictObject({ cycle: day.optional() }) },
      ({ query }, _req, res) =>
        res.json(dashboardData(db, config, today(), query.cycle)),
    ),
  );
  const current = () => dashboardData(db, config, today());
  router.get(
    "/home",
    endpoint({}, (_input, _req, res) => res.json(homeView(current()))),
  );
  router.get(
    "/counts",
    endpoint({}, (_input, _req, res) => res.json(counts(current()))),
  );
  const cycleQuery = z.strictObject({ cycle: day.optional() });
  /** Data for a chosen cycle, with the list for the cycle switcher. */
  const forCycle = (cycle = today()) => {
    const data = dashboardData(db, config, today(), cycle);
    return {
      data,
      cycles: recentCycles(today(), data.settings.cycleStartDay, 6),
    };
  };
  router.get(
    "/grid",
    endpoint({ query: cycleQuery }, ({ query }, _req, res) => {
      const { data, cycles } = forCycle(query.cycle);
      res.json({ ...gridView(data), cycles });
    }),
  );
  router.get(
    "/team",
    endpoint({ query: cycleQuery }, ({ query }, _req, res) => {
      const { data, cycles } = forCycle(query.cycle);
      const previous = dashboardData(db, config, today(), data.prior.from);
      res.json({ ...teamView(data, previous), cycles });
    }),
  );
  router.get(
    "/agents/:code",
    endpoint(
      { params: z.strictObject({ code }), query: cycleQuery },
      ({ params, query }, _req, res) => {
        const { data, cycles } = forCycle(query.cycle);
        const view = profileView(
          data,
          params.code,
          discrepanciesOf(db, "d.code=?", [params.code]),
        );
        if (!view) return notFound(res, "Agent in your team");
        res.json({ ...view, cycles });
      },
    ),
  );
  router.get(
    "/coaching",
    endpoint({}, (_input, _req, res) => res.json(coachingView(current()))),
  );
  router.get(
    "/coaching/prep/:code",
    endpoint(
      { params: z.strictObject({ code }), query: cycleQuery },
      ({ params, query }, _req, res) => {
        const view = prepView(forCycle(query.cycle).data, params.code);
        if (!view) return notFound(res, "Agent in your team");
        res.json(view);
      },
    ),
  );
  router.get(
    "/quality",
    endpoint({}, (_input, _req, res) => res.json(qualityView(current()))),
  );
  router.get(
    "/queues",
    endpoint({}, (_input, _req, res) => res.json(boardView(current()))),
  );
  router.get(
    "/reports",
    endpoint(
      {
        query: z.strictObject({ cycle: day.optional(), date: day.optional() }),
      },
      ({ query }, _req, res) => {
        const { data, cycles } = forCycle(query.date ?? query.cycle);
        // The latest reported day inside the chosen cycle.
        const latest = reportDay(data);
        const date =
          query.date ??
          (latest < data.cycle.from
            ? data.cycle.from
            : latest > data.cycle.to
              ? data.cycle.to
              : latest);
        res.json({
          today: data.today,
          cycle: { from: data.cycle.from, to: data.cycle.to },
          cycles,
          eod: eodReport(data, date),
          email: attendanceEmail(data, date),
          summary: cycleSummary(data),
          roster: rosterReport(data, eventsOf(db, data.cycle.from)),
          agents: data.agents
            .filter((agent) => agent.active)
            .map((agent) => ({ code: agent.code, name: shortName(agent) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      },
    ),
  );
  router.get(
    "/status-map",
    endpoint({}, (_input, _req, res) => res.json(statusMapView(db, config))),
  );
  router.get(
    "/settings",
    endpoint({}, (_input, _req, res) =>
      res.json(readSettings(db, config.coachingCycleStartDay)),
    ),
  );
  router.patch(
    "/settings",
    endpoint({ body: settingsPatch }, ({ body }, _req, res) => {
      const next = settingsSchema.parse({
        ...readSettings(db, config.coachingCycleStartDay),
        ...body,
      });
      saveSettings(db, next);
      res.json(next);
    }),
  );

  router.post(
    "/coachings",
    endpoint({ body: coachingSchema }, ({ body }, _req, res) => {
      if (!own(body.code)) return notFound(res, "Agent in your team");
      if (body.date > today())
        return refuse(res, "Coaching date cannot be in the future");
      const agent = dashboardData(db, config, today(), body.date).agents.find(
        (row) => row.code === body.code,
      )!;
      const recorded = db
        .prepare("SELECT date FROM attendance_days WHERE code=?")
        .pluck()
        .all(body.code) as string[];
      const allowed = new Set([
        ...agent.flags.map((flag) => flag.id),
        ...recorded.map((date) => body.code + "|" + date),
      ]);
      if (body.evidence.some((id) => !allowed.has(id)))
        return refuse(
          res,
          "Linked evidence must belong to this agent's recorded facts",
        );
      const id = db.transaction(() => {
        const result = db
          .prepare(
            "INSERT INTO coachings(code,date,type,reasons,evidence,what_happened,what_was_said,next_step,acknowledged,measure,target,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            body.code,
            body.date,
            body.type,
            JSON.stringify(body.reasons),
            JSON.stringify(body.evidence),
            body.whatHappened,
            body.whatWasSaid,
            body.nextStep,
            Number(body.acknowledged),
            body.measure,
            body.target,
            new Date().toISOString(),
          );
        if (body.followUpDate)
          db.prepare(
            "INSERT INTO coaching_followups(coaching_id,code,date) VALUES (?,?,?)",
          ).run(result.lastInsertRowid, body.code, body.followUpDate);
        return Number(result.lastInsertRowid);
      })();
      res.status(201).json({ id });
    }),
  );
  router.patch(
    "/followups/:id",
    endpoint(
      {
        params: idParams,
        body: z.strictObject({ state: z.enum(followUpStates) }),
      },
      ({ params, body }, _req, res) => {
        if (!owned("coaching_followups", params.id))
          return notFound(res, "Follow-up");
        db.prepare("UPDATE coaching_followups SET state=? WHERE id=?").run(
          body.state,
          params.id,
        );
        res.sendStatus(204);
      },
    ),
  );

  const noteBody = privateNoteSchema.extend({ code });
  router.post(
    "/notes",
    endpoint({ body: noteBody }, ({ body }, _req, res) => {
      if (!own(body.code)) return notFound(res, "Agent in your team");
      const now = new Date().toISOString();
      const result = db
        .prepare(
          "INSERT INTO private_notes(code,date,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          body.code,
          body.date,
          body.body,
          JSON.stringify(body.tags),
          now,
          now,
        );
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    }),
  );
  router.patch(
    "/notes/:id",
    endpoint(
      { params: idParams, body: privateNoteSchema },
      ({ params, body }, _req, res) => {
        if (!owned("private_notes", params.id)) return notFound(res, "Note");
        db.prepare(
          "UPDATE private_notes SET date=?,body=?,tags=?,updated_at=? WHERE id=?",
        ).run(
          body.date,
          body.body,
          JSON.stringify(body.tags),
          new Date().toISOString(),
          params.id,
        );
        res.sendStatus(204);
      },
    ),
  );
  router.delete(
    "/notes/:id",
    endpoint({ params: idParams }, ({ params }, _req, res) => {
      if (!owned("private_notes", params.id)) return notFound(res, "Note");
      db.prepare("DELETE FROM private_notes WHERE id=?").run(params.id);
      res.sendStatus(204);
    }),
  );

  router.post(
    "/flags/dismiss",
    endpoint(
      {
        body: z.strictObject({
          id: z.string().min(1).max(300),
          token: z.string().regex(/^[a-f0-9]{64}$/),
          reason: z.string().trim().min(1).max(2000),
        }),
      },
      ({ body }, _req, res) => {
        const flag = dashboardData(db, config, today()).flags.find(
          (row) => row.id === body.id && row.token === body.token,
        );
        if (!flag) {
          res
            .status(409)
            .json({ error: "Flag changed. Refresh before dismissing." });
          return;
        }
        db.prepare(
          "INSERT INTO flag_dismissals(id,facts,reason,dismissed_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET facts=excluded.facts,reason=excluded.reason,dismissed_at=excluded.dismissed_at",
        ).run(
          flag.id,
          JSON.stringify(flag.facts),
          body.reason,
          new Date().toISOString(),
        );
        res.sendStatus(204);
      },
    ),
  );
  return router;
}
