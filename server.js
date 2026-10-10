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
const APP_VERSION = "56.0.0";

let openAISkipUntil = 0;
let openAISkipReason = "";

class OpenAISkipError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenAISkipError";
    this.skipOpenAI = true;
  }
}

function isAnthropicConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function isOpenAIConfigured() {
  return isAnthropicConfigured() || Boolean(process.env.OPENAI_API_KEY);
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

// Claude is used instead of ChatGPT whenever ANTHROPIC_API_KEY is set.
// Same payload shape in, same {output_text} shape out, so callers don't change.
async function anthropicRequest(payload, timeoutMs) {
  let prompt = String(payload?.input || "");
  const schema = payload?.text?.format?.schema;
  if (schema) {
    prompt += "\n\nأعد JSON صالحًا فقط (بدون Markdown وبدون أي نص خارجه) ويطابق هذا المخطط تمامًا:\n" + JSON.stringify(schema);
  }
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: Math.min(16000, Math.max(300, Number(payload?.max_output_tokens) || 1500)),
      messages: [{ role: "user", content: prompt }]
    })
  }, timeoutMs);
  const body = await readResponseBody(response);
  if (!response.ok) {
    const message = body?.error?.message || `Claude request failed with status ${response.status}`;
    if (response.status === 429 || response.status === 402 || /credit|billing|quota/i.test(message)) {
      markOpenAISkipped("Claude quota/billing unavailable; using local fallback.");
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  let text = (Array.isArray(body?.content) ? body.content : []).map((c) => c?.text || "").join("").trim();
  if (schema) {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) text = text.slice(a, b + 1);
  }
  return { output_text: text, provider: "anthropic" };
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

const OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || "gpt-4o-mini";
const unusableModels = new Set();

function isModelAccessError(status, message = "") {
  return (status === 404 || status === 400 || status === 403) && /model|does not exist|do not have access|not found/i.test(String(message));
}

async function openAIResponsesRequest(payload, timeoutMs = OPENAI_TIMEOUT_MS) {
  if (isAnthropicConfigured()) {
    if (isOpenAISkipped()) throw new OpenAISkipError(openAISkipMessage());
    return anthropicRequest(payload, timeoutMs);
  }
  if (payload?.model && payload.model !== OPENAI_FALLBACK_MODEL && unusableModels.has(payload.model)) {
    payload = { ...payload, model: OPENAI_FALLBACK_MODEL };
  }
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

    if (payload?.model && payload.model !== OPENAI_FALLBACK_MODEL && isModelAccessError(response.status, message)) {
      unusableModels.add(payload.model);
      console.warn(`OpenAI model "${payload.model}" is unavailable (${message}); retrying with ${OPENAI_FALLBACK_MODEL}.`);
      return openAIResponsesRequest({ ...payload, model: OPENAI_FALLBACK_MODEL }, timeoutMs);
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

function normalizePinText(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  return String(value || "")
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[\s\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/^['"]|['"]$/g, "");
}

function secureEqualText(left, right) {
  const leftBuffer = Buffer.from(normalizePinText(left));
  const rightBuffer = Buffer.from(normalizePinText(right));
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

const BUILTIN_MEMBER_IDS = ["yaman", "judy"];
const FAMILY_MEMBERS = {
  yaman: { id: "yaman", name: "يَمان", label: "منطقة يَمان", icon: "🦸‍♂️", age: 15, builtin: true },
  judy: { id: "judy", name: "جودي", label: "منطقة جودي", icon: "🦸‍♀️", age: 8, builtin: true }
};
const memberPinHashes = new Map();
const MAX_FAMILY_MEMBERS = 8;

function hashMemberPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString("hex")}`;
}

function verifyMemberPin(pin, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(pin), salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicMember(member) {
  return { id: member.id, name: member.name, label: member.label, icon: member.icon, age: member.age, builtin: Boolean(member.builtin) };
}

async function loadFamilyMembers() {
  const { rows } = await pool.query(`SELECT id, name, icon, age, pin_hash FROM hero_family_members ORDER BY created_at ASC`);
  for (const id of Object.keys(FAMILY_MEMBERS)) if (!BUILTIN_MEMBER_IDS.includes(id)) { delete FAMILY_MEMBERS[id]; memberPinHashes.delete(id); }
  for (const row of rows) {
    if (BUILTIN_MEMBER_IDS.includes(row.id)) continue;
    FAMILY_MEMBERS[row.id] = { id: row.id, name: row.name, label: `منطقة ${row.name}`, icon: row.icon || "🌟", age: Number(row.age) || 10, builtin: false };
    if (row.pin_hash) memberPinHashes.set(row.id, row.pin_hash);
  }
}

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

function addDaysToDateKey(value, deltaDays) {
  const key = familyDateKey(value);
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

function previousDateKey(value) {
  return addDaysToDateKey(value, -1);
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
        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE hero_family_tasks ADD COLUMN IF NOT EXISTS checklist_done JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE hero_family_tasks DROP CONSTRAINT IF EXISTS hero_family_tasks_assignee_check;

        CREATE TABLE IF NOT EXISTS hero_family_members (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT '',
          age INTEGER NOT NULL DEFAULT 10,
          pin_hash TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS hero_family_school (
          assignee TEXT PRIMARY KEY,
          school_start TEXT NOT NULL DEFAULT '08:00',
          school_end TEXT NOT NULL DEFAULT '14:00',
          school_days JSONB NOT NULL DEFAULT '[0,1,2,3,4]'::jsonb
        );

        CREATE TABLE IF NOT EXISTS hero_family_program_runs (
          assignee TEXT NOT NULL,
          run_date DATE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (assignee, run_date)
        );

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

        ALTER TABLE hero_family_events DROP CONSTRAINT IF EXISTS hero_family_events_assignee_check;
        CREATE INDEX IF NOT EXISTS hero_family_events_date_idx ON hero_family_events (event_date, assignee);

        CREATE TABLE IF NOT EXISTS hero_family_prayer_times (
          date_key TEXT PRIMARY KEY,
          fajr TEXT NOT NULL DEFAULT '',
          sunrise TEXT NOT NULL DEFAULT '',
          dhuhr TEXT NOT NULL DEFAULT '',
          asr TEXT NOT NULL DEFAULT '',
          maghrib TEXT NOT NULL DEFAULT '',
          isha TEXT NOT NULL DEFAULT '',
          source_name TEXT NOT NULL DEFAULT 'مواقيت فلسطين - إدخال الأهل',
          note TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await loadFamilyMembers();
    })().catch((error) => {
      familyDatabaseReady = null;
      throw error;
    });
  }
  await familyDatabaseReady;
}

function parentPinConfigured() {
  return normalizePinText(process.env.PARENT_PIN).length >= 4;
}

const CHILD_PIN_VARIABLE_ALIASES = {
  yaman: ["YAMAN_PIN"],
  judy: ["JUDY_PIN", "JUDI_PIN", "JODI_PIN"]
};

function childPinVariableName(assignee) {
  const key = String(assignee || "").toLowerCase();
  const aliases = CHILD_PIN_VARIABLE_ALIASES[key] || [`${String(assignee || "").toUpperCase()}_PIN`];
  return aliases.find((name) => normalizePinText(process.env[name]).length >= 4) || aliases[0];
}

function childPinConfigured(assignee) {
  if (memberPinHashes.has(assignee)) return true;
  return normalizePinText(process.env[childPinVariableName(assignee)]).length >= 4;
}

function checkChildPin(assignee, pin) {
  const envName = childPinVariableName(assignee);
  if (normalizePinText(process.env[envName]).length >= 4) return secureEqualText(pin, process.env[envName]);
  if (memberPinHashes.has(assignee)) return verifyMemberPin(normalizePinText(pin), memberPinHashes.get(assignee));
  return false;
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

const DEFAULT_CHECKLISTS = {
  study: ["جهّز الكتب والدفتر والقلم", "اقرأ المطلوب بهدوء", "ابدأ بالجزء الأول", "اكتب أو قل ما فهمته", "اطلب مساعدة إذا احتجت"],
  prayer: ["توضأ بهدوء", "اتجه إلى القبلة", "صلِّ دون استعجال", "اذكر الله بعد الصلاة"],
  routine: ["افعل الخطوة الأولى", "افعل الخطوة الثانية", "تأكد أنك أنهيت كل شيء"],
  home: ["اعرف المطلوب بالضبط", "حضّر ما تحتاجه", "نفّذ المهمة", "أعد الأشياء إلى مكانها"],
  movement: ["اشرب ماء", "ابدأ بحركة خفيفة", "استمر حتى ينتهي الوقت", "اجلس وخذ نفساً هادئاً"],
  creative: ["اختر فكرة واحدة", "ابدأ بنسخة بسيطة", "أضف تفصيلاً واحداً", "احفظ ما أنجزته"],
  breathing: ["اجلس بوضع مريح", "تنفّس ببطء أربع مرات", "لاحظ جسمك", "ارجع لمهامك"],
  social: ["اختر جملة واحدة", "قلها بصوت هادئ", "استمع للرد", "انتهى"],
  youtube: ["اختر فكرة واحدة", "اكتب الهدف في جملة", "جرّب تسجيلاً قصيراً", "راجع الخصوصية والجودة"],
  other: ["اقرأ المطلوب", "ابدأ بخطوة صغيرة", "أكمل المهمة", "تأكد أنك انتهيت"]
};

function safeChecklist(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(typeof item === "string" ? item : item?.text, 90)).filter(Boolean).slice(0, 8);
}

function checklistFromRow(row) {
  const own = Array.isArray(row.checklist) ? safeChecklist(row.checklist) : [];
  const steps = own.length ? own : (DEFAULT_CHECKLISTS[row.task_type] || DEFAULT_CHECKLISTS.other);
  const doneIdx = new Set((Array.isArray(row.checklist_done) ? row.checklist_done : []).map(Number));
  return steps.map((text, index) => ({ text, done: doneIdx.has(index) }));
}

function mapFamilyTask(row) {
  const basePoints = Number(row.points || 0);
  const bonusPoints = taskBonusPointsFromRow(row);
  const earnedPoints = earnedPointsFromRow(row);
  const badges = achievementBadgesFromRow(row);

  return {
    id: row.id,
    assignee: row.assignee,
    title: row.title,
    type: row.task_type,
    points: basePoints,
    basePoints,
    bonusPoints,
    earnedPoints,
    badges,
    date: pgDateKey(row.due_date),
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
    ticktickCompleted: Boolean(row.ticktick_completed),
    checklist: checklistFromRow(row)
  };
}
function pgDateKey(v) {
  if (v instanceof Date) {
    // pg parses DATE columns as local-midnight Dates; read local parts so the day never shifts.
    return [v.getFullYear(), String(v.getMonth() + 1).padStart(2, "0"), String(v.getDate()).padStart(2, "0")].join("-");
  }
  return String(v || "").slice(0, 10);
}

function mapFamilyEvent(row) {
  return { id: row.id, assignee: row.assignee, title: row.title, date: pgDateKey(row.event_date), time: row.event_time || "", note: row.note || "" };
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeTaskType(value) {
  return ["study", "home", "creative", "movement", "social", "routine", "breathing", "youtube", "prayer", "other"].includes(value) ? value : "other";
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

function taskTypeAchievement(type) {
  const map = {
    study: { key: "smart-thinker", label: "مفكر ذكي", icon: "🧠" },
    creative: { key: "creative-hero", label: "مبدع", icon: "🎨" },
    movement: { key: "energy-hero", label: "قوي اليوم", icon: "💪" },
    home: { key: "responsible-helper", label: "مسؤول", icon: "🏡" },
    social: { key: "kind-heart", label: "لطيف", icon: "🤝" },
    routine: { key: "organized", label: "منظم", icon: "📋" },
    breathing: { key: "calm-breath", label: "هدوء وتنفس", icon: "🌬️" },
    youtube: { key: "channel-builder", label: "صانع محتوى", icon: "🎬" },
    prayer: { key: "spiritual-time", label: "وقت روحاني", icon: "🕌" },
    other: { key: "small-step", label: "خطوة جميلة", icon: "🌟" }
  };
  return map[type] || map.other;
}

function taskBonusPointsFromRow(row) {
  const type = row?.task_type || row?.type || "other";
  if (type === "prayer") return 0;
  const done = Boolean(row?.done);
  const started = Boolean(row?.started_at || row?.startedAt);
  const timerMinutes = Number(row?.timer_minutes ?? row?.timerMinutes ?? 0);
  if (!done) return started ? 2 : 0;
  let bonus = 0;
  if (started) bonus += 2;
  if (timerMinutes > 0) bonus += 3;
  if (["study", "creative", "movement", "youtube"].includes(type)) bonus += 2;
  return Math.min(10, bonus);
}

function achievementBadgesFromRow(row) {
  const type = row?.task_type || row?.type || "other";
  const badges = [];
  const typeBadge = taskTypeAchievement(type);

  if (type === "prayer") {
    return [typeBadge];
  }

  if (row?.started_at || row?.startedAt) {
    badges.push({ key: "starter", label: "بطل البداية", icon: "🚀" });
  }

  if (Number(row?.timer_minutes ?? row?.timerMinutes ?? 0) > 0 && row?.done) {
    badges.push({ key: "timer-master", label: "ملك المؤقت", icon: "⏱️" });
  }

  if (row?.done) {
    badges.push({ key: "completed", label: "أنجزت", icon: "✅" });
  }

  badges.push(typeBadge);

  const unique = new Map();
  for (const badge of badges) unique.set(badge.key, badge);
  return [...unique.values()].slice(0, 5);
}

function earnedPointsFromRow(row) {
  const type = row?.task_type || row?.type || "other";
  if (type === "prayer") return 0;
  const base = Number(row?.points || 0);
  if (!row?.done) return 0;
  return base + taskBonusPointsFromRow(row);
}

const DEFAULT_AUTOMATIC_TASK_SLOTS = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
  "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
  "18:00", "19:00", "20:00", "21:00"
];

function minutesFromClock(value) {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clockFromMinutes(value) {
  const minutes = Math.max(0, Math.min(23 * 60 + 59, Number(value) || 0));
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function automaticSlotFallback(index) {
  const base = minutesFromClock("06:00") || 360;
  return clockFromMinutes(base + Math.max(0, Number(index) || 0) * 45);
}

async function autoDistributeTasksForDate(date, assignee) {
  await ensureFamilyDatabase();
  if (!isFamilyMember(assignee)) return 0;
  const day = familyDateKey(date);
  const { rows } = await pool.query(
    `SELECT id, task_type, suggested_time, created_at
       FROM hero_family_tasks
      WHERE assignee = $1 AND due_date = $2
      ORDER BY
        CASE WHEN task_type = 'prayer' THEN 0 ELSE 1 END,
        NULLIF(suggested_time, '') ASC NULLS LAST,
        created_at ASC`,
    [assignee, day]
  );

  const used = new Set(rows.map((row) => safeTime(row.suggested_time)).filter(Boolean));
  const updates = [];
  for (const row of rows) {
    const current = safeTime(row.suggested_time);
    if (current || row.task_type === "prayer") continue;
    let chosen = DEFAULT_AUTOMATIC_TASK_SLOTS.find((slot) => !used.has(slot));
    if (!chosen) chosen = automaticSlotFallback(used.size + updates.length);
    used.add(chosen);
    updates.push({ id: row.id, time: chosen });
  }

  for (const update of updates) {
    await pool.query(
      `UPDATE hero_family_tasks SET suggested_time = $2, updated_at = NOW() WHERE id = $1`,
      [update.id, update.time]
    );
  }
  return updates.length;
}

async function autoDistributeFamilyDate(date, assignee = "") {
  await ensureFamilyDatabase();
  const day = familyDateKey(date);
  if (isFamilyMember(assignee)) {
    const count = await autoDistributeTasksForDate(day, assignee);
    return { [assignee]: count };
  }
  const result = {};
  for (const member of Object.keys(FAMILY_MEMBERS)) {
    result[member] = await autoDistributeTasksForDate(day, member);
  }
  return result;
}

async function previousIncompleteSummary(date) {
  await ensureFamilyDatabase();
  const previousDate = previousDateKey(date);
  const { rows } = await pool.query(
    `SELECT assignee, COUNT(*) AS incomplete_count
       FROM hero_family_tasks
      WHERE due_date = $1 AND done = FALSE
      GROUP BY assignee`,
    [previousDate]
  );
  const summary = Object.fromEntries(Object.keys(FAMILY_MEMBERS).map((id) => [id, 0]));
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.assignee)) {
      summary[row.assignee] = Number(row.incomplete_count || 0);
    }
  }
  return { previousDate, summary, total: Object.values(summary).reduce((sum, value) => sum + value, 0) };
}

async function previousIncompleteForMember(date, assignee) {
  const result = await previousIncompleteSummary(date);
  return { previousDate: result.previousDate, incomplete: Number(result.summary[assignee] || 0) };
}

async function getFamilyTasks(assignee, date, options = {}) {
  await ensureFamilyDatabase();
  if (options.autoDistribute !== false) {
    await autoDistributeTasksForDate(date, assignee);
  }
  const { rows } = await pool.query(
    `SELECT * FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 ORDER BY NULLIF(suggested_time, '') ASC NULLS LAST, done ASC, created_at ASC`,
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

const PRAYER_SOURCE_MODE = String(process.env.PRAYER_SOURCE_MODE || "shobiddak").toLowerCase();
const PRAYER_SHOBIDDAK_URL = process.env.PRAYER_SHOBIDDAK_URL || "https://www.shobiddak.com/prayers/prayer_today?town_id=164";
const PRAYER_SOURCE_NAME = process.env.PRAYER_SOURCE_NAME || "شو بدك - مواقيت بيت حنينا/القدس";
const PRAYER_LOCATION_NAME = process.env.PRAYER_LOCATION_NAME || "بيت حنينا - القدس";
const PRAYER_APP_REFERENCE = process.env.PRAYER_APP_REFERENCE || "مواقيت فلسطين";

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
  const match = String(value || "").match(/\b([0-2]?\d:[0-5]\d)\b/);
  if (!match) return "";
  const [hours, minutes] = match[1].split(":");
  return `${String(Number(hours)).padStart(2, "0")}:${minutes}`;
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToReadableText(html = "") {
  return decodeHtmlEntities(String(html))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(tr|li|p|div|td|th|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function findPrayerTimeByLabels(text, labels = []) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = new RegExp(`${escaped}[\\s\\S]{0,80}?([0-2]?\\d:[0-5]\\d)`, "i").exec(text);
    const reverse = new RegExp(`([0-2]?\\d:[0-5]\\d)[\\s\\S]{0,80}?${escaped}`, "i").exec(text);
    const found = direct?.[1] || reverse?.[1];
    const cleaned = cleanPrayerTime(found);
    if (cleaned) return cleaned;
  }
  return "";
}

function manualPrayerComplete(times = {}) {
  return Boolean(times.fajr && times.dhuhr && times.asr && times.maghrib && times.isha);
}

function normalizePrayerTimesObject(input = {}, date = new Date(), sourceName = "مواقيت فلسطين") {
  return {
    fajr: safeTime(input.fajr),
    sunrise: safeTime(input.sunrise),
    dhuhr: safeTime(input.dhuhr),
    asr: safeTime(input.asr),
    maghrib: safeTime(input.maghrib),
    isha: safeTime(input.isha),
    source: sourceName,
    sourceMode: PRAYER_SOURCE_MODE,
    sourceUrl: PRAYER_SHOBIDDAK_URL,
    appReference: PRAYER_APP_REFERENCE,
    location: PRAYER_LOCATION_NAME,
    date: familyDateKey(date),
    trustedManual: true
  };
}

function envPrayerTimes(date) {
  const times = normalizePrayerTimesObject({
    fajr: process.env.PRAYER_FAJR,
    sunrise: process.env.PRAYER_SUNRISE,
    dhuhr: process.env.PRAYER_DHUHR,
    asr: process.env.PRAYER_ASR,
    maghrib: process.env.PRAYER_MAGHRIB,
    isha: process.env.PRAYER_ISHA
  }, date, process.env.PRAYER_ENV_SOURCE_NAME || "مواقيت فلسطين - Railway Variables");
  return manualPrayerComplete(times) ? times : null;
}

async function getStoredManualPrayerTimes(date) {
  if (!pool) return null;
  try {
    await ensureFamilyDatabase();
    const key = familyDateKey(date);
    const { rows } = await pool.query("SELECT * FROM hero_family_prayer_times WHERE date_key = $1", [key]);
    if (!rows[0]) return null;
    const times = normalizePrayerTimesObject(rows[0], key, rows[0].source_name || "مواقيت فلسطين - إدخال الأهل");
    times.note = rows[0].note || "";
    times.updatedAt = rows[0].updated_at || null;
    return manualPrayerComplete(times) ? times : null;
  } catch (error) {
    console.warn("Could not read manual Palestine prayer times:", error.message);
    return null;
  }
}

async function saveManualPrayerTimes(date, body = {}) {
  await ensureFamilyDatabase();
  const key = familyDateKey(date);
  const times = normalizePrayerTimesObject(body, key, safeText(body.sourceName, 120) || "مواقيت فلسطين - إدخال الأهل");
  if (!manualPrayerComplete(times)) throw new PublicError(400, "أدخل مواقيت الفجر والظهر والعصر والمغرب والعشاء بصيغة HH:MM حسب مواقيت فلسطين.");
  const note = safeText(body.note, 260);
  const { rows } = await pool.query(
    `INSERT INTO hero_family_prayer_times (date_key, fajr, sunrise, dhuhr, asr, maghrib, isha, source_name, note, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (date_key) DO UPDATE SET
       fajr = EXCLUDED.fajr,
       sunrise = EXCLUDED.sunrise,
       dhuhr = EXCLUDED.dhuhr,
       asr = EXCLUDED.asr,
       maghrib = EXCLUDED.maghrib,
       isha = EXCLUDED.isha,
       source_name = EXCLUDED.source_name,
       note = EXCLUDED.note,
       updated_at = NOW()
     RETURNING *`,
    [key, times.fajr, times.sunrise, times.dhuhr, times.asr, times.maghrib, times.isha, times.source, note]
  );
  return normalizePrayerTimesObject(rows[0], key, rows[0].source_name);
}

function parseShobiddakPrayerTimes(html, date) {
  const text = htmlToReadableText(html);
  const prayerTimes = {
    fajr: findPrayerTimeByLabels(text, ["الفجر", "فجر", "Fajr"]),
    dhuhr: findPrayerTimeByLabels(text, ["الظهر", "ظهر", "Dhuhr", "Zuhr"]),
    asr: findPrayerTimeByLabels(text, ["العصر", "عصر", "Asr"]),
    maghrib: findPrayerTimeByLabels(text, ["المغرب", "مغرب", "Maghrib"]),
    isha: findPrayerTimeByLabels(text, ["العشاء", "عشاء", "Isha"]),
    source: PRAYER_SOURCE_NAME,
    sourceMode: PRAYER_SOURCE_MODE,
    sourceUrl: PRAYER_SHOBIDDAK_URL,
    appReference: PRAYER_APP_REFERENCE,
    location: PRAYER_LOCATION_NAME,
    date: familyDateKey(date)
  };

  const missing = ["fajr", "dhuhr", "asr", "maghrib", "isha"].filter((key) => !prayerTimes[key]);
  if (missing.length) {
    throw new Error(`لم أستطع قراءة كل مواقيت الصلاة من شو بدك: ${missing.join(", ")}`);
  }

  return prayerTimes;
}

async function getShobiddakPrayerTimes(date) {
  if (PRAYER_SOURCE_MODE !== "shobiddak") {
    throw new Error(`مصدر مواقيت الصلاة غير مدعوم الآن: ${PRAYER_SOURCE_MODE}`);
  }

  const response = await fetchWithTimeout(PRAYER_SHOBIDDAK_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en;q=0.8,he;q=0.7",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (HeroFamily/56; prayer-times-check)"
    }
  }, EXTERNAL_FETCH_TIMEOUT_MS);

  const body = await response.text();
  if (!response.ok || !body) {
    throw new Error(`تعذر جلب مواقيت الصلاة من شو بدك (${response.status})`);
  }

  return parseShobiddakPrayerTimes(body, date);
}

async function getJerusalemPrayerTimes(date) {
  return getShobiddakPrayerTimes(date);
}

async function getPrayerTimesSafely(date) {
  const storedManual = await getStoredManualPrayerTimes(date);
  if (storedManual) {
    return { prayerTimes: storedManual, warning: "" };
  }

  const envManual = envPrayerTimes(date);
  if (envManual) {
    return { prayerTimes: envManual, warning: "" };
  }

  try {
    return { prayerTimes: await getJerusalemPrayerTimes(date), warning: "" };
  } catch (error) {
    console.warn("Could not refresh Jerusalem prayer times:", error.message);
    return {
      prayerTimes: { fajr: "", sunrise: "", dhuhr: "", asr: "", maghrib: "", isha: "", source: "unavailable", sourceMode: PRAYER_SOURCE_MODE, sourceUrl: PRAYER_SHOBIDDAK_URL, appReference: PRAYER_APP_REFERENCE, location: PRAYER_LOCATION_NAME, date: familyDateKey(date) },
      warning: `تعذر جلب مواقيت الصلاة تلقائيًا من ${PRAYER_SOURCE_NAME}. موقع شو بدك قد يمنع القراءة الآلية أحيانًا. أدخل مواقيت اليوم مرة واحدة من تطبيق مواقيت فلسطين/شو بدك في لوحة الوالدين، وسأستخدمها لإضافة تذكيرات الصلاة بدقة.`
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
    familyMessage: `${plan.familyMessage || ""} تم تحديث مواقيت الصلاة تلقائيًا من مصدر شو بدك/مواقيت فلسطين لهذا اليوم.`,
    children: { yaman: addToChild(plan.children.yaman), judy: addToChild(plan.children.judy) },
    prayerTimes
  };
}

function normalizePlanTask(task) {
  const type = safeTaskType(task?.type);
  const isPrayer = type === "prayer";
  const isBreathing = type === "breathing";
  const isYouTube = type === "youtube";
  const basePoints = Number(task?.points);
  const defaultPoints = isBreathing ? 5 : (isYouTube ? 15 : (type === "study" || type === "creative" ? 15 : 10));
  const points = isPrayer ? 0 : Math.min(30, Math.max(5, Number.isFinite(basePoints) ? basePoints : defaultPoints));
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
    ["breathing", "مهارة تنفس هادئة: وردة وشمعة", 5, 5],
    ["study", "قراءة أو مراجعة علمية قصيرة", 10, 20],
    ["youtube", "مدرب القناة: فكرة فيديو آمنة وقصيرة", 15, 20],
    ["creative", "دبلجة أو تسجيل صوتي قصير", 15, 20],
    ["home", "مسؤولية منزلية صغيرة", 10, 12],
    ["social", "تدريب جملة اجتماعية لطيفة", 10, 8],
    ["youtube", "سيناريو قصير لقناة شخصية بدون نشر مباشر", 15, 25],
    ["creative", "رسم فكرة أو مشهد لفيديو", 10, 20],
    ["breathing", "تنفس الأصابع الخمسة وهدوء الجسم", 5, 5]
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
              tasks: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, type: { type: "string", enum: ["study", "home", "creative", "movement", "social", "routine", "breathing", "youtube", "other"] }, points: { type: "integer" }, note: { type: "string" }, suggestedTime: { type: "string" }, timerMinutes: { type: "integer" } }, required: ["title", "type", "points", "note", "suggestedTime", "timerMinutes"] } }
            },
            required: ["encouragement", "tasks"]
          },
          judy: {
            type: "object",
            additionalProperties: false,
            properties: {
              encouragement: { type: "string" },
              tasks: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, type: { type: "string", enum: ["study", "home", "creative", "movement", "social", "routine", "breathing", "youtube", "other"] }, points: { type: "integer" }, note: { type: "string" }, suggestedTime: { type: "string" }, timerMinutes: { type: "integer" } }, required: ["title", "type", "points", "note", "suggestedTime", "timerMinutes"] } }
            },
            required: ["encouragement", "tasks"]
          }
        },
        required: ["yaman", "judy"]
      }
    },
    required: ["familyMessage", "children"]
  };

  const prompt = `أنت Hero، مدرب يومي عربي دافئ لعائلة فيها يَمان وجودي. أنشئ خطة كاملة ليوم ${date} من الساعة ${startTime} حتى ${endTime}. المطلوب بالضبط ${count} مهام تعليمية/إثرائية/حياتية لكل طفل، موزعة على هذه الساعات بالترتيب: ${slots.join(", ")}. اجعل لكل ساعة مهمة واحدة صغيرة لكل طفل. لا تُدخل الصلاة داخل JSON؛ النظام سيضيف مواقيت الصلاة تلقائيًا من مصدر شو بدك/مواقيت فلسطين. مواقيت الصلاة للوعي فقط: الفجر ${prayerTimes.fajr || "غير متاح"}، الظهر ${prayerTimes.dhuhr || "غير متاح"}، العصر ${prayerTimes.asr || "غير متاح"}، المغرب ${prayerTimes.maghrib || "غير متاح"}، العشاء ${prayerTimes.isha || "غير متاح"}. يَمان يحب الدبلجة والرسم والرياضيات وبناء قناة شخصية آمنة، ويحتاج خطوات قصيرة ومؤقتات وتمارين تهدئة بسيطة ولغة محترمة بلا أي تصنيفات أو تسميات حساسة. اجعل تمارين التنفس قصيرة جدًا، اختيارية، بلا إجبار وبلا حبس نفس. جودي تحتاج مهام لطيفة وواضحة ومتعلمة. نوّع بين دراسة، حركة، إبداع، مسؤولية بيت، مهارة تواصل، روتين، تنفس/تهدئة ذاتية، وتدريب قناة شخصية آمنة ليَمان: فكرة حلقة، سيناريو قصير، دبلجة/تسجيل، مراجعة خصوصية، ثم موافقة الأهل قبل أي نشر. نقاط الصلاة لا تُحسب ولا ترتبط بمكافآت. اجعل timerMinutes بين 0 و60. استخدم timer للرياضيات، القراءة، الإبداع، الحركة والتركيز. أهداف الوالدين لهذا اليوم: ${parentGoals || "لا توجد أهداف إضافية"}. يجب احترام أهداف الوالدين طالما هي آمنة ومناسبة للأطفال. أعد JSON فقط حسب المخطط.`;
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


/* ===================== Fixed weekly program (no AI needed) =====================
   Study days: Mon, Tue, Wed, Thu, Sat. Fri and Sun are lighter (no study block).
   Teens (13+) get a 2-hour review block; younger children get two short sessions with a break. */
const STUDY_WEEKDAYS = new Set([1, 2, 3, 4, 6]);

const DEFAULT_SCHOOL = { start: "08:00", end: "14:00", days: [0, 1, 2, 3, 4] };

function normalizeSchool(input) {
  const start = safeTime(input?.start) || DEFAULT_SCHOOL.start;
  let end = safeTime(input?.end) || DEFAULT_SCHOOL.end;
  if ((minutesFromClock(end) ?? 0) <= (minutesFromClock(start) ?? 0)) end = DEFAULT_SCHOOL.end;
  const days = Array.isArray(input?.days) ? [...new Set(input.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_SCHOOL.days;
  return { start, end, days };
}

async function getSchoolSettings(member) {
  const { rows } = await pool.query(`SELECT school_start, school_end, school_days FROM hero_family_school WHERE assignee = $1`, [member]);
  if (!rows[0]) return { ...DEFAULT_SCHOOL, days: [...DEFAULT_SCHOOL.days] };
  return normalizeSchool({ start: rows[0].school_start, end: rows[0].school_end, days: rows[0].school_days });
}

function addMinutes(clock, delta) {
  return clockFromMinutes((minutesFromClock(clock) ?? 0) + delta);
}

function weekdayOfDateKey(date) {
  return new Date(`${familyDateKey(date)}T12:00:00Z`).getUTCDay();
}

function programTask(title, type, time, timer, note, checklist, points) {
  return { title, type, suggestedTime: time, timerMinutes: timer, note, checklist, points: points ?? (type === "prayer" ? 0 : 10), source: "program" };
}

function buildProgramTasks(member, date, school = DEFAULT_SCHOOL) {
  const info = FAMILY_MEMBERS[member];
  const teen = (info?.age || 10) >= 13;
  const day = weekdayOfDateKey(date);
  const study = STUDY_WEEKDAYS.has(day);
  const tasks = [];
  const atSchool = school.days.includes(day);
  const studyStart = atSchool ? (minutesFromClock(addMinutes(school.end, teen ? 120 : 90)) < 15 * 60 + 30 ? "15:30" : addMinutes(school.end, teen ? 120 : 90)) : (teen ? "16:00" : "15:30");

  tasks.push(programTask("نظافة شخصية صباحية", "routine", atSchool ? addMinutes(school.start, -70) : "08:00", 10,
    "روتين ثابت كل صباح، بنفس الترتيب.",
    ["اغسل وجهك بالماء والصابون", "نظّف أسنانك بالفرشاة لمدة دقيقتين", "رتّب شعرك", "البس ملابس نظيفة", "رتّب سريرك"]));

  if (atSchool) {
    tasks.push(programTask(`المدرسة (${school.start} - ${school.end})`, "other", addMinutes(school.start, -30), 0,
      `ساعات المدرسة من ${school.start} إلى ${school.end}.`,
      ["جهّز الحقيبة والوجبة وقارورة الماء", "اذهب إلى المدرسة في الوقت", "عُد إلى البيت وأخرج أغراضك من الحقيبة"], 0));
  }

  if (study && teen) {
    tasks.push(programTask("مراجعة الدروس (ساعتان)", "study", studyStart, 120,
      "ساعتان من المراجعة، في جلستين بينهما استراحة قصيرة.",
      ["جهّز الكتب والدفتر والقلم وكوب ماء", "ضع هاتفك بعيداً عنك", "الجلسة الأولى: راجع 50 دقيقة", "استراحة 10 دقائق: قف وتحرّك واشرب", "الجلسة الثانية: راجع 50 دقيقة", "اكتب ما راجعته في ثلاثة أسطر", "اكتب سؤالاً واحداً لتسأل عنه غداً"], 20));
  } else if (study) {
    tasks.push(programTask("مراجعة الدروس: الجزء الأول", "study", studyStart, 30,
      "ثلاثون دقيقة فقط، ثم استراحة.",
      ["جهّز الكتاب والدفتر والقلم", "اقرأ الدرس الأول", "حلّ التمرين الأول", "ضع علامة على ما لم تفهمه"], 15));
    tasks.push(programTask("استراحة حركة", "movement", addMinutes(studyStart, 35), 10,
      "حركة قصيرة بين جلستين.",
      ["اشرب ماء", "تحرّك أو اقفز عشر مرات", "اجلس وخذ نفساً هادئاً"], 5));
    tasks.push(programTask("مراجعة الدروس: الجزء الثاني", "study", addMinutes(studyStart, 50), 30,
      "الجلسة الأخيرة اليوم.",
      ["اقرأ الدرس الثاني", "حلّ التمرين الثاني", "اقرأ ما كتبته مرة واحدة", "اطلب من أحد أن يسمع ما تعلمته"], 15));
  } else {
    tasks.push(programTask(teen ? "وقت هواية أو قراءة حرة" : "قراءة قصة أو رسم حر", "creative", "16:00", 30,
      "ليس يوم مراجعة. وقت حر ومريح.",
      ["اختر شيئاً تحبه: كتاب أو رسم أو هواية", "افعله لمدة نصف ساعة", "رتّب أدواتك بعد الانتهاء"], 10));
  }

  if (day === 5) {
    tasks.push(programTask("الاستعداد لصلاة الجمعة", "prayer", "11:30", 0,
      "الجمعة يوم مميز. اغتسل وتطيّب واذهب مع أهلك.",
      ["اغتسل", "البس ملابس نظيفة", "تطيّب", "اذهب إلى الصلاة مع أهلك"]));
  }

  const studyEnd = study ? addMinutes(studyStart, teen ? 120 : 80) : "17:00";
  tasks.push(programTask(teen ? "رياضة أو مشي" : "لعب بالحركة", "movement", addMinutes(studyEnd, 15), 25,
    "حركة يومية خفيفة.",
    ["اشرب ماء", "ابدأ بتمدد خفيف", teen ? "امشِ أو مارس رياضتك 20 دقيقة" : "العب بالحركة 20 دقيقة", "اجلس وخذ نفساً هادئاً"], 10));

  tasks.push(programTask(teen ? "ترتيب الغرفة وتجهيز الغد" : "ترتيب الألعاب وتجهيز الحقيبة", "home", "19:30", 15,
    "تجهيز اليوم التالي يجعل الصباح أهدأ.",
    teen
      ? ["ضع الأشياء المبعثرة في أماكنها", "جهّز الحقيبة والكتب لغد", "حضّر ملابس الغد", "اشحن هاتفك خارج غرفة النوم"]
      : ["ضع الألعاب في مكانها", "جهّز الحقيبة", "ضع ملابس الغد على الكرسي"]));

  tasks.push(programTask("نظافة شخصية مسائية", "routine", "20:45", 10,
    "روتين ثابت قبل النوم.",
    ["نظّف أسنانك بالفرشاة", "اغسل وجهك ويديك", "البس ملابس النوم"]));

  tasks.push(programTask("أذكار النوم وقراءة القرآن", "prayer", "21:00", 15,
    teen ? "قبل النوم: أذكار، ثم قرآن، ثم نوم. بلا نقاط." : "قبل النوم: أذكار ثم سورة قصيرة. بلا نقاط.",
    teen
      ? ["اقرأ آية الكرسي", "اذكر الله: تسبيح وحمد وتكبير", "اقرأ ما تيسّر من القرآن", "أطفئ الشاشة ونم"]
      : ["اقرأ آية الكرسي مع أحد أهلك", "اقرأ سورة قصيرة", "قل: الحمد لله", "نم"]));

  return tasks;
}

const programLocks = new Map();

function applyProgramForMember(member, date, options = {}) {
  const key = `${member}:${familyDateKey(date)}`;
  const previous = programLocks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => applyProgramNow(member, date, options));
  programLocks.set(key, next);
  next.finally(() => { if (programLocks.get(key) === next) programLocks.delete(key); }).catch(() => {});
  return next;
}

async function applyProgramNow(member, date, { force = false, replace = false } = {}) {
  await ensureFamilyDatabase();
  if (!isFamilyMember(member)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  const day = familyDateKey(date);

  const claimed = await pool.query(`INSERT INTO hero_family_program_runs (assignee, run_date) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [member, day]);
  if (!force) {
    if (!claimed.rows[0]) return { inserted: [], skipped: true, reason: "ran" };
    const existing = await pool.query(`SELECT 1 FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 AND task_type <> 'prayer' LIMIT 1`, [member, day]);
    if (existing.rows[0]) return { inserted: [], skipped: true, reason: "has_tasks" };
  }

  if (replace) {
    await pool.query(
      `DELETE FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 AND done = FALSE AND task_type <> 'prayer' AND source NOT IN ('parent','ticktick') AND ticktick_task_id IS NULL`,
      [member, day]
    );
  }
  const prayerResult = await getPrayerTimesSafely(day);
  const school = await getSchoolSettings(member);
  const tasks = [...buildProgramTasks(member, day, school), ...buildPrayerTasks(prayerResult.prayerTimes)];
  const inserted = [];
  for (const task of tasks) {
    const exists = await pool.query(`SELECT 1 FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 AND title = $3 LIMIT 1`, [member, day, task.title]);
    if (exists.rows[0]) continue;
    const { rows } = await pool.query(
      `INSERT INTO hero_family_tasks (id, assignee, title, task_type, points, due_date, note, suggested_time, timer_minutes, source, checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
      [crypto.randomUUID(), member, task.title, task.type, task.type === "prayer" ? 0 : (task.points ?? 10), day, task.note || "", safeTime(task.suggestedTime), safeTimerMinutes(task.timerMinutes), task.source || "program", JSON.stringify(safeChecklist(task.checklist))]
    );
    inserted.push(mapFamilyTask(rows[0]));
  }
  await autoDistributeTasksForDate(day, member);
  return { inserted, warning: prayerResult.warning || "" };
}

async function ensureTodayProgram(member, date) {
  if (process.env.PROGRAM_AUTO === "off") return;
  if (familyDateKey(date) !== dateKeyInTimeZone(new Date())) return;
  try {
    await applyProgramForMember(member, date);
  } catch (error) {
    console.warn("Could not apply the daily program:", error.message);
  }
}

async function seedTodayTasksForMember(req, res, member, date) {
  return applyProgramForMember(member, date, { force: true });
}

function localEndDayMessage(member, tasks) {
  const name = FAMILY_MEMBERS[member]?.name || "الطفل";
  const list = Array.isArray(tasks) ? tasks : [];
  const doneTasks = list.filter((task) => task.done);
  const openTasks = list.filter((task) => !task.done);
  const points = doneTasks.reduce((sum, task) => sum + Number(task.earnedPoints ?? task.points ?? 0), 0);
  const total = list.length;
  const doneCount = doneTasks.length;
  const openCount = openTasks.length;
  const next = openTasks.find((task) => task.type !== "prayer") || openTasks[0];
  const byType = list.reduce((acc, task) => {
    const key = safeTaskType(task.type || task.task_type);
    if (!acc[key]) acc[key] = { total: 0, done: 0, open: 0 };
    acc[key].total += 1;
    if (task.done) acc[key].done += 1;
    else acc[key].open += 1;
    return acc;
  }, {});
  const completedTasks = doneTasks.slice(0, 6).map((task) => task.title);
  const unfinishedTasks = openTasks.slice(0, 6).map((task) => task.title);
  const encouragement = doneCount === 0
    ? `${name}، مجرد العودة للمحاولة غداً خطوة شجاعة. نبدأ بمهمة واحدة صغيرة بلا ضغط.`
    : `${name}، أحسنت. أنجزت ${doneCount} من ${total} وجمعت ${points} نقطة بجهدك. هذا تقدم حقيقي.`;
  const parentRecommendation = openCount > 0
    ? `غداً لا نرحّل كل شيء. نختار مهمة واحدة سهلة كبداية، ثم نقرر بهدوء إن كانت المهام الباقية مناسبة.`
    : "الخطة كانت مناسبة اليوم. غداً نحافظ على نفس الإيقاع مع مهمة ممتعة واحدة.";
  return {
    points,
    done: doneCount,
    open: openCount,
    total,
    completedTasks,
    unfinishedTasks,
    byType,
    encouragement,
    parentRecommendation,
    reasonPrompt: openCount > 0 ? "اختر سبب عدم الإكمال: لم يكن وقت / كانت صعبة / نسينا / احتاجت مساعدة / لا تناسب اليوم." : "لا توجد مهام غير مكتملة اليوم.",
    nextStep: next ? `غداً نبدأ بخطوة صغيرة: ${next.title}` : "غداً نختار مهمة جديدة بهدوء.",
    tomorrowFocus: next ? `ابدأ بـ: ${next.title}` : "مهمة قصيرة وممتعة كبداية."
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
    openaiSkipUntil: isOpenAISkipped() ? new Date(openAISkipUntil).toISOString() : null,
    openaiModel: OPENAI_IDEA_MODEL,
    openaiTimeoutMs: OPENAI_TIMEOUT_MS,
    prayerSource: PRAYER_SOURCE_NAME,
    prayerSourceMode: PRAYER_SOURCE_MODE,
    prayerSourceUrl: PRAYER_SHOBIDDAK_URL,
    prayerAppReference: PRAYER_APP_REFERENCE,
    prayerLocation: PRAYER_LOCATION_NAME,
    prayerApiConfigured: Boolean(PRAYER_SHOBIDDAK_URL),
    prayerManualEntrySupported: Boolean(pool)
  });
});

app.get("/api/system/diagnostics", asyncRoute(async (req, res) => {
  requireParent(req);
  const date = familyDateKey(req.query.date);
  const database = { configured: Boolean(pool), ok: false, message: "DATABASE_URL غير مهيأ" };
  if (pool) {
    try {
      await pool.query("SELECT 1 AS ok");
      database.ok = true;
      database.message = "PostgreSQL يعمل";
    } catch (error) {
      database.message = error.message || "تعذر الاتصال بقاعدة البيانات";
    }
  }

  const openai = {
    configured: isOpenAIConfigured(),
    available: openAIAvailable(),
    skipped: isOpenAISkipped(),
    model: OPENAI_IDEA_MODEL,
    timeoutMs: OPENAI_TIMEOUT_MS,
    message: openAIAvailable() ? "ChatGPT جاهز" : openAISkipMessage()
  };

  const ticktick = {
    configured: isTickTickConfigured(),
    connected: isTickTickConfigured() && Boolean(getStoredTokens(req)?.accessToken),
    redirectUriConfigured: Boolean(process.env.TICKTICK_REDIRECT_URI),
    projectName: HERO_PROJECT_NAME,
    message: isTickTickConfigured() ? "TickTick مهيأ" : "TickTick غير مهيأ بالكامل"
  };

  let prayer = {
    configured: Boolean(PRAYER_SHOBIDDAK_URL) || Boolean(pool),
    ok: false,
    source: PRAYER_SOURCE_NAME,
    location: PRAYER_LOCATION_NAME,
    message: "لم يتم فحص مواقيت الصلاة بعد"
  };
  try {
    const prayerResult = await getPrayerTimesSafely(date);
    const times = prayerResult.prayerTimes || {};
    prayer = {
      ...prayer,
      ok: Boolean(times.fajr && times.dhuhr && times.asr && times.maghrib && times.isha),
      message: prayerResult.warning || "مواقيت الصلاة تعمل",
      times
    };
  } catch (error) {
    prayer.message = error.message || "تعذر فحص مواقيت الصلاة";
  }

  res.json({
    app: "Hero Family",
    version: APP_VERSION,
    date,
    timeZone: APP_TIME_ZONE,
    database,
    openai,
    ticktick,
    prayer
  });
}));

app.use((req, res, next) => {
  if (pool && /^\/(api\/family|auth\/child)(\/|$)/.test(req.path)) {
    ensureFamilyDatabase().then(() => next(), () => next());
  } else {
    next();
  }
});

app.get("/api/family/status", (req, res) => {
  const perMember = {};
  for (const id of Object.keys(FAMILY_MEMBERS)) {
    perMember[`${id}PinConfigured`] = childPinConfigured(id);
    perMember[`${id}Authenticated`] = hasChildSession(req, id);
  }
  res.json({
    databaseConfigured: Boolean(pool),
    parentPinConfigured: parentPinConfigured(),
    parentAuthenticated: hasParentSession(req),
    ...perMember,
    members: Object.values(FAMILY_MEMBERS).map(publicMember)
  });
});

app.post("/auth/parent/login", asyncRoute(async (req, res) => {
  if (!parentPinConfigured()) return res.redirect(303, "/?area=parent&parentLogin=not_configured");
  const pin = normalizePinText(req.body?.pin);
  if (!secureEqualText(pin, process.env.PARENT_PIN)) return res.redirect(303, "/?area=parent&parentLogin=invalid");
  writeParentSession(res);
  return res.redirect(303, "/?area=parent&parent=opened");
}));

app.post("/api/family/parent/login", asyncRoute(async (req, res) => {
  if (!parentPinConfigured()) throw new PublicError(503, "أضف PARENT_PIN في Railway أولاً.");
  const pin = normalizePinText(req.body?.pin);
  if (!secureEqualText(pin, process.env.PARENT_PIN)) throw new PublicError(401, "رمز الوالدين غير صحيح.");
  writeParentSession(res);
  res.json({ authenticated: true });
}));

app.post("/api/family/parent/logout", (req, res) => {
  clearCookie(res, "hero_parent_session");
  clearCookie(res, childSessionCookieName("yaman"));
  clearCookie(res, childSessionCookieName("judy"));
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

  const pin = normalizePinText(req.body?.pin);

  if (!checkChildPin(assignee, pin)) {
    return res.redirect(303, `/?area=${encodeURIComponent(assignee)}&childLogin=invalid`);
  }

  writeChildSession(res, assignee);
  return res.redirect(303, `/?area=${encodeURIComponent(assignee)}&child=opened`);
}));

app.post("/api/family/child/:assignee/login", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  if (!childPinConfigured(assignee)) throw new PublicError(503, FAMILY_MEMBERS[assignee]?.builtin === false ? "لم يُحدَّد رمز دخول لهذا المستخدم." : `أضف ${childPinVariableName(assignee)} في Railway أولاً.`);
  const pin = normalizePinText(req.body?.pin);
  if (!checkChildPin(assignee, pin)) throw new PublicError(401, "رمز الدخول غير صحيح.");
  writeChildSession(res, assignee);
  res.json({ authenticated: true, member: publicMember(FAMILY_MEMBERS[assignee]) });
}));

app.post("/api/family/child/:assignee/logout", (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) return res.status(400).json({ error: "منطقة الطفل غير معروفة." });
  clearCookie(res, childSessionCookieName(assignee));
  res.status(204).end();
});

app.post("/api/family/auto-distribute", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const date = familyDateKey(req.body?.date || req.query?.date);
  const assignee = String(req.body?.assignee || req.query?.assignee || "").toLowerCase();
  const distribution = await autoDistributeFamilyDate(date, assignee);
  res.json({ date, distribution });
}));

app.get("/api/family/dashboard", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const date = familyDateKey(req.query.date);
  for (const memberId of Object.keys(FAMILY_MEMBERS)) await ensureTodayProgram(memberId, date);
  const distribution = await autoDistributeFamilyDate(date);
  const previousIncomplete = await previousIncompleteSummary(date);
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
  const summary = Object.fromEntries(Object.keys(FAMILY_MEMBERS).map((id) => [id, { open: 0, done: 0, total: 0 }]));
  for (const row of tasks) {
    if (summary[row.assignee]) summary[row.assignee] = { open: Number(row.open_count || 0), done: Number(row.done_count || 0), total: Number(row.total_count || 0) };
  }
  res.json({
    date,
    todayStart: true,
    previousIncomplete,
    autoDistribution: distribution,
    summary,
    members: Object.values(FAMILY_MEMBERS).map(publicMember),
    events: events.map(mapFamilyEvent)
  });
}));

app.get("/api/family/child/:assignee", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const date = familyDateKey(req.query.date);
  await ensureTodayProgram(assignee, date);
  const [tasks, events, previousIncomplete] = await Promise.all([getFamilyTasks(assignee, date), getFamilyEvents(assignee, date), previousIncompleteForMember(date, assignee)]);
  res.json({ member: publicMember(FAMILY_MEMBERS[assignee]), date, todayStart: true, previousIncomplete, tasks, events, parentAuthenticated: hasParentSession(req) });
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
  const checklist = safeChecklist(req.body?.checklist);
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
    `INSERT INTO hero_family_tasks (id, assignee, title, task_type, points, due_date, note, suggested_time, timer_minutes, source, ticktick_task_id, ticktick_project_id, ticktick_project_name, checklist)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
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
      initialTask.ticktickProjectName || tick?.ticktickProjectName || null,
      JSON.stringify(checklist)
    ]
  );
  await autoDistributeTasksForDate(dueDate, assignee);
  const updated = await pool.query(`SELECT * FROM hero_family_tasks WHERE id = $1`, [rows[0].id]);
  res.status(201).json({ task: mapFamilyTask(updated.rows[0] || rows[0]), ticktickSynced: Boolean(tick || initialTask.ticktickTaskId) });
}));

app.patch("/api/family/tasks/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();

  const assignee = String(req.body?.assignee || "").toLowerCase();
  const title = safeText(req.body?.title, 180);
  const type = safeTaskType(req.body?.type);
  const points = Math.min(50, Math.max(0, Number(req.body?.points) || 0));
  const dueDate = familyDateKey(req.body?.date);
  const note = safeText(req.body?.note, 500);
  const suggestedTime = safeTime(req.body?.suggestedTime);
  const timerMinutes = safeTimerMinutes(req.body?.timerMinutes);

  if (!isFamilyMember(assignee) || !title) {
    throw new PublicError(400, "اختر الطفل واكتب مهمة قصيرة وواضحة.");
  }

  const { rows } = await pool.query(
    `UPDATE hero_family_tasks
       SET assignee = $2,
           title = $3,
           task_type = $4,
           points = $5,
           due_date = $6,
           note = $7,
           suggested_time = $8,
           timer_minutes = $9,
           checklist = CASE WHEN $10::boolean THEN $11::jsonb ELSE checklist END,
           checklist_done = CASE WHEN $10::boolean THEN '[]'::jsonb ELSE checklist_done END,
           updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      req.params.id,
      assignee,
      title,
      type,
      Math.round(points),
      dueDate,
      note,
      suggestedTime,
      timerMinutes,
      Array.isArray(req.body?.checklist),
      JSON.stringify(safeChecklist(req.body?.checklist))
    ]
  );

  if (!rows[0]) {
    throw new PublicError(404, "لم نجد هذه المهمة.");
  }

  await autoDistributeTasksForDate(dueDate, assignee);
  const updated = await pool.query(`SELECT * FROM hero_family_tasks WHERE id = $1`, [rows[0].id]);
  res.json({ task: mapFamilyTask(updated.rows[0] || rows[0]) });
}));

app.patch("/api/family/tasks/:id/check", asyncRoute(async (req, res) => {
  await ensureFamilyDatabase();
  const found = await pool.query(`SELECT * FROM hero_family_tasks WHERE id = $1`, [req.params.id]);
  const row = found.rows[0];
  if (!row) throw new PublicError(404, "لم نجد هذه المهمة.");
  requireChildOrParent(req, row.assignee);
  const steps = checklistFromRow(row);
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) throw new PublicError(400, "خطوة غير صحيحة.");
  const doneSet = new Set(steps.map((step, i) => (step.done ? i : -1)).filter((i) => i >= 0));
  if (req.body?.done === false) doneSet.delete(index); else doneSet.add(index);
  const { rows } = await pool.query(
    `UPDATE hero_family_tasks SET checklist_done = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [row.id, JSON.stringify([...doneSet].sort((a, b) => a - b))]
  );
  res.json({ task: mapFamilyTask(rows[0]) });
}));

