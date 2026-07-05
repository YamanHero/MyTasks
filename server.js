const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const TICKTICK_AUTH_URL = "https://ticktick.com/oauth/authorize";
const TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token";
const TICKTICK_API_BASE = "https://api.ticktick.com/open/v1";
const TICKTICK_SCOPE = "tasks:read tasks:write";
const HERO_PROJECT_NAME = "Hero – Yaman";

const TICKTICK_REDIRECT_URI =
  "https://heroyaman-production.up.railway.app/auth/ticktick/callback";

const database = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5
    })
  : null;

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));

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
    process.env.SESSION_SECRET
  );
}

function cookieIsSecure() {
  return Boolean(
    process.env.NODE_ENV === "production" ||
    process.env.RAILWAY_PUBLIC_DOMAIN
  );
}

function appendCookie(res, cookie) {
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
  appendCookie(res, makeCookie(name, "", 0));
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...cookieValue] = part.trim().split("=");

    if (cookieName === name) {
      try {
        return decodeURIComponent(cookieValue.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function encryptionKey() {
  if (!process.env.SESSION_SECRET) {
    throw new PublicError(
      503,
      "יש להגדיר SESSION_SECRET ב-Railway לפני חיבור TickTick."
    );
  }

  return crypto
    .createHash("sha256")
    .update(process.env.SESSION_SECRET)
    .digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted]
    .map((item) => item.toString("base64url"))
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
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

function getToken(req) {
  return decryptJson(readCookie(req, "hero_ticktick_token"));
}

function saveToken(res, token) {
  appendCookie(
    res,
    makeCookie(
      "hero_ticktick_token",
      encryptJson({ accessToken: token }),
      60 * 60 * 24 * 30
    )
  );
}

function clearAuth(res) {
  clearCookie(res, "hero_ticktick_token");
  clearCookie(res, "hero_ticktick_state");
}

function requireTickTickConfig() {
  if (!isTickTickConfigured()) {
    throw new PublicError(
      503,
      "יש להגדיר ב-Railway: TICKTICK_CLIENT_ID, TICKTICK_CLIENT_SECRET ו-SESSION_SECRET."
    );
  }
}

async function initializeDatabase() {
  if (!database) {
    console.warn("DATABASE_URL is not configured. Database features are disabled.");
    return;
  }

  await database.query(`
    CREATE TABLE IF NOT EXISTS hero_families (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS hero_tasks (
      id TEXT PRIMARY KEY,
      family_id BIGINT REFERENCES hero_families(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      ticktick_task_id TEXT,
      ticktick_project_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS hero_tasks_family_id_idx
    ON hero_tasks (family_id);
  `);

  console.log("PostgreSQL is connected and Hero tables are ready.");
}

async function parseResponse(response) {
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

async function exchangeAuthorizationCode(code) {
  const basicAuth = Buffer
    .from(
      `${process.env.TICKTICK_CLIENT_ID}:${process.env.TICKTICK_CLIENT_SECRET}`
    )
    .toString("base64");

  const response = await fetch(TICKTICK_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: TICKTICK_REDIRECT_URI,
      scope: TICKTICK_SCOPE
    }).toString()
  });

  const body = await parseResponse(response);

  if (!response.ok || !body?.access_token) {
    throw new PublicError(
      502,
      "TickTick לא אישר את החיבור. בדוק Client ID, Client Secret ו-Redirect URI."
    );
  }

  return body.access_token;
}

async function tickTickRequest(req, res, endpoint, options = {}) {
  const token = getToken(req)?.accessToken;

  if (!token) {
    throw new PublicError(
      401,
      "TickTick אינו מחובר. יש ללחוץ על רبط TickTick."
    );
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${TICKTICK_API_BASE}${endpoint}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined
      ? undefined
      : JSON.stringify(options.body)
  });

  const body = await parseResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      clearAuth(res);

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

async function ensureHeroProject(req, res) {
  const projects = await tickTickRequest(req, res, "/project");

  if (!Array.isArray(projects)) {
    throw new PublicError(
      502,
      "לא התקבלה רשימת פרויקטים תקינה מ-TickTick."
    );
  }

  let project = projects.find(
    (item) =>
      item.name === HERO_PROJECT_NAME &&
      item.closed !== true
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
    throw new PublicError(
      502,
      "לא ניתן ליצור את רשימת Hero – Yaman ב-TickTick."
    );
  }

  return project;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Yaman Hero",
    ticktickConfigured: isTickTickConfigured(),
    databaseConfigured: Boolean(database)
  });
});

