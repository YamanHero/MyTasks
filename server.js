const crypto = require("crypto");
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const TICKTICK_AUTH_URL = "https://ticktick.com/oauth/authorize";
const TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token";
const TICKTICK_API_BASE = "https://api.ticktick.com/open/v1";
const HERO_PROJECT_NAME = "Hero – Yaman";
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Jerusalem";

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
    process.env.TICKTICK_REDIRECT_URI &&
    process.env.SESSION_SECRET
  );
}

function cookieIsSecure() {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN)
  );
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

    console.error("TickTick token request failed:", response.status, reason);

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

  if (Number(task.status) === 2) {
    return false;
  }

  return true;
}

function selectedProjectIdsFromQuery(value) {
  if (typeof value !== "string") {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id && id.length <= 200)
    )
  ];
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
    throw new PublicError(
      502,
      "לא ניתן ליצור את רשימת Hero – Yaman ב-TickTick."
    );
  }

  return project;
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

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Yaman Hero",
    ticktickConfigured: isTickTickConfigured()
  });
});

app.get("/api/ticktick/status", (req, res) => {
  const configured = isTickTickConfigured();
  const connected = configured && Boolean(getStoredTokens(req)?.accessToken);

  res.json({
    configured,
    connected,
    projectName: HERO_PROJECT_NAME,
    timeZone: APP_TIME_ZONE
  });
});

app.get(
  "/api/ticktick/projects",
  asyncRoute(async (req, res) => {
    requireConfigured();

    const projects = await tickTickRequest(req, res, "/project");

    if (!Array.isArray(projects)) {
      throw new PublicError(
        502,
        "לא התקבלה רשימת פרויקטים תקינה מ-TickTick."
      );
    }

    const activeProjects = projects
      .filter((project) => project && project.id && project.closed !== true)
      .map((project) => ({
        id: String(project.id),
        name: String(project.name || "TickTick"),
        color: typeof project.color === "string" ? project.color : "",
        kind: typeof project.kind === "string" ? project.kind : "TASK",
        viewMode:
          typeof project.viewMode === "string"
            ? project.viewMode
            : "list"
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    res.json({ projects: activeProjects });
  })
);

app.get(
  "/api/ticktick/today-tasks",
  asyncRoute(async (req, res) => {
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
      throw new PublicError(
        502,
        "לא התקבלה רשימת פרויקטים תקינה מ-TickTick."
      );
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
  })
);

app.get("/auth/ticktick", (req, res, next) => {
  try {
    requireConfigured();

    const state = crypto.randomBytes(32).toString("base64url");

    const statePayload = encryptJson({
      state,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    appendSetCookie(
      res,
      makeCookie("hero_ticktick_state", statePayload, 10 * 60)
    );

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

    authorizationUrl.searchParams.set("state", state);

    res.redirect(authorizationUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.get(
  "/auth/ticktick/callback",
  asyncRoute(async (req, res) => {
    requireConfigured();

    if (req.query.error) {
      clearCookie(res, "hero_ticktick_state");
      return res.redirect("/?ticktick=denied");
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

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

    const payload = await requestToken({
      grant_type: "authorization_code",
      client_id: process.env.TICKTICK_CLIENT_ID,
      client_secret: process.env.TICKTICK_CLIENT_SECRET,
      code,
      redirect_uri: process.env.TICKTICK_REDIRECT_URI
    });

    writeStoredTokens(res, normalizeTokens(payload));

    return res.redirect("/?ticktick=connected");
  })
);

app.post(
  "/api/ticktick/task",
  asyncRoute(async (req, res) => {
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
        content: `Hero – Yaman
المجال: ${category}
النقاط: ${Number.isFinite(points) ? points : 0}`,
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
        `/project/${encodeURIComponent(
          project.id
        )}/task/${encodeURIComponent(task.id)}/complete`,
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
  })
);

app.post(
  "/api/ticktick/task/complete",
  asyncRoute(async (req, res) => {
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
      `/project/${encodeURIComponent(
        projectId
      )}/task/${encodeURIComponent(taskId)}/complete`,
      { method: "POST" }
    );

    res.status(204).end();
  })
);

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
