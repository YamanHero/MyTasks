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
    done: Boolean(row.done),
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
  return ["study", "home", "creative", "movement", "social", "routine", "other"].includes(value) ? value : "other";
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
    `SELECT * FROM hero_family_tasks WHERE assignee = $1 AND due_date = $2 ORDER BY done ASC, created_at ASC`,
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

function normalizePlanTask(task) {
  const type = safeTaskType(task?.type);
  const points = Math.min(30, Math.max(5, Number(task?.points) || (type === "study" || type === "creative" ? 15 : 10)));
  return {
    title: safeText(task?.title, 160) || "مهمة صغيرة وواضحة",
    type,
    points: Math.round(points),
    note: safeText(task?.note, 320) || "ابدأ بخمس دقائق فقط.",
    suggestedTime: safeTime(task?.suggestedTime),
    timerMinutes: safeTimerMinutes(task?.timerMinutes)
  };
}

function parsePlanTaskCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.min(10, Math.max(1, Math.round(number)));
}

function planInstructionsText(value) {
  return safeText(value, 900);
}

function localDailyCoachPlan(taskCount = 3, instructions = "") {
  const count = parsePlanTaskCount(taskCount);
  const customNote = instructions
    ? `تم أخذ توجيه الوالدين بالحسبان: ${instructions}`
    : "ابدأ بخطوة صغيرة فقط.";

  const yamanTasks = [
    { title: "رياضيات: حل 3 أسئلة قصيرة", type: "study", points: 15, note: "ابدأ بالسؤال الأسهل وضع علامة على السؤال الصعب.", suggestedTime: "16:30", timerMinutes: 20 },
    { title: "تسجيل صوت قصير لشخصية من خيالك", type: "creative", points: 15, note: "جملة واحدة تكفي. لا نحتاج نتيجة كاملة.", suggestedTime: "17:10", timerMinutes: 15 },
    { title: "ترتيب شيء واحد في الغرفة", type: "home", points: 10, note: "اختر زاوية صغيرة فقط.", suggestedTime: "17:35", timerMinutes: 10 },
    { title: "حركة خفيفة", type: "movement", points: 10, note: "مشي قصير أو تمدد بسيط يكفي.", suggestedTime: "18:00", timerMinutes: 10 },
    { title: "تدريب اجتماعي: جملة طلب مساعدة", type: "social", points: 10, note: "تدرّب على جملة واحدة: هل يمكنك مساعدتي؟", suggestedTime: "18:15", timerMinutes: 5 },
    { title: "تجهيز شيء واحد للغد", type: "routine", points: 5, note: "ضع شيئاً واحداً في مكانه الصحيح.", suggestedTime: "19:00", timerMinutes: 8 },
    { title: "قراءة فقرة قصيرة بصوت هادئ", type: "study", points: 10, note: "اقرأ فقرة واحدة فقط ثم توقف.", suggestedTime: "19:15", timerMinutes: 10 },
    { title: "رسم لقطة من فكرة فيديو", type: "creative", points: 10, note: "ارسم بشكل سريع بدون محاولة الكمال.", suggestedTime: "19:30", timerMinutes: 12 },
    { title: "مراجعة قائمة الغد مع أحد الوالدين", type: "routine", points: 5, note: "اختر مهمة واحدة مهمة للغد.", suggestedTime: "19:50", timerMinutes: 0 },
    { title: "إغلاق اليوم بكلمة نجاح واحدة", type: "social", points: 5, note: "قل ما الشيء الصغير الذي نجح اليوم.", suggestedTime: "20:05", timerMinutes: 0 }
  ];

  const judyTasks = [
    { title: "قراءة أو مراجعة قصيرة", type: "study", points: 10, note: "اختاري فقرة واحدة فقط.", suggestedTime: "16:20", timerMinutes: 15 },
    { title: "مساعدة بسيطة في البيت", type: "home", points: 10, note: "مهمة واحدة صغيرة وواضحة.", suggestedTime: "16:45", timerMinutes: 10 },
    { title: "رسم أو نشاط إبداعي قصير", type: "creative", points: 10, note: "اختاري لونين وابدئي.", suggestedTime: "17:05", timerMinutes: 15 },
    { title: "حركة لطيفة أو لعبة نشيطة", type: "movement", points: 10, note: "خمس إلى عشر دقائق كافية.", suggestedTime: "17:30", timerMinutes: 10 },
    { title: "كلمة لطيفة لشخص من العائلة", type: "social", points: 10, note: "قولي شيئاً جميلاً وبسيطاً.", suggestedTime: "18:00", timerMinutes: 0 },
    { title: "ترتيب حقيبة أو زاوية صغيرة", type: "routine", points: 5, note: "اختاري شيئاً واحداً فقط.", suggestedTime: "18:20", timerMinutes: 8 },
    { title: "تدريب كتابة جملتين", type: "study", points: 10, note: "جملتان قصيرتان تكفيان.", suggestedTime: "18:40", timerMinutes: 12 },
    { title: "اختيار ملابس أو أدوات الغد", type: "routine", points: 5, note: "ضعي شيئاً واحداً في مكان واضح.", suggestedTime: "19:05", timerMinutes: 8 },
    { title: "نشاط هادئ قبل النوم", type: "routine", points: 5, note: "اختاري شيئاً هادئاً ومريحاً.", suggestedTime: "19:30", timerMinutes: 10 },
    { title: "إخبار العائلة بشيء جميل من اليوم", type: "social", points: 5, note: "كلمة واحدة جميلة تكفي.", suggestedTime: "19:50", timerMinutes: 0 }
  ];

  return {
    familyMessage: instructions
      ? `اليوم نبني خطة حسب توجيه الوالدين. ${customNote}`
      : "اليوم نختار خطوات واضحة مع أوقات ومؤقتات عند الحاجة. الجهد هو الذي يُحسب، وليس الكمال.",
    children: {
      yaman: {
        encouragement: "يا يَمان، ابدأ بمهمة واحدة فقط. المؤقت يساعدك أن تعرف أين تبدأ وأين تتوقف.",
        tasks: yamanTasks.slice(0, count)
      },
      judy: {
        encouragement: "يا جودي، اليوم نعمل بلطف وهدوء. الوقت المقترح يساعدنا فقط، وليس ضغطاً.",
        tasks: judyTasks.slice(0, count)
      }
    }
  };
}

