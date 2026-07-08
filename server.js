const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const OpenAI = require("openai");

const app = express();

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || null;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  console.warn("DATABASE_URL is not configured. App will run without database persistence.");
}

const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

if (!OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not configured. Math tutor chat will not work until configured.");
}

/**
 * PIN codes
 */
const FAMILY_PINS = {
  yaman: process.env.YAMAN_PIN || "1111",
  jud: process.env.JUD_PIN || "2222",
  parent: process.env.PARENT_PIN || "9999"
};

/**
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Hero Family",
    version: "24.0.3",
    databaseConfigured: Boolean(DATABASE_URL),
    openaiConfigured: Boolean(OPENAI_API_KEY),
    time: new Date().toISOString()
  });
});

/**
 * Login by PIN
 */
app.post("/api/family/login", (req, res) => {
  const { pin } = req.body || {};

  if (!pin) {
    return res.status(400).json({
      ok: false,
      error: "Missing PIN"
    });
  }

  if (pin === FAMILY_PINS.yaman) {
    return res.json({
      ok: true,
      profile: "yaman",
      displayName: "يمان"
    });
  }

  if (pin === FAMILY_PINS.jud) {
    return res.json({
      ok: true,
      profile: "jud",
      displayName: "جود"
    });
  }

  if (pin === FAMILY_PINS.parent) {
    return res.json({
      ok: true,
      profile: "parent",
      displayName: "الأهل"
    });
  }

  return res.status(401).json({
    ok: false,
    error: "Invalid PIN"
  });
});

/**
 * Database initialization
 */
async function ensureDatabase() {
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hero_math_progress (
      id SERIAL PRIMARY KEY,
      child_name TEXT NOT NULL DEFAULT 'Yaman',
      current_level INTEGER NOT NULL DEFAULT 1,
      current_topic TEXT NOT NULL DEFAULT 'أساسيات الحساب',
      easy_success INTEGER NOT NULL DEFAULT 0,
      medium_success INTEGER NOT NULL DEFAULT 0,
      hard_success INTEGER NOT NULL DEFAULT 0,
      effort_points INTEGER NOT NULL DEFAULT 0,
      last_summary TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hero_math_messages (
      id SERIAL PRIMARY KEY,
      child_name TEXT NOT NULL DEFAULT 'Yaman',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const existing = await pool.query(`
    SELECT id
    FROM hero_math_progress
    WHERE child_name = 'Yaman'
    LIMIT 1
  `);

  if (existing.rows.length === 0) {
    await pool.query(`
      INSERT INTO hero_math_progress 
      (child_name, current_level, current_topic, effort_points)
      VALUES ('Yaman', 1, 'أساسيات الحساب', 0)
    `);
  }

  console.log("Database initialized successfully.");
}

ensureDatabase().catch((err) => {
  console.error("Database initialization error:", err);
});

/**
 * Yaman Arabic math tutor prompt
 */
const YAMAN_MATH_SYSTEM_PROMPT = `
أنت “معلّم الرياضيات الخاص بيمان”.

تتحدث مع يمان باللغة العربية فقط.

مهمتك أن تعلّم يمان الرياضيات بطريقة هادئة، بسيطة، مشجعة، ومناسبة لمستواه الحقيقي.

لا تفترض أن يمان في مستوى الصف التاسع فعليًا.
ابدأ من مستواه الحالي، ثم ارفعه تدريجيًا حتى يصل إلى مستوى الصف التاسع.

قواعد مهمة:
1. اسأل سؤالًا واحدًا فقط في كل مرة.
2. لا تعطِ أكثر من تمرين واحد في الرسالة الواحدة.
3. لا تستخدم لغة صعبة.
4. إذا أخطأ يمان، لا تقل له “خطأ” بقسوة.
5. قل له: “محاولة جيدة يا يمان، لنرَ أين تعقّد الأمر.”
6. أعطه تلميحًا قبل الحل.
7. إذا لم يفهم، ارجع خطوة إلى الوراء.
8. إذا نجح بسهولة، ارفع المستوى قليلًا.
9. لا تنتقل إلى موضوع جديد إلا بعد التأكد من فهمه.
10. شجّعه على المحاولة وشرح طريقة التفكير.
11. أعطِ نقاطًا إيجابية فقط.
12. لا تخصم نقاطًا أبدًا.
13. اجعل نهاية كل درس فيها شعور نجاح.
14. لا تكتب دروسًا طويلة.
15. يجب أن تكون ردودك قصيرة، إنسانية، مشجعة، وواضحة.

مستويات التعلم:
1. أساسيات الحساب: جمع، طرح، ضرب، قسمة، ترتيب العمليات، أعداد سالبة.
2. الكسور والأعداد العشرية.
3. النسب والتناسب والنسب المئوية.
4. الجبر الأساسي: متغيرات، حدود متشابهة، تبسيط تعابير.
5. المعادلات.
6. المسائل الكلامية.
7. الدوال والخط المستقيم.
8. الهندسة.
9. مراجعة مستوى الصف التاسع.

في بداية الجلسة، ابدأ بسؤال قصير:
“مرحبًا يا يمان 😊 كيف تشعر اليوم من 1 إلى 5؟”

ثم تابع حسب إجابته.

إذا قال إنه متعب، اجعل الدرس قصيرًا وسهلًا.
إذا كان جاهزًا، أعطه تدريبًا مناسبًا.
إذا أجاب بشكل صحيح، امدحه وارفع المستوى قليلًا.
إذا أخطأ، أعطه تلميحًا.
إذا قال لا أعرف، ارجع إلى سؤال أبسط.

نظام النقاط:
+1 على المحاولة.
+2 على الإجابة الصحيحة.
+3 على شرح طريقة الحل.
+5 على الاستمرار بعد صعوبة.

لا تخصم نقاطًا أبدًا.
`;

/**
 * Get Yaman math status
 */
app.get("/api/yaman/math/status", async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        ok: true,
        progress: {
          child_name: "Yaman",
          current_level: 1,
          current_topic: "أساسيات الحساب",
          easy_success: 0,
          medium_success: 0,
          hard_success: 0,
          effort_points: 0,
          last_summary: "قاعدة البيانات غير مفعّلة بعد."
        }
      });
    }

    const result = await pool.query(`
      SELECT *
      FROM hero_math_progress
      WHERE child_name = 'Yaman'
      LIMIT 1
    `);

    return res.json({
      ok: true,
      progress: result.rows[0] || null
    });
  } catch (err) {
    console.error("Math status error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load math status"
    });
  }
});