app.get("/api/family/school", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const settings = {};
  for (const id of Object.keys(FAMILY_MEMBERS)) settings[id] = await getSchoolSettings(id);
  res.json({ settings });
}));

app.put("/api/family/school/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const id = String(req.params.id || "").toLowerCase();
  if (!isFamilyMember(id)) throw new PublicError(400, "مستخدم غير معروف.");
  const school = normalizeSchool(req.body || {});
  await pool.query(
    `INSERT INTO hero_family_school (assignee, school_start, school_end, school_days) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (assignee) DO UPDATE SET school_start = EXCLUDED.school_start, school_end = EXCLUDED.school_end, school_days = EXCLUDED.school_days`,
    [id, school.start, school.end, JSON.stringify(school.days)]
  );
  res.json({ school });
}));

app.get("/api/family/members", (req, res) => {
  res.json({ members: Object.values(FAMILY_MEMBERS).map(publicMember) });
});

app.post("/api/family/members", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const name = safeText(req.body?.name, 24);
  const age = Math.round(Number(req.body?.age));
  const pin = normalizePinText(req.body?.pin);
  const icon = safeText(req.body?.icon, 8) || (age >= 13 ? "🦸" : "🌟");
  if (!name) throw new PublicError(400, "اكتب اسم المستخدم.");
  if (!Number.isFinite(age) || age < 3 || age > 30) throw new PublicError(400, "اكتب عمراً بين 3 و30.");
  if (!/^\d{4,8}$/.test(pin)) throw new PublicError(400, "رمز الدخول من 4 إلى 8 أرقام.");
  if (Object.keys(FAMILY_MEMBERS).length >= MAX_FAMILY_MEMBERS) throw new PublicError(400, "وصلتم للحد الأقصى من المستخدمين.");
  if (Object.values(FAMILY_MEMBERS).some((member) => member.name === name)) throw new PublicError(400, "هذا الاسم موجود بالفعل.");
  const id = `u${crypto.randomBytes(4).toString("hex")}`;
  await pool.query(`INSERT INTO hero_family_members (id, name, icon, age, pin_hash) VALUES ($1,$2,$3,$4,$5)`, [id, name, icon, age, hashMemberPin(pin)]);
  await loadFamilyMembers();
  res.status(201).json({ member: publicMember(FAMILY_MEMBERS[id]) });
}));