function normalizeDailyCoachPlan(value, taskCount = 3, instructions = "") {
  const count = parsePlanTaskCount(taskCount);
  const fallback = localDailyCoachPlan(count, instructions);
  const plan = value && typeof value === "object" ? value : fallback;
  const children = plan.children && typeof plan.children === "object" ? plan.children : {};
  const normalizeChild = (member) => {
    const child = children[member] && typeof children[member] === "object" ? children[member] : fallback.children[member];
    const rawTasks = Array.isArray(child.tasks) ? child.tasks.map(normalizePlanTask) : [];
    const fallbackTasks = fallback.children[member].tasks.map(normalizePlanTask);
    const tasks = rawTasks.slice(0, count);
    for (let i = tasks.length; i < count; i += 1) {
      tasks.push(fallbackTasks[i % fallbackTasks.length]);
    }
    return {
      encouragement: safeText(child.encouragement, 260) || fallback.children[member].encouragement,
      tasks
    };
  };
  return {
    familyMessage: safeText(plan.familyMessage, 360) || fallback.familyMessage,
    children: {
      yaman: normalizeChild("yaman"),
      judy: normalizeChild("judy")
    }
  };
}

async function createOpenAIDailyCoachPlan(date, taskCount = 3, instructions = "") {
  const count = parsePlanTaskCount(taskCount);
  const parentInstructions = planInstructionsText(instructions);
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
              tasks: {
                type: "array",
                minItems: count,
                maxItems: count,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    type: { type: "string", enum: ["study", "home", "creative", "movement", "social", "routine", "other"] },
                    points: { type: "integer" },
                    note: { type: "string" },
                    suggestedTime: { type: "string" },
                    timerMinutes: { type: "integer" }
                  },
                  required: ["title", "type", "points", "note", "suggestedTime", "timerMinutes"]
                }
              }
            },
            required: ["encouragement", "tasks"]
          },
          judy: {
            type: "object",
            additionalProperties: false,
            properties: {
              encouragement: { type: "string" },
              tasks: {
                type: "array",
                minItems: count,
                maxItems: count,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    type: { type: "string", enum: ["study", "home", "creative", "movement", "social", "routine", "other"] },
                    points: { type: "integer" },
                    note: { type: "string" },
                    suggestedTime: { type: "string" },
                    timerMinutes: { type: "integer" }
                  },
                  required: ["title", "type", "points", "note", "suggestedTime", "timerMinutes"]
                }
              }
            },
            required: ["encouragement", "tasks"]
          }
        },
        required: ["yaman", "judy"]
      }
    },
    required: ["familyMessage", "children"]
  };

  const prompt = `أنت Hero، مدرّب يومي عربي دافئ لعائلة فيها يَمان وجودي. أنشئ خطة يومية بتاريخ ${date}. المطلوب بالضبط: ${count} مهام صغيرة واضحة لكل طفل، لا أكثر ولا أقل. نقاط إيجابية فقط، وتشجيع رحيم وعملي. يَمان يحب الدبلجة والرسوم والرياضيات ويحتاج خطوات قصيرة. جودي تحتاج مهام واضحة ولطيفة. لا تستخدم ضغطاً أو مقارنة. لا تربط الصلاة بالنقاط. اجعل المهام قابلة للتنفيذ اليوم. أضف لكل مهمة وقتاً مقترحاً بصيغة HH:MM أو اتركه فارغاً إذا لا يلزم، وأضف timerMinutes بين 0 و60؛ استخدم مؤقتاً للرياضيات، القراءة، الحركة، الإبداع، والتركيز، واجعل 0 للمهام الاجتماعية القصيرة أو المواعيد التي لا تحتاج عداداً. توجيهات الوالدين لما يجب أن تشمل الخطة: ${parentInstructions || "لا توجد توجيهات إضافية"}. يجب احترام هذه التوجيهات ما دامت آمنة ومناسبة للأطفال.`;
  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_IDEA_MODEL,
      input: prompt,
      text: { format: { type: "json_schema", name: "hero_daily_coach_plan", strict: true, schema } },
      max_output_tokens: Math.min(3000, 900 + count * 450)
    })
  }, OPENAI_TIMEOUT_MS);
  const body = await readResponseBody(response);
  if (!response.ok) throw new Error(body?.error?.message || "OpenAI daily plan failed");
  const output = extractOpenAIOutputText(body);
  return normalizeDailyCoachPlan(JSON.parse(output), count, parentInstructions);
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
      const baseTask = { assignee: member, title: task.title, type: task.type, points: task.points, note: task.note, suggestedTime: task.suggestedTime, timerMinutes: task.timerMinutes };
      const tick = await createTickTickTaskIfPossible(req, res, { ...baseTask, source: "chatgpt" });
      const { rows } = await pool.query(
        `INSERT INTO hero_family_tasks (id, assignee, title, task_type, points, due_date, note, suggested_time, timer_minutes, source, ticktick_task_id, ticktick_project_id, ticktick_project_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [crypto.randomUUID(), member, task.title, task.type, task.points, date, task.note, task.suggestedTime, task.timerMinutes, "chatgpt", tick?.ticktickTaskId || null, tick?.ticktickProjectId || null, tick?.ticktickProjectName || null]
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
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
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

app.patch("/api/family/tasks/:id/complete", asyncRoute(async (req, res) => {
  await ensureFamilyDatabase();
  const assignee = String(req.body?.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const { rows } = await pool.query(`UPDATE hero_family_tasks SET done = TRUE, updated_at = NOW() WHERE id = $1 AND assignee = $2 RETURNING *`, [req.params.id, assignee]);
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


app.post("/api/ai/daily-plan", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const date = familyDateKey(req.body?.date);
  const taskCount = parsePlanTaskCount(req.body?.taskCount);
  const instructions = planInstructionsText(req.body?.instructions);
  let source = "local";
  let plan = localDailyCoachPlan(taskCount, instructions);
  let warning = "";
  if (process.env.OPENAI_API_KEY) {
    try {
      plan = await createOpenAIDailyCoachPlan(date, taskCount, instructions);
      source = "openai";
    } catch (error) {
      warning = "تعذر إنشاء خطة OpenAI الآن؛ استخدمنا خطة محلية آمنة حسب عدد المهام والتوجيهات التي اخترتها.";
      console.warn("OpenAI daily plan failed; using local fallback:", error.message);
    }
  }
  plan = normalizeDailyCoachPlan(plan, taskCount, instructions);
  const inserted = await insertCoachPlanTasks(req, res, plan, date);
  res.json({ date, source, warning, taskCount, instructions, plan, inserted });
}));

app.get("/api/ai/end-day/:assignee", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();
  if (!isFamilyMember(assignee)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, assignee);
  const date = familyDateKey(req.query.date);
  const tasks = await getFamilyTasks(assignee, date);
  const summary = localEndDayMessage(assignee, tasks);
  if (!process.env.OPENAI_API_KEY) return res.json({ date, source: "local", summary });
  try {
    const prompt = `اكتب تشجيع نهاية يوم عربي قصير ودافئ لـ ${FAMILY_MEMBERS[assignee].name}. البيانات: أنجز ${summary.done} من ${summary.total}، النقاط ${summary.points}. لا تقارن بين الأطفال، لا تضغط، أعطِ خطوة صغيرة للغد.`;
    const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_IDEA_MODEL, input: prompt, max_output_tokens: 350 })
    }, OPENAI_TIMEOUT_MS);
    const body = await readResponseBody(response);
    const text = response.ok ? extractOpenAIOutputText(body) : "";
    return res.json({ date, source: text ? "openai" : "local", summary: { ...summary, encouragement: text || summary.encouragement } });
  } catch (error) {
    return res.json({ date, source: "local", summary });
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
  if (!process.env.OPENAI_API_KEY) {
    return res.json({ source: "local", ideas: [{ title: "فكرة قصيرة", summary: `نحوّل فكرتك إلى مشهد صغير: ${idea}`, firstStep: "اكتب جملة واحدة أو سجّل صوتاً قصيراً.", taskTitle: "تطوير فكرة إبداعية لمدة 10 دقائق", category: "creative" }] });
  }
  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_IDEA_MODEL, input: `اقترح 3 أفكار آمنة وبسيطة باللغة العربية لطفل عمره 15 سنة بناءً على: ${idea}`, max_output_tokens: 700 })
  }, OPENAI_TIMEOUT_MS);
  const body = await readResponseBody(response);
  if (!response.ok) throw new PublicError(502, "تعذر الوصول إلى اقتراحات AI الآن.");
  res.json({ source: "openai", text: body?.output_text || body });
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
