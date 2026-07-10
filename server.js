const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const TICKTICK_AUTH_URL = "https://ticktick.com/oauth/authorize";
const TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token";
const TICKTICK_API_BASE = "https://api.ticktick.com/open/v1";
const HERO_PROJECT_NAME = process.env.HERO_TICKTICK_PROJECT_NAME || "Hero – Family";
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Jerusalem";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_IDEA_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Math.min(60000, Math.max(3000, Number(process.env.OPENAI_TIMEOUT_MS) || 12000));
const EXTERNAL_FETCH_TIMEOUT_MS = Math.min(60000, Math.max(3000, Number(process.env.EXTERNAL_FETCH_TIMEOUT_MS) || 10000));
const OPENAI_QUOTA_SKIP_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(5 * 60 * 1000, Number(process.env.OPENAI_QUOTA_SKIP_MS) || 6 * 60 * 60 * 1000)
);
const APP_VERSION = "41.0.0";

let openAISkipUntil = 0;
let openAISkipReason = "";

class OpenAISkipError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenAISkipError";
    this.skipOpenAI = true;
  }
}

function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function isOpenAISkipped() {
  return Boolean(openAISkipUntil && openAISkipUntil > Date.now());
}

function openAISkipMessage() {
  if (!isOpenAIConfigured()) return "OpenAI API key is not configured.";
  if (!isOpenAISkipped()) return "";
  return openAISkipReason || "OpenAI is temporarily skipped.";
}

function openAIAvailable() {
  return isOpenAIConfigured() && !isOpenAISkipped();
}

function markOpenAISkipped(reason, durationMs = OPENAI_QUOTA_SKIP_MS) {
  openAISkipUntil = Date.now() + durationMs;
  openAISkipReason = reason || "OpenAI quota or billing is unavailable; using local fallback.";
  console.warn(`OpenAI disabled temporarily: ${openAISkipReason}`);
}

function isOpenAIQuotaOrBillingError(status, body, message = "") {
  const code = String(body?.error?.code || body?.error?.type || "").toLowerCase();
  const text = String(body?.error?.message || message || "").toLowerCase();
  return (
    status === 429 &&
    (
      code.includes("quota") ||
      code.includes("billing") ||
      text.includes("quota") ||
      text.includes("billing") ||
      text.includes("exceeded your current quota") ||
      text.includes("usage limit") ||
      text.includes("insufficient")
    )
  );
}

async function openAIResponsesRequest(payload, timeoutMs = OPENAI_TIMEOUT_MS) {
  if (!isOpenAIConfigured()) {
    throw new OpenAISkipError("OpenAI is not configured; using local fallback.");
  }

  if (isOpenAISkipped()) {
    throw new OpenAISkipError(openAISkipMessage());
  }

  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  }, timeoutMs);

  const body = await readResponseBody(response);

  if (!response.ok) {
    const message = body?.error?.message || `OpenAI request failed with status ${response.status}`;

    if (isOpenAIQuotaOrBillingError(response.status, body, message)) {
      markOpenAISkipped("OpenAI quota/billing unavailable. Hero will skip ChatGPT and use local fallback.");
    }

    const error = new Error(message);
    error.status = response.status;
    error.openAIBody = body;
    throw error;
  }

  return body;
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = EXTERNAL_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isTickTickConfigured() {
  return Boolean(
    process.env.TICKTICK_CLIENT_ID &&
      process.env.TICKTICK_CLIENT_SECRET &&
      process.env.TICKTICK_REDIRECT_URI &&
      process.env.SESSION_SECRET
  );
}

function cookieIsSecure() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_PUBLIC_DOMAIN);
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) return res.setHeader("Set-Cookie", [cookie]);
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function makeCookie(name, value, maxAgeSeconds) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (cookieIsSecure()) attributes.push("Secure");
  return attributes.join("; ");
}

function clearCookie(res, name) {
  appendSetCookie(res, makeCookie(name, "", 0));
}

