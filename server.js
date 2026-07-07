const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const TICKTICK_AUTH_URL = "https://ticktick.com/oauth/authorize";
const TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token";
const TICKTICK_API_BASE = "https://api.ticktick.com/open/v1";
const HERO_PROJECT_NAME = "Hero – Yaman";
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Jerusalem";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_IDEA_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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

  if (!current) {
    res.setHeader("Set-Cookie", [cookie]);
    return;
  }

  res.setHeader(
    "Set-Cookie",
    Array.isArray(current) ? [...current, cookie] : [current, cookie]
  );
}

function makeCookie(name, value, maxAgeSeconds) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (cookieIsSecure()) {
    attributes.push("Secure");
  }

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

function encryptionKey() {
  if (!process.env.SESSION_SECRET) {
    throw new PublicError(503, "יש להגדיר SESSION_SECRET ב-Railway לפני חיבור TickTick.");
  }

  return crypto
    .createHash("sha256")
    .update(process.env.SESSION_SECRET)
    .digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptJson(value) {
  try {
    const [ivValue, tagValue, encryptedValue] = String(value || "").split(".");

    if (!ivValue || !tagValue || !encryptedValue) {
      return null;
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64url")
    );

    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue)),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
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

    if (!issuedAtValue || !nonce || !signature) {
      return false;
    }

    const issuedAt = Number(issuedAtValue);
    const maxAge = 10 * 60 * 1000;

    if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000 || Date.now() - issuedAt > maxAge) {
      return false;
    }

    const payload = `${issuedAtValue}.${nonce}`;
    const expected = crypto
      .createHmac("sha256", encryptionKey())
      .update(`ticktick-oauth:${payload}`)
      .digest("base64url");

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    return (
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  } catch {
    return false;
  }
}

function getStoredTokens(req) {
  return decryptJson(readCookie(req, "hero_ticktick_tokens"));
}

function writeStoredTokens(res, tokens) {
  appendSetCookie(
    res,
    makeCookie(
      "hero_ticktick_tokens",
      encryptJson(tokens),
      60 * 60 * 24 * 30
    )
  );
}

function normalizeTokens(payload, previousTokens = {}) {
  const expiresIn = Number(payload.expires_in);

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previousTokens.refreshToken || null,
    expiresAt: Number.isFinite(expiresIn)
      ? Date.now() + expiresIn * 1000
      : previousTokens.expiresAt || null
  };
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestToken(params) {
  const response = await fetch(TICKTICK_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });

  const body = await readResponseBody(response);

  if (!response.ok || !body || typeof body !== "object" || !body.access_token) {
    const reason =
      body && typeof body === "object"
        ? body.error || body.message || "unknown_error"
        : "unknown_error";

    console.error("TickTick token request failed:", response.status, reason, {
      redirectUri: process.env.TICKTICK_REDIRECT_URI || ""
    });

    throw new PublicError(
      502,
      "TickTick לא אישר את החיבור. בדוק את Client ID, Client Secret ו-Redirect URI."
    );
  }

  return body;
}

async function refreshTokens(req, res, tokens) {
  if (!tokens?.refreshToken) {
    throw new PublicError(
      401,
      "חיבור TickTick הסתיים. יש ללחוץ שוב על רبط TickTick."
    );
  }

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

  if (!tokens?.accessToken) {
    throw new PublicError(401, "TickTick אינו מחובר עדיין.");
  }

  const expiresSoon =
    tokens.expiresAt && Number(tokens.expiresAt) <= Date.now() + 60_000;

  if (expiresSoon) {
    tokens = await refreshTokens(req, res, tokens);
  }

  return tokens;
}