app.post("/api/family/members/:id/pin", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const id = String(req.params.id || "");
  const member = FAMILY_MEMBERS[id];
  if (!member || member.builtin) throw new PublicError(400, "رمز هذا المستخدم يُضبط من إعدادات Railway.");
  const pin = normalizePinText(req.body?.pin);
  if (!/^\d{4,8}$/.test(pin)) throw new PublicError(400, "رمز الدخول من 4 إلى 8 أرقام.");
  await pool.query(`UPDATE hero_family_members SET pin_hash = $2 WHERE id = $1`, [id, hashMemberPin(pin)]);
  await loadFamilyMembers();
  res.json({ ok: true });
}));

app.delete("/api/family/members/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const id = String(req.params.id || "");
  const member = FAMILY_MEMBERS[id];
  if (!member || member.builtin) throw new PublicError(400, "لا يمكن حذف هذا المستخدم.");
  await pool.query(`DELETE FROM hero_family_tasks WHERE assignee = $1`, [id]);
  await pool.query(`DELETE FROM hero_family_events WHERE assignee = $1`, [id]);
  await pool.query(`DELETE FROM hero_family_program_runs WHERE assignee = $1`, [id]);
  await pool.query(`DELETE FROM hero_family_school WHERE assignee = $1`, [id]);
  await pool.query(`DELETE FROM hero_family_members WHERE id = $1`, [id]);
  await loadFamilyMembers();
  res.status(204).end();
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

app.get("/api/family/events", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const from = familyDateKey(req.query.from);
  const to = familyDateKey(req.query.to || req.query.from);
  const { rows } = await pool.query(
    `SELECT * FROM hero_family_events WHERE event_date BETWEEN $1 AND $2 ORDER BY event_date ASC, NULLIF(event_time, '') ASC NULLS LAST, created_at ASC LIMIT 400`,
    [from, to]
  );
  res.json({ events: rows.map(mapFamilyEvent) });
}));