function readCookie(req, name) {
  const rawCookies = req.headers.cookie || "";
  for (const part of rawCookies.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function requireSessionSecret() {
  if (!process.env.SESSION_SECRET) {
    throw new PublicError(503, "יש להגדיר SESSION_SECRET ב-Railway.");
  }
}

function encryptionKey() {
  requireSessionSecret();
  return crypto.createHash("sha256").update(process.env.SESSION_SECRET).digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptJson(value) {
  try {
    const [ivValue, tagValue, encryptedValue] = String(value || "").split(".");
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

function secureEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createOAuthState() {
  const issuedAt = Date.now().toString();
  const nonce = crypto.randomBytes(24).toString("base64url");
  const payload = `${issuedAt}.${nonce}`;
  const signature = crypto
    .createHmac("sha256", encryptionKey())
    .update(`ticktick-oauth:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyOAuthState(value) {
  try {
    const [issuedAtValue, nonce, signature] = String(value || "").split(".");
    if (!issuedAtValue || !nonce || !signature) return false;
    const issuedAt = Number(issuedAtValue);
    if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60000 || Date.now() - issuedAt > 10 * 60 * 1000) return false;
    const payload = `${issuedAtValue}.${nonce}`;
    const expected = crypto
      .createHmac("sha256", encryptionKey())
      .update(`ticktick-oauth:${payload}`)
      .digest("base64url");
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function getStoredTokens(req) {
  return decryptJson(readCookie(req, "hero_ticktick_tokens"));
}

function writeStoredTokens(res, tokens) {
  appendSetCookie(res, makeCookie("hero_ticktick_tokens", encryptJson(tokens), 60 * 60 * 24 * 30));
}

function normalizeTokens(payload, previousTokens = {}) {
  const expiresIn = Number(payload.expires_in);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previousTokens.refreshToken || null,
    expiresAt: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : previousTokens.expiresAt || null
  };
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestToken(params) {
  const response = await fetchWithTimeout(TICKTICK_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  const body = await readResponseBody(response);
  if (!response.ok || !body || typeof body !== "object" || !body.access_token) {
    const reason = body && typeof body === "object" ? body.error || body.message || "unknown_error" : "unknown_error";
    console.error("TickTick token request failed:", response.status, reason, { redirectUri: process.env.TICKTICK_REDIRECT_URI || "" });
    throw new PublicError(502, "TickTick לא אישר את החיבור. בדוק את Client ID, Client Secret ו-Redirect URI.");
  }
  return body;
}

async function refreshTokens(req, res, tokens) {
  if (!tokens?.refreshToken) throw new PublicError(401, "חיבור TickTick הסתיים. יש ללחוץ שוב על רبط TickTick.");
  const payload = await requestToken({
    grant_type: "refresh_token",
    client_id: process.env.TICKTICK_CLIENT_ID,
    client_secret: process.env.TICKTICK_CLIENT_SECRET,
    refresh_token: tokens.refreshToken
  });
  const refreshed = normalizeTokens(payload, tokens);
  writeStoredTokens(res, refreshed);
  return refreshed;
}

async function getValidTokens(req, res) {
  let tokens = getStoredTokens(req);
  if (!tokens?.accessToken) throw new PublicError(401, "TickTick אינו מחובר עדיין.");
  if (tokens.expiresAt && Number(tokens.expiresAt) <= Date.now() + 60000) {
    tokens = await refreshTokens(req, res, tokens);
  }
  return tokens;
}

async function tickTickRequest(req, res, endpoint, options = {}) {
  let tokens = await getValidTokens(req, res);
  async function send(accessToken) {
    const headers = { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    return fetchWithTimeout(`${TICKTICK_API_BASE}${endpoint}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  }
  let response = await send(tokens.accessToken);
  if (response.status === 401 && tokens.refreshToken) {
    tokens = await refreshTokens(req, res, tokens);
    response = await send(tokens.accessToken);
  }
  const body = await readResponseBody(response);
  if (!response.ok) {
    console.error("TickTick API request failed:", response.status, endpoint, body);
    if (response.status === 401) throw new PublicError(401, "חיבור TickTick הסתיים. יש ללחוץ שוב על רبط TickTick.");
    throw new PublicError(502, "TickTick לא הצליח לבצע את הפעולה. נסה שוב בעוד רגע.");
  }
  return body;
}

function dateKeyInTimeZone(value, timeZone = APP_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function taskDateKey(task) {
  const rawDate = task?.dueDate || task?.startDate;
  if (!rawDate) return null;
  const value = String(rawDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateKeyInTimeZone(value);
}

function isOpenTickTickTask(task) {
  if (!task || !task.id || !task.title) return false;
  if (task.completed === true || task.deleted === true) return false;
  if (Number(task.status) === 2) return false;
  return true;
}

function selectedProjectIdsFromQuery(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter((id) => id && id.length <= 200))];
}

async function ensureHeroProject(req, res) {
  const projects = await tickTickRequest(req, res, "/project");
  if (!Array.isArray(projects)) throw new PublicError(502, "לא התקבלה רשימת פרויקטים תקינה מ-TickTick.");
  let project = projects.find((item) => item.name === HERO_PROJECT_NAME && item.closed !== true);
  if (!project) {
    project = await tickTickRequest(req, res, "/project", {
      method: "POST",
      body: { name: HERO_PROJECT_NAME, color: "#5B5BD6", viewMode: "list", kind: "TASK" }
    });
  }
  if (!project?.id) throw new PublicError(502, "לא ניתן ליצור את רשימת Hero ב-TickTick.");
  return project;
}

async function createTickTickTaskIfPossible(req, res, task) {
  if (!isTickTickConfigured() || !getStoredTokens(req)?.accessToken) return null;
  try {
    const project = await ensureHeroProject(req, res);
    const created = await tickTickRequest(req, res, "/task", {
      method: "POST",
      body: {
        projectId: project.id,
        title: task.title,
        content: `Hero Family\nالطفل: ${task.assignee}\nالنوع: ${task.type}\nالنقاط: ${task.points}\nالوقت المقترح: ${task.suggestedTime || "بدون"}\nالمؤقت: ${task.timerMinutes ? `${task.timerMinutes} دقيقة` : "بدون"}\n${task.note || ""}`,
        priority: 0
      }
    });
    if (!created?.id) return null;
    return { ticktickTaskId: String(created.id), ticktickProjectId: String(project.id), ticktickProjectName: project.name };
  } catch (error) {
    console.warn("Could not create TickTick task from Hero:", error.message);
    return null;
  }
}

async function completeTickTickTaskIfPossible(req, res, task) {
  if (!task.ticktickTaskId || !task.ticktickProjectId || !isTickTickConfigured() || !getStoredTokens(req)?.accessToken) return false;
  try {
    await tickTickRequest(req, res, `/project/${encodeURIComponent(task.ticktickProjectId)}/task/${encodeURIComponent(task.ticktickTaskId)}/complete`, { method: "POST" });
    return true;
  } catch (error) {
    console.warn("Could not complete TickTick task from Hero:", error.message);
    return false;
  }
}

const FAMILY_MEMBERS = {
  yaman: { id: "yaman", name: "يَمان", label: "منطقة يَمان" },
  judy: { id: "judy", name: "جودي", label: "منطقة جودي" }
};

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false })
  : null;

let familyDatabaseReady = null;

function isFamilyMember(value) {
  return Object.prototype.hasOwnProperty.call(FAMILY_MEMBERS, value);
}

function familyDateKey(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dateKeyInTimeZone(new Date());
}

function requireFamilyDatabase() {
  if (!pool) throw new PublicError(503, "قاعدة بيانات العائلة غير مفعّلة. أضف DATABASE_URL من PostgreSQL في Railway.");
}

async function ensureFamilyDatabase() {
  requireFamilyDatabase();
  if (!familyDatabaseReady) {
    familyDatabaseReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hero_family_tasks (
          id UUID PRIMARY KEY,
          assignee TEXT NOT NULL CHECK (assignee IN ('yaman', 'judy')),
          title TEXT NOT NULL,
          task_type TEXT NOT NULL DEFAULT 'other',
          points INTEGER NOT NULL DEFAULT 5,
          due_date DATE NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          suggested_time TEXT NOT NULL DEFAULT '',
          timer_minutes INTEGER NOT NULL DEFAULT 0,
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          done BOOLEAN NOT NULL DEFAULT FALSE,
          source TEXT NOT NULL DEFAULT 'parent',
          ticktick_task_id TEXT,
          ticktick_project_id TEXT,
          ticktick_project_name TEXT,
          ticktick_completed BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS ticktick_completed BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS suggested_time TEXT NOT NULL DEFAULT '';
        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS timer_minutes INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS hero_family_tasks_assignee_date_idx
          ON hero_family_tasks (assignee, due_date, done);

        CREATE TABLE IF NOT EXISTS hero_family_events (
          id UUID PRIMARY KEY,
          assignee TEXT NOT NULL CHECK (assignee IN ('yaman', 'judy', 'family')),
          title TEXT NOT NULL,
          event_date DATE NOT NULL,
          event_time TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS hero_family_events_date_idx ON hero_family_events (event_date, assignee);
      `);
    })().catch((error) => {
      familyDatabaseReady = null;
      throw error;
    });
  }
  await familyDatabaseReady;
}

function parentPinConfigured() {
  return typeof process.env.PARENT_PIN === "string" && process.env.PARENT_PIN.length >= 4;
}

function childPinVariableName(assignee) {
  return `${String(assignee || "").toUpperCase()}_PIN`;
}

function childPinConfigured(assignee) {
  const pin = process.env[childPinVariableName(assignee)];
  return typeof pin === "string" && pin.length >= 4;
}

function createParentSession() {
  return encryptJson({ role: "parent", expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
}

function createChildSession(assignee) {
  return encryptJson({ role: "child", assignee, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
}

function childSessionCookieName(assignee) {
  return `hero_${assignee}_session`;
}

function hasParentSession(req) {
  const session = decryptJson(readCookie(req, "hero_parent_session"));
  return Boolean(session?.role === "parent" && Number(session?.expiresAt) > Date.now());
}

function hasChildSession(req, assignee) {
  const session = decryptJson(readCookie(req, childSessionCookieName(assignee)));
  return Boolean(session?.role === "child" && session?.assignee === assignee && Number(session?.expiresAt) > Date.now());
}

function requireParent(req) {
  if (!hasParentSession(req)) throw new PublicError(401, "يلزم رمز الوالدين لإدارة مهام العائلة.");
}

function requireChildOrParent(req, assignee) {
  if (!hasParentSession(req) && !hasChildSession(req, assignee)) throw new PublicError(401, "أدخل رمز الدخول الخاص بهذه المنطقة أولاً.");
}

function writeParentSession(res) {
  appendSetCookie(res, makeCookie("hero_parent_session", createParentSession(), 60 * 60 * 12));
}

function writeChildSession(res, assignee) {
  appendSetCookie(res, makeCookie(childSessionCookieName(assignee), createChildSession(assignee), 60 * 60 * 12));
}

function mapFamilyTask(row) {
  return {
    id: row.id,
    assignee: row.assignee,
    title: row.title,
    type: row.task_type,
    points: Number(row.points || 0),
    date: String(row.due_date).slice(0, 10),
    note: row.note || "",
    suggestedTime: row.suggested_time || "",
    timerMinutes: Number(row.timer_minutes || 0),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    done: Boolean(row.done),
    status: row.done ? "done" : row.started_at ? "in_progress" : "open",
    source: row.source || "parent",
    ticktickTaskId: row.ticktick_task_id || null,
    ticktickProjectId: row.ticktick_project_id || null,
    ticktickProjectName: row.ticktick_project_name || "",
    ticktickCompleted: Boolean(row.ticktick_completed)
  };
}

function mapFamilyEvent(row) {
  return { id: row.id, assignee: row.assignee, title: row.title, date: String(row.event_date).slice(0, 10), time: row.event_time || "", note: row.note || "" };
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeTaskType(value) {
  return ["study", "home", "creative", "movement", "social", "routine", "prayer", "other"].includes(value) ? value : "other";
}

function safeTime(value) {
  const raw = safeText(value, 8);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function safeTimerMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(180, Math.max(0, Math.round(number)));
}

async function getFamilyTasks(assignee, date) {
  await ensureFamilyDatabase();
  const { rows } = await pool.query(
    `SELECT * FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 ORDER BY done ASC, NULLIF(suggested_time, '') ASC NULLS LAST, created_at ASC`,
    [assignee, date]
  );
  return rows.map(mapFamilyTask);
}

async function getFamilyEvents(assignee, date) {
  await ensureFamilyDatabase();
  const assignees = assignee === "family" ? ["family"] : [assignee, "family"];
  const { rows } = await pool.query(
    `SELECT * FROM hero_family_events WHERE assignee = ANY($1::text[]) AND event_date = $2 ORDER BY NULLIF(event_time, '') ASC NULLS LAST, created_at ASC`,
    [assignees, date]
  );
  return rows.map(mapFamilyEvent);
}

function requireConfigured() {
  if (!isTickTickConfigured()) {
    throw new PublicError(503, "יש להוסיף את TICKTICK_CLIENT_ID, TICKTICK_CLIENT_SECRET, TICKTICK_REDIRECT_URI ו-SESSION_SECRET ב-Railway.");
  }
}


function extractOpenAIOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

const PRAYER_API_BASE = "https://api.aladhan.com/v1/timings";
const JERUSALEM_LATITUDE = Number(process.env.PRAYER_LATITUDE) || 31.7683;
const JERUSALEM_LONGITUDE = Number(process.env.PRAYER_LONGITUDE) || 35.2137;
const PRAYER_METHOD = Number(process.env.PRAYER_METHOD) || 3;
const PRAYER_SCHOOL = Number(process.env.PRAYER_SCHOOL) || 1;

function timeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const minutes = ((Number(value) || 0) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function hourlySlots(startTime = "06:00", endTime = "21:00") {
  const start = timeToMinutes(startTime) ?? 6 * 60;
  const end = timeToMinutes(endTime) ?? 21 * 60;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const slots = [];
  for (let minute = from; minute <= to; minute += 60) {
    slots.push(minutesToTime(minute));
  }
  return slots.slice(0, 24);
}

function parseFullDayOptions(body = {}) {
  const fullDay = body?.fullDay !== false;
  const startTime = safeTime(body?.startTime) || "06:00";
  const endTime = safeTime(body?.endTime) || "21:00";
  const slots = fullDay ? hourlySlots(startTime, endTime) : [];
  const taskCount = fullDay ? slots.length : parsePlanTaskCount(body?.taskCount);
  const goals = planInstructionsText(body?.goals || body?.instructions);
  return { fullDay, startTime, endTime, slots, taskCount, goals };
}

function cleanPrayerTime(value) {
  const match = String(value || "").match(/\b([0-2]\d:[0-5]\d)\b/);
  return match ? safeTime(match[1]) : "";
}

function dateForPrayerApi(date) {
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : dateKeyInTimeZone(new Date());
  const [year, month, day] = raw.split("-");
  return `${day}-${month}-${year}`;
}

async function getJerusalemPrayerTimes(date) {
  const apiDate = dateForPrayerApi(date);
  const url = new URL(`${PRAYER_API_BASE}/${apiDate}`);
  url.searchParams.set("latitude", String(JERUSALEM_LATITUDE));
  url.searchParams.set("longitude", String(JERUSALEM_LONGITUDE));
  url.searchParams.set("method", String(PRAYER_METHOD));
  url.searchParams.set("school", String(PRAYER_SCHOOL));

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } }, EXTERNAL_FETCH_TIMEOUT_MS);
  const body = await readResponseBody(response);
  if (!response.ok || !body?.data?.timings) {
    throw new Error("Prayer API failed");
  }

  const timings = body.data.timings;
  return {
    fajr: cleanPrayerTime(timings.Fajr),
    dhuhr: cleanPrayerTime(timings.Dhuhr),
    asr: cleanPrayerTime(timings.Asr),
    maghrib: cleanPrayerTime(timings.Maghrib),
    isha: cleanPrayerTime(timings.Isha),
    source: "aladhan",
    location: "Jerusalem",
    date: familyDateKey(date)
  };
}

async function getPrayerTimesSafely(date) {
  try {
    return { prayerTimes: await getJerusalemPrayerTimes(date), warning: "" };
  } catch (error) {
    console.warn("Could not refresh Jerusalem prayer times:", error.message);
    return {
      prayerTimes: { fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "", source: "unavailable", location: "Jerusalem", date: familyDateKey(date) },
      warning: "تعذر تحديث مواقيت الصلاة في القدس الآن؛ لم تتم إضافة مهام الصلاة تلقائيًا لهذه الخطة."
    };
  }
}

function buildPrayerTasks(prayerTimes = {}) {
  const prayers = [
    ["fajr", "صلاة الفجر في وقتها"],
    ["dhuhr", "صلاة الظهر في وقتها"],
    ["asr", "صلاة العصر في وقتها"],
    ["maghrib", "صلاة المغرب في وقتها"],
    ["isha", "صلاة العشاء في وقتها"]
  ];
  return prayers.map(([key, title]) => {
    const time = safeTime(prayerTimes[key]);
    if (!time) return null;
    return { title, type: "prayer", points: 0, note: "تذكير هادئ للصلاة في وقتها. الصلاة قيمة روحية وليست مرتبطة بالنقاط أو المكافآت.", suggestedTime: time, timerMinutes: 0, source: "prayer" };
  }).filter(Boolean);
}

function addPrayerTasksToPlan(plan, prayerTimes) {
  const fixedPrayerTasks = buildPrayerTasks(prayerTimes);
  if (!fixedPrayerTasks.length) return plan;
  const addToChild = (child) => {
    const existingTitles = new Set((child.tasks || []).map((task) => String(task.title || "")));
    const prayersToAdd = fixedPrayerTasks.filter((task) => !existingTitles.has(task.title));
    return { ...child, tasks: [...(child.tasks || []), ...prayersToAdd] };
  };
  return {
    ...plan,
    familyMessage: `${plan.familyMessage || ""} تم تحديث مواقيت الصلاة تلقائيًا لمدينة القدس لهذا اليوم.`,
    children: { yaman: addToChild(plan.children.yaman), judy: addToChild(plan.children.judy) },
    prayerTimes
  };
}

function normalizePlanTask(task) {
  const type = safeTaskType(task?.type);
  const isPrayer = type === "prayer";
  const basePoints = Number(task?.points);
  const points = isPrayer ? 0 : Math.min(30, Math.max(5, Number.isFinite(basePoints) ? basePoints : (type === "study" || type === "creative" ? 15 : 10)));
  return {
    title: safeText(task?.title, 180) || "مهمة صغيرة وواضحة",
    type,
    points: Math.round(points),
    note: safeText(task?.note, 420) || "ابدأ بخطوة صغيرة فقط.",
    suggestedTime: safeTime(task?.suggestedTime),
    timerMinutes: safeTimerMinutes(task?.timerMinutes),
    source: safeText(task?.source, 30) || (isPrayer ? "prayer" : "chatgpt")
  };
}

function parsePlanTaskCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 16;
  return Math.min(24, Math.max(1, Math.round(number)));
}

function planInstructionsText(value) {
  return safeText(value, 1400);
}

function taskFromSlot(member, time, index, goals = "") {
  const yamanPattern = [
    ["routine", "بداية هادئة وترتيب سريع", 5, 10],
    ["study", "رياضيات مركزة: خطوة واحدة واضحة", 15, 25],
    ["movement", "حركة قصيرة وتنشيط الجسم", 10, 12],
    ["study", "قراءة أو مراجعة علمية قصيرة", 10, 20],
    ["creative", "دبلجة أو تسجيل صوتي قصير", 15, 20],
    ["home", "مسؤولية منزلية صغيرة", 10, 12],
    ["social", "تدريب جملة اجتماعية لطيفة", 10, 8],
    ["creative", "رسم فكرة أو مشهد لفيديو", 10, 20]
  ];
  const judyPattern = [
    ["routine", "بداية لطيفة وترتيب صغير", 5, 10],
    ["study", "قراءة أو كتابة قصيرة", 10, 20],
    ["creative", "رسم أو نشاط ألوان", 10, 20],
    ["movement", "حركة مريحة أو لعب نشط", 10, 12],
    ["home", "مساعدة بسيطة في البيت", 10, 12],
    ["study", "مراجعة تعليمية خفيفة", 10, 18],
    ["social", "كلمة طيبة أو مشاركة هادئة", 10, 0],
    ["routine", "تجهيز شيء للغد", 5, 8]
  ];
  const pattern = member === "yaman" ? yamanPattern : judyPattern;
  const [type, title, points, timerMinutes] = pattern[index % pattern.length];
  return { title, type, points, note: goals ? `مرتبط بأهداف اليوم: ${goals}` : "نفّذها بهدوء وبخطوة واحدة واضحة.", suggestedTime: time, timerMinutes, source: "local-full-day" };
}

function localDailyCoachPlan(taskCountOrOptions = 16, instructions = "") {
  const options = typeof taskCountOrOptions === "object" ? taskCountOrOptions : { taskCount: taskCountOrOptions, goals: instructions, fullDay: false, startTime: "06:00", endTime: "21:00" };
  const slots = options.fullDay ? hourlySlots(options.startTime, options.endTime) : hourlySlots("16:00", "20:00").slice(0, parsePlanTaskCount(options.taskCount));
  const count = options.fullDay ? slots.length : parsePlanTaskCount(options.taskCount);
  const goals = planInstructionsText(options.goals || options.instructions || instructions);
  const effectiveSlots = slots.slice(0, count);
  return {
    familyMessage: goals ? `تم بناء خطة يومية كاملة من ${options.startTime || "06:00"} إلى ${options.endTime || "21:00"} وفق أهداف الوالدين: ${goals}` : `تم بناء خطة يومية كاملة من ${options.startTime || "06:00"} إلى ${options.endTime || "21:00"}، متنوعة ومتعلمة وهادئة.`,
    children: {
      yaman: { encouragement: "يا يَمان، اليوم مقسّم إلى ساعات واضحة. نفّذ خطوة واحدة في كل ساعة ولا تبحث عن الكمال.", tasks: effectiveSlots.map((time, index) => taskFromSlot("yaman", time, index, goals)) },
      judy: { encouragement: "يا جودي، الخطة اليوم لطيفة ومتنوعة. كل ساعة فيها خطوة صغيرة تساعدك على التقدم.", tasks: effectiveSlots.map((time, index) => taskFromSlot("judy", time, index, goals)) }
    }
  };
}

function normalizeDailyCoachPlan(value, options = {}) {
  const count = parsePlanTaskCount(options.taskCount);
  const fallback = localDailyCoachPlan(options);
  const plan = value && typeof value === "object" ? value : fallback;
  const children = plan.children && typeof plan.children === "object" ? plan.children : {};
  const normalizeChild = (member) => {
    const child = children[member] && typeof children[member] === "object" ? children[member] : fallback.children[member];
    const rawTasks = Array.isArray(child.tasks) ? child.tasks.map(normalizePlanTask) : [];
    const fallbackTasks = fallback.children[member].tasks.map(normalizePlanTask);
    const tasks = rawTasks.filter((task) => task.type !== "prayer").slice(0, count);
    for (let i = tasks.length; i < count; i += 1) tasks.push(fallbackTasks[i % fallbackTasks.length]);
    return { encouragement: safeText(child.encouragement, 320) || fallback.children[member].encouragement, tasks };
  };
  return { familyMessage: safeText(plan.familyMessage, 520) || fallback.familyMessage, children: { yaman: normalizeChild("yaman"), judy: normalizeChild("judy") } };
}

async function createOpenAIDailyCoachPlan(date, options = {}) {
  const count = parsePlanTaskCount(options.taskCount);
  const parentGoals = planInstructionsText(options.goals || options.instructions);
  const startTime = safeTime(options.startTime) || "06:00";
  const endTime = safeTime(options.endTime) || "21:00";
  const slots = (Array.isArray(options.slots) && options.slots.length ? options.slots : hourlySlots(startTime, endTime)).slice(0, count);
  const prayerTimes = options.prayerTimes || {};
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      familyMessage: { type: "string" },
      children: {
        type: "object",
        additionalProperties: false,
        properties: {
          yaman: {
            type: "object",
            additionalProperties: false,
            properties: {
              encouragement: { type: "string" },
              tasks: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, type: { type: "string", enum: ["study", "home", "creative", "movement", "social", "routine", "other"] }, points: { type: "integer" }, note: { type: "string" }, suggestedTime: { type: "string" }, timerMinutes: { type: "integer" } }, required: ["title", "type", "points", "note", "suggestedTime", "timerMinutes"] } }
            },
            required: ["encouragement", "tasks"]
          },
          judy: {
            type: "object",
            additionalProperties: false,
            properties: {
              encouragement: { type: "string" },
              tasks: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, type: { type: "string", enum: ["study", "home", "creative", "movement", "social", "routine", "other"] }, points: { type: "integer" }, note: { type: "string" }, suggestedTime: { type: "string" }, timerMinutes: { type: "integer" } }, required: ["title", "type", "points", "note", "suggestedTime", "timerMinutes"] } }
            },
            required: ["encouragement", "tasks"]
          }
        },
        required: ["yaman", "judy"]
      }
    },
    required: ["familyMessage", "children"]
  };

  const prompt = `أنت Hero، مدرب يومي عربي دافئ لعائلة فيها يَمان وجودي. أنشئ خطة كاملة ليوم ${date} من الساعة ${startTime} حتى ${endTime}. المطلوب بالضبط ${count} مهام تعليمية/إثرائية/حياتية لكل طفل، موزعة على هذه الساعات بالترتيب: ${slots.join(", ")}. اجعل لكل ساعة مهمة واحدة صغيرة لكل طفل. لا تُدخل الصلاة داخل JSON؛ النظام سيضيف مواقيت الصلاة تلقائيًا لمدينة القدس. مواقيت الصلاة للوعي فقط: الفجر ${prayerTimes.fajr || "غير متاح"}، الظهر ${prayerTimes.dhuhr || "غير متاح"}، العصر ${prayerTimes.asr || "غير متاح"}، المغرب ${prayerTimes.maghrib || "غير متاح"}، العشاء ${prayerTimes.isha || "غير متاح"}. يَمان يحب الدبلجة والرسم والرياضيات ويحتاج خطوات قصيرة ومؤقتات. جودي تحتاج مهام لطيفة وواضحة ومتعلمة. نوّع بين دراسة، حركة، إبداع، مسؤولية بيت، مهارة اجتماعية وروتين. نقاط الصلاة لا تُحسب ولا ترتبط بمكافآت. اجعل timerMinutes بين 0 و60. استخدم timer للرياضيات، القراءة، الإبداع، الحركة والتركيز. أهداف الوالدين لهذا اليوم: ${parentGoals || "لا توجد أهداف إضافية"}. يجب احترام أهداف الوالدين طالما هي آمنة ومناسبة للأطفال. أعد JSON فقط حسب المخطط.`;
  const body = await openAIResponsesRequest({
    model: OPENAI_IDEA_MODEL,
    input: prompt,
    text: { format: { type: "json_schema", name: "hero_full_day_coach_plan", strict: true, schema } },
    max_output_tokens: Math.min(9000, 1200 + count * 520)
  }, Math.max(OPENAI_TIMEOUT_MS, 20000));
  const output = extractOpenAIOutputText(body);
  return normalizeDailyCoachPlan(JSON.parse(output), { ...options, taskCount: count, goals: parentGoals });
}

async function insertCoachPlanTasks(req, res, plan, date) {
  const inserted = [];
  for (const member of ["yaman", "judy"]) {
    for (const task of plan.children[member].tasks.map(normalizePlanTask)) {
      const exists = await pool.query(
        `SELECT id FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 AND title = $3 LIMIT 1`,
        [member, date, task.title]
      );
      if (exists.rows[0]) continue;
      const baseTask = { assignee: member, title: task.title, type: task.type, points: task.points, note: task.note, suggestedTime: task.suggestedTime, timerMinutes: task.timerMinutes, source: task.source || "chatgpt" };
      const tick = baseTask.source === "prayer" ? null : await createTickTickTaskIfPossible(req, res, baseTask);
      const { rows } = await pool.query(
        `INSERT INTO hero_family_tasks (id, assignee, title, task_type, points, due_date, note, suggested_time, timer_minutes, source, ticktick_task_id, ticktick_project_id, ticktick_project_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [crypto.randomUUID(), member, task.title, task.type, task.points, date, task.note, task.suggestedTime, task.timerMinutes, baseTask.source, tick?.ticktickTaskId || null, tick?.ticktickProjectId || null, tick?.ticktickProjectName || null]
      );
      inserted.push(mapFamilyTask(rows[0]));
    }
  }
  return inserted;
}

function localEndDayMessage(member, tasks) {
  const name = FAMILY_MEMBERS[member]?.name || "الطفل";
  const done = tasks.filter((task) => task.done);
  const points = done.reduce((sum, task) => sum + Number(task.points || 0), 0);
  const total = tasks.length;
  const doneCount = done.length;
  const next = tasks.find((task) => !task.done);
  const encouragement = doneCount === 0
    ? `${name}، مجرد العودة للمحاولة غداً خطوة شجاعة. نبدأ بمهمة واحدة صغيرة.`
    : `${name}، أحسنت. أنجزت ${doneCount} من ${total} وجمعت ${points} نقطة بجهدك.`;
  return {
    points,
    done: doneCount,
    total,
    encouragement,
    nextStep: next ? `غداً نبدأ بخطوة صغيرة: ${next.title}` : "غداً نختار مهمة جديدة بهدوء."
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Hero Family",
    ticktickConfigured: isTickTickConfigured(),
    openaiConfigured: isOpenAIConfigured(),
    openaiAvailable: openAIAvailable(),
    openaiSkipped: isOpenAISkipped(),
    openaiSkipReason: openAISkipMessage(),
    openaiSkipUntil: openAISkipped() ? new Date(openAISkipUntil).toISOString() : null,
    openaiModel: OPENAI_IDEA_MODEL,
    openaiTimeoutMs: OPENAI_TIMEOUT_MS
  });
});

app.get("/api/family/status", (req, res) => {
  res.json({
    databaseConfigured: Boolean(pool),
    parentPinConfigured: parentPinConfigured(),
    parentAuthenticated: hasParentSession(req),
    yamanPinConfigured: childPinConfigured("yaman"),
    judyPinConfigured: childPinConfigured("judy"),
    yamanAuthenticated: hasChildSession(req, "yaman"),
    judyAuthenticated: hasChildSession(req, "judy"),
    members: Object.values(FAMILY_MEMBERS)
  });
});

app.post("/auth/parent/login", asyncRoute(async (req, res) => {
  if (!parentPinConfigured()) return res.redirect(303, "/?area=parent&parentLogin=not_configured");
  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  if (!secureEqualText(pin, process.env.PARENT_PIN)) return res.redirect(303, "/?area=parent&parentLogin=invalid");
  writeParentSession(res);
  return res.redirect(303, "/?area=parent&parent=opened");
}));

app.post("/api/family/parent/login", asyncRoute(async (req, res) => {
  if (!parentPinConfigured()) throw new PublicError(503, "أضف PARENT_PIN في Railway أولاً.");
  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  if (!secureEqualText(pin, process.env.PARENT_PIN)) throw new PublicError(401, "رمز الوالدين غير صحيح.");
  writeParentSession(res);
  res.json({ authenticated: true });
}));

app.post("/api/family/parent/logout", (req, res) => {
  clearCookie(res, "hero_parent_session");
  res.status(204).end();
});

app.post("/auth/child/:assignee/login", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();

  if (!isFamilyMember(assignee)) {
    return res.redirect(303, "/?area=parent&childLogin=unknown");
  }

  if (!childPinConfigured(assignee)) {
    return res.redirect(303, `/?area=${encodeURIComponent(assignee)}&childLogin=not_configured`);
  }

  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";

  if (!secureEqualText(pin, process.env[childPinVariableName(assignee)])) {
    return res.redirect(303, `/?area=${encodeURIComponent(assignee)}&childLogin=invalid`);
  }

  writeChildSession(res, assignee);
  return res.redirect(303, `/?area=${encodeURIComponent(assignee)}&child=opened`);
}));