app.get("/api/database-status", asyncRoute(async (req, res) => {
  if (!database) {
    return res.status(503).json({
      connected: false,
      error: "DATABASE_URL is missing."
    });
  }

  const result = await database.query(
    "SELECT NOW() AS database_time"
  );

  res.json({
    connected: true,
    databaseTime: result.rows[0].database_time
  });
}));

app.get("/api/ticktick/status", (req, res) => {
  res.json({
    configured: isTickTickConfigured(),
    connected: Boolean(
      isTickTickConfigured() &&
      getToken(req)?.accessToken
    ),
    projectName: HERO_PROJECT_NAME
  });
});

app.get("/auth/ticktick", (req, res, next) => {
  try {
    requireTickTickConfig();

    const state = crypto.randomBytes(32).toString("base64url");

    appendCookie(
      res,
      makeCookie(
        "hero_ticktick_state",
        encryptJson({
          state,
          expiresAt: Date.now() + 10 * 60 * 1000
        }),
        10 * 60
      )
    );

    const authorizationUrl = new URL(TICKTICK_AUTH_URL);

    authorizationUrl.searchParams.set(
      "client_id",
      process.env.TICKTICK_CLIENT_ID
    );

    authorizationUrl.searchParams.set(
      "redirect_uri",
      TICKTICK_REDIRECT_URI
    );

    authorizationUrl.searchParams.set(
      "response_type",
      "code"
    );

    authorizationUrl.searchParams.set(
      "scope",
      TICKTICK_SCOPE
    );

    authorizationUrl.searchParams.set("state", state);

    res.redirect(authorizationUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.get("/auth/ticktick/callback", asyncRoute(async (req, res) => {
  requireTickTickConfig();

  if (req.query.error) {
    clearCookie(res, "hero_ticktick_state");
    return res.redirect("/?ticktick=denied");
  }

  const code = typeof req.query.code === "string"
    ? req.query.code
    : "";

  const state = typeof req.query.state === "string"
    ? req.query.state
    : "";

  const savedState = decryptJson(
    readCookie(req, "hero_ticktick_state")
  );

  clearCookie(res, "hero_ticktick_state");

  if (
    !code ||
    !savedState ||
    savedState.state !== state ||
    Number(savedState.expiresAt) < Date.now()
  ) {
    return res.redirect("/?ticktick=state_error");
  }

  const accessToken = await exchangeAuthorizationCode(code);

  saveToken(res, accessToken);

  return res.redirect("/?ticktick=connected");
}));

app.post("/api/ticktick/task", asyncRoute(async (req, res) => {
  requireTickTickConfig();

  const title = typeof req.body?.title === "string"
    ? req.body.title.trim().slice(0, 200)
    : "";

  const category = typeof req.body?.category === "string"
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
      }`
    }
  });

  if (!task?.id) {
    throw new PublicError(
      502,
      "TickTick לא החזיר מזהה משימה."
    );
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
  requireTickTickConfig();

  const projectId = typeof req.body?.projectId === "string"
    ? req.body.projectId.trim()
    : "";

  const taskId = typeof req.body?.taskId === "string"
    ? req.body.taskId.trim()
    : "";

  if (!projectId || !taskId) {
    throw new PublicError(
      400,
      "חסרים מזהי המשימה ב-TickTick."
    );
  }

  await tickTickRequest(
    req,
    res,
    `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
    { method: "POST" }
  );

  res.status(204).end();
}));

app.post("/api/ticktick/disconnect", (req, res) => {
  clearAuth(res);
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
  const status = Number(error?.status) || 500;

  const message = error instanceof PublicError
    ? error.message
    : "אירעה שגיאה בשרת. נסה שוב בעוד רגע.";

  if (!(error instanceof PublicError)) {
    console.error(error);
  }

  res.status(status).json({ error: message });
});

app.listen(PORT, async () => {
  console.log(`Yaman Hero is running on port ${PORT}`);

  try {
    await initializeDatabase();
  } catch (error) {
    console.error("PostgreSQL initialization failed:", error);
  }
});
