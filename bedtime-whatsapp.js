"use strict";

// Hero Family: daily bedtime WhatsApp message for Yaman (via Twilio WhatsApp API).
// Self-contained and OFF by default: nothing runs unless the Railway variables below are set.
// It adds no dependencies, touches no existing route, and only uses the hero_kv table
// (already created by the app) to remember the last day a message was sent.
//
// Railway variables:
//   BEDTIME_WHATSAPP_TO     recipient phone, e.g. 0515800799 (never commit it to the repo)
//   TWILIO_ACCOUNT_SID      Twilio account SID
//   TWILIO_AUTH_TOKEN       Twilio auth token
//   TWILIO_WHATSAPP_FROM    sender, e.g. whatsapp:+14155238886 (Twilio sandbox or approved sender)
//   TWILIO_CONTENT_SID      optional: approved WhatsApp template SID (needed outside the 24h window)
//   BEDTIME_SEND_TIME       optional, default 20:00 (24h, in APP_TIME_ZONE)
//   BEDTIME_DRY_RUN         optional, "1" logs the message instead of sending it

const KV_KEY = "bedtime_whatsapp_last_sent";
const CHECK_EVERY_MS = 30 * 1000;
const CATCH_UP_MINUTES = 120; // if the server was down at send time, still send within 2 hours
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

function normalizeWhatsAppNumber(raw) {
  let digits = String(raw || "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return `whatsapp:${digits}`;
  if (digits.startsWith("00")) return `whatsapp:+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `whatsapp:+972${digits.slice(1)}`; // Israeli local format
  return `whatsapp:+${digits}`;
}

function parseSendTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "20:00").trim());
  const hour = match ? Number(match[1]) : 20;
  const minute = match ? Number(match[2]) : 0;
  return hour < 24 && minute < 60 ? hour * 60 + minute : 20 * 60;
}

function localClock(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

async function sendViaTwilio({ to, from, sid, token, contentSid }) {
  const body = new URLSearchParams({ To: to, From: from });
  if (contentSid) body.set("ContentSid", contentSid);
  else body.set("Body", BEDTIME_MESSAGE);
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

function startBedtimeWhatsApp({ pool, timeZone }) {
  const to = normalizeWhatsAppNumber(process.env.BEDTIME_WHATSAPP_TO);
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_FROM);
  const dryRun = process.env.BEDTIME_DRY_RUN === "1";
  if (!to || (!dryRun && !(sid && token && from))) return false; // not configured: do nothing

  const sendAt = parseSendTime(process.env.BEDTIME_SEND_TIME);
  let memoryLastSent = "";
  let retryNotBefore = 0;
  let busy = false;

  // Claim today's slot atomically so two server instances can never both send.
  async function claim(dateKey) {
    if (!pool) {
      if (memoryLastSent === dateKey) return null;
      const previous = memoryLastSent;
      memoryLastSent = dateKey;
      return { previous };
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS hero_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows: before } = await pool.query(`SELECT v FROM hero_kv WHERE k = $1`, [KV_KEY]);
    const previous = before[0]?.v || "";
    const { rows } = await pool.query(
      `INSERT INTO hero_kv (k, v) VALUES ($1, $2)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW() WHERE hero_kv.v <> EXCLUDED.v
       RETURNING v`,
      [KV_KEY, dateKey]
    );
    return rows.length ? { previous } : null;
  }

  async function release(claimInfo) {
    if (!pool) { memoryLastSent = claimInfo.previous; return; }
    if (claimInfo.previous) await pool.query(`UPDATE hero_kv SET v = $2, updated_at = NOW() WHERE k = $1`, [KV_KEY, claimInfo.previous]);
    else await pool.query(`DELETE FROM hero_kv WHERE k = $1`, [KV_KEY]);
  }

  async function tick() {
    if (busy || Date.now() < retryNotBefore) return;
    const { dateKey, minutes } = localClock(timeZone);
    if (minutes < sendAt || minutes > sendAt + CATCH_UP_MINUTES) return;
    busy = true;
    try {
      const claimInfo = await claim(dateKey);
      if (!claimInfo) return; // already sent today
      try {
        if (dryRun) console.log("[bedtime-whatsapp] dry run, would send:\n" + BEDTIME_MESSAGE);
        else await sendViaTwilio({ to, from, sid, token, contentSid: process.env.TWILIO_CONTENT_SID });
        console.log(`[bedtime-whatsapp] sent for ${dateKey}`);
      } catch (error) {
        console.warn("[bedtime-whatsapp] send failed, will retry:", error.message);
        retryNotBefore = Date.now() + RETRY_BACKOFF_MS;
        await release(claimInfo).catch(() => {});
      }
    } catch (error) {
      console.warn("[bedtime-whatsapp] check failed:", error.message);
    } finally {
      busy = false;
    }
  }

  setInterval(tick, CHECK_EVERY_MS).unref();
  setTimeout(tick, 20000).unref();
  console.log(`[bedtime-whatsapp] enabled, daily at ${String(Math.floor(sendAt / 60)).padStart(2, "0")}:${String(sendAt % 60).padStart(2, "0")} (${timeZone})${dryRun ? " [dry run]" : ""}`);
  return true;
}

module.exports = { startBedtimeWhatsApp, normalizeWhatsAppNumber, parseSendTime, BEDTIME_MESSAGE };