app.post("/api/family/child/:assignee/login", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  if (!childPinConfigured(assignee)) throw new PublicError(503, `أضف ${childPinVariableName(assignee)} في Railway أولاً.`);
  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  if (!secureEqualText(pin, process.env[childPinVariableName(assignee)])) throw new PublicError(401, "رمز الدخول غير صحيح.");
  writeChildSession(res, assignee);
  res.json({ authenticated: true, member: FAMILY_MEMBERS[assignee] });
}));

app.post("/api/family/child/:assignee/logout", (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) return res.status(400).json({ error: "منطقة الطفل غير معروفة." });
  clearCookie(res, childSessionCookieName(assignee));
  res.status(204).end();
});

app.get("/api/family/dashboard", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const date = familyDateKey(req.query.date);
  const [{ rows: tasks }, { rows: events }] = await Promise.all([
    pool.query(
      `SELECT assignee, COUNT(*) FILTER (WHERE done = FALSE) AS open_count, COUNT(*) FILTER (WHERE done = TRUE) AS done_count, COUNT(*) AS total_count FROM hero_family_tasks WHERE due_date = $1 GROUP BY assignee`,
      [date]
    ),
    pool.query(
      `SELECT * FROM hero_family_events WHERE event_date >= $1 ORDER BY event_date ASC, NULLIF(event_time, '') ASC NULLS LAST, created_at ASC LIMIT 20`,
      [date]
    )
  ]);
  const summary = { yaman: { open: 0, done: 0, total: 0 }, judy: { open: 0, done: 0, total: 0 } };
  for (const row of tasks) {
    if (summary[row.assignee]) summary[row.assignee] = { open: Number(row.open_count || 0), done: Number(row.done_count || 0), total: Number(row.total_count || 0) };
  }
  res.json({ date, summary, events: events.map(mapFamilyEvent) });
}));

