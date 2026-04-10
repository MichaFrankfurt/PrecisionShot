var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../backend/api.js
var api_exports = {};
__export(api_exports, {
  createApp: () => createApp
});
import express from "file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/express/index.js";
import cors from "file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/cors/lib/index.js";
import jwt from "file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/jsonwebtoken/index.js";
import bcrypt from "file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/bcryptjs/index.js";
import initSqlJs from "file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/sql.js/dist/sql-wasm.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
async function initDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    db = new SQL.Database(readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  const schema = readFileSync(join(__dirname, "db", "schema.sql"), "utf-8");
  db.run(schema);
  try {
    db.run("ALTER TABLE settings ADD COLUMN shots_per_series INTEGER DEFAULT 5");
  } catch (e) {
  }
  return db;
}
function saveDb() {
  if (db) writeFileSync(DB_PATH, Buffer.from(db.export()));
}
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    results.push(row);
  }
  stmt.free();
  return results;
}
function queryOne(sql, params = []) {
  return query(sql, params)[0];
}
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0];
  saveDb();
  return { lastInsertRowid: lastId };
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token fehlt" });
  try {
    req.user = jwt.verify(header.replace("Bearer ", ""), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Ung\xFCltiger Token" });
  }
}
function calculateScore(x, y) {
  const distance = Math.sqrt(x * x + y * y);
  return Math.round(Math.max(1, 10 - distance / 150 * 9) * 10) / 10;
}
async function createApp() {
  await initDb();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "20mb" }));
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  app.post("/api/auth/register", (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Alle Felder erforderlich" });
    }
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = run("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [username, email, hash]);
      const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: "7d" });
      res.json({ token, user: { id: result.lastInsertRowid, username, email } });
    } catch (e) {
      if (e.message?.includes("UNIQUE")) {
        return res.status(409).json({ error: "Username oder Email bereits vergeben" });
      }
      res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
  });
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email und Passwort erforderlich" });
    }
    const user = queryOne("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Ung\xFCltige Anmeldedaten" });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  });
  app.get("/api/settings", authMiddleware, (req, res) => {
    let settings = queryOne("SELECT * FROM settings WHERE user_id = ?", [req.user.id]);
    if (!settings) {
      run("INSERT INTO settings (user_id) VALUES (?)", [req.user.id]);
      settings = queryOne("SELECT * FROM settings WHERE user_id = ?", [req.user.id]);
    }
    if (settings.openai_key) {
      settings.openai_key_masked = settings.openai_key.substring(0, 7) + "..." + settings.openai_key.slice(-4);
      settings.has_api_key = true;
    } else {
      settings.openai_key_masked = "";
      settings.has_api_key = false;
    }
    delete settings.openai_key;
    res.json(settings);
  });
  app.put("/api/settings", authMiddleware, (req, res) => {
    const { distance, shots_per_series, target_type, training_type, openai_key } = req.body;
    const existing = queryOne("SELECT * FROM settings WHERE user_id = ?", [req.user.id]);
    if (!existing) {
      run("INSERT INTO settings (user_id) VALUES (?)", [req.user.id]);
    }
    if (distance != null) {
      run("UPDATE settings SET distance = ? WHERE user_id = ?", [distance, req.user.id]);
    }
    if (shots_per_series != null) {
      run("UPDATE settings SET shots_per_series = ? WHERE user_id = ?", [shots_per_series, req.user.id]);
    }
    if (target_type) {
      run("UPDATE settings SET target_type = ? WHERE user_id = ?", [target_type, req.user.id]);
    }
    if (training_type) {
      run("UPDATE settings SET training_type = ? WHERE user_id = ?", [training_type, req.user.id]);
    }
    if (openai_key !== void 0) {
      run("UPDATE settings SET openai_key = ? WHERE user_id = ?", [openai_key, req.user.id]);
    }
    const updated = queryOne("SELECT * FROM settings WHERE user_id = ?", [req.user.id]);
    if (updated.openai_key) {
      updated.openai_key_masked = updated.openai_key.substring(0, 7) + "..." + updated.openai_key.slice(-4);
      updated.has_api_key = true;
    } else {
      updated.openai_key_masked = "";
      updated.has_api_key = false;
    }
    delete updated.openai_key;
    res.json(updated);
  });
  app.get("/api/sessions", authMiddleware, (req, res) => {
    const sessions = query("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
    res.json(sessions);
  });
  app.get("/api/sessions/:id", authMiddleware, (req, res) => {
    const session = queryOne("SELECT * FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (!session) return res.status(404).json({ error: "Session nicht gefunden" });
    const shots = query("SELECT * FROM shots WHERE session_id = ? ORDER BY shot_number", [session.id]);
    res.json({ ...session, shots });
  });
  app.post("/api/sessions", authMiddleware, (req, res) => {
    try {
      const { shots, total_score, ai_feedback } = req.body;
      const result = run(
        'INSERT INTO sessions (user_id, date, total_score, ai_feedback) VALUES (?, date("now"), ?, ?)',
        [req.user.id, total_score, ai_feedback]
      );
      const sessionId = result.lastInsertRowid;
      for (const shot of shots) {
        run(
          "INSERT INTO shots (session_id, shot_number, x, y, score) VALUES (?, ?, ?, ?, ?)",
          [sessionId, shot.shot_number, shot.x, shot.y, shot.score]
        );
      }
      const session = queryOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
      const savedShots = query("SELECT * FROM shots WHERE session_id = ?", [sessionId]);
      res.json({ ...session, shots: savedShots });
    } catch (e) {
      console.error("Session save error:", e);
      res.status(500).json({ error: "Session konnte nicht gespeichert werden: " + e.message });
    }
  });
  function getUserApiKey(userId) {
    const settings = queryOne("SELECT openai_key FROM settings WHERE user_id = ?", [userId]);
    if (settings?.openai_key) return settings.openai_key;
    if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes("your")) return process.env.OPENAI_API_KEY;
    return null;
  }
  function getUserContext(userId) {
    const s = queryOne("SELECT distance, target_type, training_type FROM settings WHERE user_id = ?", [userId]);
    return s || { distance: 10, target_type: "paper", training_type: "laser" };
  }
  function getRecentError(userId) {
    const recent = query("SELECT ai_feedback FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [userId]);
    if (!recent.length) return { recent_common_error: "none", baseline_summary: "New shooter, no history yet" };
    try {
      const errors = recent.map((r) => {
        try {
          return JSON.parse(r.ai_feedback)?.diagnosis?.main_error;
        } catch {
          return null;
        }
      }).filter(Boolean);
      const counts = {};
      errors.forEach((e) => counts[e] = (counts[e] || 0) + 1);
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return {
        recent_common_error: sorted[0]?.[0] || "none",
        baseline_summary: sorted.length ? `Recurring: ${sorted.map(([e, c]) => `${e}(${c}x)`).join(", ")}` : "No clear pattern yet"
      };
    } catch {
      return { recent_common_error: "none", baseline_summary: "No history parsed" };
    }
  }
  const SYSTEM_PROMPT = `You are PrecisionShot Coach, a professional shooting coach for pistol precision training.

Your job is to analyze shot patterns from a single shooting series and return short, actionable coaching feedback.

Rules:
1. Be concise.
2. Be practical.
3. Focus on the most important correction only.
4. Use coach language, not generic AI language.
5. Do not explain too much during training mode.
6. Prefer trigger control, consistency, rhythm, grip pressure, and fatigue interpretation over abstract theory.
7. If the pattern is unclear, say so briefly and give the safest next instruction.
8. Never give more than one main task for the next series.
9. Output must always follow the required JSON schema.
10. Feedback language must match the "language" field in the input.

Interpretation priorities:
- Detect group center shift
- Detect spread pattern
- Detect likely trigger errors
- Detect likely timing / rhythm errors
- Detect likely fatigue pattern if relevant
- Suggest exactly one next task

Training context:
- The shooter trains with a pistol
- Typical series length is 5 shots
- Coaching style must feel like a real range coach speaking briefly between series
- Coordinate system: center = (0,0), range -150 to +150, positive x = right, positive y = down

Good examples of coaching tone:
- "Low left. Trigger is being accelerated at the break. Next series: press straight through."
- "Vertical spread. Rhythm is inconsistent. Next series: same trigger tempo every shot."
- "Pattern unclear. Do not chase the center. Next series: repeat the same process."

You MUST return valid JSON matching this exact schema:
{
  "pattern": { "group_shift": "string", "spread_type": "string", "confidence": 0.0 },
  "diagnosis": { "main_error": "string", "main_cause": "string", "secondary_note": "string" },
  "coaching": { "summary": "string", "next_task": "string", "audio_cues": ["string"] },
  "progress_logging": { "store_feedback": true, "tags": ["string"] }
}`;
  const LANG_INSTRUCTIONS = {
    de: "Schreibe coaching.summary, coaching.next_task und coaching.audio_cues auf Deutsch.",
    en: "Write coaching.summary, coaching.next_task and coaching.audio_cues in English.",
    ru: "\u041D\u0430\u043F\u0438\u0448\u0438 coaching.summary, coaching.next_task \u0438 coaching.audio_cues \u043D\u0430 \u0440\u0443\u0441\u0441\u043A\u043E\u043C \u044F\u0437\u044B\u043A\u0435."
  };
  function buildFallback(scoredShots, totalScore, lang) {
    const avgX = scoredShots.reduce((s, shot) => s + shot.x, 0) / 5;
    const avgY = scoredShots.reduce((s, shot) => s + shot.y, 0) / 5;
    const spread = Math.sqrt(scoredShots.reduce((s, shot) => s + (shot.x - avgX) ** 2 + (shot.y - avgY) ** 2, 0) / 5);
    let shift = "centered";
    const dirs = [];
    if (avgY < -20) dirs.push("high");
    if (avgY > 20) dirs.push("low");
    if (avgX < -20) dirs.push("left");
    if (avgX > 20) dirs.push("right");
    if (dirs.length) shift = dirs.join("_");
    let spreadType = spread < 20 ? "tight_group" : spread < 40 ? "moderate_spread" : "scattered";
    const summaries = {
      de: { good: "Gute Gruppe, Zentrum halten.", fix: `Trefferbild ${shift}. Abzug gleichm\xE4ssig durchziehen.`, task: "N\xE4chste Serie: gleiches Tempo bei jedem Schuss.", cues: ["ruhig bleiben", "gleichm\xE4ssiger Abzug"] },
      en: { good: "Good group, hold center.", fix: `Group shifts ${shift}. Smooth trigger pull.`, task: "Next series: same tempo every shot.", cues: ["smooth trigger", "same process"] },
      ru: { good: "\u0425\u043E\u0440\u043E\u0448\u0430\u044F \u0433\u0440\u0443\u043F\u043F\u0430, \u0434\u0435\u0440\u0436\u0438 \u0446\u0435\u043D\u0442\u0440.", fix: `\u0413\u0440\u0443\u043F\u043F\u0430 \u0441\u043C\u0435\u0449\u0435\u043D\u0430 ${shift}. \u041F\u043B\u0430\u0432\u043D\u044B\u0439 \u0441\u043F\u0443\u0441\u043A.`, task: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0441\u0435\u0440\u0438\u044F: \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u044B\u0439 \u0442\u0435\u043C\u043F \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u0432\u044B\u0441\u0442\u0440\u0435\u043B\u0430.", cues: ["\u043F\u043B\u0430\u0432\u043D\u044B\u0439 \u0441\u043F\u0443\u0441\u043A", "\u0442\u043E\u0442 \u0436\u0435 \u043F\u0440\u043E\u0446\u0435\u0441\u0441"] }
    };
    const fb = summaries[lang] || summaries.en;
    const isGood = totalScore >= 45 && spread < 15;
    return {
      pattern: { group_shift: shift, spread_type: spreadType, confidence: 0.3 },
      diagnosis: { main_error: isGood ? "none" : shift, main_cause: isGood ? "none" : "requires API analysis", secondary_note: "none" },
      coaching: { summary: isGood ? fb.good : fb.fix, next_task: fb.task, audio_cues: fb.cues },
      progress_logging: { store_feedback: true, tags: ["fallback", shift] }
    };
  }
  app.post("/api/analyze", authMiddleware, async (req, res) => {
    const { shots, lang = "de" } = req.body;
    const userSettings = queryOne("SELECT shots_per_series FROM settings WHERE user_id = ?", [req.user.id]);
    const expectedShots = userSettings?.shots_per_series || 5;
    if (!shots || shots.length < 1 || shots.length > 10) {
      return res.status(400).json({ error: `1-10 shots required, got ${shots?.length || 0}` });
    }
    const scoredShots = shots.map((s, i) => ({
      ...s,
      shot_number: i + 1,
      score: calculateScore(s.x, s.y)
    }));
    const totalScore = scoredShots.reduce((sum, s) => sum + s.score, 0);
    const apiKey = getUserApiKey(req.user.id);
    const ctx = getUserContext(req.user.id);
    const history = getRecentError(req.user.id);
    let coaching;
    try {
      if (!apiKey) throw new Error("No API key");
      const { default: OpenAI } = await import("file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/openai/index.mjs");
      const openai = new OpenAI({ apiKey });
      const shotsJson = scoredShots.map((s) => ({
        shot_index: s.shot_number,
        x: Math.round(s.x),
        y: Math.round(s.y),
        ring_value: s.score
      }));
      const userMessage = `Analyze this pistol shooting series and return valid JSON only.
${LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.en}

Context:
- Distance: ${ctx.distance}m
- Target: ${ctx.target_type === "monitor" ? "electronic (Meyton)" : "paper"}
- Training: ${ctx.training_type === "live" ? "live fire" : "laser"}
- Shots per series: 5
- Recent common error: ${history.recent_common_error}
- Baseline summary: ${history.baseline_summary}
- Fatigue flag: false

Shots:
${JSON.stringify(shotsJson, null, 2)}`;
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        max_tokens: 600,
        temperature: 0.4
      });
      const content = response.choices[0].message.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      coaching = JSON.parse(jsonMatch[0]);
      if (!coaching.coaching?.summary || !coaching.coaching?.next_task) {
        throw new Error("Invalid schema");
      }
    } catch (e) {
      console.error("AI analyze error:", e.message);
      coaching = buildFallback(scoredShots, totalScore, lang);
    }
    const feedbackText = `${coaching.coaching.summary} ${coaching.coaching.next_task}`;
    res.json({
      shots: scoredShots,
      total_score: totalScore,
      ai_feedback: JSON.stringify(coaching),
      ai_feedback_text: feedbackText,
      coaching
    });
  });
  app.post("/api/vision/detect", authMiddleware, async (req, res) => {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Image required" });
    }
    try {
      const visionKey = getUserApiKey(req.user.id);
      if (!visionKey) {
        throw new Error("No API key");
      }
      const { default: OpenAI } = await import("file:///Users/michaelrubin/Desktop/PrecisionShot/backend/node_modules/openai/index.mjs");
      const openai = new OpenAI({ apiKey: visionKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a shooting target analysis system. Analyze the image of a shooting target and detect bullet holes / impact points.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{"shots": [{"x": 0, "y": 0}, {"x": 10, "y": -5}]}

Coordinate system:
- Center of target = (0, 0)
- Range: -150 to +150 for both x and y
- Positive x = right, positive y = down
- Scale based on the target rings visible in the image

If you cannot detect any shots, return: {"shots": []}
If the image is not a shooting target, return: {"shots": [], "error": "Not a shooting target"}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Detect all bullet holes / impact points on this shooting target. Return their coordinates as JSON." },
              { type: "image_url", image_url: { url: image, detail: "high" } }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.1
      });
      const content = response.choices[0].message.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ shots: [], error: "Could not parse response" });
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const shots = (parsed.shots || []).slice(0, 5).map((s) => ({
        x: Math.max(-150, Math.min(150, Math.round(s.x))),
        y: Math.max(-150, Math.min(150, Math.round(s.y)))
      }));
      res.json({ shots });
    } catch (e) {
      console.error("Vision error:", e.message);
      let errorMsg = e.message;
      if (e.message.includes("No API key")) {
        errorMsg = "Kein API Key. Bitte in Einstellungen (\u2699\uFE0F) eintragen.";
      } else if (e.message.includes("401") || e.message.includes("Incorrect API key") || e.message.includes("invalid_api_key")) {
        errorMsg = "API Key ung\xFCltig. Bitte in Einstellungen (\u2699\uFE0F) pr\xFCfen.";
      } else if (e.message.includes("429") || e.message.includes("rate_limit")) {
        errorMsg = "API Rate Limit erreicht. Bitte kurz warten.";
      } else if (e.message.includes("insufficient_quota") || e.message.includes("billing")) {
        errorMsg = "Kein OpenAI Guthaben. Bitte auf platform.openai.com aufladen.";
      }
      res.status(500).json({ error: errorMsg, shots: [] });
    }
  });
  return app;
}
var __vite_injected_original_import_meta_url, __dirname, DB_PATH, JWT_SECRET, db;
var init_api = __esm({
  "../backend/api.js"() {
    __vite_injected_original_import_meta_url = "file:///Users/michaelrubin/Desktop/PrecisionShot/backend/api.js";
    __dirname = dirname(fileURLToPath(__vite_injected_original_import_meta_url));
    DB_PATH = join(__dirname, "db", "precisionshot.db");
    JWT_SECRET = process.env.JWT_SECRET || "precisionshot-dev-secret-2024";
  }
});

