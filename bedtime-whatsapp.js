"use strict";

// Hero Family: daily WhatsApp messages for Yaman (via Twilio WhatsApp API):
//   - morning message before school (school days, Sunday to Thursday, default 06:30)
//   - bedtime message (every day, default 20:00)
// Self-contained and OFF by default: nothing runs unless the Railway variables below are set.
// It adds no dependencies, touches no existing route, and only uses the hero_kv table
// (already created by the app) to remember the last day each message was sent.
//
// Railway variables:
//   BEDTIME_WHATSAPP_TO       recipient phone, e.g. 0515800799 (never commit it to the repo)
//   TWILIO_ACCOUNT_SID        Twilio account SID
//   TWILIO_AUTH_TOKEN         Twilio auth token
//   TWILIO_WHATSAPP_FROM      sender, e.g. whatsapp:+14155238886 (Twilio sandbox or approved sender)
//   TWILIO_CONTENT_SID        optional: approved WhatsApp template SID for the bedtime message
//   TWILIO_CONTENT_SID_MORNING optional: approved template SID for the morning message
//   BEDTIME_SEND_TIME         optional, default 20:00 (24h, in APP_TIME_ZONE)
//   MORNING_SEND_TIME         optional, default 06:30
//   MORNING_SEND_DAYS         optional, default 0,1,2,3,4 (0 = Sunday ... 6 = Saturday)
//   MORNING_MESSAGE_OFF       optional, "1" turns the morning message off
//   BEDTIME_DRY_RUN           optional, "1" logs the messages instead of sending them

const CHECK_EVERY_MS = 30 * 1000;
const RETRY_BACKOFF_MS = 15 * 60 * 1000;

const BEDTIME_MESSAGE = [
  "مساء الخير يا يمان 🌙",
  "حان وقت النوم. الآن:",
  "١. أقول: سبحان الله، الحمد لله، الله أكبر.",
  "٢. أقرأ صفحة من القرآن.",
  "٣. أنام.",
  "",
  "أحسنت اليوم. تصبح على خير."
].join("\n");