app.get("/api/family/child/:assignee", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const date = familyDateKey(req.query.date);
  const [tasks, events] = await Promise.all([getFamilyTasks(assignee, date), getFamilyEvents(assignee, date)]);
  res.json({ member: FAMILY_MEMBERS[assignee], date, tasks, events, parentAuthenticated: hasParentSession(req) });
}));

app.post("/api/family/tasks", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const assignee = String(req.body?.assignee || "").toLowerCase();
  const title = safeText(req.body?.title, 180);
  const type = safeTaskType(req.body?.type);
  const points = Math.min(50, Math.max(0, Number(req.body?.points) || 5));
  const dueDate = familyDateKey(req.body?.date);
  const note = safeText(req.body?.note, 500);
  const suggestedTime = safeTime(req.body?.suggestedTime);
  const timerMinutes = safeTimerMinutes(req.body?.timerMinutes);
  const source = safeText(req.body?.source, 30) || "parent";
  if (!isFamilyMember(assignee) || !title) throw new PublicError(400, "اختر الطفل واكتب مهمة قصيرة وواضحة.");

  const id = crypto.randomUUID();
  const initialTask = {
    assignee,
    title,
    type,
    points: Math.round(points),
    note,
    suggestedTime,
    timerMinutes,
    ticktickTaskId: safeText(req.body?.ticktickTaskId, 200) || null,
    ticktickProjectId: safeText(req.body?.ticktickProjectId, 200) || null,
    ticktickProjectName: safeText(req.body?.ticktickProjectName, 200) || null
  };

  let tick = initialTask.ticktickTaskId ? null : await createTickTickTaskIfPossible(req, res, initialTask);

  const { rows } = await pool.query(
    `INSERT INTO hero_family_tasks (id, assignee, title, task_type, points, due_date, note, suggested_time, timer_minutes, source, ticktick_task_id, ticktick_project_id, ticktick_project_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      id,
      assignee,
      title,
      type,
      Math.round(points),
      dueDate,
      note,
      suggestedTime,
      timerMinutes,
      source,
      initialTask.ticktickTaskId || tick?.ticktickTaskId || null,
      initialTask.ticktickProjectId || tick?.ticktickProjectId || null,
      initialTask.ticktickProjectName || tick?.ticktickProjectName || null
    ]
  );
  res.status(201).json({ task: mapFamilyTask(rows[0]), ticktickSynced: Boolean(tick || initialTask.ticktickTaskId) });
}));

app.patch("/api/family/tasks/:id/start", asyncRoute(async (req, res) => {
  await ensureFamilyDatabase();
  const assignee = String(req.body?.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const { rows } = await pool.query(
    `UPDATE hero_family_tasks
       SET started_at = COALESCE(started_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND assignee = $2 AND done = FALSE
     RETURNING *`,
    [req.params.id, assignee]
  );
  if (!rows[0]) throw new PublicError(404, "لم نجد هذه المهمة أو أنها أُنجزت بالفعل.");
  res.json({ task: mapFamilyTask(rows[0]) });
}));

app.patch("/api/family/tasks/:id/complete", asyncRoute(async (req, res) => {
  await ensureFamilyDatabase();
  const assignee = String(req.body?.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const { rows } = await pool.query(`UPDATE hero_family_tasks SET done = TRUE, started_at = COALESCE(started_at, NOW()), finished_at = NOW(), updated_at = NOW() WHERE id = $1 AND assignee = $2 RETURNING *`, [req.params.id, assignee]);
  if (!rows[0]) throw new PublicError(404, "لم نجد هذه المهمة.");
  const task = mapFamilyTask(rows[0]);
  const completed = await completeTickTickTaskIfPossible(req, res, task);
  if (completed) {
    const updated = await pool.query(`UPDATE hero_family_tasks SET ticktick_completed = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`, [task.id]);
    return res.json({ task: mapFamilyTask(updated.rows[0]), ticktickCompleted: true });
  }
  res.json({ task, ticktickCompleted: false });
}));

app.delete("/api/family/tasks/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const result = await pool.query("DELETE FROM hero_family_tasks WHERE id = $1", [req.params.id]);
  if (!result.rowCount) throw new PublicError(404, "لم نجد هذه المهمة.");
  res.status(204).end();
}));

app.post("/api/family/events", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const assignee = String(req.body?.assignee || "family").toLowerCase();
  const title = safeText(req.body?.title, 140);
  const date = familyDateKey(req.body?.date);
  const time = /^\d{2}:\d{2}$/.test(String(req.body?.time || "")) ? String(req.body.time) : "";
  const note = safeText(req.body?.note, 350);
  if (!["yaman", "judy", "family"].includes(assignee) || !title) throw new PublicError(400, "اكتب اسم الموعد وحدد لمن يظهر.");
  const { rows } = await pool.query(`INSERT INTO hero_family_events (id, assignee, title, event_date, event_time, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [crypto.randomUUID(), assignee, title, date, time, note]);
  res.status(201).json({ event: mapFamilyEvent(rows[0]) });
}));

