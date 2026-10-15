"use strict";

// Hero Family: gentle reminders when a task is still unchecked
//   - before leaving for school (school days, from 06:45 until a few minutes after school starts)
//   - before bed (every day, from 20:30)
// Two outputs, both read-only with respect to tasks (nothing is ever completed or changed here):
//   1) GET /api/family/nudge?assignee=yaman  -> the child's app shows one calm banner while it is open
//   2) optional WhatsApp summary to the parents (needs NUDGE_WHATSAPP_TO plus the Twilio variables of bedtime-whatsapp.js)
//
// Railway variables (all optional):
//   NUDGE_BED_TIME         default 20:30
//   NUDGE_LEAVE_TIME       default 06:45
//   NUDGE_LEAVE_GRACE_MIN  minutes after school start during which the "leaving" nudge stays, default 20
//   NUDGE_OFF              "1" turns everything here off
//   NUDGE_WHATSAPP_TO      parents' phone, e.g. 0585558077 (WhatsApp summary is off without it)
//   BEDTIME_DRY_RUN       "1" logs the WhatsApp text instead of sending it

const { normalizeWhatsAppNumber, parseSendTime, localClock, sendViaTwilio } = require("./bedtime-whatsapp");

const CHECK_EVERY_MS = 30 * 1000;
const RETRY_BACKOFF_MS = 15 * 60 * 1000;
const SKIPPED_TYPES = ["prayer", "school"];

function nudgeConfig(env = process.env) {
  return {
    off: env.NUDGE_OFF === "1",
    bedAt: parseSendTime(env.NUDGE_BED_TIME, 20 * 60 + 30),
    leaveAt: parseSendTime(env.NUDGE_LEAVE_TIME, 6 * 60 + 45),
    leaveGrace: Math.max(0, Math.min(90, Number(env.NUDGE_LEAVE_GRACE_MIN) || 20)),
    bedEnd: 23 * 60 + 59
  };
}