async function tickTickRequest(req, res, endpoint, options = {}) {
  let tokens = await getValidTokens(req, res);

  async function send(accessToken) {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    return fetch(`${TICKTICK_API_BASE}${endpoint}`, {
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
    console.error("TickTick API request failed:", response.status, endpoint);

    if (response.status === 401) {
      throw new PublicError(
        401,
        "חיבור TickTick הסתיים. יש ללחוץ שוב על רبط TickTick."
      );
    }

    throw new PublicError(
      502,
      "TickTick לא הצליח לבצע את הפעולה. נסה שוב בעוד רגע."
    );
  }

  return body;
}

function dateKeyInTimeZone(value, timeZone = APP_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

function taskDateKey(task) {
  const rawDate = task?.dueDate || task?.startDate;

  if (!rawDate) {
    return null;
  }

  const value = String(rawDate);

  // TickTick may return an all-day date without a time component.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return dateKeyInTimeZone(value);
}

function isOpenTickTickTask(task) {
  if (!task || !task.id || !task.title) {
    return false;
  }

  if (task.completed === true || task.deleted === true) {
    return false;
  }

  // TickTick task status 2 indicates a completed item in project data.
  if (Number(task.status) === 2) {
    return false;
  }

  return true;
}

function selectedProjectIdsFromQuery(value) {
  if (typeof value !== "string") {
    return [];
  }

  return [...new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id && id.length <= 200)
  )];
}
async function ensureHeroProject(req, res) {
  const projects = await tickTickRequest(req, res, "/project");

  if (!Array.isArray(projects)) {
    throw new PublicError(502, "לא התקבלה רשימת פרויקטים תקינה מ-TickTick.");
  }

  let project = projects.find(
    (item) => item.name === HERO_PROJECT_NAME && item.closed !== true
  );

  if (!project) {
    project = await tickTickRequest(req, res, "/project", {
      method: "POST",
      body: {
        name: HERO_PROJECT_NAME,
        color: "#5B5BD6",
        viewMode: "list",
        kind: "TASK"
      }
    });
  }

  if (!project?.id) {
    throw new PublicError(502, "לא ניתן ליצור את רשימת Hero – Yaman ב-TickTick.");
  }

  return project;
}

function cleanIdeaText(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 600)
    : "";
}

function createLocalIdeaSuggestions(idea) {
  const text = cleanIdeaText(idea);
  const lower = text.toLowerCase();
  const has = (...words) => words.some((word) => lower.includes(word));

  let theme = "فكرة أصلية قصيرة";
  let character = "بطل صغير";

  if (has("روبوت", "robot")) {
    theme = "روبوت يتعلم شيئاً جديداً";
    character = "روبوت فضولي";
  } else if (has("فضاء", "كوكب", "space", "planet")) {
    theme = "مغامرة صغيرة في الفضاء";
    character = "مستكشف فضاء صغير";
  } else if (has("كرة", "رياضة", "football", "sport")) {
    theme = "تحدٍّ رياضي لطيف";
    character = "لاعب يحب التدريب";
  } else if (has("صوت", "دبلج", "تمثيل", "voice", "dub")) {
    theme = "مغامرة بأصوات مختلفة";
    character = "مؤدي أصوات شاب";
  } else if (has("قط", "حيوان", "cat", "animal")) {
    theme = "حيوان ذكي يساعد صديقاً";
    character = "حيوان لطيف ومتحدث";
  }

  const safeInput = text || "فكرة جديدة";

  return {
    source: "local",
    ideas: [
      {
        title: `${theme}: المهمة الأولى`,
        summary: `${character} يبدأ من فكرتك: «${safeInput}». تظهر مشكلة صغيرة، ويجد حلاً هادئاً مع صديق.`,
        firstStep: "اختر شخصية واحدة واكتب أو سجّل جملة واحدة بصوتها.",
        taskTitle: "تطوير فكرة إبداعية: كتابة جملة واحدة أو تسجيل صوت قصير",
        category: "creative"
      },
      {
        title: `${theme}: تبديل الأدوار`,
        summary:
          `${character} يجرّب دورين مختلفين: بطل هادئ وصديق مضحك. في النهاية يتعاونان بدلاً من التنافس.`,
        firstStep:
          "اختر اسمين للشخصيتين وحدد ما الذي يريده كل واحد منهما.",
        taskTitle: "ابتكار شخصيتين وفكرة حوار قصيرة",
        category: "creative"
      },
      {
        title: `${theme}: نهاية سعيدة`,
        summary:
          `${character} يواجه موقفاً محيّراً، ثم يتوقف قليلاً ويسأل سؤالاً جيداً قبل أن يتصرف.`,
        firstStep:
          "اكتب نهاية من سطر واحد تبدأ بكلمة: في النهاية...",
        taskTitle: "كتابة نهاية قصيرة لفكرة جديدة",
        category: "creative"
      }
    ]
  };
}

