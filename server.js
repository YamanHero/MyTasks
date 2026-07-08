const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 8080;
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Jerusalem";

const TICKTICK_AUTH_URL = "https://ticktick.com/oauth/authorize";
const TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token";
const TICKTICK_API_BASE = "https://api.ticktick.com/open/v1";
const TICKTICK_PROJECT_NAME = "Hero Family";

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FAMILY_MEMBERS = {
  yaman: { id: "yaman", name: "يَمان", label: "منطقة يَمان" },
  judy: { id: "judy", name: "جودي", label: "منطقة جودي" }
};

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    })
  : null;

let databaseReady = null;

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isFamilyMember(value) {
  return Object.prototype.hasOwnProperty.call(FAMILY_MEMBERS, value);
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
  res.setHeader("Set-Cookie", current ? (Array.isArray(current) ? [...current, cookie] : [current, cookie]) : [cookie]);
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
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sessionKey() {
  if (!process.env.SESSION_SECRET) {
    throw new PublicError(503, "יש להגדיר SESSION_SECRET ב-Railway.");
  }
  return crypto.createHash("sha256").update(process.env.SESSION_SECRET).digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptJson(value) {
  try {
    const [ivText, tagText, encryptedText] = String(value || "").split(".");
    if (!ivText || !tagText || !encryptedText) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final()
    ]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizePin(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\D/g, "");
}

function parentPinConfigured() {
  return typeof process.env.PARENT_PIN === "string" && process.env.PARENT_PIN.length >= 4;
}

function childPinName(member) {
  return `${String(member).toUpperCase()}_PIN`;
}

function childPinConfigured(member) {
  const value = process.env[childPinName(member)];
  return typeof value === "string" && value.length >= 4;
}

function parentSession(req) {
  const value = decryptJson(readCookie(req, "hero_parent_session"));
  return value?.role === "parent" && Number(value?.expiresAt) > Date.now();
}

function childSession(req, member) {
  const value = decryptJson(readCookie(req, `hero_${member}_session`));
  return value?.role === "child" && value?.member === member && Number(value?.expiresAt) > Date.now();
}

function writeParentSession(res) {
  appendSetCookie(
    res,
    makeCookie("hero_parent_session", encryptJson({ role: "parent", expiresAt: Date.now() + 12 * 60 * 60 * 1000 }), 12 * 60 * 60)
  );
}

function writeChildSession(res, member) {
  appendSetCookie(
    res,
    makeCookie(`hero_${member}_session`, encryptJson({ role: "child", member, expiresAt: Date.now() + 12 * 60 * 60 * 1000 }), 12 * 60 * 60)
  );
}

function requireParent(req) {
  if (!parentSession(req)) throw new PublicError(401, "يلزم رمز الوالدين لإدارة مهام العائلة.");
}

function requireChildOrParent(req, member) {
  if (!parentSession(req) && !childSession(req, member)) {
    throw new PublicError(401, "أدخل رمز الدخول الخاص بهذه المنطقة أولاً.");
  }
}

function familyDateKey(value) {
  const raw = String(value || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function text(value, max = 300) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function taskType(value) {
  return ["study", "home", "creative", "movement", "social", "routine", "other"].includes(value) ? value : "other";
}

function requireDatabase() {
  if (!pool) throw new PublicError(503, "قاعدة بيانات العائلة غير مفعّلة. أضف DATABASE_URL في Railway.");
}

async function ensureDatabase() {
  requireDatabase();
  if (!databaseReady) {
    databaseReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS hero_family_tasks (
          id UUID PRIMARY KEY,
          assignee TEXT NOT NULL CHECK (assignee IN ('yaman','judy')),
          title TEXT NOT NULL,
          task_type TEXT NOT NULL DEFAULT 'other',
          points INTEGER NOT NULL DEFAULT 5,
          due_date DATE NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          done BOOLEAN NOT NULL DEFAULT FALSE,
          source TEXT NOT NULL DEFAULT 'parent',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS hero_family_tasks_date_idx ON hero_family_tasks (assignee, due_date, done);
        CREATE TABLE IF NOT EXISTS hero_family_events (
          id UUID PRIMARY KEY,
          assignee TEXT NOT NULL CHECK (assignee IN ('yaman','judy','family')),
          title TEXT NOT NULL,
          event_date DATE NOT NULL,
          event_time TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS hero_family_events_date_idx ON hero_family_events (event_date, assignee);
      `)
      .catch((error) => {
        databaseReady = null;
        throw error;
      });
  }
  await databaseReady;
}

function mapTask(row) {
  return {
    id: row.id,
    assignee: row.assignee,
    title: row.title,
    type: row.task_type,
    points: Number(row.points || 0),
    date: String(row.due_date).slice(0, 10),
    note: row.note || "",
    done: Boolean(row.done),
    source: row.source || "parent"
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    assignee: row.assignee,
    title: row.title,
    date: String(row.event_date).slice(0, 10),
    time: row.event_time || "",
    note: row.note || ""
  };
}

async function getTasks(member, date) {
  await ensureDatabase();
  const { rows } = await pool.query(
    `SELECT * FROM hero_family_tasks WHERE assignee=$1 AND due_date=$2 ORDER BY done ASC, created_at ASC`,
    [member, date]
  );
  return rows.map(mapTask);
}

async function getEvents(member, date) {
  await ensureDatabase();
  const assignees = member === "family" ? ["family"] : [member, "family"];
  const { rows } = await pool.query(
    `SELECT * FROM hero_family_events WHERE assignee = ANY($1::text[]) AND event_date=$2 ORDER BY NULLIF(event_time,'') ASC NULLS LAST, created_at ASC`,
    [assignees, date]
  );
  return rows.map(mapEvent);
}

// ---- Session and family routes ----
app.get("/api/family/status", (req, res) => {
  res.json({
    databaseConfigured: Boolean(pool),
    parentPinConfigured: parentPinConfigured(),
    yamanPinConfigured: childPinConfigured("yaman"),
    judyPinConfigured: childPinConfigured("judy"),
    parentAuthenticated: parentSession(req),
    yamanAuthenticated: childSession(req, "yaman"),
    judyAuthenticated: childSession(req, "judy"),
    members: Object.values(FAMILY_MEMBERS)
  });
});

app.post("/auth/parent/login", (req, res) => {
  if (!parentPinConfigured()) return res.redirect(303, "/?parentLogin=not_configured");
  if (!safeEqual(normalizePin(req.body?.pin), normalizePin(process.env.PARENT_PIN))) {
    return res.redirect(303, "/?parentLogin=invalid");
  }
  writeParentSession(res);
  return res.redirect(303, "/?area=parent&login=ok");
});

app.post("/auth/child/:member/login", (req, res) => {
  const member = String(req.params.member || "").toLowerCase();
  if (!isFamilyMember(member)) return res.redirect(303, "/?childLogin=invalid_member");
  if (!childPinConfigured(member)) return res.redirect(303, `/?area=${member}&childLogin=not_configured`);
  if (!safeEqual(normalizePin(req.body?.pin), normalizePin(process.env[childPinName(member)]))) {
    return res.redirect(303, `/?area=${member}&childLogin=invalid`);
  }
  writeChildSession(res, member);
  return res.redirect(303, `/?area=${member}&login=ok`);
});

app.post("/auth/logout/:role", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();
  if (role === "parent") clearCookie(res, "hero_parent_session");
  if (isFamilyMember(role)) clearCookie(res, `hero_${role}_session`);
  return res.redirect(303, `/?area=${isFamilyMember(role) ? role : "parent"}`);
});

app.get("/api/family/dashboard", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureDatabase();
  const date = familyDateKey(req.query.date);
  const [{ rows: summaryRows }, { rows: eventRows }] = await Promise.all([
    pool.query(
      `SELECT assignee, COUNT(*) FILTER (WHERE done=FALSE) open_count, COUNT(*) FILTER (WHERE done=TRUE) done_count, COUNT(*) total_count FROM hero_family_tasks WHERE due_date=$1 GROUP BY assignee`,
      [date]
    ),
    pool.query(`SELECT * FROM hero_family_events WHERE event_date >= $1 ORDER BY event_date ASC, NULLIF(event_time,'') ASC NULLS LAST LIMIT 20`, [date])
  ]);
  const summary = { yaman: { open: 0, done: 0, total: 0 }, judy: { open: 0, done: 0, total: 0 } };
  for (const row of summaryRows) {
    if (summary[row.assignee]) summary[row.assignee] = { open: Number(row.open_count), done: Number(row.done_count), total: Number(row.total_count) };
  }
  res.json({ date, summary, events: eventRows.map(mapEvent) });
}));

app.get("/api/family/child/:member", asyncRoute(async (req, res) => {
  const member = String(req.params.member || "").toLowerCase();
  if (!isFamilyMember(member)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, member);
  const date = familyDateKey(req.query.date);
  const [tasks, events] = await Promise.all([getTasks(member, date), getEvents(member, date)]);
  res.json({ member: FAMILY_MEMBERS[member], date, tasks, events });
}));

app.post("/api/family/tasks", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureDatabase();
  const assignee = String(req.body?.assignee || "").toLowerCase();
  const title = text(req.body?.title, 160);
  if (!isFamilyMember(assignee) || !title) throw new PublicError(400, "اختر الطفل واكتب مهمة واضحة.");
  const { rows } = await pool.query(
    `INSERT INTO hero_family_tasks (id,assignee,title,task_type,points,due_date,note,source) VALUES ($1,$2,$3,$4,$5,$6,$7,'parent') RETURNING *`,
    [crypto.randomUUID(), assignee, title, taskType(req.body?.type), Math.max(0, Math.min(50, Number(req.body?.points) || 5)), familyDateKey(req.body?.date), text(req.body?.note, 400)]
  );
  res.status(201).json({ task: mapTask(rows[0]) });
}));

app.patch("/api/family/tasks/:id/complete", asyncRoute(async (req, res) => {
  await ensureDatabase();
  const member = String(req.body?.assignee || "").toLowerCase();
  if (!isFamilyMember(member)) throw new PublicError(400, "منطقة الطفل غير معروفة.");
  requireChildOrParent(req, member);
  const { rows } = await pool.query(
    `UPDATE hero_family_tasks SET done=TRUE, updated_at=NOW() WHERE id=$1 AND assignee=$2 RETURNING *`,
    [req.params.id, member]
  );
  if (!rows[0]) throw new PublicError(404, "لم نجد هذه المهمة.");
  res.json({ task: mapTask(rows[0]) });
}));

app.delete("/api/family/tasks/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureDatabase();
  const result = await pool.query("DELETE FROM hero_family_tasks WHERE id=$1", [req.params.id]);
  if (!result.rowCount) throw new PublicError(404, "لم نجد هذه المهمة.");
  res.status(204).end();
}));

app.post("/api/family/events", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureDatabase();
  const assignee = String(req.body?.assignee || "family").toLowerCase();
  const title = text(req.body?.title, 140);
  const time = /^\d{2}:\d{2}$/.test(String(req.body?.time || "")) ? String(req.body.time) : "";
  if (!['yaman','judy','family'].includes(assignee) || !title) throw new PublicError(400, "اكتب اسم الموعد وحدد لمن يظهر.");
  const { rows } = await pool.query(
    `INSERT INTO hero_family_events (id,assignee,title,event_date,event_time,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [crypto.randomUUID(), assignee, title, familyDateKey(req.body?.date), time, text(req.body?.note, 350)]
  );
  res.status(201).json({ event: mapEvent(rows[0]) });
}));

// ---- TickTick routes ----
function ticktickTokens(req) {
  return decryptJson(readCookie(req, "hero_ticktick_tokens"));
}

function ticktickWriteTokens(res, payload) {
  appendSetCookie(res, makeCookie("hero_ticktick_tokens", encryptJson(payload), 30 * 24 * 60 * 60));
}

async function readResponse(response) {
  const body = await response.text();
  try { return body ? JSON.parse(body) : null; } catch { return body; }
}

app.get("/api/ticktick/status", (req, res) => {
  const configured = isTickTickConfigured();
  res.json({ configured, connected: configured && Boolean(ticktickTokens(req)?.accessToken), projectName: TICKTICK_PROJECT_NAME });
});

app.get("/auth/ticktick", (req, res, next) => {
  try {
    if (!isTickTickConfigured()) throw new PublicError(503, "יש להגדיר את משתני TickTick ואת SESSION_SECRET ב-Railway.");
    const state = crypto.randomBytes(24).toString("base64url");
    appendSetCookie(res, makeCookie("hero_ticktick_state", encryptJson({ state, expiresAt: Date.now() + 10 * 60 * 1000 }), 10 * 60));
    const url = new URL(TICKTICK_AUTH_URL);
    url.searchParams.set("client_id", process.env.TICKTICK_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", process.env.TICKTICK_REDIRECT_URI);
    url.searchParams.set("scope", "tasks:read tasks:write");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  } catch (error) { next(error); }
});

app.get("/auth/ticktick/callback", asyncRoute(async (req, res) => {
  if (req.query.error) return res.redirect("/?ticktick=denied");
  const saved = decryptJson(readCookie(req, "hero_ticktick_state"));
  clearCookie(res, "hero_ticktick_state");
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!saved || saved.state !== state || Number(saved.expiresAt) < Date.now() || !code) return res.redirect("/?ticktick=state_error");
  const response = await fetch(TICKTICK_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.TICKTICK_CLIENT_ID,
      client_secret: process.env.TICKTICK_CLIENT_SECRET,
      code,
      redirect_uri: process.env.TICKTICK_REDIRECT_URI
    }).toString()
  });
  const body = await readResponse(response);
  if (!response.ok || !body?.access_token) throw new PublicError(502, "TickTick לא אישר את החיבור. בדוק Client ID, Client Secret ו-Redirect URI.");
  ticktickWriteTokens(res, { accessToken: body.access_token, refreshToken: body.refresh_token || null, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 });
  res.redirect("/?ticktick=connected");
}));

app.post("/api/ticktick/disconnect", (req, res) => {
  clearCookie(res, "hero_ticktick_tokens");
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
  const status = Number(error?.status) || 500;
  if (!(error instanceof PublicError)) console.error("Unexpected server error:", error);
  res.status(status).json({ error: error instanceof PublicError ? error.message : "אירעה שגיאה בשרת. נסה שוב." });
});

app.listen(PORT, () => {
  console.log(`Hero Family is running on port ${PORT}`);
});