app.delete("/api/family/events/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const result = await pool.query("DELETE FROM hero_family_events WHERE id = $1", [req.params.id]);
  if (!result.rowCount) throw new PublicError(404, "لم نجد هذا الموعد.");
  res.status(204).end();
}));


app.get("/api/prayer/today", asyncRoute(async (req, res) => {
  const date = familyDateKey(req.query.date);
  const result = await getPrayerTimesSafely(date);
  res.json({ date, ...result });
}));

app.post("/api/ai/daily-plan", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const date = familyDateKey(req.body?.date);
  const options = parseFullDayOptions(req.body || {});
  const prayerResult = await getPrayerTimesSafely(date);
  const planOptions = { ...options, prayerTimes: prayerResult.prayerTimes };
  let source = "local";
  let plan = localDailyCoachPlan(planOptions);
  let warning = prayerResult.warning;

  if (openAIAvailable()) {
    try {
      plan = await createOpenAIDailyCoachPlan(date, planOptions);
      source = "openai";
    } catch (error) {
      warning = [warning, "تخطينا ChatGPT مؤقتًا واستخدمنا خطة محلية آمنة كاملة من 06:00 إلى 21:00 وفق أهدافك."].filter(Boolean).join(" ");
      if (error.skipOpenAI) console.warn("OpenAI skipped; using local fallback:", error.message);
      else console.warn("OpenAI full day plan failed; using local fallback:", error.message);
    }
  } else if (isOpenAIConfigured() && isOpenAISkipped()) {
    warning = [warning, "تم تخطي ChatGPT لأن رصيد/حد OpenAI غير متاح حاليًا؛ استخدمنا خطة محلية آمنة."].filter(Boolean).join(" ");
  }

  plan = normalizeDailyCoachPlan(plan, planOptions);
  plan = addPrayerTasksToPlan(plan, prayerResult.prayerTimes);
  const inserted = await insertCoachPlanTasks(req, res, plan, date);
  res.json({ date, source, warning, fullDay: options.fullDay, startTime: options.startTime, endTime: options.endTime, taskCount: options.taskCount, goals: options.goals, prayerTimes: prayerResult.prayerTimes, plan, inserted });
}));