function extractOpenAIText(payload) {
  if (
    typeof payload?.output_text === "string" &&
    payload.output_text.trim()
  ) {
    return payload.output_text.trim();
  }

  const parts = [];

  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content)
      ? item.content
      : []) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function normalizeIdeaSuggestions(value) {
  const rawIdeas = Array.isArray(value?.ideas) ? value.ideas : [];

  const allowedCategories = new Set([
    "study",
    "home",
    "creative",
    "movement",
    "social",
    "routine",
    "other"
  ]);

  return rawIdeas
    .slice(0, 3)
    .map((idea) => ({
      title: String(idea?.title || "فكرة جديدة")
        .trim()
        .slice(0, 100),
      summary: String(
        idea?.summary || "فكرة قصيرة يمكن تطويرها بهدوء."
      )
        .trim()
        .slice(0, 360),
      firstStep: String(
        idea?.firstStep || "ابدأ بجملة واحدة فقط."
      )
        .trim()
        .slice(0, 180),
      taskTitle: String(
        idea?.taskTitle || "تطوير فكرة قصيرة لمدة 10 دقائق"
      )
        .trim()
        .slice(0, 180),
      category: allowedCategories.has(idea?.category)
        ? idea.category
        : "creative"
    }))
    .filter(
      (idea) =>
        idea.title &&
        idea.summary &&
        idea.firstStep &&
        idea.taskTitle
    );
}

async function createOpenAIIdeaSuggestions(idea) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      ideas: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            firstStep: { type: "string" },
            taskTitle: { type: "string" },
            category: {
              type: "string",
              enum: [
                "study",
                "home",
                "creative",
                "movement",
                "social",
                "routine",
                "other"
              ]
            }
          },
          required: [
            "title",
            "summary",
            "firstStep",
            "taskTitle",
            "category"
          ]
        }
      }
    },
    required: ["ideas"]
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_IDEA_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are Hero, a supportive Arabic idea coach for a 15-year-old. Return exactly three safe, original, age-appropriate ideas in Arabic. Keep language simple and concrete. Every idea must have one small first step that takes 5–15 minutes. Avoid scary, sexual, violent, illegal, risky, medical, political, or copyrighted-character ideas. Do not encourage public posting. Do not mention diagnoses."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `فكرة يَمان الأولية: ${idea}`
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "yaman_idea_suggestions",
          strict: true,
          schema
        }
      },
      max_output_tokens: 900
    })
  });

  const body = await readResponseBody(response);

  if (!response.ok) {
    const reason =
      body && typeof body === "object"
        ? body.error?.message ||
          body.error?.code ||
          "OpenAI request failed"
        : "OpenAI request failed";

    console.error(
      "OpenAI idea request failed:",
      response.status,
      reason
    );

    throw new PublicError(
      502,
      "تعذر الوصول إلى اقتراحات AI الآن. جرّب مرة أخرى."
    );
  }

  const outputText = extractOpenAIText(body);

  if (!outputText) {
    throw new PublicError(
      502,
      "لم تصل اقتراحات AI بشكل صحيح. جرّب مرة أخرى."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new PublicError(
      502,
      "وصل رد AI غير صالح. جرّب مرة أخرى."
    );
  }

  const ideas = normalizeIdeaSuggestions(parsed);

  if (ideas.length !== 3) {
    throw new PublicError(
      502,
      "لم تصل 3 اقتراحات واضحة. جرّب مرة أخرى."
    );
  }

  return {
    source: "openai",
    ideas
  };
}

function requireConfigured() {
  if (!isTickTickConfigured()) {
    throw new PublicError(
      503,
      "יש להוסיף קודם את TICKTICK_CLIENT_ID, TICKTICK_CLIENT_SECRET, TICKTICK_REDIRECT_URI ו-SESSION_SECRET ב-Railway."
    );
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
const FAMILY_MEMBERS = {
  yaman: { id: "yaman", name: "يَمان", label: "منطقة يَمان" },
  judy: { id: "judy", name: "جودي", label: "منطقة جودي" }
};

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false
    })
  : null;

let familyDatabaseReady = null;

function isFamilyMember(value) {
  return Object.prototype.hasOwnProperty.call(FAMILY_MEMBERS, value);
}

function familyDateKey(value) {
  const raw = String(value || "").slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : dateKeyInTimeZone(new Date());
}

