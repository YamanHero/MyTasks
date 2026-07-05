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

let databaseReadyPromise = null;
const sseClients = new Set();

app.set("trust proxy", 1);
app.use(express.json({ limit: "500kb" }));

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

function isSecureCookie() {
  return Boolean(
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.NODE_ENV === "production"
  );
}

function appendCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");

  const cookies = current
    ? Array.isArray(current)
      ? current
      : [current]
    : [];

  res.setHeader("Set-Cookie", [...cookies, cookie]);
}

function makeCookie(name, value, maxAgeSeconds) {
  const values = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (isSecureCookie()) {
    values.push("Secure");
  }

  return values.join("; ");
}

function clearCookie(res, name) {
  appendCookie(res, makeCookie(name, "", 0));
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";

  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}

function encryptionKey() {
  if (!process.env.SESSION_SECRET) {
    throw new PublicError(
      503,
      "יש להגדיר SESSION_SECRET ב-Railway."
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

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptJson(value) {
  try {
    const [ivValue, tagValue, ciphertextValue] = String(value || "").split(".");

    if (!ivValue || !tagValue || !ciphertextValue) {
      return null;
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64url")
    );

    decipher.setAuthTag(
      Buffer.from(tagValue, "base64url")
    );

    const plaintext = Buffer.concat([
      decipher.update(
        Buffer.from(ciphertextValue, "base64url")
      ),
      decipher.final()
    ]);

    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    return null;
  }
}

function getTickTickToken(req) {
  return decryptJson(
    readCookie(req, "hero_ticktick_token")
  );
}

function saveTickTickToken(res, accessToken) {
  appendCookie(
    res,
    makeCookie(
      "hero_ticktick_token",
      encryptJson({ accessToken }),
      60 * 60 * 24 * 30
    )
  );
}

function clearTickTickAuth(res) {
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
    throw new PublicError(
      503,
      "DATABASE_URL is missing."
    );
  }

  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      await database.query(`
        CREATE TABLE IF NOT EXISTS hero_app_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          state JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await database.query(`
        INSERT INTO hero_app_state (id, state)
        VALUES (1, '{}'::jsonb)
        ON CONFLICT (id) DO NOTHING;
      `);

      console.log(
        "PostgreSQL is connected and Hero state storage is ready."
      );
    })().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }

  return databaseReadyPromise;
}

function broadcastStateUpdated(updatedAt) {
  const payload =
    `event: state-updated\n` +
    `data: ${JSON.stringify({ updatedAt })}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next))
      .catch(next);
  };
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
  const basic = Buffer
    .from(
      `${process.env.TICKTICK_CLIENT_ID}:${process.env.TICKTICK_CLIENT_SECRET}`
    )
    .toString("base64");

  const response = await fetch(TICKTICK_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
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
      "TickTick לא אישר את החיבור. בדוק את הגדרות OAuth."
    );
  }

  return body.access_token;
}

async function tickTickRequest(req, res, endpoint, options = {}) {
  const accessToken = getTickTickToken(req)?.accessToken;

  if (!accessToken) {
    throw new PublicError(
      401,
      "TickTick אינו מחובר. יש ללחוץ על רبط TickTick."
    );
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(
    `${TICKTICK_API_BASE}${endpoint}`,
    {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    }
  );

  const body = await parseResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      clearTickTickAuth(res);

      throw new PublicError(
        401,
        "חיבור TickTick הסתיים. יש לבצע חיבור מחדש."
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
  const projects = await tickTickRequest(
    req,
    res,
    "/project"
  );

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

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Yaman Hero",
    databaseConfigured: Boolean(database),
    ticktickConfigured: isTickTickConfigured()
  });
});

app.get(
  "/api/database-status",
  asyncRoute(async (req, res) => {
    await initializeDatabase();

    const result = await database.query(
      "SELECT NOW() AS database_time"
    );

    res.json({
      connected: true,
      databaseTime: result.rows[0].database_time
    });
  })
);

app.get(
  "/api/hero-state",
  asyncRoute(async (req, res) => {
    await initializeDatabase();

    const result = await database.query(
      "SELECT state, updated_at FROM hero_app_state WHERE id = 1"
    );

    const row = result.rows[0];

    res.json({
      state: row?.state || {},
      updatedAt: row?.updated_at || null
    });
  })
);