app.get("/api/family/calendar-tasks", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const from = familyDateKey(req.query.from);
  const to = familyDateKey(req.query.to || req.query.from);
  const { rows } = await pool.query(
    `SELECT id, assignee, title, task_type, due_date, suggested_time, done, timer_minutes FROM hero_family_tasks WHERE due_date BETWEEN $1 AND $2 ORDER BY due_date ASC, NULLIF(suggested_time, '') ASC NULLS LAST, created_at ASC LIMIT 1500`,
    [from, to]
  );
  res.json({ tasks: rows.map((r) => ({ id: r.id, assignee: r.assignee, title: r.title, type: r.task_type, date: pgDateKey(r.due_date), time: r.suggested_time || "", done: Boolean(r.done), timer: Number(r.timer_minutes || 0) })) });
}));

app.delete("/api/family/events/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const result = await pool.query("DELETE FROM hero_family_events WHERE id = $1", [req.params.id]);
  if (!result.rowCount) throw new PublicError(404, "لم نجد هذا الموعد.");
  res.status(204).end();
}));


app.get("/api/prayer/manual", asyncRoute(async (req, res) => {
  requireParent(req);
  const date = familyDateKey(req.query.date);
  const manual = await getStoredManualPrayerTimes(date);
  res.json({ date, prayerTimes: manual, exists: Boolean(manual) });
}));