/**
 * Chat with Yaman math tutor
 */
app.post("/api/yaman/math/chat", async (req, res) => {
  try {
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Missing message"
      });
    }

    if (!openai) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured"
      });
    }

    let progress = {
      current_level: 1,
      current_topic: "أساسيات الحساب",
      easy_success: 0,
      medium_success: 0,
      hard_success: 0,
      effort_points: 0
    };

    let history = [];

    if (pool) {
      const progressResult = await pool.query(`
        SELECT *
        FROM hero_math_progress
        WHERE child_name = 'Yaman'
        LIMIT 1
      `);

      if (progressResult.rows[0]) {
        progress = progressResult.rows[0];
      }

      const historyResult = await pool.query(`
        SELECT role, content
        FROM hero_math_messages
        WHERE child_name = 'Yaman'
        ORDER BY created_at DESC
        LIMIT 10
      `);

      history = historyResult.rows.reverse();

      await pool.query(
        `
        INSERT INTO hero_math_messages (child_name, role, content)
        VALUES ('Yaman', 'user', $1)
        `,
        [message]
      );
    }

    const input = [
      {
        role: "system",
        content: YAMAN_MATH_SYSTEM_PROMPT
      },
      {
        role: "system",
        content: `
معلومات التقدم الحالية عن يمان:
المستوى الحالي: ${progress.current_level || 1}
الموضوع الحالي: ${progress.current_topic || "أساسيات الحساب"}
نجاحات سهلة: ${progress.easy_success || 0}
نجاحات متوسطة: ${progress.medium_success || 0}
نجاحات صعبة: ${progress.hard_success || 0}
نقاط الجهد: ${progress.effort_points || 0}

استخدم هذه المعلومات لتكييف السؤال التالي مع مستوى يمان.
`
      },
      ...history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
      })),
      {
        role: "user",
        content: message
      }
    ];

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input
    });

    const answer =
      response.output_text ||
      "حسنًا يا يمان، لنحاول خطوة بسيطة معًا.";

    if (pool) {
      await pool.query(
        `
        INSERT INTO hero_math_messages (child_name, role, content)
        VALUES ('Yaman', 'assistant', $1)
        `,
        [answer]
      );
    }

    return res.json({
      ok: true,
      answer
    });
  } catch (err) {
    console.error("Yaman math chat error:", err);
    return res.status(500).json({
      ok: false,
      error: "Math teacher failed"
    });
  }
});

/**
 * Update Yaman math progress manually
 */
app.post("/api/yaman/math/progress", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        ok: false,
        error: "Database is not configured"
      });
    }

    const {
      current_level,
      current_topic,
      easy_success,
      medium_success,
      hard_success,
      effort_points,
      last_summary
    } = req.body || {};

    await pool.query(
      `
      UPDATE hero_math_progress
      SET 
        current_level = COALESCE($1, current_level),
        current_topic = COALESCE($2, current_topic),
        easy_success = COALESCE($3, easy_success),
        medium_success = COALESCE($4, medium_success),
        hard_success = COALESCE($5, hard_success),
        effort_points = COALESCE($6, effort_points),
        last_summary = COALESCE($7, last_summary),
        updated_at = NOW()
      WHERE child_name = 'Yaman'
      `,
      [
        current_level ?? null,
        current_topic ?? null,
        easy_success ?? null,
        medium_success ?? null,
        hard_success ?? null,
        effort_points ?? null,
        last_summary ?? null
      ]
    );

    return res.json({
      ok: true
    });
  } catch (err) {
    console.error("Math progress update error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to update progress"
    });
  }
});

/**
 * Parent dashboard summary
 */
app.get("/api/parent/yaman/math/report", async (req, res) => {
  try {
    if (!pool) {
      return res.json({
        ok: true,
        report: {
          current_topic: "أساسيات الحساب",
          current_level: 1,
          effort_points: 0,
          last_summary: "Database is not configured yet."
        }
      });
    }

    const result = await pool.query(`
      SELECT *
      FROM hero_math_progress
      WHERE child_name = 'Yaman'
      LIMIT 1
    `);

    return res.json({
      ok: true,
      report: result.rows[0] || null
    });
  } catch (err) {
    console.error("Parent math report error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load parent report"
    });
  }
});

/**
 * SPA fallback
 */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hero Family server is running on port ${PORT}`);
});