function requireFamilyDatabase() {
  if (!pool) {
    throw new PublicError(
      503,
      "قاعدة بيانات العائلة غير مفعّلة. أضف DATABASE_URL من PostgreSQL في Railway."
    );
  }
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
          done BOOLEAN NOT NULL DEFAULT FALSE,
          source TEXT NOT NULL DEFAULT 'parent',
          ticktick_task_id TEXT,
          ticktick_project_id TEXT,
          ticktick_project_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

        CREATE INDEX IF NOT EXISTS hero_family_events_date_idx
          ON hero_family_events (event_date, assignee);
      `);
    })().catch((error) => {
      familyDatabaseReady = null;
      throw error;
    });
  }

  await familyDatabaseReady;
}

function parentPinConfigured() {
  return (
    typeof process.env.PARENT_PIN === "string" &&
    process.env.PARENT_PIN.length >= 4
  );
}

function childPinVariableName(assignee) {
  return `${String(assignee || "").toUpperCase()}_PIN`;
}

function childPinConfigured(assignee) {
  const pin = process.env[childPinVariableName(assignee)];

  return typeof pin === "string" && pin.length >= 4;
}

function secureEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createParentSession() {
  return encryptJson({
    role: "parent",
    expiresAt: Date.now() + 1000 * 60 * 60 * 12
  });
}

function createChildSession(assignee) {
  return encryptJson({
    role: "child",
    assignee,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12
  });
}

function childSessionCookieName(assignee) {
  return `hero_${assignee}_session`;
}

function hasParentSession(req) {
  const session = decryptJson(
    readCookie(req, "hero_parent_session")
  );

  return Boolean(
    session?.role === "parent" &&
    Number(session?.expiresAt) > Date.now()
  );
}

function hasChildSession(req, assignee) {
  const session = decryptJson(
    readCookie(req, childSessionCookieName(assignee))
  );

  return Boolean(
    session?.role === "child" &&
    session?.assignee === assignee &&
    Number(session?.expiresAt) > Date.now()
  );
}

function requireParent(req) {
  if (!hasParentSession(req)) {
    throw new PublicError(
      401,
      "يلزم رمز الوالدين لإدارة مهام العائلة."
    );
  }
}

function requireChildOrParent(req, assignee) {
  if (!hasParentSession(req) && !hasChildSession(req, assignee)) {
    throw new PublicError(
      401,
      "أدخل رمز الدخول الخاص بهذه المنطقة أولاً."
    );
  }
}

function writeParentSession(res) {
  appendSetCookie(
    res,
    makeCookie(
      "hero_parent_session",
      createParentSession(),
      60 * 60 * 12
    )
  );
}

function writeChildSession(res, assignee) {
  appendSetCookie(
    res,
    makeCookie(
      childSessionCookieName(assignee),
      createChildSession(assignee),
      60 * 60 * 12
    )
  );
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
    done: Boolean(row.done),
    source: row.source || "parent",
    ticktickTaskId: row.ticktick_task_id || null,
    ticktickProjectId: row.ticktick_project_id || null,
    ticktickProjectName: row.ticktick_project_name || ""
  };
}

function mapFamilyEvent(row) {
  return {
    id: row.id,
    assignee: row.assignee,
    title: row.title,
    date: String(row.event_date).slice(0, 10),
    time: row.event_time || "",
    note: row.note || ""
  };
}

function safeText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function safeTaskType(value) {
  return [
    "study",
    "home",
    "creative",
    "movement",
    "social",
    "routine",
    "other"
  ].includes(value)
    ? value
    : "other";
}

async function getFamilyTasks(assignee, date) {
  await ensureFamilyDatabase();

  const { rows } = await pool.query(
    `SELECT * FROM hero_family_tasks
      WHERE assignee = $1 AND due_date = $2
      ORDER BY done ASC, created_at ASC`,
    [assignee, date]
  );

  return rows.map(mapFamilyTask);
}

async function getFamilyEvents(assignee, date) {
  await ensureFamilyDatabase();

  const assignees =
    assignee === "family" ? ["family"] : [assignee, "family"];

  const { rows } = await pool.query(
    `SELECT * FROM hero_family_events
      WHERE assignee = ANY($1::text[]) AND event_date = $2
      ORDER BY NULLIF(event_time, '') ASC NULLS LAST, created_at ASC`,
    [assignees, date]
  );

  return rows.map(mapFamilyEvent);
}

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

// כניסת הורה רגילה באמצעות form.
// הנתיב הזה אינו תלוי ב-JavaScript של הדפדפן.
app.post("/auth/parent/login", asyncRoute(async (req, res) => {
  if (!parentPinConfigured()) {
    return res.redirect(303, "/?parentLogin=not_configured");
  }

  const pin =
    typeof req.body?.pin === "string" ? req.body.pin : "";

  if (!secureEqualText(pin, process.env.PARENT_PIN)) {
    return res.redirect(303, "/?parentLogin=invalid");
  }

  writeParentSession(res);

  return res.redirect(303, "/?parent=opened");
}));

app.post("/api/family/parent/login", asyncRoute(async (req, res) => {
  if (!parentPinConfigured()) {
    throw new PublicError(
      503,
      "أضف PARENT_PIN في Railway أولاً. اختر رمزاً من 4 أرقام أو أكثر."
    );
  }

  const pin =
    typeof req.body?.pin === "string" ? req.body.pin : "";

  if (!secureEqualText(pin, process.env.PARENT_PIN)) {
    throw new PublicError(401, "رمز الوالدين غير صحيح.");
  }

  writeParentSession(res);

  res.json({ authenticated: true });
}));

app.post("/api/family/parent/logout", (req, res) => {
  clearCookie(res, "hero_parent_session");
  res.status(204).end();
});

app.post("/api/family/child/:assignee/login", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();

  if (!isFamilyMember(assignee)) {
    throw new PublicError(400, "منطقة الطفل غير معروفة.");
  }

  if (!childPinConfigured(assignee)) {
    throw new PublicError(
      503,
      `أضف ${childPinVariableName(assignee)} في Railway أولاً. اختر رمزاً من 4 أرقام أو أكثر.`
    );
  }

  const pin =
    typeof req.body?.pin === "string" ? req.body.pin : "";

  if (!secureEqualText(pin, process.env[childPinVariableName(assignee)])) {
    throw new PublicError(401, "رمز الدخول غير صحيح.");
  }

  writeChildSession(res, assignee);

  res.json({
    authenticated: true,
    member: FAMILY_MEMBERS[assignee]
  });
}));

app.post("/api/family/child/:assignee/logout", (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();

  if (!isFamilyMember(assignee)) {
    return res.status(400).json({
      error: "منطقة الطفل غير معروفة."
    });
  }

  clearCookie(res, childSessionCookieName(assignee));

  res.status(204).end();
});
app.get("/api/family/dashboard", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();
  const date = familyDateKey(req.query.date);

  const [{ rows: tasks }, { rows: events }] = await Promise.all([
    pool.query(
      `SELECT assignee,
        COUNT(*) FILTER (WHERE done = FALSE) AS open_count,
        COUNT(*) FILTER (WHERE done = TRUE) AS done_count,
        COUNT(*) AS total_count
       FROM hero_family_tasks
       WHERE due_date = $1
       GROUP BY assignee`,
      [date]
    ),
    pool.query(
      `SELECT * FROM hero_family_events
       WHERE event_date >= $1
       ORDER BY event_date ASC, NULLIF(event_time, '') ASC NULLS LAST, created_at ASC
       LIMIT 20`,
      [date]
    )
  ]);

  const summary = {
    yaman: { open: 0, done: 0, total: 0 },
    judy: { open: 0, done: 0, total: 0 }
  };

  for (const row of tasks) {
    if (summary[row.assignee]) {
      summary[row.assignee] = {
        open: Number(row.open_count || 0),
        done: Number(row.done_count || 0),
        total: Number(row.total_count || 0)
      };
    }
  }

  res.json({
    date,
    summary,
    events: events.map(mapFamilyEvent)
  });
}));

app.get("/api/family/child/:assignee", asyncRoute(async (req, res) => {
  const assignee = String(req.params.assignee || "").toLowerCase();

  if (!isFamilyMember(assignee)) {
    throw new PublicError(400, "منطقة الطفل غير معروفة.");
  }

  requireChildOrParent(req, assignee);

  const date = familyDateKey(req.query.date);

  const [tasks, events] = await Promise.all([
    getFamilyTasks(assignee, date),
    getFamilyEvents(assignee, date)
  ]);

  res.json({
    member: FAMILY_MEMBERS[assignee],
    date,
    tasks,
    events,
    parentAuthenticated: hasParentSession(req)
  });
}));

app.post("/api/family/tasks", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();

  const assignee = String(req.body?.assignee || "").toLowerCase();
  const title = safeText(req.body?.title, 160);
  const type = safeTaskType(req.body?.type);
  const points = Math.min(50, Math.max(0, Number(req.body?.points) || 5));
  const dueDate = familyDateKey(req.body?.date);
  const note = safeText(req.body?.note, 400);
  const source = safeText(req.body?.source, 30) || "parent";

  if (!isFamilyMember(assignee) || !title) {
    throw new PublicError(400, "اختر الطفل واكتب مهمة قصيرة وواضحة.");
  }

  const id = crypto.randomUUID();

  const { rows } = await pool.query(
    `INSERT INTO hero_family_tasks
      (id, assignee, title, task_type, points, due_date, note, source, ticktick_task_id, ticktick_project_id, ticktick_project_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      id,
      assignee,
      title,
      type,
      Math.round(points),
      dueDate,
      note,
      source,
      safeText(req.body?.ticktickTaskId, 200) || null,
      safeText(req.body?.ticktickProjectId, 200) || null,
      safeText(req.body?.ticktickProjectName, 200) || null
    ]
  );

  res.status(201).json({ task: mapFamilyTask(rows[0]) });
}));