app.get("/api/ai/end-day/:assignee", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const date = familyDateKey(req.query.date);
  const tasks = await getFamilyTasks(assignee, date);
  const summary = localEndDayMessage(assignee, tasks);
  if (!openAIAvailable()) return res.json({ date, source: "local", summary, warning: openAISkipMessage() });
  try {
    const prompt = `اكتب تشجيع نهاية يوم عربي قصير ودافئ لـ ${FAMILY_MEMBERS[assignee].name}. البيانات: أنجز ${summary.done} من ${summary.total}، النقاط ${summary.points}. لا تقارن بين الأطفال، لا تضغط، أعطِ خطوة صغيرة للغد.`;
    const body = await openAIResponsesRequest({ model: OPENAI_IDEA_MODEL, input: prompt, max_output_tokens: 350 }, OPENAI_TIMEOUT_MS);
    const text = extractOpenAIOutputText(body) || "";
    return res.json({ date, source: text ? "openai" : "local", summary: { ...summary, encouragement: text || summary.encouragement } });
  } catch (error) {
    return res.json({ date, source: "local", summary });
  }
}));

function normalizeHelpList(value, fallback = []) {
  const items = Array.isArray(value) ? value : fallback;
  return items
    .map((item) => safeText(item, 220))
    .filter(Boolean)
    .slice(0, 8);
}