app.post("/api/prayer/manual", asyncRoute(async (req, res) => {
  requireParent(req);
  const date = familyDateKey(req.body?.date);
  const prayerTimes = await saveManualPrayerTimes(date, req.body || {});
  res.json({ date, prayerTimes, message: "تم حفظ مواقيت الصلاة لهذا اليوم حسب مواقيت فلسطين/شو بدك." });
}));

app.post("/api/family/child/:assignee/seed-today", asyncRoute(async (req, res) => {
  requireParent(req);
  const assignee = String(req.params.assignee || "").toLowerCase();
  const date = familyDateKey(req.body?.date || req.query?.date);
  const result = await seedTodayTasksForMember(req, res, assignee, date);
  const tasks = await getFamilyTasks(assignee, date);
  res.json({ date, member: publicMember(FAMILY_MEMBERS[assignee]), tasks, ...result });
}));

app.post("/api/family/child/:assignee/program", asyncRoute(async (req, res) => {
  requireParent(req);
  const assignee = String(req.params.assignee || "").toLowerCase();
  const date = familyDateKey(req.body?.date || req.query?.date);
  const result = await applyProgramForMember(assignee, date, { force: true, replace: req.body?.replace === true });
  const tasks = await getFamilyTasks(assignee, date);
  res.json({ date, member: publicMember(FAMILY_MEMBERS[assignee]), tasks, ...result });
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
    const prompt = `اكتب تقرير نهاية يوم عربي قصير ودافئ لـ ${FAMILY_MEMBERS[assignee].name}.
البيانات: أنجز ${summary.done} من ${summary.total}، غير مكتمل ${summary.open}، النقاط ${summary.points}.
المهام المكتملة: ${(summary.completedTasks || []).join("، ") || "لا يوجد"}.
المهام غير المكتملة: ${(summary.unfinishedTasks || []).join("، ") || "لا يوجد"}.
القواعد: لا تقارن بين الأطفال، لا تضغط، لا تعاقب، لا تخصم نقاط، أعطِ خطوة صغيرة للغد وتوصية قصيرة للوالدين.`;
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
  const answer = safeText(help?.answer, 900);
  const questions = normalizeHelpList(help?.questions, []);
  const steps = normalizeHelpList(help?.steps, []);
  const checklist = normalizeHelpList(help?.checklist, []);
  const encouragement = safeText(help?.encouragement, 260);

  return [
    intro,
    answer ? `الإجابة المباشرة:\n${answer}` : "",
    questions.length ? `أسئلة سريعة قبل البدء:\n${questions.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    steps.length ? `خطوات التنفيذ:\n${steps.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    checklist.length ? `Checklist للإنجاز:\n${checklist.map((item) => `☐ ${item}`).join("\n")}` : "",
    encouragement
  ].filter(Boolean).join("\n\n");
}

function localTaskHelp(task, question = "", mode = "full") {
  const type = safeTaskType(task?.type);
  const title = safeText(task?.title, 180) || "المهمة";
  const note = safeText(task?.note, 500);
  const cleanQuestion = safeText(question, 1100);
  const helpMode = safeText(mode, 40) || "full";
  const timer = safeTimerMinutes(task?.timerMinutes);
  const time = safeTime(task?.suggestedTime);
  const taskText = `${title} ${note} ${cleanQuestion}`.toLowerCase();
  const hasTypedUserText = Boolean(cleanQuestion) && !/^(أعطني|حضّر|ما أول|اسألني|checklist|Checklist|قائمة)$/i.test(cleanQuestion.trim());

  const isMath = /رياض|حساب|جمع|طرح|ضرب|قسمة|مسائل|معادلة|كسور|نسبة|math|שבר|חשבון|מתמט/.test(taskText);
  const isReading = /قراءة|اقرأ|نص|قصة|فقرة|تلخيص|מקריאה|קריאה|read/.test(taskText);
  const isDubbing = /دبلجة|صوت|تسجيل|فيديو|تمثيل|dub|record/.test(taskText);
  const isYouTube = type === "youtube" || /يوتيوب|youtube|قناة|channel|محتوى|حلقة|فيديو|shorts|نشر|مونتاج|سيناريو|سكريبت|thumbnail|عنوان|وصف/.test(taskText);
  const isDrawing = /رسم|ارسم|لون|تصميم|צייר|ציור|draw/.test(taskText);
  const isBreathingTask = type === "breathing" || /تنفس|نفس|هدوء|تهدئة|استرخاء|قلق|غضب|ضغط|breath|calm|relax|נשימ|רגיעה|וויסות|הרגעה/.test(taskText);

  const stepsByType = {
    study: isMath
      ? ["انسخ السؤال أو اقرأه كاملًا مرة واحدة.", "حدد: ما المطلوب إيجاده؟", "اكتب المعطيات المهمة بالأرقام أو الكلمات.", "حل خطوة واحدة فقط ثم توقف للمراجعة.", "افحص الجواب: هل يناسب السؤال؟"]
      : isReading
        ? ["اقرأ العنوان أولًا.", "اقرأ فقرة قصيرة بصوت هادئ.", "ضع خطًا تحت كلمة أو فكرة مهمة.", "قل بجملة واحدة: ماذا فهمت؟", "اسأل عن الكلمة الصعبة بدل التوقف."]
        : ["حضّر الدفتر والقلم فقط.", "اقرأ المطلوب بصوت هادئ.", "ابدأ بالجزء الأسهل أو الفقرة الأولى.", "ضع علامة على الشيء الصعب لتسأل عنه لاحقًا.", "راجع النتيجة قبل الضغط على إنهاء."],
    creative: isDubbing
      ? ["اختر مشهدًا قصيرًا جدًا.", "اقرأ الجملة بصوت عادي مرة واحدة.", "سجل محاولة أولى بلا كمال.", "استمع واختر شيئًا واحدًا لتحسينه.", "احفظ النسخة الأفضل فقط."]
      : isDrawing
        ? ["اختر فكرة واحدة للرسم.", "ارسم الشكل الكبير أولًا.", "أضف تفصيلًا واحدًا فقط.", "لوّن بهدوء دون استعجال.", "اكتب اسم الرسم أو احفظه."]
        : ["اختر فكرة واحدة فقط.", "جرّب نسخة أولى قصيرة دون محاولة الكمال.", "سجّل أو ارسم أو اكتب لمدة قصيرة.", "اختر شيئًا واحدًا أعجبك واحتفظ به."],
    home: ["افهم المطلوب بالضبط.", "حضّر المكان أو الأداة المطلوبة.", "أنجز جزءًا صغيرًا وآمنًا.", "أعد الشيء إلى مكانه إذا احتجت.", "أخبر أحد الوالدين عندما تنتهي."],
    movement: ["اشرب قليلًا من الماء.", "ابدأ بحركة خفيفة.", "استمر حتى نهاية المؤقت دون مبالغة.", "توقف إذا شعرت بتعب غير عادي.", "خذ نفسًا هادئًا في النهاية."],
    breathing: ["اختر نوع تنفس واحد فقط: وردة وشمعة، الأصابع الخمسة، أو 2 داخل و4 خارج.", "اجلس أو قف بوضعية مريحة دون إجبار.", "خذ شهيقًا قصيرًا من الأنف كأنك تشم وردة.", "أخرج النفس ببطء كأنك تطفئ شمعة أو تنفخ فقاعة.", "كرر 3 إلى 5 مرات فقط، وتوقف إذا شعرت بدوخة أو ضيق."],
    youtube: ["اختر فكرة فيديو واحدة قصيرة وآمنة.", "اكتب هدف الفيديو في جملة واحدة: ماذا سيستفيد المشاهد؟", "اكتب سيناريو من 3 مشاهد أو 5 جمل فقط.", "سجل تجربة خاصة غير منشورة، ثم راجعها بهدوء.", "افحص الخصوصية: لا اسم مدرسة، لا عنوان، لا رقم هاتف، لا موقع، ولا نشر قبل موافقة الوالدين."],
    social: ["اختر جملة واحدة.", "قلها بصوت هادئ.", "جرّبها مع شخص تثق به.", "استمع للرد دون مقاطعة.", "لاحظ ما نجح بدون ضغط."],
    routine: ["اختر خطوة واحدة فقط.", "ضع الشيء المطلوب في مكان واضح.", "أنجزها بهدوء.", "راجع المكان بسرعة.", "انتقل لشيء آخر فقط إذا بقيت طاقة."],
    prayer: ["تأكد من دخول الوقت.", "استعد للوضوء بهدوء.", "صلِّ بخشوع دون استعجال.", "اذكر دعاءً قصيرًا بعد الصلاة.", "ارجع إلى جدولك التالي بهدوء."],
    other: ["اقرأ اسم المهمة.", "حوّلها إلى أول خطوة صغيرة.", "ابدأ لخمس دقائق.", "اطلب مساعدة إذا احتجت.", "اضغط إنهاء فقط بعد إنجاز الجزء المطلوب."]
  };

  const steps = (isBreathingTask ? stepsByType.breathing : (isYouTube ? stepsByType.youtube : (stepsByType[type] || stepsByType.other)));
  const breathingAnswer = "اختَر تمرينًا واحدًا قصيرًا: 1) وردة وشمعة: أشم وردة 2–3 ثوانٍ ثم أطفئ شمعة 4 ثوانٍ. 2) الأصابع الخمسة: أتتبع الإصبع صعودًا مع الشهيق ونزولًا مع الزفير. 3) 2 داخل و4 خارج: شهيق قصير وزفير أطول. نكرر 3–5 مرات فقط، بلا حبس نفس وبلا إجبار. إذا شعر يَمان بدوخة أو انزعاج نتوقف فورًا.";
  const youtubeAnswer = "مدرب القناة يقسّم العمل إلى خطوة آمنة: فكرة واحدة، سيناريو قصير، تسجيل تجربة خاصة، مراجعة جودة وخصوصية، ثم عرضها على الوالدين قبل أي نشر. لا نذكر معلومات شخصية ولا مكان ولا مدرسة، ولا نفتح تعليقات أو نشرًا مباشرًا بدون موافقة.";
  const answer = type === "prayer"
    ? "هذه ليست مهمة نقاط. المطلوب فقط تذكير هادئ: الاستعداد، الوضوء، الصلاة بخشوع، ثم العودة لليوم بهدوء."
    : isYouTube
      ? youtubeAnswer
      : isBreathingTask
      ? breathingAnswer
      : hasTypedUserText
        ? `قرأت النص المكتوب وربطته بعنوان المهمة «${title}». الإجابة الآن: ابدأ بما طلبته في النص نفسه، وحدد المطلوب بدقة، ثم نفّذ أول خطوة عملية من القائمة. إذا كان النص تمرينًا أو سؤالًا ويحتاج أرقامًا/صورة/فقرة غير موجودة، فالمعلومة الناقصة هي نص السؤال الكامل أو الصورة الواضحة؛ لا أستطيع اختراعها.`
      : `المطلوب في «${title}» هو تنفيذها بخطوات صغيرة وواضحة. ابدأ بالخطوة الأولى في القائمة، ولا تنتظر أن تكون جاهزًا 100%.`;

  const checklist = [
    `فهمت ماذا يعني: ${title}.`,
    note ? `راجعت ملاحظة المهمة: ${note.slice(0, 90)}${note.length > 90 ? "…" : ""}` : "حددت ما أحتاجه قبل البدء.",
    time ? `تأكدت من الوقت المقترح: ${time}.` : "اخترت وقتًا مناسبًا للبدء.",
    timer ? `شغّلت المؤقت لمدة ${timer} دقيقة.` : "بدأت بخمس دقائق على الأقل.",
    steps[0] || "أنجزت أول خطوة صغيرة.",
    "راجعت النتيجة أو طلبت مساعدة عند الحاجة.",
    "ضغطت إنهاء المهمة بعد الإنجاز."
  ];

  const questions = type === "prayer"
    ? ["هل دخل وقت الصلاة؟", "هل أحتاج وضوءًا؟", "ما الشيء الذي يساعدني على الخشوع الآن؟"]
    : isBreathingTask
      ? ["أي تمرين أريد الآن: وردة وشمعة، الأصابع الخمسة، أم 2 داخل و4 خارج؟", "هل جسمي مرتاح أم أحتاج أن أقف؟", "هل أريد أن يعدّ معي أحد الوالدين بصوت هادئ؟", "هل أوقف التمرين إذا شعرت بدوخة أو انزعاج؟"]
      : isYouTube
        ? ["ما فكرة الفيديو في جملة واحدة؟", "من الجمهور: العائلة فقط أم قناة عامة لاحقًا؟", "هل الفيديو دبلجة، شرح، رسم، أم قصة قصيرة؟", "ما الشيء الشخصي الذي يجب ألا يظهر؟", "هل أحتاج موافقة الوالدين قبل الحفظ أو النشر؟"]
        : [
        "ما المطلوب بالضبط في هذه المهمة؟",
        "ما أول خطوة صغيرة أستطيع تنفيذها الآن؟",
        "ما الشيء الذي أحتاجه قبل أن أبدأ؟",
        timer ? "هل شغّلت المؤقت؟" : "هل أبدأ بخمس دقائق فقط؟",
        "إذا توقفت، ما المعلومة الناقصة التي أحتاج أن أسأل عنها؟"
      ];

  let modeAnswer = answer;
  let modeQuestions = questions;
  let modeSteps = steps;
  let modeChecklist = checklist;
  if (helpMode === "first_step") {
    modeAnswer = `أول خطوة الآن: ${steps[0] || "اقرأ اسم المهمة وابدأ لخمس دقائق"}. لا تفكر في كل المهمة؛ نفذ هذه الخطوة فقط.`;
    modeQuestions = ["هل أستطيع تنفيذ هذه الخطوة الآن؟", "ما الشيء الوحيد الذي أحتاجه قبل البدء؟"];
    modeSteps = steps.slice(0, 3);
    modeChecklist = checklist.slice(0, 4);
  } else if (helpMode === "checklist") {
    modeAnswer = "هذه قائمة إنجاز خاصة بالمهمة. علّم ✓ بعد كل مرحلة، ولا تنتقل للمرحلة التالية إذا احتجت مساعدة.";
    modeQuestions = [];
    modeSteps = steps.slice(0, 4);
  } else if (helpMode === "clarify") {
    modeAnswer = "قبل أن أجيب بدقة كاملة، هذه الأسئلة تساعدنا نعرف ما الناقص. إذا أرسلت نص التمرين أو الصورة أو المطلوب الكامل، أستطيع إعطاء جواب أدق.";
    modeSteps = ["أجب عن سؤال واحد فقط من القائمة.", "أرسل النص أو المعلومة الناقصة إن وجدت.", "ابدأ بأصغر خطوة لا تحتاج معلومات إضافية."];
    modeChecklist = ["حددت ما لا أفهمه بعد.", "كتبت أو صورت نص السؤال إذا كان مطلوبًا.", "اخترت أول خطوة آمنة للبدء."];
  } else if (helpMode === "youtube") {
    modeAnswer = youtubeAnswer;
    modeQuestions = ["ما فكرة الحلقة؟", "هل الجمهور عائلة فقط أم نشر لاحق بعد موافقة؟", "هل أريد دبلجة، رسم، شرح، أم قصة؟", "ما الشيء الخاص الذي يجب ألا يظهر؟"];
    modeSteps = stepsByType.youtube;
    modeChecklist = ["اخترت فكرة واحدة مناسبة.", "كتبت 5 جمل أو 3 مشاهد فقط.", "سجلت تجربة خاصة غير منشورة.", "راجعت الصوت والصورة بهدوء.", "حذفت أي معلومة شخصية: مدرسة، عنوان، رقم، موقع.", "عرضت الفيديو على الوالدين قبل أي نشر."];
  }

  const help = {
    intro: `لننفذ «${title}» بهدوء ومن غير ضغط.${note ? ` ملاحظة المهمة: ${note}.` : ""}`,
    answer: modeAnswer,
    questions: modeQuestions,
    steps: modeSteps,
    checklist: modeChecklist,
    encouragement: "خطوة صغيرة صحيحة أفضل من انتظار طويل. ابدأ الآن، وأنا معك."
  };

  return { ...help, answerText: buildTaskHelpAnswer(help) };
}
function normalizeTaskHelp(value, fallback) {
  const base = fallback || localTaskHelp({}, "");
  const help = value && typeof value === "object" ? value : {};
  const normalized = {
    intro: safeText(help.intro, 360) || base.intro,
    answer: safeText(help.answer, 900) || safeText(help.directAnswer, 900) || base.answer,
    questions: normalizeHelpList(help.questions, base.questions),
    steps: normalizeHelpList(help.steps, base.steps),
    checklist: normalizeHelpList(help.checklist, base.checklist),
    encouragement: safeText(help.encouragement, 260) || base.encouragement
  };
  return { ...normalized, answerText: buildTaskHelpAnswer(normalized) };
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
  const previousContext = safeText(req.body?.context, 900);
  const mode = ["full", "first_step", "checklist", "clarify", "youtube"].includes(String(req.body?.mode || "")) ? String(req.body.mode) : "full";
  if (!task.title) throw new PublicError(400, "لم تصل تفاصيل المهمة.");

  const fallback = localTaskHelp(task, question, mode);

  if (!openAIAvailable()) {
    return res.json({ source: "local", ...fallback, warning: openAISkipMessage() });
  }

  try {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        intro: { type: "string" },
        answer: { type: "string" },
        questions: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
        steps: { type: "array", minItems: 4, maxItems: 8, items: { type: "string" } },
        checklist: { type: "array", minItems: 5, maxItems: 9, items: { type: "string" } },
        encouragement: { type: "string" }
      },
      required: ["intro", "answer", "questions", "steps", "checklist", "encouragement"]
    };

    const prompt = `أنت Hero، مساعد عربي دافئ وعملي لطفل/طفلة داخل صفحة مهمة واحدة. الهدف: جواب دقيق، ثم خطة تنفيذ واضحة، ثم checklist ملائم للمهمة نفسها.

قواعد مهمة جدًا:
1) ابدأ بحقل answer كإجابة مباشرة على سؤال الطفل/الأهل المكتوب فعليًا في حقل السؤال، مع ربط الإجابة بعنوان المهمة. لا تجعل الإجابة عامة.
2) إذا كان السؤال يحتاج نص تمرين أو معلومة غير موجودة، قل بالضبط ما المعلومة الناقصة، ثم أعطِ طريقة البدء بما هو متاح. لا تخترع أرقامًا أو حقائق.
3) اجعل checklist خاصًا بالمهمة، لا checklist عام. كل بند يجب أن يكون قابلًا للتعليم بعلامة ✓.
4) الخطوات يجب أن تكون مرتبة زمنيًا ومنطقية: فهم المطلوب → تجهيز → أول خطوة → تنفيذ → مراجعة → إنهاء.
5) اللغة عربية بسيطة، قصيرة، مشجعة، مناسبة لطفل.
6) لا تضغط، لا تقارن بين الأطفال، لا تستخدم لغة مخيفة.
7) اجعل answer من جملتين إلى ثلاث جمل كحد أقصى. كل خطوة جملة واحدة قصيرة (حتى 12 كلمة) تبدأ بفعل. كل بند في checklist حتى 8 كلمات. لا تكرر المعنى نفسه في الخطوات والـchecklist.
8) إذا وُجدت "الإجابة السابقة" فالسؤال الحالي متابعة لها: أجب عنه بالتحديد، ولا تعد نفس الخطوات ولا نفس الأمثلة، وابنِ على ما سبق. إذا قال الطفل إنه لا يفهم فاشرح بطريقة مختلفة وأبسط مع مثال صغير من حياته اليومية.
9) لا تدّعِ أنك رأيت دفتر الطفل أو كتابه. إذا احتجت نص التمرين فاطلبه بجملة واحدة.
10) استخدم لغة حرفية ومباشرة بلا مجاز أو أمثال أو سخرية، بجمل قصيرة ومتوقعة البنية. رقّم الخطوات، واذكر المدة التقريبية لكل جزء عندما يمكن، وقل بوضوح متى تنتهي المهمة. عند الحاجة لاختيار قدّم خيارين فقط. لا تُكثر من التعجب أو الإطراء، واستخدم تشجيعًا هادئًا ومحددًا (مثل: "أنهيت الخطوة الأولى").
11) لا تربط الصلاة بالنقاط أو المكافآت. إذا كانت المهمة صلاة فاجعلها استعدادًا هادئًا: دخول الوقت، وضوء، نية، خشوع، هدوء، بدون نقاط.

وضع المساعدة المطلوب: ${mode}
- full: إجابة مباشرة + خطوات + checklist.
- first_step: ركّز على أول خطوة فقط.
- checklist: ركّز على checklist خاص وقابل للتعليم.
- clarify: ركّز على أسئلة التوضيح وما الناقص.

تعامل حسب نوع المهمة:
- study/رياضيات: لا تعطِ الناتج النهائي إذا لا يوجد نص تمرين؛ اطلب نص السؤال، واشرح طريقة الحل خطوة خطوة.
- creative/دبلجة/رسم: أعطِ خطوات عملية قصيرة وممتعة.
- home/routine: checklist بسيط وواضح.
- social: جملة تدريب واحدة وسيناريو قصير.
- breathing/تنفس/تهدئة: اختر تمرينًا واحدًا مناسبًا ليَمان، قصيرًا وواضحًا، بلا إجبار، بلا حبس نفس، بلا مؤثرات مزعجة، ودون استخدام أي تشخيص أو تسمية حساسة. اقترح واحدًا من: وردة وشمعة، الأصابع الخمسة، 2 داخل و4 خارج، فقاعة بطيئة، إنزال الكتفين مع زفير طويل. اذكر أن التوقف مطلوب عند الدوخة أو الانزعاج.
- youtube/قناة شخصية: كن مدرب قناة آمن ومحترم. ساعده في فكرة فيديو، اسم سلسلة، سيناريو قصير، تدريب صوت/دبلجة، قائمة تصوير، مراجعة الخصوصية، وعرض المادة على الوالدين. لا تقترح نشر معلومات شخصية أو مدرسة أو موقع أو صورة وجه إذا لم يوافق الوالدان. لا تطلب فتح بث مباشر أو تعليقات مفتوحة.
- prayer: تذكير هادئ بلا نقاط ولا مكافآت.

الطفل: ${FAMILY_MEMBERS[assignee].name}
المهمة: ${task.title}
النوع: ${task.type}
الوقت: ${task.suggestedTime || "غير محدد"}
المؤقت: ${task.timerMinutes || 0} دقيقة
النقاط: ${task.points}
الحالة: ${task.status || "مفتوحة"}
ملاحظة المهمة: ${task.note || "لا توجد"}
سؤال/نص الطفل أو الأهل المكتوب في الصفحة: ${question}
الإجابة السابقة (للمتابعة فقط): ${previousContext || "لا توجد، هذا أول سؤال"}
تعليمات إضافية: إذا احتوى السؤال على عبارة "النص الذي كتبه المستخدم" فاجعل هذا النص هو الأولوية الأولى، واعتبر "طلب الزر" مجرد طريقة عرض. أجب حسب النص المكتوب وعنوان المهمة معًا.

إذا كان وضع المساعدة youtube فاجعل answer عمليًا: فكرة الحلقة، سيناريو قصير، checklist أمان، وخطوة إنتاج واحدة اليوم.

أعد JSON فقط حسب المخطط. لا تستخدم Markdown داخل القيم.`;

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