app.patch("/api/family/tasks/:id/complete", asyncRoute(async (req, res) => {
  await ensureFamilyDatabase();

  const assignee = String(req.body?.assignee || "").toLowerCase();

  if (!isFamilyMember(assignee)) {
    throw new PublicError(400, "منطقة الطفل غير معروفة.");
  }

  requireChildOrParent(req, assignee);

  const { rows } = await pool.query(
    `UPDATE hero_family_tasks
      SET done = TRUE, updated_at = NOW()
      WHERE id = $1 AND assignee = $2
      RETURNING *`,
    [req.params.id, assignee]
  );

  if (!rows[0]) {
    throw new PublicError(404, "لم نجد هذه المهمة.");
  }

  const task = mapFamilyTask(rows[0]);

  if (
    task.ticktickTaskId &&
    task.ticktickProjectId &&
    isTickTickConfigured() &&
    getStoredTokens(req)?.accessToken
  ) {
    try {
      await tickTickRequest(
        req,
        res,
        `/project/${encodeURIComponent(task.ticktickProjectId)}/task/${encodeURIComponent(task.ticktickTaskId)}/complete`,
        { method: "POST" }
      );
    } catch (error) {
      console.warn(
        "Family task completed locally but TickTick completion failed:",
        error.message
      );
    }
  }

  res.json({ task });
}));