function clockText(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Which check, if any, is active right now for this child? Pure function (easy to test).
function activeKind(clock, school, cfg) {
  const schoolStart = minutesOf(school?.start);
  const isSchoolDay = Array.isArray(school?.days) && school.days.includes(clock.weekday);
  if (isSchoolDay && schoolStart !== null && clock.minutes >= cfg.leaveAt && clock.minutes <= schoolStart + cfg.leaveGrace) {
    return { kind: "leave", cutoff: schoolStart, at: cfg.leaveAt };
  }
  if (clock.minutes >= cfg.bedAt && clock.minutes <= cfg.bedEnd) {
    return { kind: "bed", cutoff: cfg.bedAt, at: cfg.bedAt };
  }
  return null;
}

// Open tasks of the day that were already due at the cutoff time (tasks planned for later are not "missed").
async function openTasksDueBy(pool, member, dateKey, cutoffMinutes) {
  const { rows } = await pool.query(
    `SELECT id, title, suggested_time FROM hero_family_tasks
      WHERE assignee = $1 AND due_date = $2 AND done = FALSE AND task_type <> ALL($3::text[])
        AND (COALESCE(suggested_time, '') = '' OR suggested_time <= $4)
      ORDER BY COALESCE(NULLIF(suggested_time, ''), '99:99'), created_at`,
    [member, dateKey, SKIPPED_TYPES, clockText(cutoffMinutes)]
  );
  return rows.map((r) => ({ id: r.id, title: String(r.title || ""), time: r.suggested_time || "" }));
}

async function computeNudge({ pool, member, clock, school, cfg }) {
  const active = activeKind(clock, school, cfg);
  if (!active) return { kind: null, count: 0, tasks: [] };
  const open = await openTasksDueBy(pool, member, clock.dateKey, active.cutoff);
  return { kind: open.length ? active.kind : null, count: open.length, at: clockText(active.at), tasks: open.slice(0, 5).map((t) => ({ id: t.id, title: t.title })) };
}

function parentMessage(kind, perMember) {
  const head = kind === "leave" ? "⏰ قبل الخروج إلى المدرسة، مهام لم تُنجز بعد:" : "🌙 قبل النوم، مهام لم تُنجز بعد:";
  const lines = perMember.map(({ name, tasks, count }) => `• ${name}: ${tasks.map((t) => t.title).join("، ")}${count > tasks.length ? ` (+${count - tasks.length})` : ""}`);
  return [head, ...lines].join("\n");
}

function setupNudges(deps) {
  const { app, pool, timeZone, asyncRoute, isFamilyMember, requireChildOrParent, requireFamilyDatabase, ensureFamilyDatabase, ensureTodayProgram, getSchoolSettings, members } = deps;
  const cfg = nudgeConfig();
  if (cfg.off) return false;

  app.get("/api/family/nudge", asyncRoute(async (req, res) => {
    const member = String(req.query.assignee || "").toLowerCase();
    if (!isFamilyMember(member)) return res.status(400).json({ error: "منطقة الطفل غير معروفة." });
    requireChildOrParent(req, member);
    requireFamilyDatabase();
    await ensureFamilyDatabase();
    const clock = localClock(timeZone);
    if (!activeKind(clock, await getSchoolSettings(member), cfg)) return res.json({ kind: null, count: 0, tasks: [] });
    await ensureTodayProgram(member, clock.dateKey);
    const school = await getSchoolSettings(member);
    res.set("Cache-Control", "no-store");
    res.json(await computeNudge({ pool, member, clock, school, cfg }));
  }));

  startParentWhatsApp({ pool, timeZone, cfg, getSchoolSettings, members });
  console.log(`[task-nudges] enabled: leave ${clockText(cfg.leaveAt)} (school days), bed ${clockText(cfg.bedAt)}`);
  return true;
}

function startParentWhatsApp({ pool, timeZone, cfg, getSchoolSettings, members }) {
  const to = normalizeWhatsAppNumber(process.env.NUDGE_WHATSAPP_TO);
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_FROM);
  const dryRun = process.env.BEDTIME_DRY_RUN === "1";
  if (!pool || !to || (!dryRun && !(sid && token && from))) return false;

  const retryNotBefore = {};
  let busy = false;

  async function claim(kind, dateKey) {
    const k = `nudge_wa_${kind}_last_sent`;
    await pool.query(`CREATE TABLE IF NOT EXISTS hero_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows: before } = await pool.query(`SELECT v FROM hero_kv WHERE k = $1`, [k]);
    const previous = before[0]?.v || "";
    const { rows } = await pool.query(
      `INSERT INTO hero_kv (k, v) VALUES ($1, $2)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW() WHERE hero_kv.v <> EXCLUDED.v RETURNING v`,
      [k, dateKey]
    );
    return rows.length ? { k, previous } : null;
  }

  async function release(info) {
    if (info.previous) await pool.query(`UPDATE hero_kv SET v = $2, updated_at = NOW() WHERE k = $1`, [info.k, info.previous]);
    else await pool.query(`DELETE FROM hero_kv WHERE k = $1`, [info.k]);
  }

  async function runKind(kind, clock) {
    if (Date.now() < (retryNotBefore[kind] || 0)) return;
    // Send once, a little after the check time (so the child had the full lead time), never long after.
    // The child's banner appears at the check time; parents get the summary 5 minutes later.
    const sendAt = (kind === "leave" ? cfg.leaveAt : cfg.bedAt) + 5;
    if (clock.minutes < sendAt || clock.minutes > sendAt + (kind === "leave" ? 10 : 60)) return;
    const perMember = [];
    for (const id of Object.keys(members)) {
      const school = await getSchoolSettings(id);
      const active = activeKind(clock, school, cfg);
      if (!active || active.kind !== kind) continue;
      const open = await openTasksDueBy(pool, id, clock.dateKey, active.cutoff);
      if (open.length) perMember.push({ name: members[id].name, count: open.length, tasks: open.slice(0, 4) });
    }
    if (!perMember.length) return; // everything is checked: say nothing
    const info = await claim(kind, clock.dateKey);
    if (!info) return; // already sent today
    const text = parentMessage(kind, perMember);
    try {
      if (dryRun) console.log(`[task-nudges] dry run, would send ${kind}:\n${text}`);
      else await sendViaTwilio({ to, from, sid, token, text });
      console.log(`[task-nudges] ${kind} summary sent for ${clock.dateKey}`);
    } catch (error) {
      console.warn(`[task-nudges] ${kind} summary failed, will retry:`, error.message);
      retryNotBefore[kind] = Date.now() + RETRY_BACKOFF_MS;
      await release(info).catch(() => {});
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const clock = localClock(timeZone);
      for (const kind of ["leave", "bed"]) {
        try { await runKind(kind, clock); } catch (error) { console.warn(`[task-nudges] ${kind} check failed:`, error.message); }
      }
    } finally {
      busy = false;
    }
  }
  setInterval(tick, CHECK_EVERY_MS).unref();
  console.log("[task-nudges] parent WhatsApp summary enabled");
  return true;
}

module.exports = { setupNudges, nudgeConfig, activeKind, computeNudge, parentMessage, openTasksDueBy };