function buildTaskHelpAnswer(help) {
  const intro = safeText(help?.intro, 360);
  const questions = normalizeHelpList(help?.questions, []);
  const steps = normalizeHelpList(help?.steps, []);
  const checklist = normalizeHelpList(help?.checklist, []);
  const encouragement = safeText(help?.encouragement, 260);

  return [
    intro,
    questions.length ? `أسئلة سريعة قبل البدء:\n${questions.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    steps.length ? `خطوات التنفيذ:\n${steps.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    checklist.length ? `Checklist للإنجاز:\n${checklist.map((item) => `☐ ${item}`).join("\n")}` : "",
    encouragement
  ].filter(Boolean).join("\n\n");
}

function localTaskHelp(task, question = "") {
  const type = safeTaskType(task?.type);
  const title = safeText(task?.title, 180) || "المهمة";
  const note = safeText(task?.note, 500);
  const timer = safeTimerMinutes(task?.timerMinutes);
  const time = safeTime(task?.suggestedTime);

  const stepsByType = {
    study: ["حضّر الدفتر والقلم فقط.", "اقرأ المطلوب بصوت هادئ.", "ابدأ بالسؤال الأسهل أو الفقرة الأولى.", "ضع علامة على الشيء الصعب لتسأل عنه لاحقًا."],
    creative: ["اختر فكرة واحدة فقط.", "جرّب نسخة أولى قصيرة دون محاولة الكمال.", "سجّل أو ارسم أو اكتب لمدة قصيرة.", "اختر شيئًا واحدًا أعجبك واحتفظ به."],
    home: ["افهم المطلوب بالضبط.", "حضّر المكان أو الأداة المطلوبة.", "أنجز جزءًا صغيرًا وآمنًا.", "أخبر أحد الوالدين عندما تنتهي."],
    movement: ["اشرب قليلًا من الماء.", "ابدأ بحركة خفيفة.", "استمر حتى نهاية المؤقت دون مبالغة.", "خذ نفسًا هادئًا في النهاية."],
    social: ["اختر جملة واحدة.", "قلها بصوت هادئ.", "جرّبها مع شخص تثق به.", "لاحظ ما نجح بدون ضغط."],
    routine: ["اختر خطوة واحدة فقط.", "ضع الشيء المطلوب في مكان واضح.", "أنجزها بهدوء.", "انتقل لشيء آخر فقط إذا بقيت طاقة."],
    other: ["اقرأ اسم المهمة.", "حوّلها إلى أول خطوة صغيرة.", "ابدأ لخمس دقائق.", "اطلب مساعدة إذا احتجت."]
  };

  const steps = stepsByType[type] || stepsByType.other;
  const checklist = [
    "فهمت المطلوب من المهمة.",
    time ? `بدأت في الوقت المقترح ${time}.` : "اخترت وقتًا مناسبًا للبدء.",
    timer ? `شغّلت المؤقت لمدة ${timer} دقيقة.` : "بدأت بخمس دقائق على الأقل.",
    "أنجزت أول خطوة صغيرة.",
    "راجعت النتيجة أو طلبت مساعدة عند الحاجة.",
    "ضغطت إنهاء المهمة بعد الإنجاز."
  ];

  const questions = [
    "ما أول خطوة صغيرة أستطيع تنفيذها الآن؟",
    "ما الشيء الذي أحتاجه قبل أن أبدأ؟",
    timer ? "هل شغّلت المؤقت؟" : "هل أبدأ بخمس دقائق فقط؟",
    "من يمكنني أن أسأل إذا علقت؟"
  ];

  const help = {
    intro: `لننفذ «${title}» بهدوء. ${question ? `سؤالك: ${question}. ` : ""}${note ? `ملاحظة المهمة: ${note}.` : "المهم أن نبدأ بخطوة صغيرة، وليس أن نكون مثاليين."}`,
    questions,
    steps,
    checklist,
    encouragement: "أحسنت. ابدأ الآن بأول خطوة فقط، وبعدها يصبح الطريق أسهل."
  };

  return { ...help, answer: buildTaskHelpAnswer(help) };
}

function normalizeTaskHelp(value, fallback) {
  const base = fallback || localTaskHelp({}, "");
  const help = value && typeof value === "object" ? value : {};
  const normalized = {
    intro: safeText(help.intro, 360) || base.intro,
    questions: normalizeHelpList(help.questions, base.questions),
    steps: normalizeHelpList(help.steps, base.steps),
    checklist: normalizeHelpList(help.checklist, base.checklist),
    encouragement: safeText(help.encouragement, 260) || base.encouragement
  };
  return { ...normalized, answer: buildTaskHelpAnswer(normalized) };
}

app.post("/api/ai/task-help", asyncRoute(async (req, res) => {
  const assignee = String(req.body?.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);

  const task = {
    title: safeText(req.body?.task?.title || req.body?.title, 180),
    type: safeTaskType(req.body?.task?.type || req.body?.type),
    note: safeText(req.body?.task?.note || req.body?.note, 700),
    suggestedTime: safeTime(req.body?.task?.suggestedTime || req.body?.suggestedTime),
    timerMinutes: safeTimerMinutes(req.body?.task?.timerMinutes || req.body?.timerMinutes),
    points: Math.min(50, Math.max(0, Number(req.body?.task?.points || req.body?.points) || 0)),
    done: Boolean(req.body?.task?.done || req.body?.done),
    status: safeText(req.body?.task?.status || req.body?.status, 40)
  };

  const question = safeText(req.body?.question, 700) || "اسألني أسئلة قصيرة، ثم حضّر checklist، ثم اشرح كيف أنفذ المهمة.";
  if (!task.title) throw new PublicError(400, "لم تصل تفاصيل المهمة.");

  const fallback = localTaskHelp(task, question);

  if (!openAIAvailable()) {
    return res.json({ source: "local", ...fallback, warning: openAISkipMessage() });
  }

  try {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        intro: { type: "string" },
        questions: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
        steps: { type: "array", minItems: 4, maxItems: 8, items: { type: "string" } },
        checklist: { type: "array", minItems: 4, maxItems: 8, items: { type: "string" } },
        encouragement: { type: "string" }
      },
      required: ["intro", "questions", "steps", "checklist", "encouragement"]
    };

    const prompt = `أنت Hero، مساعد عربي دافئ وعملي لطفل/طفلة. داخل كل مهمة يجب أن تساعد الطفل على التنفيذ لا أن تعطي كلامًا عامًا. اسأل 3-6 أسئلة قصيرة تساعده يفهم المهمة، ثم اشرح خطوات صغيرة جدًا، ثم حضّر checklist واضح للإنجاز. لا تضغط، لا تقارن بين الأطفال، لا تستخدم لغة مخيفة. لا تربط الصلاة بالنقاط أو المكافآت. إذا كانت المهمة صلاة فاجعلها استعدادًا هادئًا: وضوء، نية، خشوع، وهدوء، بدون نقاط.\n\nالطفل: ${FAMILY_MEMBERS[assignee].name}\nالمهمة: ${task.title}\nالنوع: ${task.type}\nالوقت: ${task.suggestedTime || "غير محدد"}\nالمؤقت: ${task.timerMinutes || 0} دقيقة\nالنقاط: ${task.points}\nالحالة: ${task.status || "مفتوحة"}\nملاحظة المهمة: ${task.note || "لا توجد"}\nسؤال الطفل/الأهل: ${question}\n\nاكتب بالعربية فقط وبشكل عملي جدًا.`;

    const body = await openAIResponsesRequest({
      model: OPENAI_IDEA_MODEL,
      input: prompt,
      text: { format: { type: "json_schema", name: "hero_task_help_checklist", strict: true, schema } },
      max_output_tokens: 1200
    }, OPENAI_TIMEOUT_MS);
    const output = extractOpenAIOutputText(body);
    const parsed = output ? JSON.parse(output) : null;
    const help = normalizeTaskHelp(parsed, fallback);
    return res.json({ source: "openai", ...help });
  } catch (error) {
    console.warn("OpenAI task help failed; using local fallback:", error.message);
    return res.json({ source: "local", ...fallback, warning: error.skipOpenAI ? "تم تخطي ChatGPT مؤقتًا واستخدمنا مساعدة محلية." : "استخدمنا مساعدة محلية لأن اتصال ChatGPT تأخر." });
  }
}));