app.patch("/api/family/tasks/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();

  const title = safeText(req.body?.title, 160);
  const type = safeTaskType(req.body?.type);
  const points = Math.min(50, Math.max(0, Number(req.body?.points) || 5));
  const date = familyDateKey(req.body?.date);
  const note = safeText(req.body?.note, 400);
  const assignee = String(req.body?.assignee || "").toLowerCase();

  if (!title || !isFamilyMember(assignee)) {
    throw new PublicError(400, "تحقق من الطفل واسم المهمة.");
  }

  const { rows } = await pool.query(
    `UPDATE hero_family_tasks
      SET assignee = $2,
          title = $3,
          task_type = $4,
          points = $5,
          due_date = $6,
          note = $7,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      req.params.id,
      assignee,
      title,
      type,
      Math.round(points),
      date,
      note
    ]
  );

  if (!rows[0]) {
    throw new PublicError(404, "لم نجد هذه المهمة.");
  }

  res.json({ task: mapFamilyTask(rows[0]) });
}));

app.delete("/api/family/tasks/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();

  const result = await pool.query(
    "DELETE FROM hero_family_tasks WHERE id = $1",
    [req.params.id]
  );

  if (!result.rowCount) {
    throw new PublicError(404, "لم نجد هذه المهمة.");
  }

  res.status(204).end();
}));

app.post("/api/family/events", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();

  const assignee = String(req.body?.assignee || "family").toLowerCase();
  const title = safeText(req.body?.title, 140);
  const date = familyDateKey(req.body?.date);
  const time = /^\d{2}:\d{2}$/.test(String(req.body?.time || ""))
    ? String(req.body.time)
    : "";
  const note = safeText(req.body?.note, 350);

  if (!["yaman", "judy", "family"].includes(assignee) || !title) {
    throw new PublicError(400, "اكتب اسم الموعد وحدد لمن يظهر.");
  }

  const { rows } = await pool.query(
    `INSERT INTO hero_family_events
      (id, assignee, title, event_date, event_time, note)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [crypto.randomUUID(), assignee, title, date, time, note]
  );

  res.status(201).json({ event: mapFamilyEvent(rows[0]) });
}));