const MORNING_MESSAGE = [
  "صباح الخير يا يمان 🌟",
  "اليوم في المدرسة:",
  "١. أجلس في مكاني وأسمع المعلم.",
  "٢. أنهي مهمة واحدة في كل حصة.",
  "٣. إذا احتجت مساعدة، أرفع يدي.",
  "",
  "أنا فخور بك.",
  "بعد المدرسة أخبرني عن شيء واحد أعجبك اليوم."
].join("\n");

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function normalizeWhatsAppNumber(raw) {
  const digits = String(raw || "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return `whatsapp:${digits}`;
  if (digits.startsWith("00")) return `whatsapp:+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `whatsapp:+972${digits.slice(1)}`; // Israeli local format
  return `whatsapp:+${digits}`;
}

function parseSendTime(value, fallbackMinutes) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallbackMinutes;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : fallbackMinutes;
}

function parseDays(value, fallback) {
  const days = String(value || "").split(",").map((d) => d.trim()).filter(Boolean).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return days.length ? days : fallback;
}

function localClock(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0
  };
}

async function sendViaTwilio({ to, from, sid, token, contentSid, text }) {
  const body = new URLSearchParams({ To: to, From: from });
  if (contentSid) body.set("ContentSid", contentSid);
  else body.set("Body", text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`Twilio ${response.status}: ${detail.message || "request failed"}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function fmt(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function startBedtimeWhatsApp({ pool, timeZone }) {
  const to = normalizeWhatsAppNumber(process.env.BEDTIME_WHATSAPP_TO);
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_FROM);
  const dryRun = process.env.BEDTIME_DRY_RUN === "1";
  if (!to || (!dryRun && !(sid && token && from))) return false; // not configured: do nothing

  const schedules = [
    {
      name: "bedtime",
      kvKey: "bedtime_whatsapp_last_sent",
      text: BEDTIME_MESSAGE,
      contentSid: process.env.TWILIO_CONTENT_SID,
      sendAt: parseSendTime(process.env.BEDTIME_SEND_TIME, 20 * 60),
      catchUpMinutes: 120, // if the server was down at send time, still send within 2 hours
      days: [0, 1, 2, 3, 4, 5, 6]
    }
  ];
  if (process.env.MORNING_MESSAGE_OFF !== "1") {
    schedules.push({
      name: "morning",
      kvKey: "morning_whatsapp_last_sent",
      text: MORNING_MESSAGE,
      contentSid: process.env.TWILIO_CONTENT_SID_MORNING,
      sendAt: parseSendTime(process.env.MORNING_SEND_TIME, 6 * 60 + 30),
      catchUpMinutes: 30, // a late morning message is no use once school has started
      days: parseDays(process.env.MORNING_SEND_DAYS, [0, 1, 2, 3, 4]) // Israeli school days: Sunday to Thursday
    });
  }

  const memoryLastSent = {};
  const retryNotBefore = {};
  let busy = false;

  // Claim today's slot atomically so two server instances can never both send.
  async function claim(schedule, dateKey) {
    if (!pool) {
      if (memoryLastSent[schedule.name] === dateKey) return null;
      const previous = memoryLastSent[schedule.name] || "";
      memoryLastSent[schedule.name] = dateKey;
      return { previous };
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS hero_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows: before } = await pool.query(`SELECT v FROM hero_kv WHERE k = $1`, [schedule.kvKey]);
    const previous = before[0]?.v || "";
    const { rows } = await pool.query(
      `INSERT INTO hero_kv (k, v) VALUES ($1, $2)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW() WHERE hero_kv.v <> EXCLUDED.v
       RETURNING v`,
      [schedule.kvKey, dateKey]
    );
    return rows.length ? { previous } : null;
  }

  async function release(schedule, claimInfo) {
    if (!pool) { memoryLastSent[schedule.name] = claimInfo.previous; return; }
    if (claimInfo.previous) await pool.query(`UPDATE hero_kv SET v = $2, updated_at = NOW() WHERE k = $1`, [schedule.kvKey, claimInfo.previous]);
    else await pool.query(`DELETE FROM hero_kv WHERE k = $1`, [schedule.kvKey]);
  }

  async function runSchedule(schedule, clock) {
    if (Date.now() < (retryNotBefore[schedule.name] || 0)) return;
    if (!schedule.days.includes(clock.weekday)) return;
    if (clock.minutes < schedule.sendAt || clock.minutes > schedule.sendAt + schedule.catchUpMinutes) return;
    const claimInfo = await claim(schedule, clock.dateKey);
    if (!claimInfo) return; // already sent today
    try {
      if (dryRun) console.log(`[whatsapp-messages] dry run, would send ${schedule.name}:\n${schedule.text}`);
      else await sendViaTwilio({ to, from, sid, token, contentSid: schedule.contentSid, text: schedule.text });
      console.log(`[whatsapp-messages] ${schedule.name} sent for ${clock.dateKey}`);
    } catch (error) {
      console.warn(`[whatsapp-messages] ${schedule.name} failed, will retry:`, error.message);
      retryNotBefore[schedule.name] = Date.now() + RETRY_BACKOFF_MS;
      await release(schedule, claimInfo).catch(() => {});
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const clock = localClock(timeZone);
      for (const schedule of schedules) {
        try { await runSchedule(schedule, clock); }
        catch (error) { console.warn(`[whatsapp-messages] ${schedule.name} check failed:`, error.message); }
      }
    } finally {
      busy = false;
    }
  }

  setInterval(tick, CHECK_EVERY_MS).unref();
  setTimeout(tick, 20000).unref();
  // Keep the original log prefix on the first line so existing log filters still match.
  console.log(`[bedtime-whatsapp] enabled, daily at ${fmt(schedules[0].sendAt)} (${timeZone})${dryRun ? " [dry run]" : ""}`);
  if (schedules[1]) console.log(`[bedtime-whatsapp] morning message enabled at ${fmt(schedules[1].sendAt)} on days ${schedules[1].days.join(",")}`);
  return true;
}

module.exports = { startBedtimeWhatsApp, normalizeWhatsAppNumber, parseSendTime, parseDays, BEDTIME_MESSAGE, MORNING_MESSAGE };