app.get("/api/ticktick/status", (req, res) => {
  const configured = isTickTickConfigured();
  const connected = configured && Boolean(getStoredTokens(req)?.accessToken);
  res.json({ configured, connected, projectName: HERO_PROJECT_NAME, timeZone: APP_TIME_ZONE });
});

app.get("/api/ticktick/diagnostics", (req, res) => {
  const configured = isTickTickConfigured();
  const cookieHeader = req.headers.cookie || "";
  const hasTokenCookie = /(?:^|;\s*)hero_ticktick_tokens=/.test(cookieHeader);
  res.json({ configured, connected: configured && Boolean(getStoredTokens(req)?.accessToken), hasTokenCookie, redirectUri: process.env.TICKTICK_REDIRECT_URI || "", cookieSecure: cookieIsSecure(), appTimeZone: APP_TIME_ZONE });
});

app.get("/api/ticktick/projects", asyncRoute(async (req, res) => {
  requireConfigured();
  const projects = await tickTickRequest(req, res, "/project");
  if (!Array.isArray(projects)) throw new PublicError(502, "לא התקבלה רשימת פרויקטים תקינה מ-TickTick.");
  const activeProjects = projects
    .filter((project) => project && project.id && project.closed !== true)
    .map((project) => ({ id: String(project.id), name: String(project.name || "TickTick"), color: typeof project.color === "string" ? project.color : "", kind: typeof project.kind === "string" ? project.kind : "TASK", viewMode: typeof project.viewMode === "string" ? project.viewMode : "list" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  res.json({ projects: activeProjects });
}));

app.get("/api/ticktick/today-tasks", asyncRoute(async (req, res) => {
  requireConfigured();
  const today = dateKeyInTimeZone(new Date());
  const requestedDate = typeof req.query.date === "string" ? req.query.date : "";
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  if (targetDate !== today) throw new PublicError(400, "אפשר לייבא רק את משימות היום הנוכחי.");
  const projects = await tickTickRequest(req, res, "/project");
  if (!Array.isArray(projects)) throw new PublicError(502, "לא התקבלה רשימת פרויקטים תקינה מ-TickTick.");
  const allActiveProjects = projects.filter((project) => project && project.id && project.closed !== true);
  const requestedProjectIds = selectedProjectIdsFromQuery(req.query.projectIds);
  const requestedIdSet = new Set(requestedProjectIds);
  const activeProjects = requestedProjectIds.length ? allActiveProjects.filter((project) => requestedIdSet.has(String(project.id))) : allActiveProjects;
  const collected = [];
  let failedProjects = 0;
  for (const project of activeProjects) {
    try {
      const data = await tickTickRequest(req, res, `/project/${encodeURIComponent(project.id)}/data`);
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      for (const task of tasks) {
        if (!isOpenTickTickTask(task) || taskDateKey(task) !== targetDate) continue;
        collected.push({ id: String(task.id), projectId: String(task.projectId || project.id), projectName: String(project.name || "TickTick"), title: String(task.title).trim().slice(0, 200), content: typeof task.content === "string" ? task.content.slice(0, 500) : "", dueDate: task.dueDate || task.startDate || null, priority: Number(task.priority) || 0 });
      }
    } catch (error) {
      if (Number(error?.status) === 401) throw error;
      failedProjects += 1;
      console.warn("Could not load TickTick project for daily import:", project.id);
    }
  }
  const unique = new Map();
  for (const task of collected) unique.set(`${task.projectId}:${task.id}`, task);
  const tasks = [...unique.values()].sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")) || Number(b.priority) - Number(a.priority) || a.title.localeCompare(b.title)).slice(0, 100);
  res.json({ date: targetDate, timeZone: APP_TIME_ZONE, projectScope: requestedProjectIds.length ? "selected" : "all", projectsRequested: requestedProjectIds.length || allActiveProjects.length, projectsScanned: activeProjects.length, failedProjects, tasks });
}));

app.get("/auth/ticktick", (req, res, next) => {
  try {
    requireConfigured();
    const authorizationUrl = new URL(TICKTICK_AUTH_URL);
    authorizationUrl.searchParams.set("client_id", process.env.TICKTICK_CLIENT_ID);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", process.env.TICKTICK_REDIRECT_URI);
    authorizationUrl.searchParams.set("scope", "tasks:read tasks:write");
    authorizationUrl.searchParams.set("state", createOAuthState());
    res.redirect(authorizationUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.get("/auth/ticktick/callback", asyncRoute(async (req, res) => {
  requireConfigured();
  if (req.query.error) return res.redirect("/?ticktick=denied");
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !verifyOAuthState(state)) return res.redirect("/?ticktick=state_error");
  const payload = await requestToken({ grant_type: "authorization_code", client_id: process.env.TICKTICK_CLIENT_ID, client_secret: process.env.TICKTICK_CLIENT_SECRET, code, redirect_uri: process.env.TICKTICK_REDIRECT_URI });
  writeStoredTokens(res, normalizeTokens(payload));
  return res.redirect("/?ticktick=connected");
}));

app.post("/api/ideas", asyncRoute(async (req, res) => {
  const idea = safeText(req.body?.idea, 600);
  if (idea.length < 4) throw new PublicError(400, "اكتب فكرة قصيرة من عدة كلمات أولاً.");
  const fallbackIdeas = { source: "local", ideas: [{ title: "فكرة قصيرة", summary: `نحوّل فكرتك إلى مشهد صغير: ${idea}`, firstStep: "اكتب جملة واحدة أو سجّل صوتاً قصيراً.", taskTitle: "تطوير فكرة إبداعية لمدة 10 دقائق", category: "creative" }] };
  if (!openAIAvailable()) return res.json({ ...fallbackIdeas, warning: openAISkipMessage() });
  try {
    const body = await openAIResponsesRequest({ model: OPENAI_IDEA_MODEL, input: `اقترح 3 أفكار آمنة وبسيطة باللغة العربية لطفل عمره 15 سنة بناءً على: ${idea}`, max_output_tokens: 700 }, OPENAI_TIMEOUT_MS);
    return res.json({ source: "openai", text: body?.output_text || body });
  } catch (error) {
    console.warn("OpenAI ideas failed; using local fallback:", error.message);
    return res.json({ ...fallbackIdeas, warning: error.skipOpenAI ? "تم تخطي ChatGPT مؤقتًا." : "استخدمنا فكرة محلية لأن AI غير متاح مؤقتًا." });
  }
}));

app.post("/api/ticktick/disconnect", (req, res) => {
  clearCookie(res, "hero_ticktick_tokens");
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
  const status = Number(error?.status) || 500;
  const message = error instanceof PublicError ? error.message : "אירעה שגיאה בשרת. נסה שוב בעוד רגע.";
  if (!(error instanceof PublicError)) console.error("Unexpected server error:", error);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Hero Family is running on port ${PORT}`);
});