app.delete("/api/family/events/:id", asyncRoute(async (req, res) => {
  requireParent(req);
  await ensureFamilyDatabase();

  const result = await pool.query(
    "DELETE FROM hero_family_events WHERE id = $1",
    [req.params.id]
  );

  if (!result.rowCount) {
    throw new PublicError(404, "لم نجد هذا الموعد.");
  }

  res.status(204).end();
}));
app.get("/api/ticktick/diagnostics", (req, res) => {
  const configured = isTickTickConfigured();
  const cookieHeader = req.headers.cookie || "";
  const hasTokenCookie = /(?:^|;\s*)hero_ticktick_tokens=/.test(cookieHeader);

  res.json({
    configured,
    connected: configured && Boolean(getStoredTokens(req)?.accessToken),
    hasTokenCookie,
    redirectUri: process.env.TICKTICK_REDIRECT_URI || "",
    cookieSecure: cookieIsSecure(),
    appTimeZone: APP_TIME_ZONE
  });
});

app.get("/api/ticktick/projects", asyncRoute(async (req, res) => {
  requireConfigured();

  const projects = await tickTickRequest(req, res, "/project");

  if (!Array.isArray(projects)) {
    throw new PublicError(502, "לא התקבלה רשימת פרויקטים תקינה מ-TickTick.");
  }

  const activeProjects = projects
    .filter((project) => project && project.id && project.closed !== true)
    .map((project) => ({
      id: String(project.id),
      name: String(project.name || "TickTick"),
      color: typeof project.color === "string" ? project.color : "",
      kind: typeof project.kind === "string" ? project.kind : "TASK",
      viewMode: typeof project.viewMode === "string" ? project.viewMode : "list"
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  res.json({ projects: activeProjects });
}));

app.get("/api/ticktick/today-tasks", asyncRoute(async (req, res) => {
  requireConfigured();

  const today = dateKeyInTimeZone(new Date());
  const requestedDate =
    typeof req.query.date === "string" ? req.query.date : "";

  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : today;

  if (targetDate !== today) {
    throw new PublicError(400, "אפשר לייבא רק את משימות היום הנוכחי.");
  }

  const projects = await tickTickRequest(req, res, "/project");

  if (!Array.isArray(projects)) {
    throw new PublicError(502, "לא התקבלה רשימת פרויקטים תקינה מ-TickTick.");
  }

  const allActiveProjects = projects.filter(
    (project) => project && project.id && project.closed !== true
  );

  const requestedProjectIds = selectedProjectIdsFromQuery(
    req.query.projectIds
  );

  const requestedIdSet = new Set(requestedProjectIds);

  const activeProjects = requestedProjectIds.length
    ? allActiveProjects.filter((project) =>
        requestedIdSet.has(String(project.id))
      )
    : allActiveProjects;

  const collected = [];
  let failedProjects = 0;

  for (const project of activeProjects) {
    try {
      const data = await tickTickRequest(
        req,
        res,
        `/project/${encodeURIComponent(project.id)}/data`
      );

      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

      for (const task of tasks) {
        if (!isOpenTickTickTask(task) || taskDateKey(task) !== targetDate) {
          continue;
        }

        collected.push({
          id: String(task.id),
          projectId: String(task.projectId || project.id),
          projectName: String(project.name || "TickTick"),
          title: String(task.title).trim().slice(0, 200),
          content:
            typeof task.content === "string"
              ? task.content.slice(0, 500)
              : "",
          dueDate: task.dueDate || task.startDate || null,
          priority: Number(task.priority) || 0
        });
      }
    } catch (error) {
      if (Number(error?.status) === 401) {
        throw error;
      }

      failedProjects += 1;
      console.warn(
        "Could not load TickTick project for daily import:",
        project.id
      );
    }
  }

  const unique = new Map();

  for (const task of collected) {
    unique.set(`${task.projectId}:${task.id}`, task);
  }

  const tasks = [...unique.values()]
    .sort((a, b) => {
      const byDueDate = String(a.dueDate || "").localeCompare(
        String(b.dueDate || "")
      );

      return (
        byDueDate ||
        Number(b.priority) - Number(a.priority) ||
        a.title.localeCompare(b.title)
      );
    })
    .slice(0, 100);

  res.json({
    date: targetDate,
    timeZone: APP_TIME_ZONE,
    projectScope: requestedProjectIds.length ? "selected" : "all",
    projectsRequested:
      requestedProjectIds.length || allActiveProjects.length,
    projectsScanned: activeProjects.length,
    failedProjects,
    tasks
  });
}));

app.get("/auth/ticktick", (req, res, next) => {
  try {
    requireConfigured();

    const authorizationUrl = new URL(TICKTICK_AUTH_URL);

    authorizationUrl.searchParams.set(
      "client_id",
      process.env.TICKTICK_CLIENT_ID
    );

    authorizationUrl.searchParams.set("response_type", "code");

    authorizationUrl.searchParams.set(
      "redirect_uri",
      process.env.TICKTICK_REDIRECT_URI
    );

    authorizationUrl.searchParams.set(
      "scope",
      "tasks:read tasks:write"
    );

    authorizationUrl.searchParams.set("state", createOAuthState());

    res.redirect(authorizationUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.get("/auth/ticktick/callback", asyncRoute(async (req, res) => {
  requireConfigured();

  if (req.query.error) {
    return res.redirect("/?ticktick=denied");
  }

  const code =
    typeof req.query.code === "string" ? req.query.code : "";

  const state =
    typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !verifyOAuthState(state)) {
    return res.redirect("/?ticktick=state_error");
  }

  const payload = await requestToken({
    grant_type: "authorization_code",
    client_id: process.env.TICKTICK_CLIENT_ID,
    client_secret: process.env.TICKTICK_CLIENT_SECRET,
    code,
    redirect_uri: process.env.TICKTICK_REDIRECT_URI
  });

  writeStoredTokens(res, normalizeTokens(payload));

  return res.redirect("/?ticktick=connected");
}));

app.post("/api/ticktick/task", asyncRoute(async (req, res) => {
  requireConfigured();

  const title =
    typeof req.body?.title === "string"
      ? req.body.title.trim().slice(0, 200)
      : "";

  const category =
    typeof req.body?.category === "string"
      ? req.body.category.trim().slice(0, 80)
      : "other";

  const points = Number(req.body?.points);
  const completed = Boolean(req.body?.completed);

  if (!title) {
    throw new PublicError(400, "חסר שם משימה.");
  }

  const project = await ensureHeroProject(req, res);

  const task = await tickTickRequest(req, res, "/task", {
    method: "POST",
    body: {
      title,
      projectId: project.id,
      content: `Hero – Yaman\nالمجال: ${category}\nالنقاط: ${
        Number.isFinite(points) ? points : 0
      }`,
      priority: 0
    }
  });

  if (!task?.id) {
    throw new PublicError(502, "TickTick לא החזיר מזהה משימה.");
  }

  if (completed) {
    await tickTickRequest(
      req,
      res,
      `/project/${encodeURIComponent(project.id)}/task/${encodeURIComponent(task.id)}/complete`,
      { method: "POST" }
    );
  }

  res.status(201).json({
    project: {
      id: project.id,
      name: project.name
    },
    task: {
      id: task.id,
      projectId: project.id,
      completed
    }
  });
}));

app.post("/api/ticktick/task/complete", asyncRoute(async (req, res) => {
  requireConfigured();

  const projectId =
    typeof req.body?.projectId === "string"
      ? req.body.projectId.trim()
      : "";

  const taskId =
    typeof req.body?.taskId === "string"
      ? req.body.taskId.trim()
      : "";

  if (!projectId || !taskId) {
    throw new PublicError(400, "חסרים מזהי המשימה ב-TickTick.");
  }

  await tickTickRequest(
    req,
    res,
    `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
    { method: "POST" }
  );

  res.status(204).end();
}));

app.post("/api/ideas", asyncRoute(async (req, res) => {
  const idea = cleanIdeaText(req.body?.idea);

  if (idea.length < 4) {
    throw new PublicError(400, "اكتب فكرة قصيرة من عدة كلمات أولاً.");
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.json(createLocalIdeaSuggestions(idea));
  }

  const result = await createOpenAIIdeaSuggestions(idea);

  return res.json(result);
}));

app.post("/api/ticktick/disconnect", (req, res) => {
  clearCookie(res, "hero_ticktick_tokens");
  clearCookie(res, "hero_ticktick_state");
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
  const status = Number(error?.status) || 500;

  const message =
    error instanceof PublicError
      ? error.message
      : "אירעה שגיאה בשרת. נסה שוב בעוד רגע.";

  if (!(error instanceof PublicError)) {
    console.error("Unexpected server error:", error);
  }

  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Yaman Hero is running on port ${PORT}`);
});