app.put(
  "/api/hero-state",
  asyncRoute(async (req, res) => {
    await initializeDatabase();

    if (
      !req.body ||
      typeof req.body.state !== "object" ||
      Array.isArray(req.body.state)
    ) {
      throw new PublicError(
        400,
        "Invalid Hero state."
      );
    }

    const result = await database.query(
      `
        INSERT INTO hero_app_state (id, state, updated_at)
        VALUES (1, $1::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          state = EXCLUDED.state,
          updated_at = NOW()
        RETURNING state, updated_at;
      `,
      [JSON.stringify(req.body.state)]
    );

    const row = result.rows[0];

    broadcastStateUpdated(row.updated_at);

    res.json({
      state: row.state,
      updatedAt: row.updated_at
    });
  })
);

app.get("/api/events", (req, res) => {
  res.status(200);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  res.flushHeaders();

  res.write(
    `event: connected\n` +
    `data: ${JSON.stringify({ ok: true })}\n\n`
  );

  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

app.get("/api/ticktick/status", (req, res) => {
  res.json({
    configured: isTickTickConfigured(),
    connected: Boolean(
      isTickTickConfigured() &&
      getTickTickToken(req)?.accessToken
    ),
    projectName: HERO_PROJECT_NAME
  });
});

app.get("/auth/ticktick", (req, res, next) => {
  try {
    requireTickTickConfig();

    const state = crypto
      .randomBytes(32)
      .toString("base64url");

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

    const url = new URL(TICKTICK_AUTH_URL);

    url.searchParams.set(
      "client_id",
      process.env.TICKTICK_CLIENT_ID
    );

    url.searchParams.set(
      "redirect_uri",
      TICKTICK_REDIRECT_URI
    );

    url.searchParams.set(
      "response_type",
      "code"
    );

    url.searchParams.set(
      "scope",
      TICKTICK_SCOPE
    );

    url.searchParams.set("state", state);

    res.redirect(url.toString());
  } catch (error) {
    next(error);
  }
});

app.get(
  "/auth/ticktick/callback",
  asyncRoute(async (req, res) => {
    requireTickTickConfig();

    if (req.query.error) {
      clearCookie(res, "hero_ticktick_state");
      return res.redirect("/?ticktick=denied");
    }

    const code =
      typeof req.query.code === "string"
        ? req.query.code
        : "";

    const returnedState =
      typeof req.query.state === "string"
        ? req.query.state
        : "";

    const savedState = decryptJson(
      readCookie(req, "hero_ticktick_state")
    );

    clearCookie(res, "hero_ticktick_state");

    if (
      !code ||
      !savedState ||
      savedState.state !== returnedState ||
      Number(savedState.expiresAt) < Date.now()
    ) {
      return res.redirect("/?ticktick=state_error");
    }

    const accessToken =
      await exchangeAuthorizationCode(code);

    saveTickTickToken(res, accessToken);

    return res.redirect("/?ticktick=connected");
  })
);

app.post(
  "/api/ticktick/task",
  asyncRoute(async (req, res) => {
    requireTickTickConfig();

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
        content:
          `Hero – Yaman\n` +
          `المجال: ${category}\n` +
          `النقاط: ${Number.isFinite(points) ? points : 0}`
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
        `/project/${encodeURIComponent(project.id)}` +
          `/task/${encodeURIComponent(task.id)}/complete`,
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
    requireTickTickConfig();

    const projectId =
      typeof req.body?.projectId === "string"
        ? req.body.projectId.trim()
        : "";

    const taskId =
      typeof req.body?.taskId === "string"
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
      `/project/${encodeURIComponent(projectId)}` +
        `/task/${encodeURIComponent(taskId)}/complete`,
      { method: "POST" }
    );

    res.status(204).end();
  })
);

app.post("/api/ticktick/disconnect", (req, res) => {
  clearTickTickAuth(res);
  res.status(204).end();
});

app.use(
  express.static(path.join(__dirname, "public"))
);

app.use((error, req, res, next) => {
  const status = Number(error?.status) || 500;

  const message =
    error instanceof PublicError
      ? error.message
      : "אירעה שגיאה בשרת. נסה שוב בעוד רגע.";

  if (!(error instanceof PublicError)) {
    console.error(error);
  }

  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(
    `Yaman Hero is running on port ${PORT}`
  );

  initializeDatabase().catch((error) => {
    console.error(
      "PostgreSQL initialization failed:",
      error.message
    );
  });
});