// vite.config.js
import { defineConfig } from "file:///Users/michaelrubin/Desktop/PrecisionShot/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///Users/michaelrubin/Desktop/PrecisionShot/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
function apiPlugin() {
  return {
    name: "api-middleware",
    async configureServer(server) {
      const { createApp: createApp2 } = await Promise.resolve().then(() => (init_api(), api_exports));
      const apiApp = await createApp2();
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith("/api")) {
          apiApp(req, res, (err) => {
            if (err) console.error("Express error:", err);
            next();
          });
        } else {
          next();
        }
      });
      console.log("API middleware loaded");
    }
  };
}
var vite_config_default = defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    port: 5174
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vYmFja2VuZC9hcGkuanMiLCAidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9iYWNrZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9iYWNrZW5kL2FwaS5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9iYWNrZW5kL2FwaS5qc1wiO2ltcG9ydCBleHByZXNzIGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0IGNvcnMgZnJvbSAnY29ycyc7XG5pbXBvcnQgand0IGZyb20gJ2pzb253ZWJ0b2tlbic7XG5pbXBvcnQgYmNyeXB0IGZyb20gJ2JjcnlwdGpzJztcbmltcG9ydCBpbml0U3FsSnMgZnJvbSAnc3FsLmpzJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgd3JpdGVGaWxlU3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGpvaW4sIGRpcm5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKSk7XG5jb25zdCBEQl9QQVRIID0gam9pbihfX2Rpcm5hbWUsICdkYicsICdwcmVjaXNpb25zaG90LmRiJyk7XG5jb25zdCBKV1RfU0VDUkVUID0gcHJvY2Vzcy5lbnYuSldUX1NFQ1JFVCB8fCAncHJlY2lzaW9uc2hvdC1kZXYtc2VjcmV0LTIwMjQnO1xuXG5sZXQgZGI7XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXREYigpIHtcbiAgaWYgKGRiKSByZXR1cm4gZGI7XG4gIGNvbnN0IFNRTCA9IGF3YWl0IGluaXRTcWxKcygpO1xuICBpZiAoZXhpc3RzU3luYyhEQl9QQVRIKSkge1xuICAgIGRiID0gbmV3IFNRTC5EYXRhYmFzZShyZWFkRmlsZVN5bmMoREJfUEFUSCkpO1xuICB9IGVsc2Uge1xuICAgIGRiID0gbmV3IFNRTC5EYXRhYmFzZSgpO1xuICB9XG4gIGNvbnN0IHNjaGVtYSA9IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJ2RiJywgJ3NjaGVtYS5zcWwnKSwgJ3V0Zi04Jyk7XG4gIGRiLnJ1bihzY2hlbWEpO1xuXG4gIC8vIE1pZ3JhdGlvbnM6IGFkZCBjb2x1bW5zIGlmIG1pc3NpbmcgKHNhZmUgLSBzcWwuanMgdGhyb3dzIGlmIGNvbHVtbiBleGlzdHMpXG4gIHRyeSB7IGRiLnJ1bignQUxURVIgVEFCTEUgc2V0dGluZ3MgQUREIENPTFVNTiBzaG90c19wZXJfc2VyaWVzIElOVEVHRVIgREVGQVVMVCA1Jyk7IH0gY2F0Y2ggKGUpIHsgLyogY29sdW1uIGFscmVhZHkgZXhpc3RzICovIH1cblxuICByZXR1cm4gZGI7XG59XG5cbmZ1bmN0aW9uIHNhdmVEYigpIHtcbiAgaWYgKGRiKSB3cml0ZUZpbGVTeW5jKERCX1BBVEgsIEJ1ZmZlci5mcm9tKGRiLmV4cG9ydCgpKSk7XG59XG5cbmZ1bmN0aW9uIHF1ZXJ5KHNxbCwgcGFyYW1zID0gW10pIHtcbiAgY29uc3Qgc3RtdCA9IGRiLnByZXBhcmUoc3FsKTtcbiAgc3RtdC5iaW5kKHBhcmFtcyk7XG4gIGNvbnN0IHJlc3VsdHMgPSBbXTtcbiAgd2hpbGUgKHN0bXQuc3RlcCgpKSB7XG4gICAgY29uc3QgY29scyA9IHN0bXQuZ2V0Q29sdW1uTmFtZXMoKTtcbiAgICBjb25zdCB2YWxzID0gc3RtdC5nZXQoKTtcbiAgICBjb25zdCByb3cgPSB7fTtcbiAgICBjb2xzLmZvckVhY2goKGMsIGkpID0+IHJvd1tjXSA9IHZhbHNbaV0pO1xuICAgIHJlc3VsdHMucHVzaChyb3cpO1xuICB9XG4gIHN0bXQuZnJlZSgpO1xuICByZXR1cm4gcmVzdWx0cztcbn1cblxuZnVuY3Rpb24gcXVlcnlPbmUoc3FsLCBwYXJhbXMgPSBbXSkge1xuICByZXR1cm4gcXVlcnkoc3FsLCBwYXJhbXMpWzBdO1xufVxuXG5mdW5jdGlvbiBydW4oc3FsLCBwYXJhbXMgPSBbXSkge1xuICBjb25zdCBzdG10ID0gZGIucHJlcGFyZShzcWwpO1xuICBzdG10LmJpbmQocGFyYW1zKTtcbiAgc3RtdC5zdGVwKCk7XG4gIHN0bXQuZnJlZSgpO1xuICBjb25zdCBsYXN0SWQgPSBkYi5leGVjKCdTRUxFQ1QgbGFzdF9pbnNlcnRfcm93aWQoKSBhcyBpZCcpWzBdPy52YWx1ZXNbMF1bMF07XG4gIHNhdmVEYigpO1xuICByZXR1cm4geyBsYXN0SW5zZXJ0Um93aWQ6IGxhc3RJZCB9O1xufVxuXG5mdW5jdGlvbiBhdXRoTWlkZGxld2FyZShyZXEsIHJlcywgbmV4dCkge1xuICBjb25zdCBoZWFkZXIgPSByZXEuaGVhZGVycy5hdXRob3JpemF0aW9uO1xuICBpZiAoIWhlYWRlcikgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICdUb2tlbiBmZWhsdCcgfSk7XG4gIHRyeSB7XG4gICAgcmVxLnVzZXIgPSBqd3QudmVyaWZ5KGhlYWRlci5yZXBsYWNlKCdCZWFyZXIgJywgJycpLCBKV1RfU0VDUkVUKTtcbiAgICBuZXh0KCk7XG4gIH0gY2F0Y2gge1xuICAgIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICdVbmdcdTAwRkNsdGlnZXIgVG9rZW4nIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNhbGN1bGF0ZVNjb3JlKHgsIHkpIHtcbiAgY29uc3QgZGlzdGFuY2UgPSBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWF4KDEsIDEwIC0gKGRpc3RhbmNlIC8gMTUwKSAqIDkpICogMTApIC8gMTA7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVBcHAoKSB7XG4gIGF3YWl0IGluaXREYigpO1xuXG4gIGNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcbiAgYXBwLnVzZShjb3JzKCkpO1xuICBhcHAudXNlKGV4cHJlc3MuanNvbih7IGxpbWl0OiAnMjBtYicgfSkpO1xuXG4gIC8vIEhlYWx0aFxuICBhcHAuZ2V0KCcvYXBpL2hlYWx0aCcsIChyZXEsIHJlcykgPT4gcmVzLmpzb24oeyBzdGF0dXM6ICdvaycgfSkpO1xuXG4gIC8vIEF1dGhcbiAgYXBwLnBvc3QoJy9hcGkvYXV0aC9yZWdpc3RlcicsIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IHsgdXNlcm5hbWUsIGVtYWlsLCBwYXNzd29yZCB9ID0gcmVxLmJvZHk7XG4gICAgaWYgKCF1c2VybmFtZSB8fCAhZW1haWwgfHwgIXBhc3N3b3JkKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ0FsbGUgRmVsZGVyIGVyZm9yZGVybGljaCcgfSk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBoYXNoID0gYmNyeXB0Lmhhc2hTeW5jKHBhc3N3b3JkLCAxMCk7XG4gICAgICBjb25zdCByZXN1bHQgPSBydW4oJ0lOU0VSVCBJTlRPIHVzZXJzICh1c2VybmFtZSwgZW1haWwsIHBhc3N3b3JkX2hhc2gpIFZBTFVFUyAoPywgPywgPyknLCBbdXNlcm5hbWUsIGVtYWlsLCBoYXNoXSk7XG4gICAgICBjb25zdCB0b2tlbiA9IGp3dC5zaWduKHsgaWQ6IHJlc3VsdC5sYXN0SW5zZXJ0Um93aWQsIHVzZXJuYW1lIH0sIEpXVF9TRUNSRVQsIHsgZXhwaXJlc0luOiAnN2QnIH0pO1xuICAgICAgcmVzLmpzb24oeyB0b2tlbiwgdXNlcjogeyBpZDogcmVzdWx0Lmxhc3RJbnNlcnRSb3dpZCwgdXNlcm5hbWUsIGVtYWlsIH0gfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKGUubWVzc2FnZT8uaW5jbHVkZXMoJ1VOSVFVRScpKSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwOSkuanNvbih7IGVycm9yOiAnVXNlcm5hbWUgb2RlciBFbWFpbCBiZXJlaXRzIHZlcmdlYmVuJyB9KTtcbiAgICAgIH1cbiAgICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICdSZWdpc3RyaWVydW5nIGZlaGxnZXNjaGxhZ2VuJyB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIGFwcC5wb3N0KCcvYXBpL2F1dGgvbG9naW4nLCAocmVxLCByZXMpID0+IHtcbiAgICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCB9ID0gcmVxLmJvZHk7XG4gICAgaWYgKCFlbWFpbCB8fCAhcGFzc3dvcmQpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAnRW1haWwgdW5kIFBhc3N3b3J0IGVyZm9yZGVybGljaCcgfSk7XG4gICAgfVxuICAgIGNvbnN0IHVzZXIgPSBxdWVyeU9uZSgnU0VMRUNUICogRlJPTSB1c2VycyBXSEVSRSBlbWFpbCA9ID8nLCBbZW1haWxdKTtcbiAgICBpZiAoIXVzZXIgfHwgIWJjcnlwdC5jb21wYXJlU3luYyhwYXNzd29yZCwgdXNlci5wYXNzd29yZF9oYXNoKSkge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICdVbmdcdTAwRkNsdGlnZSBBbm1lbGRlZGF0ZW4nIH0pO1xuICAgIH1cbiAgICBjb25zdCB0b2tlbiA9IGp3dC5zaWduKHsgaWQ6IHVzZXIuaWQsIHVzZXJuYW1lOiB1c2VyLnVzZXJuYW1lIH0sIEpXVF9TRUNSRVQsIHsgZXhwaXJlc0luOiAnN2QnIH0pO1xuICAgIHJlcy5qc29uKHsgdG9rZW4sIHVzZXI6IHsgaWQ6IHVzZXIuaWQsIHVzZXJuYW1lOiB1c2VyLnVzZXJuYW1lLCBlbWFpbDogdXNlci5lbWFpbCB9IH0pO1xuICB9KTtcblxuICAvLyBTZXR0aW5nc1xuICBhcHAuZ2V0KCcvYXBpL3NldHRpbmdzJywgYXV0aE1pZGRsZXdhcmUsIChyZXEsIHJlcykgPT4ge1xuICAgIGxldCBzZXR0aW5ncyA9IHF1ZXJ5T25lKCdTRUxFQ1QgKiBGUk9NIHNldHRpbmdzIFdIRVJFIHVzZXJfaWQgPSA/JywgW3JlcS51c2VyLmlkXSk7XG4gICAgaWYgKCFzZXR0aW5ncykge1xuICAgICAgcnVuKCdJTlNFUlQgSU5UTyBzZXR0aW5ncyAodXNlcl9pZCkgVkFMVUVTICg/KScsIFtyZXEudXNlci5pZF0pO1xuICAgICAgc2V0dGluZ3MgPSBxdWVyeU9uZSgnU0VMRUNUICogRlJPTSBzZXR0aW5ncyBXSEVSRSB1c2VyX2lkID0gPycsIFtyZXEudXNlci5pZF0pO1xuICAgIH1cbiAgICAvLyBNYXNrIEFQSSBrZXkgZm9yIHNlY3VyaXR5XG4gICAgaWYgKHNldHRpbmdzLm9wZW5haV9rZXkpIHtcbiAgICAgIHNldHRpbmdzLm9wZW5haV9rZXlfbWFza2VkID0gc2V0dGluZ3Mub3BlbmFpX2tleS5zdWJzdHJpbmcoMCwgNykgKyAnLi4uJyArIHNldHRpbmdzLm9wZW5haV9rZXkuc2xpY2UoLTQpO1xuICAgICAgc2V0dGluZ3MuaGFzX2FwaV9rZXkgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZXR0aW5ncy5vcGVuYWlfa2V5X21hc2tlZCA9ICcnO1xuICAgICAgc2V0dGluZ3MuaGFzX2FwaV9rZXkgPSBmYWxzZTtcbiAgICB9XG4gICAgZGVsZXRlIHNldHRpbmdzLm9wZW5haV9rZXk7XG4gICAgcmVzLmpzb24oc2V0dGluZ3MpO1xuICB9KTtcblxuICBhcHAucHV0KCcvYXBpL3NldHRpbmdzJywgYXV0aE1pZGRsZXdhcmUsIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IHsgZGlzdGFuY2UsIHNob3RzX3Blcl9zZXJpZXMsIHRhcmdldF90eXBlLCB0cmFpbmluZ190eXBlLCBvcGVuYWlfa2V5IH0gPSByZXEuYm9keTtcblxuICAgIC8vIEVuc3VyZSBzZXR0aW5ncyByb3cgZXhpc3RzXG4gICAgY29uc3QgZXhpc3RpbmcgPSBxdWVyeU9uZSgnU0VMRUNUICogRlJPTSBzZXR0aW5ncyBXSEVSRSB1c2VyX2lkID0gPycsIFtyZXEudXNlci5pZF0pO1xuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHJ1bignSU5TRVJUIElOVE8gc2V0dGluZ3MgKHVzZXJfaWQpIFZBTFVFUyAoPyknLCBbcmVxLnVzZXIuaWRdKTtcbiAgICB9XG5cbiAgICBpZiAoZGlzdGFuY2UgIT0gbnVsbCkge1xuICAgICAgcnVuKCdVUERBVEUgc2V0dGluZ3MgU0VUIGRpc3RhbmNlID0gPyBXSEVSRSB1c2VyX2lkID0gPycsIFtkaXN0YW5jZSwgcmVxLnVzZXIuaWRdKTtcbiAgICB9XG4gICAgaWYgKHNob3RzX3Blcl9zZXJpZXMgIT0gbnVsbCkge1xuICAgICAgcnVuKCdVUERBVEUgc2V0dGluZ3MgU0VUIHNob3RzX3Blcl9zZXJpZXMgPSA/IFdIRVJFIHVzZXJfaWQgPSA/JywgW3Nob3RzX3Blcl9zZXJpZXMsIHJlcS51c2VyLmlkXSk7XG4gICAgfVxuICAgIGlmICh0YXJnZXRfdHlwZSkge1xuICAgICAgcnVuKCdVUERBVEUgc2V0dGluZ3MgU0VUIHRhcmdldF90eXBlID0gPyBXSEVSRSB1c2VyX2lkID0gPycsIFt0YXJnZXRfdHlwZSwgcmVxLnVzZXIuaWRdKTtcbiAgICB9XG4gICAgaWYgKHRyYWluaW5nX3R5cGUpIHtcbiAgICAgIHJ1bignVVBEQVRFIHNldHRpbmdzIFNFVCB0cmFpbmluZ190eXBlID0gPyBXSEVSRSB1c2VyX2lkID0gPycsIFt0cmFpbmluZ190eXBlLCByZXEudXNlci5pZF0pO1xuICAgIH1cbiAgICBpZiAob3BlbmFpX2tleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBydW4oJ1VQREFURSBzZXR0aW5ncyBTRVQgb3BlbmFpX2tleSA9ID8gV0hFUkUgdXNlcl9pZCA9ID8nLCBbb3BlbmFpX2tleSwgcmVxLnVzZXIuaWRdKTtcbiAgICB9XG5cbiAgICBjb25zdCB1cGRhdGVkID0gcXVlcnlPbmUoJ1NFTEVDVCAqIEZST00gc2V0dGluZ3MgV0hFUkUgdXNlcl9pZCA9ID8nLCBbcmVxLnVzZXIuaWRdKTtcbiAgICBpZiAodXBkYXRlZC5vcGVuYWlfa2V5KSB7XG4gICAgICB1cGRhdGVkLm9wZW5haV9rZXlfbWFza2VkID0gdXBkYXRlZC5vcGVuYWlfa2V5LnN1YnN0cmluZygwLCA3KSArICcuLi4nICsgdXBkYXRlZC5vcGVuYWlfa2V5LnNsaWNlKC00KTtcbiAgICAgIHVwZGF0ZWQuaGFzX2FwaV9rZXkgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICB1cGRhdGVkLm9wZW5haV9rZXlfbWFza2VkID0gJyc7XG4gICAgICB1cGRhdGVkLmhhc19hcGlfa2V5ID0gZmFsc2U7XG4gICAgfVxuICAgIGRlbGV0ZSB1cGRhdGVkLm9wZW5haV9rZXk7XG4gICAgcmVzLmpzb24odXBkYXRlZCk7XG4gIH0pO1xuXG4gIC8vIFNlc3Npb25zIChwcm90ZWN0ZWQpXG4gIGFwcC5nZXQoJy9hcGkvc2Vzc2lvbnMnLCBhdXRoTWlkZGxld2FyZSwgKHJlcSwgcmVzKSA9PiB7XG4gICAgY29uc3Qgc2Vzc2lvbnMgPSBxdWVyeSgnU0VMRUNUICogRlJPTSBzZXNzaW9ucyBXSEVSRSB1c2VyX2lkID0gPyBPUkRFUiBCWSBjcmVhdGVkX2F0IERFU0MnLCBbcmVxLnVzZXIuaWRdKTtcbiAgICByZXMuanNvbihzZXNzaW9ucyk7XG4gIH0pO1xuXG4gIGFwcC5nZXQoJy9hcGkvc2Vzc2lvbnMvOmlkJywgYXV0aE1pZGRsZXdhcmUsIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IHNlc3Npb24gPSBxdWVyeU9uZSgnU0VMRUNUICogRlJPTSBzZXNzaW9ucyBXSEVSRSBpZCA9ID8gQU5EIHVzZXJfaWQgPSA/JywgW3JlcS5wYXJhbXMuaWQsIHJlcS51c2VyLmlkXSk7XG4gICAgaWYgKCFzZXNzaW9uKSByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ1Nlc3Npb24gbmljaHQgZ2VmdW5kZW4nIH0pO1xuICAgIGNvbnN0IHNob3RzID0gcXVlcnkoJ1NFTEVDVCAqIEZST00gc2hvdHMgV0hFUkUgc2Vzc2lvbl9pZCA9ID8gT1JERVIgQlkgc2hvdF9udW1iZXInLCBbc2Vzc2lvbi5pZF0pO1xuICAgIHJlcy5qc29uKHsgLi4uc2Vzc2lvbiwgc2hvdHMgfSk7XG4gIH0pO1xuXG4gIGFwcC5wb3N0KCcvYXBpL3Nlc3Npb25zJywgYXV0aE1pZGRsZXdhcmUsIChyZXEsIHJlcykgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IHNob3RzLCB0b3RhbF9zY29yZSwgYWlfZmVlZGJhY2sgfSA9IHJlcS5ib2R5O1xuICAgICAgY29uc3QgcmVzdWx0ID0gcnVuKCdJTlNFUlQgSU5UTyBzZXNzaW9ucyAodXNlcl9pZCwgZGF0ZSwgdG90YWxfc2NvcmUsIGFpX2ZlZWRiYWNrKSBWQUxVRVMgKD8sIGRhdGUoXCJub3dcIiksID8sID8pJyxcbiAgICAgICAgW3JlcS51c2VyLmlkLCB0b3RhbF9zY29yZSwgYWlfZmVlZGJhY2tdKTtcbiAgICAgIGNvbnN0IHNlc3Npb25JZCA9IHJlc3VsdC5sYXN0SW5zZXJ0Um93aWQ7XG4gICAgICBmb3IgKGNvbnN0IHNob3Qgb2Ygc2hvdHMpIHtcbiAgICAgICAgcnVuKCdJTlNFUlQgSU5UTyBzaG90cyAoc2Vzc2lvbl9pZCwgc2hvdF9udW1iZXIsIHgsIHksIHNjb3JlKSBWQUxVRVMgKD8sID8sID8sID8sID8pJyxcbiAgICAgICAgICBbc2Vzc2lvbklkLCBzaG90LnNob3RfbnVtYmVyLCBzaG90LngsIHNob3QueSwgc2hvdC5zY29yZV0pO1xuICAgICAgfVxuICAgICAgY29uc3Qgc2Vzc2lvbiA9IHF1ZXJ5T25lKCdTRUxFQ1QgKiBGUk9NIHNlc3Npb25zIFdIRVJFIGlkID0gPycsIFtzZXNzaW9uSWRdKTtcbiAgICAgIGNvbnN0IHNhdmVkU2hvdHMgPSBxdWVyeSgnU0VMRUNUICogRlJPTSBzaG90cyBXSEVSRSBzZXNzaW9uX2lkID0gPycsIFtzZXNzaW9uSWRdKTtcbiAgICAgIHJlcy5qc29uKHsgLi4uc2Vzc2lvbiwgc2hvdHM6IHNhdmVkU2hvdHMgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignU2Vzc2lvbiBzYXZlIGVycm9yOicsIGUpO1xuICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ1Nlc3Npb24ga29ubnRlIG5pY2h0IGdlc3BlaWNoZXJ0IHdlcmRlbjogJyArIGUubWVzc2FnZSB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIEhlbHBlcjogZ2V0IHVzZXIncyBBUEkga2V5ICh1c2VyLXNwZWNpZmljIG9yIGZhbGxiYWNrIHRvIGVudilcbiAgZnVuY3Rpb24gZ2V0VXNlckFwaUtleSh1c2VySWQpIHtcbiAgICBjb25zdCBzZXR0aW5ncyA9IHF1ZXJ5T25lKCdTRUxFQ1Qgb3BlbmFpX2tleSBGUk9NIHNldHRpbmdzIFdIRVJFIHVzZXJfaWQgPSA/JywgW3VzZXJJZF0pO1xuICAgIGlmIChzZXR0aW5ncz8ub3BlbmFpX2tleSkgcmV0dXJuIHNldHRpbmdzLm9wZW5haV9rZXk7XG4gICAgaWYgKHByb2Nlc3MuZW52Lk9QRU5BSV9BUElfS0VZICYmICFwcm9jZXNzLmVudi5PUEVOQUlfQVBJX0tFWS5pbmNsdWRlcygneW91cicpKSByZXR1cm4gcHJvY2Vzcy5lbnYuT1BFTkFJX0FQSV9LRVk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBIZWxwZXI6IGdldCB1c2VyIHNldHRpbmdzIGZvciBBSSBjb250ZXh0XG4gIGZ1bmN0aW9uIGdldFVzZXJDb250ZXh0KHVzZXJJZCkge1xuICAgIGNvbnN0IHMgPSBxdWVyeU9uZSgnU0VMRUNUIGRpc3RhbmNlLCB0YXJnZXRfdHlwZSwgdHJhaW5pbmdfdHlwZSBGUk9NIHNldHRpbmdzIFdIRVJFIHVzZXJfaWQgPSA/JywgW3VzZXJJZF0pO1xuICAgIHJldHVybiBzIHx8IHsgZGlzdGFuY2U6IDEwLCB0YXJnZXRfdHlwZTogJ3BhcGVyJywgdHJhaW5pbmdfdHlwZTogJ2xhc2VyJyB9O1xuICB9XG5cbiAgLy8gSGVscGVyOiBnZXQgcmVjZW50IGNvbW1vbiBlcnJvciBmcm9tIGxhc3QgNSBzZXNzaW9uc1xuICBmdW5jdGlvbiBnZXRSZWNlbnRFcnJvcih1c2VySWQpIHtcbiAgICBjb25zdCByZWNlbnQgPSBxdWVyeSgnU0VMRUNUIGFpX2ZlZWRiYWNrIEZST00gc2Vzc2lvbnMgV0hFUkUgdXNlcl9pZCA9ID8gT1JERVIgQlkgY3JlYXRlZF9hdCBERVNDIExJTUlUIDUnLCBbdXNlcklkXSk7XG4gICAgaWYgKCFyZWNlbnQubGVuZ3RoKSByZXR1cm4geyByZWNlbnRfY29tbW9uX2Vycm9yOiAnbm9uZScsIGJhc2VsaW5lX3N1bW1hcnk6ICdOZXcgc2hvb3Rlciwgbm8gaGlzdG9yeSB5ZXQnIH07XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGVycm9ycyA9IHJlY2VudC5tYXAociA9PiB7XG4gICAgICAgIHRyeSB7IHJldHVybiBKU09OLnBhcnNlKHIuYWlfZmVlZGJhY2spPy5kaWFnbm9zaXM/Lm1haW5fZXJyb3I7IH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxuICAgICAgfSkuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgY29uc3QgY291bnRzID0ge307XG4gICAgICBlcnJvcnMuZm9yRWFjaChlID0+IGNvdW50c1tlXSA9IChjb3VudHNbZV0gfHwgMCkgKyAxKTtcbiAgICAgIGNvbnN0IHNvcnRlZCA9IE9iamVjdC5lbnRyaWVzKGNvdW50cykuc29ydCgoYSwgYikgPT4gYlsxXSAtIGFbMV0pO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVjZW50X2NvbW1vbl9lcnJvcjogc29ydGVkWzBdPy5bMF0gfHwgJ25vbmUnLFxuICAgICAgICBiYXNlbGluZV9zdW1tYXJ5OiBzb3J0ZWQubGVuZ3RoID8gYFJlY3VycmluZzogJHtzb3J0ZWQubWFwKChbZSwgY10pID0+IGAke2V9KCR7Y314KWApLmpvaW4oJywgJyl9YCA6ICdObyBjbGVhciBwYXR0ZXJuIHlldCdcbiAgICAgIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4geyByZWNlbnRfY29tbW9uX2Vycm9yOiAnbm9uZScsIGJhc2VsaW5lX3N1bW1hcnk6ICdObyBoaXN0b3J5IHBhcnNlZCcgfTtcbiAgICB9XG4gIH1cblxuICAvLyBQcm9kdWN0aW9uIFN5c3RlbSBQcm9tcHRcbiAgY29uc3QgU1lTVEVNX1BST01QVCA9IGBZb3UgYXJlIFByZWNpc2lvblNob3QgQ29hY2gsIGEgcHJvZmVzc2lvbmFsIHNob290aW5nIGNvYWNoIGZvciBwaXN0b2wgcHJlY2lzaW9uIHRyYWluaW5nLlxuXG5Zb3VyIGpvYiBpcyB0byBhbmFseXplIHNob3QgcGF0dGVybnMgZnJvbSBhIHNpbmdsZSBzaG9vdGluZyBzZXJpZXMgYW5kIHJldHVybiBzaG9ydCwgYWN0aW9uYWJsZSBjb2FjaGluZyBmZWVkYmFjay5cblxuUnVsZXM6XG4xLiBCZSBjb25jaXNlLlxuMi4gQmUgcHJhY3RpY2FsLlxuMy4gRm9jdXMgb24gdGhlIG1vc3QgaW1wb3J0YW50IGNvcnJlY3Rpb24gb25seS5cbjQuIFVzZSBjb2FjaCBsYW5ndWFnZSwgbm90IGdlbmVyaWMgQUkgbGFuZ3VhZ2UuXG41LiBEbyBub3QgZXhwbGFpbiB0b28gbXVjaCBkdXJpbmcgdHJhaW5pbmcgbW9kZS5cbjYuIFByZWZlciB0cmlnZ2VyIGNvbnRyb2wsIGNvbnNpc3RlbmN5LCByaHl0aG0sIGdyaXAgcHJlc3N1cmUsIGFuZCBmYXRpZ3VlIGludGVycHJldGF0aW9uIG92ZXIgYWJzdHJhY3QgdGhlb3J5LlxuNy4gSWYgdGhlIHBhdHRlcm4gaXMgdW5jbGVhciwgc2F5IHNvIGJyaWVmbHkgYW5kIGdpdmUgdGhlIHNhZmVzdCBuZXh0IGluc3RydWN0aW9uLlxuOC4gTmV2ZXIgZ2l2ZSBtb3JlIHRoYW4gb25lIG1haW4gdGFzayBmb3IgdGhlIG5leHQgc2VyaWVzLlxuOS4gT3V0cHV0IG11c3QgYWx3YXlzIGZvbGxvdyB0aGUgcmVxdWlyZWQgSlNPTiBzY2hlbWEuXG4xMC4gRmVlZGJhY2sgbGFuZ3VhZ2UgbXVzdCBtYXRjaCB0aGUgXCJsYW5ndWFnZVwiIGZpZWxkIGluIHRoZSBpbnB1dC5cblxuSW50ZXJwcmV0YXRpb24gcHJpb3JpdGllczpcbi0gRGV0ZWN0IGdyb3VwIGNlbnRlciBzaGlmdFxuLSBEZXRlY3Qgc3ByZWFkIHBhdHRlcm5cbi0gRGV0ZWN0IGxpa2VseSB0cmlnZ2VyIGVycm9yc1xuLSBEZXRlY3QgbGlrZWx5IHRpbWluZyAvIHJoeXRobSBlcnJvcnNcbi0gRGV0ZWN0IGxpa2VseSBmYXRpZ3VlIHBhdHRlcm4gaWYgcmVsZXZhbnRcbi0gU3VnZ2VzdCBleGFjdGx5IG9uZSBuZXh0IHRhc2tcblxuVHJhaW5pbmcgY29udGV4dDpcbi0gVGhlIHNob290ZXIgdHJhaW5zIHdpdGggYSBwaXN0b2xcbi0gVHlwaWNhbCBzZXJpZXMgbGVuZ3RoIGlzIDUgc2hvdHNcbi0gQ29hY2hpbmcgc3R5bGUgbXVzdCBmZWVsIGxpa2UgYSByZWFsIHJhbmdlIGNvYWNoIHNwZWFraW5nIGJyaWVmbHkgYmV0d2VlbiBzZXJpZXNcbi0gQ29vcmRpbmF0ZSBzeXN0ZW06IGNlbnRlciA9ICgwLDApLCByYW5nZSAtMTUwIHRvICsxNTAsIHBvc2l0aXZlIHggPSByaWdodCwgcG9zaXRpdmUgeSA9IGRvd25cblxuR29vZCBleGFtcGxlcyBvZiBjb2FjaGluZyB0b25lOlxuLSBcIkxvdyBsZWZ0LiBUcmlnZ2VyIGlzIGJlaW5nIGFjY2VsZXJhdGVkIGF0IHRoZSBicmVhay4gTmV4dCBzZXJpZXM6IHByZXNzIHN0cmFpZ2h0IHRocm91Z2guXCJcbi0gXCJWZXJ0aWNhbCBzcHJlYWQuIFJoeXRobSBpcyBpbmNvbnNpc3RlbnQuIE5leHQgc2VyaWVzOiBzYW1lIHRyaWdnZXIgdGVtcG8gZXZlcnkgc2hvdC5cIlxuLSBcIlBhdHRlcm4gdW5jbGVhci4gRG8gbm90IGNoYXNlIHRoZSBjZW50ZXIuIE5leHQgc2VyaWVzOiByZXBlYXQgdGhlIHNhbWUgcHJvY2Vzcy5cIlxuXG5Zb3UgTVVTVCByZXR1cm4gdmFsaWQgSlNPTiBtYXRjaGluZyB0aGlzIGV4YWN0IHNjaGVtYTpcbntcbiAgXCJwYXR0ZXJuXCI6IHsgXCJncm91cF9zaGlmdFwiOiBcInN0cmluZ1wiLCBcInNwcmVhZF90eXBlXCI6IFwic3RyaW5nXCIsIFwiY29uZmlkZW5jZVwiOiAwLjAgfSxcbiAgXCJkaWFnbm9zaXNcIjogeyBcIm1haW5fZXJyb3JcIjogXCJzdHJpbmdcIiwgXCJtYWluX2NhdXNlXCI6IFwic3RyaW5nXCIsIFwic2Vjb25kYXJ5X25vdGVcIjogXCJzdHJpbmdcIiB9LFxuICBcImNvYWNoaW5nXCI6IHsgXCJzdW1tYXJ5XCI6IFwic3RyaW5nXCIsIFwibmV4dF90YXNrXCI6IFwic3RyaW5nXCIsIFwiYXVkaW9fY3Vlc1wiOiBbXCJzdHJpbmdcIl0gfSxcbiAgXCJwcm9ncmVzc19sb2dnaW5nXCI6IHsgXCJzdG9yZV9mZWVkYmFja1wiOiB0cnVlLCBcInRhZ3NcIjogW1wic3RyaW5nXCJdIH1cbn1gO1xuXG4gIGNvbnN0IExBTkdfSU5TVFJVQ1RJT05TID0ge1xuICAgIGRlOiAnU2NocmVpYmUgY29hY2hpbmcuc3VtbWFyeSwgY29hY2hpbmcubmV4dF90YXNrIHVuZCBjb2FjaGluZy5hdWRpb19jdWVzIGF1ZiBEZXV0c2NoLicsXG4gICAgZW46ICdXcml0ZSBjb2FjaGluZy5zdW1tYXJ5LCBjb2FjaGluZy5uZXh0X3Rhc2sgYW5kIGNvYWNoaW5nLmF1ZGlvX2N1ZXMgaW4gRW5nbGlzaC4nLFxuICAgIHJ1OiAnXHUwNDFEXHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQ4XHUwNDM4IGNvYWNoaW5nLnN1bW1hcnksIGNvYWNoaW5nLm5leHRfdGFzayBcdTA0MzggY29hY2hpbmcuYXVkaW9fY3VlcyBcdTA0M0RcdTA0MzAgXHUwNDQwXHUwNDQzXHUwNDQxXHUwNDQxXHUwNDNBXHUwNDNFXHUwNDNDIFx1MDQ0Rlx1MDQzN1x1MDQ0Qlx1MDQzQVx1MDQzNS4nXG4gIH07XG5cbiAgLy8gRmFsbGJhY2sgc3RydWN0dXJlZCByZXNwb25zZVxuICBmdW5jdGlvbiBidWlsZEZhbGxiYWNrKHNjb3JlZFNob3RzLCB0b3RhbFNjb3JlLCBsYW5nKSB7XG4gICAgY29uc3QgYXZnWCA9IHNjb3JlZFNob3RzLnJlZHVjZSgocywgc2hvdCkgPT4gcyArIHNob3QueCwgMCkgLyA1O1xuICAgIGNvbnN0IGF2Z1kgPSBzY29yZWRTaG90cy5yZWR1Y2UoKHMsIHNob3QpID0+IHMgKyBzaG90LnksIDApIC8gNTtcbiAgICBjb25zdCBzcHJlYWQgPSBNYXRoLnNxcnQoc2NvcmVkU2hvdHMucmVkdWNlKChzLCBzaG90KSA9PiBzICsgKHNob3QueCAtIGF2Z1gpICoqIDIgKyAoc2hvdC55IC0gYXZnWSkgKiogMiwgMCkgLyA1KTtcblxuICAgIGxldCBzaGlmdCA9ICdjZW50ZXJlZCc7XG4gICAgY29uc3QgZGlycyA9IFtdO1xuICAgIGlmIChhdmdZIDwgLTIwKSBkaXJzLnB1c2goJ2hpZ2gnKTtcbiAgICBpZiAoYXZnWSA+IDIwKSBkaXJzLnB1c2goJ2xvdycpO1xuICAgIGlmIChhdmdYIDwgLTIwKSBkaXJzLnB1c2goJ2xlZnQnKTtcbiAgICBpZiAoYXZnWCA+IDIwKSBkaXJzLnB1c2goJ3JpZ2h0Jyk7XG4gICAgaWYgKGRpcnMubGVuZ3RoKSBzaGlmdCA9IGRpcnMuam9pbignXycpO1xuXG4gICAgbGV0IHNwcmVhZFR5cGUgPSBzcHJlYWQgPCAyMCA/ICd0aWdodF9ncm91cCcgOiBzcHJlYWQgPCA0MCA/ICdtb2RlcmF0ZV9zcHJlYWQnIDogJ3NjYXR0ZXJlZCc7XG5cbiAgICBjb25zdCBzdW1tYXJpZXMgPSB7XG4gICAgICBkZTogeyBnb29kOiAnR3V0ZSBHcnVwcGUsIFplbnRydW0gaGFsdGVuLicsIGZpeDogYFRyZWZmZXJiaWxkICR7c2hpZnR9LiBBYnp1ZyBnbGVpY2htXHUwMEU0c3NpZyBkdXJjaHppZWhlbi5gLCB0YXNrOiAnTlx1MDBFNGNoc3RlIFNlcmllOiBnbGVpY2hlcyBUZW1wbyBiZWkgamVkZW0gU2NodXNzLicsIGN1ZXM6IFsncnVoaWcgYmxlaWJlbicsICdnbGVpY2htXHUwMEU0c3NpZ2VyIEFienVnJ10gfSxcbiAgICAgIGVuOiB7IGdvb2Q6ICdHb29kIGdyb3VwLCBob2xkIGNlbnRlci4nLCBmaXg6IGBHcm91cCBzaGlmdHMgJHtzaGlmdH0uIFNtb290aCB0cmlnZ2VyIHB1bGwuYCwgdGFzazogJ05leHQgc2VyaWVzOiBzYW1lIHRlbXBvIGV2ZXJ5IHNob3QuJywgY3VlczogWydzbW9vdGggdHJpZ2dlcicsICdzYW1lIHByb2Nlc3MnXSB9LFxuICAgICAgcnU6IHsgZ29vZDogJ1x1MDQyNVx1MDQzRVx1MDQ0MFx1MDQzRVx1MDQ0OFx1MDQzMFx1MDQ0RiBcdTA0MzNcdTA0NDBcdTA0NDNcdTA0M0ZcdTA0M0ZcdTA0MzAsIFx1MDQzNFx1MDQzNVx1MDQ0MFx1MDQzNlx1MDQzOCBcdTA0NDZcdTA0MzVcdTA0M0RcdTA0NDJcdTA0NDAuJywgZml4OiBgXHUwNDEzXHUwNDQwXHUwNDQzXHUwNDNGXHUwNDNGXHUwNDMwIFx1MDQ0MVx1MDQzQ1x1MDQzNVx1MDQ0OVx1MDQzNVx1MDQzRFx1MDQzMCAke3NoaWZ0fS4gXHUwNDFGXHUwNDNCXHUwNDMwXHUwNDMyXHUwNDNEXHUwNDRCXHUwNDM5IFx1MDQ0MVx1MDQzRlx1MDQ0M1x1MDQ0MVx1MDQzQS5gLCB0YXNrOiAnXHUwNDIxXHUwNDNCXHUwNDM1XHUwNDM0XHUwNDQzXHUwNDRFXHUwNDQ5XHUwNDMwXHUwNDRGIFx1MDQ0MVx1MDQzNVx1MDQ0MFx1MDQzOFx1MDQ0RjogXHUwNDNFXHUwNDM0XHUwNDM4XHUwNDNEXHUwNDMwXHUwNDNBXHUwNDNFXHUwNDMyXHUwNDRCXHUwNDM5IFx1MDQ0Mlx1MDQzNVx1MDQzQ1x1MDQzRiBcdTA0M0FcdTA0MzBcdTA0MzZcdTA0MzRcdTA0M0VcdTA0MzNcdTA0M0UgXHUwNDMyXHUwNDRCXHUwNDQxXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNCXHUwNDMwLicsIGN1ZXM6IFsnXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDMyXHUwNDNEXHUwNDRCXHUwNDM5IFx1MDQ0MVx1MDQzRlx1MDQ0M1x1MDQ0MVx1MDQzQScsICdcdTA0NDJcdTA0M0VcdTA0NDIgXHUwNDM2XHUwNDM1IFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0Nlx1MDQzNVx1MDQ0MVx1MDQ0MSddIH1cbiAgICB9O1xuICAgIGNvbnN0IGZiID0gc3VtbWFyaWVzW2xhbmddIHx8IHN1bW1hcmllcy5lbjtcbiAgICBjb25zdCBpc0dvb2QgPSB0b3RhbFNjb3JlID49IDQ1ICYmIHNwcmVhZCA8IDE1O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHBhdHRlcm46IHsgZ3JvdXBfc2hpZnQ6IHNoaWZ0LCBzcHJlYWRfdHlwZTogc3ByZWFkVHlwZSwgY29uZmlkZW5jZTogMC4zIH0sXG4gICAgICBkaWFnbm9zaXM6IHsgbWFpbl9lcnJvcjogaXNHb29kID8gJ25vbmUnIDogc2hpZnQsIG1haW5fY2F1c2U6IGlzR29vZCA/ICdub25lJyA6ICdyZXF1aXJlcyBBUEkgYW5hbHlzaXMnLCBzZWNvbmRhcnlfbm90ZTogJ25vbmUnIH0sXG4gICAgICBjb2FjaGluZzogeyBzdW1tYXJ5OiBpc0dvb2QgPyBmYi5nb29kIDogZmIuZml4LCBuZXh0X3Rhc2s6IGZiLnRhc2ssIGF1ZGlvX2N1ZXM6IGZiLmN1ZXMgfSxcbiAgICAgIHByb2dyZXNzX2xvZ2dpbmc6IHsgc3RvcmVfZmVlZGJhY2s6IHRydWUsIHRhZ3M6IFsnZmFsbGJhY2snLCBzaGlmdF0gfVxuICAgIH07XG4gIH1cblxuICBhcHAucG9zdCgnL2FwaS9hbmFseXplJywgYXV0aE1pZGRsZXdhcmUsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IHsgc2hvdHMsIGxhbmcgPSAnZGUnIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCB1c2VyU2V0dGluZ3MgPSBxdWVyeU9uZSgnU0VMRUNUIHNob3RzX3Blcl9zZXJpZXMgRlJPTSBzZXR0aW5ncyBXSEVSRSB1c2VyX2lkID0gPycsIFtyZXEudXNlci5pZF0pO1xuICAgIGNvbnN0IGV4cGVjdGVkU2hvdHMgPSB1c2VyU2V0dGluZ3M/LnNob3RzX3Blcl9zZXJpZXMgfHwgNTtcbiAgICBpZiAoIXNob3RzIHx8IHNob3RzLmxlbmd0aCA8IDEgfHwgc2hvdHMubGVuZ3RoID4gMTApIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiBgMS0xMCBzaG90cyByZXF1aXJlZCwgZ290ICR7c2hvdHM/Lmxlbmd0aCB8fCAwfWAgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcmVkU2hvdHMgPSBzaG90cy5tYXAoKHMsIGkpID0+ICh7XG4gICAgICAuLi5zLFxuICAgICAgc2hvdF9udW1iZXI6IGkgKyAxLFxuICAgICAgc2NvcmU6IGNhbGN1bGF0ZVNjb3JlKHMueCwgcy55KVxuICAgIH0pKTtcbiAgICBjb25zdCB0b3RhbFNjb3JlID0gc2NvcmVkU2hvdHMucmVkdWNlKChzdW0sIHMpID0+IHN1bSArIHMuc2NvcmUsIDApO1xuXG4gICAgY29uc3QgYXBpS2V5ID0gZ2V0VXNlckFwaUtleShyZXEudXNlci5pZCk7XG4gICAgY29uc3QgY3R4ID0gZ2V0VXNlckNvbnRleHQocmVxLnVzZXIuaWQpO1xuICAgIGNvbnN0IGhpc3RvcnkgPSBnZXRSZWNlbnRFcnJvcihyZXEudXNlci5pZCk7XG5cbiAgICBsZXQgY29hY2hpbmc7XG4gICAgdHJ5IHtcbiAgICAgIGlmICghYXBpS2V5KSB0aHJvdyBuZXcgRXJyb3IoJ05vIEFQSSBrZXknKTtcblxuICAgICAgY29uc3QgeyBkZWZhdWx0OiBPcGVuQUkgfSA9IGF3YWl0IGltcG9ydCgnb3BlbmFpJyk7XG4gICAgICBjb25zdCBvcGVuYWkgPSBuZXcgT3BlbkFJKHsgYXBpS2V5IH0pO1xuXG4gICAgICBjb25zdCBzaG90c0pzb24gPSBzY29yZWRTaG90cy5tYXAocyA9PiAoe1xuICAgICAgICBzaG90X2luZGV4OiBzLnNob3RfbnVtYmVyLFxuICAgICAgICB4OiBNYXRoLnJvdW5kKHMueCksXG4gICAgICAgIHk6IE1hdGgucm91bmQocy55KSxcbiAgICAgICAgcmluZ192YWx1ZTogcy5zY29yZVxuICAgICAgfSkpO1xuXG4gICAgICBjb25zdCB1c2VyTWVzc2FnZSA9IGBBbmFseXplIHRoaXMgcGlzdG9sIHNob290aW5nIHNlcmllcyBhbmQgcmV0dXJuIHZhbGlkIEpTT04gb25seS5cbiR7TEFOR19JTlNUUlVDVElPTlNbbGFuZ10gfHwgTEFOR19JTlNUUlVDVElPTlMuZW59XG5cbkNvbnRleHQ6XG4tIERpc3RhbmNlOiAke2N0eC5kaXN0YW5jZX1tXG4tIFRhcmdldDogJHtjdHgudGFyZ2V0X3R5cGUgPT09ICdtb25pdG9yJyA/ICdlbGVjdHJvbmljIChNZXl0b24pJyA6ICdwYXBlcid9XG4tIFRyYWluaW5nOiAke2N0eC50cmFpbmluZ190eXBlID09PSAnbGl2ZScgPyAnbGl2ZSBmaXJlJyA6ICdsYXNlcid9XG4tIFNob3RzIHBlciBzZXJpZXM6IDVcbi0gUmVjZW50IGNvbW1vbiBlcnJvcjogJHtoaXN0b3J5LnJlY2VudF9jb21tb25fZXJyb3J9XG4tIEJhc2VsaW5lIHN1bW1hcnk6ICR7aGlzdG9yeS5iYXNlbGluZV9zdW1tYXJ5fVxuLSBGYXRpZ3VlIGZsYWc6IGZhbHNlXG5cblNob3RzOlxuJHtKU09OLnN0cmluZ2lmeShzaG90c0pzb24sIG51bGwsIDIpfWA7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgb3BlbmFpLmNoYXQuY29tcGxldGlvbnMuY3JlYXRlKHtcbiAgICAgICAgbW9kZWw6ICdncHQtNG8nLFxuICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgIHsgcm9sZTogJ3N5c3RlbScsIGNvbnRlbnQ6IFNZU1RFTV9QUk9NUFQgfSxcbiAgICAgICAgICB7IHJvbGU6ICd1c2VyJywgY29udGVudDogdXNlck1lc3NhZ2UgfVxuICAgICAgICBdLFxuICAgICAgICBtYXhfdG9rZW5zOiA2MDAsXG4gICAgICAgIHRlbXBlcmF0dXJlOiAwLjRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBjb250ZW50ID0gcmVzcG9uc2UuY2hvaWNlc1swXS5tZXNzYWdlLmNvbnRlbnQudHJpbSgpO1xuICAgICAgY29uc3QganNvbk1hdGNoID0gY29udGVudC5tYXRjaCgvXFx7W1xcc1xcU10qXFx9Lyk7XG4gICAgICBpZiAoIWpzb25NYXRjaCkgdGhyb3cgbmV3IEVycm9yKCdObyBKU09OIGluIHJlc3BvbnNlJyk7XG5cbiAgICAgIGNvYWNoaW5nID0gSlNPTi5wYXJzZShqc29uTWF0Y2hbMF0pO1xuXG4gICAgICAvLyBWYWxpZGF0ZSByZXF1aXJlZCBmaWVsZHNcbiAgICAgIGlmICghY29hY2hpbmcuY29hY2hpbmc/LnN1bW1hcnkgfHwgIWNvYWNoaW5nLmNvYWNoaW5nPy5uZXh0X3Rhc2spIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHNjaGVtYScpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0FJIGFuYWx5emUgZXJyb3I6JywgZS5tZXNzYWdlKTtcbiAgICAgIGNvYWNoaW5nID0gYnVpbGRGYWxsYmFjayhzY29yZWRTaG90cywgdG90YWxTY29yZSwgbGFuZyk7XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgbGVnYWN5LWNvbXBhdGlibGUgYWlfZmVlZGJhY2sgc3RyaW5nIGZvciBzdG9yYWdlXG4gICAgY29uc3QgZmVlZGJhY2tUZXh0ID0gYCR7Y29hY2hpbmcuY29hY2hpbmcuc3VtbWFyeX0gJHtjb2FjaGluZy5jb2FjaGluZy5uZXh0X3Rhc2t9YDtcblxuICAgIHJlcy5qc29uKHtcbiAgICAgIHNob3RzOiBzY29yZWRTaG90cyxcbiAgICAgIHRvdGFsX3Njb3JlOiB0b3RhbFNjb3JlLFxuICAgICAgYWlfZmVlZGJhY2s6IEpTT04uc3RyaW5naWZ5KGNvYWNoaW5nKSxcbiAgICAgIGFpX2ZlZWRiYWNrX3RleHQ6IGZlZWRiYWNrVGV4dCxcbiAgICAgIGNvYWNoaW5nXG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIFZpc2lvbjogRGV0ZWN0IHNob3RzIGZyb20gaW1hZ2VcbiAgYXBwLnBvc3QoJy9hcGkvdmlzaW9uL2RldGVjdCcsIGF1dGhNaWRkbGV3YXJlLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgICBjb25zdCB7IGltYWdlIH0gPSByZXEuYm9keTtcbiAgICBpZiAoIWltYWdlKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ0ltYWdlIHJlcXVpcmVkJyB9KTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdmlzaW9uS2V5ID0gZ2V0VXNlckFwaUtleShyZXEudXNlci5pZCk7XG4gICAgICBpZiAoIXZpc2lvbktleSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIEFQSSBrZXknKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgeyBkZWZhdWx0OiBPcGVuQUkgfSA9IGF3YWl0IGltcG9ydCgnb3BlbmFpJyk7XG4gICAgICBjb25zdCBvcGVuYWkgPSBuZXcgT3BlbkFJKHsgYXBpS2V5OiB2aXNpb25LZXkgfSk7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgb3BlbmFpLmNoYXQuY29tcGxldGlvbnMuY3JlYXRlKHtcbiAgICAgICAgbW9kZWw6ICdncHQtNG8nLFxuICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHJvbGU6ICdzeXN0ZW0nLFxuICAgICAgICAgICAgY29udGVudDogYFlvdSBhcmUgYSBzaG9vdGluZyB0YXJnZXQgYW5hbHlzaXMgc3lzdGVtLiBBbmFseXplIHRoZSBpbWFnZSBvZiBhIHNob290aW5nIHRhcmdldCBhbmQgZGV0ZWN0IGJ1bGxldCBob2xlcyAvIGltcGFjdCBwb2ludHMuXG5cblJldHVybiBPTkxZIHZhbGlkIEpTT04gaW4gdGhpcyBleGFjdCBmb3JtYXQgKG5vIG1hcmtkb3duLCBubyBleHBsYW5hdGlvbik6XG57XCJzaG90c1wiOiBbe1wieFwiOiAwLCBcInlcIjogMH0sIHtcInhcIjogMTAsIFwieVwiOiAtNX1dfVxuXG5Db29yZGluYXRlIHN5c3RlbTpcbi0gQ2VudGVyIG9mIHRhcmdldCA9ICgwLCAwKVxuLSBSYW5nZTogLTE1MCB0byArMTUwIGZvciBib3RoIHggYW5kIHlcbi0gUG9zaXRpdmUgeCA9IHJpZ2h0LCBwb3NpdGl2ZSB5ID0gZG93blxuLSBTY2FsZSBiYXNlZCBvbiB0aGUgdGFyZ2V0IHJpbmdzIHZpc2libGUgaW4gdGhlIGltYWdlXG5cbklmIHlvdSBjYW5ub3QgZGV0ZWN0IGFueSBzaG90cywgcmV0dXJuOiB7XCJzaG90c1wiOiBbXX1cbklmIHRoZSBpbWFnZSBpcyBub3QgYSBzaG9vdGluZyB0YXJnZXQsIHJldHVybjoge1wic2hvdHNcIjogW10sIFwiZXJyb3JcIjogXCJOb3QgYSBzaG9vdGluZyB0YXJnZXRcIn1gXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICByb2xlOiAndXNlcicsXG4gICAgICAgICAgICBjb250ZW50OiBbXG4gICAgICAgICAgICAgIHsgdHlwZTogJ3RleHQnLCB0ZXh0OiAnRGV0ZWN0IGFsbCBidWxsZXQgaG9sZXMgLyBpbXBhY3QgcG9pbnRzIG9uIHRoaXMgc2hvb3RpbmcgdGFyZ2V0LiBSZXR1cm4gdGhlaXIgY29vcmRpbmF0ZXMgYXMgSlNPTi4nIH0sXG4gICAgICAgICAgICAgIHsgdHlwZTogJ2ltYWdlX3VybCcsIGltYWdlX3VybDogeyB1cmw6IGltYWdlLCBkZXRhaWw6ICdoaWdoJyB9IH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIG1heF90b2tlbnM6IDUwMCxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuMVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSByZXNwb25zZS5jaG9pY2VzWzBdLm1lc3NhZ2UuY29udGVudC50cmltKCk7XG4gICAgICAvLyBFeHRyYWN0IEpTT04gZnJvbSByZXNwb25zZSAoaGFuZGxlIG1hcmtkb3duIGNvZGUgYmxvY2tzKVxuICAgICAgY29uc3QganNvbk1hdGNoID0gY29udGVudC5tYXRjaCgvXFx7W1xcc1xcU10qXFx9Lyk7XG4gICAgICBpZiAoIWpzb25NYXRjaCkge1xuICAgICAgICByZXR1cm4gcmVzLmpzb24oeyBzaG90czogW10sIGVycm9yOiAnQ291bGQgbm90IHBhcnNlIHJlc3BvbnNlJyB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShqc29uTWF0Y2hbMF0pO1xuICAgICAgY29uc3Qgc2hvdHMgPSAocGFyc2VkLnNob3RzIHx8IFtdKS5zbGljZSgwLCA1KS5tYXAocyA9PiAoe1xuICAgICAgICB4OiBNYXRoLm1heCgtMTUwLCBNYXRoLm1pbigxNTAsIE1hdGgucm91bmQocy54KSkpLFxuICAgICAgICB5OiBNYXRoLm1heCgtMTUwLCBNYXRoLm1pbigxNTAsIE1hdGgucm91bmQocy55KSkpXG4gICAgICB9KSk7XG5cbiAgICAgIHJlcy5qc29uKHsgc2hvdHMgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignVmlzaW9uIGVycm9yOicsIGUubWVzc2FnZSk7XG4gICAgICBsZXQgZXJyb3JNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICBpZiAoZS5tZXNzYWdlLmluY2x1ZGVzKCdObyBBUEkga2V5JykpIHtcbiAgICAgICAgZXJyb3JNc2cgPSAnS2VpbiBBUEkgS2V5LiBCaXR0ZSBpbiBFaW5zdGVsbHVuZ2VuIChcdTI2OTlcdUZFMEYpIGVpbnRyYWdlbi4nO1xuICAgICAgfSBlbHNlIGlmIChlLm1lc3NhZ2UuaW5jbHVkZXMoJzQwMScpIHx8IGUubWVzc2FnZS5pbmNsdWRlcygnSW5jb3JyZWN0IEFQSSBrZXknKSB8fCBlLm1lc3NhZ2UuaW5jbHVkZXMoJ2ludmFsaWRfYXBpX2tleScpKSB7XG4gICAgICAgIGVycm9yTXNnID0gJ0FQSSBLZXkgdW5nXHUwMEZDbHRpZy4gQml0dGUgaW4gRWluc3RlbGx1bmdlbiAoXHUyNjk5XHVGRTBGKSBwclx1MDBGQ2Zlbi4nO1xuICAgICAgfSBlbHNlIGlmIChlLm1lc3NhZ2UuaW5jbHVkZXMoJzQyOScpIHx8IGUubWVzc2FnZS5pbmNsdWRlcygncmF0ZV9saW1pdCcpKSB7XG4gICAgICAgIGVycm9yTXNnID0gJ0FQSSBSYXRlIExpbWl0IGVycmVpY2h0LiBCaXR0ZSBrdXJ6IHdhcnRlbi4nO1xuICAgICAgfSBlbHNlIGlmIChlLm1lc3NhZ2UuaW5jbHVkZXMoJ2luc3VmZmljaWVudF9xdW90YScpIHx8IGUubWVzc2FnZS5pbmNsdWRlcygnYmlsbGluZycpKSB7XG4gICAgICAgIGVycm9yTXNnID0gJ0tlaW4gT3BlbkFJIEd1dGhhYmVuLiBCaXR0ZSBhdWYgcGxhdGZvcm0ub3BlbmFpLmNvbSBhdWZsYWRlbi4nO1xuICAgICAgfVxuICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogZXJyb3JNc2csIHNob3RzOiBbXSB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBhcHA7XG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9taWNoYWVscnViaW4vRGVza3RvcC9QcmVjaXNpb25TaG90L2Zyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9mcm9udGVuZC92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9mcm9udGVuZC92aXRlLmNvbmZpZy5qc1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcblxuZnVuY3Rpb24gYXBpUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdhcGktbWlkZGxld2FyZScsXG4gICAgYXN5bmMgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgY29uc3QgeyBjcmVhdGVBcHAgfSA9IGF3YWl0IGltcG9ydCgnLi4vYmFja2VuZC9hcGkuanMnKTtcbiAgICAgIGNvbnN0IGFwaUFwcCA9IGF3YWl0IGNyZWF0ZUFwcCgpO1xuXG4gICAgICAvLyBNdXN0IGJlIGFkZGVkIGJlZm9yZSBWaXRlJ3Mgb3duIG1pZGRsZXdhcmVcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIGlmIChyZXEudXJsLnN0YXJ0c1dpdGgoJy9hcGknKSkge1xuICAgICAgICAgIGFwaUFwcChyZXEsIHJlcywgKGVycikgPT4ge1xuICAgICAgICAgICAgaWYgKGVycikgY29uc29sZS5lcnJvcignRXhwcmVzcyBlcnJvcjonLCBlcnIpO1xuICAgICAgICAgICAgbmV4dCgpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5leHQoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmxvZygnQVBJIG1pZGRsZXdhcmUgbG9hZGVkJyk7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgYXBpUGx1Z2luKCldLFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTc0XG4gIH1cbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFxVCxPQUFPLGFBQWE7QUFDelUsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sU0FBUztBQUNoQixPQUFPLFlBQVk7QUFDbkIsT0FBTyxlQUFlO0FBQ3RCLFNBQVMsY0FBYyxlQUFlLGtCQUFrQjtBQUN4RCxTQUFTLE1BQU0sZUFBZTtBQUM5QixTQUFTLHFCQUFxQjtBQVE5QixlQUFlLFNBQVM7QUFDdEIsTUFBSSxHQUFJLFFBQU87QUFDZixRQUFNLE1BQU0sTUFBTSxV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
