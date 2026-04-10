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
  } catch {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vYmFja2VuZC9hcGkuanMiLCAidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9iYWNrZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9iYWNrZW5kL2FwaS5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvbWljaGFlbHJ1YmluL0Rlc2t0b3AvUHJlY2lzaW9uU2hvdC9iYWNrZW5kL2FwaS5qc1wiO2ltcG9ydCBleHByZXNzIGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0IGNvcnMgZnJvbSAnY29ycyc7XG5pbXBvcnQgand0IGZyb20gJ2pzb253ZWJ0b2tlbic7XG5pbXBvcnQgYmNyeXB0IGZyb20gJ2JjcnlwdGpzJztcbmltcG9ydCBpbml0U3FsSnMgZnJvbSAnc3FsLmpzJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgd3JpdGVGaWxlU3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGpvaW4sIGRpcm5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKSk7XG5jb25zdCBEQl9QQVRIID0gam9pbihfX2Rpcm5hbWUsICdkYicsICdwcmVjaXNpb25zaG90LmRiJyk7XG5jb25zdCBKV1RfU0VDUkVUID0gcHJvY2Vzcy5lbnYuSldUX1NFQ1JFVCB8fCAncHJlY2lzaW9uc2hvdC1kZXYtc2VjcmV0LTIwMjQnO1xuXG5sZXQgZGI7XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXREYigpIHtcbiAgaWYgKGRiKSByZXR1cm4gZGI7XG4gIGNvbnN0IFNRTCA9IGF3YWl0IGluaXRTcWxKcygpO1xuICBpZiAoZXhpc3RzU3luYyhEQl9QQVRIKSkge1xuICAgIGRiID0gbmV3IFNRTC5EYXRhYmFzZShyZWFkRmlsZVN5bmMoREJfUEFUSCkpO1xuICB9IGVsc2Uge1xuICAgIGRiID0gbmV3IFNRTC5EYXRhYmFzZSgpO1xuICB9XG4gIGNvbnN0IHNjaGVtYSA9IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJ2RiJywgJ3NjaGVtYS5zcWwnKSwgJ3V0Zi04Jyk7XG4gIGRiLnJ1bihzY2hlbWEpO1xuXG4gIC8vIE1pZ3JhdGlvbnM6IGFkZCBjb2x1bW5zIGlmIG1pc3NpbmdcbiAgdHJ5IHsgZGIucnVuKCdBTFRFUiBUQUJMRSBzZXR0aW5ncyBBREQgQ09MVU1OIHNob3RzX3Blcl9zZXJpZXMgSU5URUdFUiBERUZBVUxUIDUnKTsgfSBjYXRjaCB7fVxuXG4gIHJldHVybiBkYjtcbn1cblxuZnVuY3Rpb24gc2F2ZURiKCkge1xuICBpZiAoZGIpIHdyaXRlRmlsZVN5bmMoREJfUEFUSCwgQnVmZmVyLmZyb20oZGIuZXhwb3J0KCkpKTtcbn1cblxuZnVuY3Rpb24gcXVlcnkoc3FsLCBwYXJhbXMgPSBbXSkge1xuICBjb25zdCBzdG10ID0gZGIucHJlcGFyZShzcWwpO1xuICBzdG10LmJpbmQocGFyYW1zKTtcbiAgY29uc3QgcmVzdWx0cyA9IFtdO1xuICB3aGlsZSAoc3RtdC5zdGVwKCkpIHtcbiAgICBjb25zdCBjb2xzID0gc3RtdC5nZXRDb2x1bW5OYW1lcygpO1xuICAgIGNvbnN0IHZhbHMgPSBzdG10LmdldCgpO1xuICAgIGNvbnN0IHJvdyA9IHt9O1xuICAgIGNvbHMuZm9yRWFjaCgoYywgaSkgPT4gcm93W2NdID0gdmFsc1tpXSk7XG4gICAgcmVzdWx0cy5wdXNoKHJvdyk7XG4gIH1cbiAgc3RtdC5mcmVlKCk7XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiBxdWVyeU9uZShzcWwsIHBhcmFtcyA9IFtdKSB7XG4gIHJldHVybiBxdWVyeShzcWwsIHBhcmFtcylbMF07XG59XG5cbmZ1bmN0aW9uIHJ1bihzcWwsIHBhcmFtcyA9IFtdKSB7XG4gIGNvbnN0IHN0bXQgPSBkYi5wcmVwYXJlKHNxbCk7XG4gIHN0bXQuYmluZChwYXJhbXMpO1xuICBzdG10LnN0ZXAoKTtcbiAgc3RtdC5mcmVlKCk7XG4gIGNvbnN0IGxhc3RJZCA9IGRiLmV4ZWMoJ1NFTEVDVCBsYXN0X2luc2VydF9yb3dpZCgpIGFzIGlkJylbMF0/LnZhbHVlc1swXVswXTtcbiAgc2F2ZURiKCk7XG4gIHJldHVybiB7IGxhc3RJbnNlcnRSb3dpZDogbGFzdElkIH07XG59XG5cbmZ1bmN0aW9uIGF1dGhNaWRkbGV3YXJlKHJlcSwgcmVzLCBuZXh0KSB7XG4gIGNvbnN0IGhlYWRlciA9IHJlcS5oZWFkZXJzLmF1dGhvcml6YXRpb247XG4gIGlmICghaGVhZGVyKSByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ1Rva2VuIGZlaGx0JyB9KTtcbiAgdHJ5IHtcbiAgICByZXEudXNlciA9IGp3dC52ZXJpZnkoaGVhZGVyLnJlcGxhY2UoJ0JlYXJlciAnLCAnJyksIEpXVF9TRUNSRVQpO1xuICAgIG5leHQoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ1VuZ1x1MDBGQ2x0aWdlciBUb2tlbicgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY2FsY3VsYXRlU2NvcmUoeCwgeSkge1xuICBjb25zdCBkaXN0YW5jZSA9IE1hdGguc3FydCh4ICogeCArIHkgKiB5KTtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5tYXgoMSwgMTAgLSAoZGlzdGFuY2UgLyAxNTApICogOSkgKiAxMCkgLyAxMDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUFwcCgpIHtcbiAgYXdhaXQgaW5pdERiKCk7XG5cbiAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICBhcHAudXNlKGNvcnMoKSk7XG4gIGFwcC51c2UoZXhwcmVzcy5qc29uKHsgbGltaXQ6ICcyMG1iJyB9KSk7XG5cbiAgLy8gSGVhbHRoXG4gIGFwcC5nZXQoJy9hcGkvaGVhbHRoJywgKHJlcSwgcmVzKSA9PiByZXMuanNvbih7IHN0YXR1czogJ29rJyB9KSk7XG5cbiAgLy8gQXV0aFxuICBhcHAucG9zdCgnL2FwaS9hdXRoL3JlZ2lzdGVyJywgKHJlcSwgcmVzKSA9PiB7XG4gICAgY29uc3QgeyB1c2VybmFtZSwgZW1haWwsIHBhc3N3b3JkIH0gPSByZXEuYm9keTtcbiAgICBpZiAoIXVzZXJuYW1lIHx8ICFlbWFpbCB8fCAhcGFzc3dvcmQpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAnQWxsZSBGZWxkZXIgZXJmb3JkZXJsaWNoJyB9KTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhc2ggPSBiY3J5cHQuaGFzaFN5bmMocGFzc3dvcmQsIDEwKTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJ1bignSU5TRVJUIElOVE8gdXNlcnMgKHVzZXJuYW1lLCBlbWFpbCwgcGFzc3dvcmRfaGFzaCkgVkFMVUVTICg/LCA/LCA/KScsIFt1c2VybmFtZSwgZW1haWwsIGhhc2hdKTtcbiAgICAgIGNvbnN0IHRva2VuID0gand0LnNpZ24oeyBpZDogcmVzdWx0Lmxhc3RJbnNlcnRSb3dpZCwgdXNlcm5hbWUgfSwgSldUX1NFQ1JFVCwgeyBleHBpcmVzSW46ICc3ZCcgfSk7XG4gICAgICByZXMuanNvbih7IHRva2VuLCB1c2VyOiB7IGlkOiByZXN1bHQubGFzdEluc2VydFJvd2lkLCB1c2VybmFtZSwgZW1haWwgfSB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoZS5tZXNzYWdlPy5pbmNsdWRlcygnVU5JUVVFJykpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA5KS5qc29uKHsgZXJyb3I6ICdVc2VybmFtZSBvZGVyIEVtYWlsIGJlcmVpdHMgdmVyZ2ViZW4nIH0pO1xuICAgICAgfVxuICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ1JlZ2lzdHJpZXJ1bmcgZmVobGdlc2NobGFnZW4nIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgYXBwLnBvc3QoJy9hcGkvYXV0aC9sb2dpbicsIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IHsgZW1haWwsIHBhc3N3b3JkIH0gPSByZXEuYm9keTtcbiAgICBpZiAoIWVtYWlsIHx8ICFwYXNzd29yZCkge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICdFbWFpbCB1bmQgUGFzc3dvcnQgZXJmb3JkZXJsaWNoJyB9KTtcbiAgICB9XG4gICAgY29uc3QgdXNlciA9IHF1ZXJ5T25lKCdTRUxFQ1QgKiBGUk9NIHVzZXJzIFdIRVJFIGVtYWlsID0gPycsIFtlbWFpbF0pO1xuICAgIGlmICghdXNlciB8fCAhYmNyeXB0LmNvbXBhcmVTeW5jKHBhc3N3b3JkLCB1c2VyLnBhc3N3b3JkX2hhc2gpKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ1VuZ1x1MDBGQ2x0aWdlIEFubWVsZGVkYXRlbicgfSk7XG4gICAgfVxuICAgIGNvbnN0IHRva2VuID0gand0LnNpZ24oeyBpZDogdXNlci5pZCwgdXNlcm5hbWU6IHVzZXIudXNlcm5hbWUgfSwgSldUX1NFQ1JFVCwgeyBleHBpcmVzSW46ICc3ZCcgfSk7XG4gICAgcmVzLmpzb24oeyB0b2tlbiwgdXNlcjogeyBpZDogdXNlci5pZCwgdXNlcm5hbWU6IHVzZXIudXNlcm5hbWUsIGVtYWlsOiB1c2VyLmVtYWlsIH0gfSk7XG4gIH0pO1xuXG4gIC8vIFNldHRpbmdzXG4gIGFwcC5nZXQoJy9hcGkvc2V0dGluZ3MnLCBhdXRoTWlkZGxld2FyZSwgKHJlcSwgcmVzKSA9PiB7XG4gICAgbGV0IHNldHRpbmdzID0gcXVlcnlPbmUoJ1NFTEVDVCAqIEZST00gc2V0dGluZ3MgV0hFUkUgdXNlcl9pZCA9ID8nLCBbcmVxLnVzZXIuaWRdKTtcbiAgICBpZiAoIXNldHRpbmdzKSB7XG4gICAgICBydW4oJ0lOU0VSVCBJTlRPIHNldHRpbmdzICh1c2VyX2lkKSBWQUxVRVMgKD8pJywgW3JlcS51c2VyLmlkXSk7XG4gICAgICBzZXR0aW5ncyA9IHF1ZXJ5T25lKCdTRUxFQ1QgKiBGUk9NIHNldHRpbmdzIFdIRVJFIHVzZXJfaWQgPSA/JywgW3JlcS51c2VyLmlkXSk7XG4gICAgfVxuICAgIC8vIE1hc2sgQVBJIGtleSBmb3Igc2VjdXJpdHlcbiAgICBpZiAoc2V0dGluZ3Mub3BlbmFpX2tleSkge1xuICAgICAgc2V0dGluZ3Mub3BlbmFpX2tleV9tYXNrZWQgPSBzZXR0aW5ncy5vcGVuYWlfa2V5LnN1YnN0cmluZygwLCA3KSArICcuLi4nICsgc2V0dGluZ3Mub3BlbmFpX2tleS5zbGljZSgtNCk7XG4gICAgICBzZXR0aW5ncy5oYXNfYXBpX2tleSA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNldHRpbmdzLm9wZW5haV9rZXlfbWFza2VkID0gJyc7XG4gICAgICBzZXR0aW5ncy5oYXNfYXBpX2tleSA9IGZhbHNlO1xuICAgIH1cbiAgICBkZWxldGUgc2V0dGluZ3Mub3BlbmFpX2tleTtcbiAgICByZXMuanNvbihzZXR0aW5ncyk7XG4gIH0pO1xuXG4gIGFwcC5wdXQoJy9hcGkvc2V0dGluZ3MnLCBhdXRoTWlkZGxld2FyZSwgKHJlcSwgcmVzKSA9PiB7XG4gICAgY29uc3QgeyBkaXN0YW5jZSwgc2hvdHNfcGVyX3NlcmllcywgdGFyZ2V0X3R5cGUsIHRyYWluaW5nX3R5cGUsIG9wZW5haV9rZXkgfSA9IHJlcS5ib2R5O1xuXG4gICAgLy8gRW5zdXJlIHNldHRpbmdzIHJvdyBleGlzdHNcbiAgICBjb25zdCBleGlzdGluZyA9IHF1ZXJ5T25lKCdTRUxFQ1QgKiBGUk9NIHNldHRpbmdzIFdIRVJFIHVzZXJfaWQgPSA/JywgW3JlcS51c2VyLmlkXSk7XG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgcnVuKCdJTlNFUlQgSU5UTyBzZXR0aW5ncyAodXNlcl9pZCkgVkFMVUVTICg/KScsIFtyZXEudXNlci5pZF0pO1xuICAgIH1cblxuICAgIGlmIChkaXN0YW5jZSAhPSBudWxsKSB7XG4gICAgICBydW4oJ1VQREFURSBzZXR0aW5ncyBTRVQgZGlzdGFuY2UgPSA/IFdIRVJFIHVzZXJfaWQgPSA/JywgW2Rpc3RhbmNlLCByZXEudXNlci5pZF0pO1xuICAgIH1cbiAgICBpZiAoc2hvdHNfcGVyX3NlcmllcyAhPSBudWxsKSB7XG4gICAgICBydW4oJ1VQREFURSBzZXR0aW5ncyBTRVQgc2hvdHNfcGVyX3NlcmllcyA9ID8gV0hFUkUgdXNlcl9pZCA9ID8nLCBbc2hvdHNfcGVyX3NlcmllcywgcmVxLnVzZXIuaWRdKTtcbiAgICB9XG4gICAgaWYgKHRhcmdldF90eXBlKSB7XG4gICAgICBydW4oJ1VQREFURSBzZXR0aW5ncyBTRVQgdGFyZ2V0X3R5cGUgPSA/IFdIRVJFIHVzZXJfaWQgPSA/JywgW3RhcmdldF90eXBlLCByZXEudXNlci5pZF0pO1xuICAgIH1cbiAgICBpZiAodHJhaW5pbmdfdHlwZSkge1xuICAgICAgcnVuKCdVUERBVEUgc2V0dGluZ3MgU0VUIHRyYWluaW5nX3R5cGUgPSA/IFdIRVJFIHVzZXJfaWQgPSA/JywgW3RyYWluaW5nX3R5cGUsIHJlcS51c2VyLmlkXSk7XG4gICAgfVxuICAgIGlmIChvcGVuYWlfa2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJ1bignVVBEQVRFIHNldHRpbmdzIFNFVCBvcGVuYWlfa2V5ID0gPyBXSEVSRSB1c2VyX2lkID0gPycsIFtvcGVuYWlfa2V5LCByZXEudXNlci5pZF0pO1xuICAgIH1cblxuICAgIGNvbnN0IHVwZGF0ZWQgPSBxdWVyeU9uZSgnU0VMRUNUICogRlJPTSBzZXR0aW5ncyBXSEVSRSB1c2VyX2lkID0gPycsIFtyZXEudXNlci5pZF0pO1xuICAgIGlmICh1cGRhdGVkLm9wZW5haV9rZXkpIHtcbiAgICAgIHVwZGF0ZWQub3BlbmFpX2tleV9tYXNrZWQgPSB1cGRhdGVkLm9wZW5haV9rZXkuc3Vic3RyaW5nKDAsIDcpICsgJy4uLicgKyB1cGRhdGVkLm9wZW5haV9rZXkuc2xpY2UoLTQpO1xuICAgICAgdXBkYXRlZC5oYXNfYXBpX2tleSA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHVwZGF0ZWQub3BlbmFpX2tleV9tYXNrZWQgPSAnJztcbiAgICAgIHVwZGF0ZWQuaGFzX2FwaV9rZXkgPSBmYWxzZTtcbiAgICB9XG4gICAgZGVsZXRlIHVwZGF0ZWQub3BlbmFpX2tleTtcbiAgICByZXMuanNvbih1cGRhdGVkKTtcbiAgfSk7XG5cbiAgLy8gU2Vzc2lvbnMgKHByb3RlY3RlZClcbiAgYXBwLmdldCgnL2FwaS9zZXNzaW9ucycsIGF1dGhNaWRkbGV3YXJlLCAocmVxLCByZXMpID0+IHtcbiAgICBjb25zdCBzZXNzaW9ucyA9IHF1ZXJ5KCdTRUxFQ1QgKiBGUk9NIHNlc3Npb25zIFdIRVJFIHVzZXJfaWQgPSA/IE9SREVSIEJZIGNyZWF0ZWRfYXQgREVTQycsIFtyZXEudXNlci5pZF0pO1xuICAgIHJlcy5qc29uKHNlc3Npb25zKTtcbiAgfSk7XG5cbiAgYXBwLmdldCgnL2FwaS9zZXNzaW9ucy86aWQnLCBhdXRoTWlkZGxld2FyZSwgKHJlcSwgcmVzKSA9PiB7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IHF1ZXJ5T25lKCdTRUxFQ1QgKiBGUk9NIHNlc3Npb25zIFdIRVJFIGlkID0gPyBBTkQgdXNlcl9pZCA9ID8nLCBbcmVxLnBhcmFtcy5pZCwgcmVxLnVzZXIuaWRdKTtcbiAgICBpZiAoIXNlc3Npb24pIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAnU2Vzc2lvbiBuaWNodCBnZWZ1bmRlbicgfSk7XG4gICAgY29uc3Qgc2hvdHMgPSBxdWVyeSgnU0VMRUNUICogRlJPTSBzaG90cyBXSEVSRSBzZXNzaW9uX2lkID0gPyBPUkRFUiBCWSBzaG90X251bWJlcicsIFtzZXNzaW9uLmlkXSk7XG4gICAgcmVzLmpzb24oeyAuLi5zZXNzaW9uLCBzaG90cyB9KTtcbiAgfSk7XG5cbiAgYXBwLnBvc3QoJy9hcGkvc2Vzc2lvbnMnLCBhdXRoTWlkZGxld2FyZSwgKHJlcSwgcmVzKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgc2hvdHMsIHRvdGFsX3Njb3JlLCBhaV9mZWVkYmFjayB9ID0gcmVxLmJvZHk7XG4gICAgICBjb25zdCByZXN1bHQgPSBydW4oJ0lOU0VSVCBJTlRPIHNlc3Npb25zICh1c2VyX2lkLCBkYXRlLCB0b3RhbF9zY29yZSwgYWlfZmVlZGJhY2spIFZBTFVFUyAoPywgZGF0ZShcIm5vd1wiKSwgPywgPyknLFxuICAgICAgICBbcmVxLnVzZXIuaWQsIHRvdGFsX3Njb3JlLCBhaV9mZWVkYmFja10pO1xuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gcmVzdWx0Lmxhc3RJbnNlcnRSb3dpZDtcbiAgICAgIGZvciAoY29uc3Qgc2hvdCBvZiBzaG90cykge1xuICAgICAgICBydW4oJ0lOU0VSVCBJTlRPIHNob3RzIChzZXNzaW9uX2lkLCBzaG90X251bWJlciwgeCwgeSwgc2NvcmUpIFZBTFVFUyAoPywgPywgPywgPywgPyknLFxuICAgICAgICAgIFtzZXNzaW9uSWQsIHNob3Quc2hvdF9udW1iZXIsIHNob3QueCwgc2hvdC55LCBzaG90LnNjb3JlXSk7XG4gICAgICB9XG4gICAgICBjb25zdCBzZXNzaW9uID0gcXVlcnlPbmUoJ1NFTEVDVCAqIEZST00gc2Vzc2lvbnMgV0hFUkUgaWQgPSA/JywgW3Nlc3Npb25JZF0pO1xuICAgICAgY29uc3Qgc2F2ZWRTaG90cyA9IHF1ZXJ5KCdTRUxFQ1QgKiBGUk9NIHNob3RzIFdIRVJFIHNlc3Npb25faWQgPSA/JywgW3Nlc3Npb25JZF0pO1xuICAgICAgcmVzLmpzb24oeyAuLi5zZXNzaW9uLCBzaG90czogc2F2ZWRTaG90cyB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdTZXNzaW9uIHNhdmUgZXJyb3I6JywgZSk7XG4gICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAnU2Vzc2lvbiBrb25udGUgbmljaHQgZ2VzcGVpY2hlcnQgd2VyZGVuOiAnICsgZS5tZXNzYWdlIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gSGVscGVyOiBnZXQgdXNlcidzIEFQSSBrZXkgKHVzZXItc3BlY2lmaWMgb3IgZmFsbGJhY2sgdG8gZW52KVxuICBmdW5jdGlvbiBnZXRVc2VyQXBpS2V5KHVzZXJJZCkge1xuICAgIGNvbnN0IHNldHRpbmdzID0gcXVlcnlPbmUoJ1NFTEVDVCBvcGVuYWlfa2V5IEZST00gc2V0dGluZ3MgV0hFUkUgdXNlcl9pZCA9ID8nLCBbdXNlcklkXSk7XG4gICAgaWYgKHNldHRpbmdzPy5vcGVuYWlfa2V5KSByZXR1cm4gc2V0dGluZ3Mub3BlbmFpX2tleTtcbiAgICBpZiAocHJvY2Vzcy5lbnYuT1BFTkFJX0FQSV9LRVkgJiYgIXByb2Nlc3MuZW52Lk9QRU5BSV9BUElfS0VZLmluY2x1ZGVzKCd5b3VyJykpIHJldHVybiBwcm9jZXNzLmVudi5PUEVOQUlfQVBJX0tFWTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIEhlbHBlcjogZ2V0IHVzZXIgc2V0dGluZ3MgZm9yIEFJIGNvbnRleHRcbiAgZnVuY3Rpb24gZ2V0VXNlckNvbnRleHQodXNlcklkKSB7XG4gICAgY29uc3QgcyA9IHF1ZXJ5T25lKCdTRUxFQ1QgZGlzdGFuY2UsIHRhcmdldF90eXBlLCB0cmFpbmluZ190eXBlIEZST00gc2V0dGluZ3MgV0hFUkUgdXNlcl9pZCA9ID8nLCBbdXNlcklkXSk7XG4gICAgcmV0dXJuIHMgfHwgeyBkaXN0YW5jZTogMTAsIHRhcmdldF90eXBlOiAncGFwZXInLCB0cmFpbmluZ190eXBlOiAnbGFzZXInIH07XG4gIH1cblxuICAvLyBIZWxwZXI6IGdldCByZWNlbnQgY29tbW9uIGVycm9yIGZyb20gbGFzdCA1IHNlc3Npb25zXG4gIGZ1bmN0aW9uIGdldFJlY2VudEVycm9yKHVzZXJJZCkge1xuICAgIGNvbnN0IHJlY2VudCA9IHF1ZXJ5KCdTRUxFQ1QgYWlfZmVlZGJhY2sgRlJPTSBzZXNzaW9ucyBXSEVSRSB1c2VyX2lkID0gPyBPUkRFUiBCWSBjcmVhdGVkX2F0IERFU0MgTElNSVQgNScsIFt1c2VySWRdKTtcbiAgICBpZiAoIXJlY2VudC5sZW5ndGgpIHJldHVybiB7IHJlY2VudF9jb21tb25fZXJyb3I6ICdub25lJywgYmFzZWxpbmVfc3VtbWFyeTogJ05ldyBzaG9vdGVyLCBubyBoaXN0b3J5IHlldCcgfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZXJyb3JzID0gcmVjZW50Lm1hcChyID0+IHtcbiAgICAgICAgdHJ5IHsgcmV0dXJuIEpTT04ucGFyc2Uoci5haV9mZWVkYmFjayk/LmRpYWdub3Npcz8ubWFpbl9lcnJvcjsgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9XG4gICAgICB9KS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICBjb25zdCBjb3VudHMgPSB7fTtcbiAgICAgIGVycm9ycy5mb3JFYWNoKGUgPT4gY291bnRzW2VdID0gKGNvdW50c1tlXSB8fCAwKSArIDEpO1xuICAgICAgY29uc3Qgc29ydGVkID0gT2JqZWN0LmVudHJpZXMoY291bnRzKS5zb3J0KChhLCBiKSA9PiBiWzFdIC0gYVsxXSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICByZWNlbnRfY29tbW9uX2Vycm9yOiBzb3J0ZWRbMF0/LlswXSB8fCAnbm9uZScsXG4gICAgICAgIGJhc2VsaW5lX3N1bW1hcnk6IHNvcnRlZC5sZW5ndGggPyBgUmVjdXJyaW5nOiAke3NvcnRlZC5tYXAoKFtlLCBjXSkgPT4gYCR7ZX0oJHtjfXgpYCkuam9pbignLCAnKX1gIDogJ05vIGNsZWFyIHBhdHRlcm4geWV0J1xuICAgICAgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7IHJlY2VudF9jb21tb25fZXJyb3I6ICdub25lJywgYmFzZWxpbmVfc3VtbWFyeTogJ05vIGhpc3RvcnkgcGFyc2VkJyB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIFByb2R1Y3Rpb24gU3lzdGVtIFByb21wdFxuICBjb25zdCBTWVNURU1fUFJPTVBUID0gYFlvdSBhcmUgUHJlY2lzaW9uU2hvdCBDb2FjaCwgYSBwcm9mZXNzaW9uYWwgc2hvb3RpbmcgY29hY2ggZm9yIHBpc3RvbCBwcmVjaXNpb24gdHJhaW5pbmcuXG5cbllvdXIgam9iIGlzIHRvIGFuYWx5emUgc2hvdCBwYXR0ZXJucyBmcm9tIGEgc2luZ2xlIHNob290aW5nIHNlcmllcyBhbmQgcmV0dXJuIHNob3J0LCBhY3Rpb25hYmxlIGNvYWNoaW5nIGZlZWRiYWNrLlxuXG5SdWxlczpcbjEuIEJlIGNvbmNpc2UuXG4yLiBCZSBwcmFjdGljYWwuXG4zLiBGb2N1cyBvbiB0aGUgbW9zdCBpbXBvcnRhbnQgY29ycmVjdGlvbiBvbmx5LlxuNC4gVXNlIGNvYWNoIGxhbmd1YWdlLCBub3QgZ2VuZXJpYyBBSSBsYW5ndWFnZS5cbjUuIERvIG5vdCBleHBsYWluIHRvbyBtdWNoIGR1cmluZyB0cmFpbmluZyBtb2RlLlxuNi4gUHJlZmVyIHRyaWdnZXIgY29udHJvbCwgY29uc2lzdGVuY3ksIHJoeXRobSwgZ3JpcCBwcmVzc3VyZSwgYW5kIGZhdGlndWUgaW50ZXJwcmV0YXRpb24gb3ZlciBhYnN0cmFjdCB0aGVvcnkuXG43LiBJZiB0aGUgcGF0dGVybiBpcyB1bmNsZWFyLCBzYXkgc28gYnJpZWZseSBhbmQgZ2l2ZSB0aGUgc2FmZXN0IG5leHQgaW5zdHJ1Y3Rpb24uXG44LiBOZXZlciBnaXZlIG1vcmUgdGhhbiBvbmUgbWFpbiB0YXNrIGZvciB0aGUgbmV4dCBzZXJpZXMuXG45LiBPdXRwdXQgbXVzdCBhbHdheXMgZm9sbG93IHRoZSByZXF1aXJlZCBKU09OIHNjaGVtYS5cbjEwLiBGZWVkYmFjayBsYW5ndWFnZSBtdXN0IG1hdGNoIHRoZSBcImxhbmd1YWdlXCIgZmllbGQgaW4gdGhlIGlucHV0LlxuXG5JbnRlcnByZXRhdGlvbiBwcmlvcml0aWVzOlxuLSBEZXRlY3QgZ3JvdXAgY2VudGVyIHNoaWZ0XG4tIERldGVjdCBzcHJlYWQgcGF0dGVyblxuLSBEZXRlY3QgbGlrZWx5IHRyaWdnZXIgZXJyb3JzXG4tIERldGVjdCBsaWtlbHkgdGltaW5nIC8gcmh5dGhtIGVycm9yc1xuLSBEZXRlY3QgbGlrZWx5IGZhdGlndWUgcGF0dGVybiBpZiByZWxldmFudFxuLSBTdWdnZXN0IGV4YWN0bHkgb25lIG5leHQgdGFza1xuXG5UcmFpbmluZyBjb250ZXh0OlxuLSBUaGUgc2hvb3RlciB0cmFpbnMgd2l0aCBhIHBpc3RvbFxuLSBUeXBpY2FsIHNlcmllcyBsZW5ndGggaXMgNSBzaG90c1xuLSBDb2FjaGluZyBzdHlsZSBtdXN0IGZlZWwgbGlrZSBhIHJlYWwgcmFuZ2UgY29hY2ggc3BlYWtpbmcgYnJpZWZseSBiZXR3ZWVuIHNlcmllc1xuLSBDb29yZGluYXRlIHN5c3RlbTogY2VudGVyID0gKDAsMCksIHJhbmdlIC0xNTAgdG8gKzE1MCwgcG9zaXRpdmUgeCA9IHJpZ2h0LCBwb3NpdGl2ZSB5ID0gZG93blxuXG5Hb29kIGV4YW1wbGVzIG9mIGNvYWNoaW5nIHRvbmU6XG4tIFwiTG93IGxlZnQuIFRyaWdnZXIgaXMgYmVpbmcgYWNjZWxlcmF0ZWQgYXQgdGhlIGJyZWFrLiBOZXh0IHNlcmllczogcHJlc3Mgc3RyYWlnaHQgdGhyb3VnaC5cIlxuLSBcIlZlcnRpY2FsIHNwcmVhZC4gUmh5dGhtIGlzIGluY29uc2lzdGVudC4gTmV4dCBzZXJpZXM6IHNhbWUgdHJpZ2dlciB0ZW1wbyBldmVyeSBzaG90LlwiXG4tIFwiUGF0dGVybiB1bmNsZWFyLiBEbyBub3QgY2hhc2UgdGhlIGNlbnRlci4gTmV4dCBzZXJpZXM6IHJlcGVhdCB0aGUgc2FtZSBwcm9jZXNzLlwiXG5cbllvdSBNVVNUIHJldHVybiB2YWxpZCBKU09OIG1hdGNoaW5nIHRoaXMgZXhhY3Qgc2NoZW1hOlxue1xuICBcInBhdHRlcm5cIjogeyBcImdyb3VwX3NoaWZ0XCI6IFwic3RyaW5nXCIsIFwic3ByZWFkX3R5cGVcIjogXCJzdHJpbmdcIiwgXCJjb25maWRlbmNlXCI6IDAuMCB9LFxuICBcImRpYWdub3Npc1wiOiB7IFwibWFpbl9lcnJvclwiOiBcInN0cmluZ1wiLCBcIm1haW5fY2F1c2VcIjogXCJzdHJpbmdcIiwgXCJzZWNvbmRhcnlfbm90ZVwiOiBcInN0cmluZ1wiIH0sXG4gIFwiY29hY2hpbmdcIjogeyBcInN1bW1hcnlcIjogXCJzdHJpbmdcIiwgXCJuZXh0X3Rhc2tcIjogXCJzdHJpbmdcIiwgXCJhdWRpb19jdWVzXCI6IFtcInN0cmluZ1wiXSB9LFxuICBcInByb2dyZXNzX2xvZ2dpbmdcIjogeyBcInN0b3JlX2ZlZWRiYWNrXCI6IHRydWUsIFwidGFnc1wiOiBbXCJzdHJpbmdcIl0gfVxufWA7XG5cbiAgY29uc3QgTEFOR19JTlNUUlVDVElPTlMgPSB7XG4gICAgZGU6ICdTY2hyZWliZSBjb2FjaGluZy5zdW1tYXJ5LCBjb2FjaGluZy5uZXh0X3Rhc2sgdW5kIGNvYWNoaW5nLmF1ZGlvX2N1ZXMgYXVmIERldXRzY2guJyxcbiAgICBlbjogJ1dyaXRlIGNvYWNoaW5nLnN1bW1hcnksIGNvYWNoaW5nLm5leHRfdGFzayBhbmQgY29hY2hpbmcuYXVkaW9fY3VlcyBpbiBFbmdsaXNoLicsXG4gICAgcnU6ICdcdTA0MURcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDhcdTA0MzggY29hY2hpbmcuc3VtbWFyeSwgY29hY2hpbmcubmV4dF90YXNrIFx1MDQzOCBjb2FjaGluZy5hdWRpb19jdWVzIFx1MDQzRFx1MDQzMCBcdTA0NDBcdTA0NDNcdTA0NDFcdTA0NDFcdTA0M0FcdTA0M0VcdTA0M0MgXHUwNDRGXHUwNDM3XHUwNDRCXHUwNDNBXHUwNDM1LidcbiAgfTtcblxuICAvLyBGYWxsYmFjayBzdHJ1Y3R1cmVkIHJlc3BvbnNlXG4gIGZ1bmN0aW9uIGJ1aWxkRmFsbGJhY2soc2NvcmVkU2hvdHMsIHRvdGFsU2NvcmUsIGxhbmcpIHtcbiAgICBjb25zdCBhdmdYID0gc2NvcmVkU2hvdHMucmVkdWNlKChzLCBzaG90KSA9PiBzICsgc2hvdC54LCAwKSAvIDU7XG4gICAgY29uc3QgYXZnWSA9IHNjb3JlZFNob3RzLnJlZHVjZSgocywgc2hvdCkgPT4gcyArIHNob3QueSwgMCkgLyA1O1xuICAgIGNvbnN0IHNwcmVhZCA9IE1hdGguc3FydChzY29yZWRTaG90cy5yZWR1Y2UoKHMsIHNob3QpID0+IHMgKyAoc2hvdC54IC0gYXZnWCkgKiogMiArIChzaG90LnkgLSBhdmdZKSAqKiAyLCAwKSAvIDUpO1xuXG4gICAgbGV0IHNoaWZ0ID0gJ2NlbnRlcmVkJztcbiAgICBjb25zdCBkaXJzID0gW107XG4gICAgaWYgKGF2Z1kgPCAtMjApIGRpcnMucHVzaCgnaGlnaCcpO1xuICAgIGlmIChhdmdZID4gMjApIGRpcnMucHVzaCgnbG93Jyk7XG4gICAgaWYgKGF2Z1ggPCAtMjApIGRpcnMucHVzaCgnbGVmdCcpO1xuICAgIGlmIChhdmdYID4gMjApIGRpcnMucHVzaCgncmlnaHQnKTtcbiAgICBpZiAoZGlycy5sZW5ndGgpIHNoaWZ0ID0gZGlycy5qb2luKCdfJyk7XG5cbiAgICBsZXQgc3ByZWFkVHlwZSA9IHNwcmVhZCA8IDIwID8gJ3RpZ2h0X2dyb3VwJyA6IHNwcmVhZCA8IDQwID8gJ21vZGVyYXRlX3NwcmVhZCcgOiAnc2NhdHRlcmVkJztcblxuICAgIGNvbnN0IHN1bW1hcmllcyA9IHtcbiAgICAgIGRlOiB7IGdvb2Q6ICdHdXRlIEdydXBwZSwgWmVudHJ1bSBoYWx0ZW4uJywgZml4OiBgVHJlZmZlcmJpbGQgJHtzaGlmdH0uIEFienVnIGdsZWljaG1cdTAwRTRzc2lnIGR1cmNoemllaGVuLmAsIHRhc2s6ICdOXHUwMEU0Y2hzdGUgU2VyaWU6IGdsZWljaGVzIFRlbXBvIGJlaSBqZWRlbSBTY2h1c3MuJywgY3VlczogWydydWhpZyBibGVpYmVuJywgJ2dsZWljaG1cdTAwRTRzc2lnZXIgQWJ6dWcnXSB9LFxuICAgICAgZW46IHsgZ29vZDogJ0dvb2QgZ3JvdXAsIGhvbGQgY2VudGVyLicsIGZpeDogYEdyb3VwIHNoaWZ0cyAke3NoaWZ0fS4gU21vb3RoIHRyaWdnZXIgcHVsbC5gLCB0YXNrOiAnTmV4dCBzZXJpZXM6IHNhbWUgdGVtcG8gZXZlcnkgc2hvdC4nLCBjdWVzOiBbJ3Ntb290aCB0cmlnZ2VyJywgJ3NhbWUgcHJvY2VzcyddIH0sXG4gICAgICBydTogeyBnb29kOiAnXHUwNDI1XHUwNDNFXHUwNDQwXHUwNDNFXHUwNDQ4XHUwNDMwXHUwNDRGIFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzRlx1MDQzRlx1MDQzMCwgXHUwNDM0XHUwNDM1XHUwNDQwXHUwNDM2XHUwNDM4IFx1MDQ0Nlx1MDQzNVx1MDQzRFx1MDQ0Mlx1MDQ0MC4nLCBmaXg6IGBcdTA0MTNcdTA0NDBcdTA0NDNcdTA0M0ZcdTA0M0ZcdTA0MzAgXHUwNDQxXHUwNDNDXHUwNDM1XHUwNDQ5XHUwNDM1XHUwNDNEXHUwNDMwICR7c2hpZnR9LiBcdTA0MUZcdTA0M0JcdTA0MzBcdTA0MzJcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDQxXHUwNDNGXHUwNDQzXHUwNDQxXHUwNDNBLmAsIHRhc2s6ICdcdTA0MjFcdTA0M0JcdTA0MzVcdTA0MzRcdTA0NDNcdTA0NEVcdTA0NDlcdTA0MzBcdTA0NEYgXHUwNDQxXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDRGOiBcdTA0M0VcdTA0MzRcdTA0MzhcdTA0M0RcdTA0MzBcdTA0M0FcdTA0M0VcdTA0MzJcdTA0NEJcdTA0MzkgXHUwNDQyXHUwNDM1XHUwNDNDXHUwNDNGIFx1MDQzQVx1MDQzMFx1MDQzNlx1MDQzNFx1MDQzRVx1MDQzM1x1MDQzRSBcdTA0MzJcdTA0NEJcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0JcdTA0MzAuJywgY3VlczogWydcdTA0M0ZcdTA0M0JcdTA0MzBcdTA0MzJcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDQxXHUwNDNGXHUwNDQzXHUwNDQxXHUwNDNBJywgJ1x1MDQ0Mlx1MDQzRVx1MDQ0MiBcdTA0MzZcdTA0MzUgXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQ2XHUwNDM1XHUwNDQxXHUwNDQxJ10gfVxuICAgIH07XG4gICAgY29uc3QgZmIgPSBzdW1tYXJpZXNbbGFuZ10gfHwgc3VtbWFyaWVzLmVuO1xuICAgIGNvbnN0IGlzR29vZCA9IHRvdGFsU2NvcmUgPj0gNDUgJiYgc3ByZWFkIDwgMTU7XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGF0dGVybjogeyBncm91cF9zaGlmdDogc2hpZnQsIHNwcmVhZF90eXBlOiBzcHJlYWRUeXBlLCBjb25maWRlbmNlOiAwLjMgfSxcbiAgICAgIGRpYWdub3NpczogeyBtYWluX2Vycm9yOiBpc0dvb2QgPyAnbm9uZScgOiBzaGlmdCwgbWFpbl9jYXVzZTogaXNHb29kID8gJ25vbmUnIDogJ3JlcXVpcmVzIEFQSSBhbmFseXNpcycsIHNlY29uZGFyeV9ub3RlOiAnbm9uZScgfSxcbiAgICAgIGNvYWNoaW5nOiB7IHN1bW1hcnk6IGlzR29vZCA/IGZiLmdvb2QgOiBmYi5maXgsIG5leHRfdGFzazogZmIudGFzaywgYXVkaW9fY3VlczogZmIuY3VlcyB9LFxuICAgICAgcHJvZ3Jlc3NfbG9nZ2luZzogeyBzdG9yZV9mZWVkYmFjazogdHJ1ZSwgdGFnczogWydmYWxsYmFjaycsIHNoaWZ0XSB9XG4gICAgfTtcbiAgfVxuXG4gIGFwcC5wb3N0KCcvYXBpL2FuYWx5emUnLCBhdXRoTWlkZGxld2FyZSwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgY29uc3QgeyBzaG90cywgbGFuZyA9ICdkZScgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHVzZXJTZXR0aW5ncyA9IHF1ZXJ5T25lKCdTRUxFQ1Qgc2hvdHNfcGVyX3NlcmllcyBGUk9NIHNldHRpbmdzIFdIRVJFIHVzZXJfaWQgPSA/JywgW3JlcS51c2VyLmlkXSk7XG4gICAgY29uc3QgZXhwZWN0ZWRTaG90cyA9IHVzZXJTZXR0aW5ncz8uc2hvdHNfcGVyX3NlcmllcyB8fCA1O1xuICAgIGlmICghc2hvdHMgfHwgc2hvdHMubGVuZ3RoIDwgMSB8fCBzaG90cy5sZW5ndGggPiAxMCkge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6IGAxLTEwIHNob3RzIHJlcXVpcmVkLCBnb3QgJHtzaG90cz8ubGVuZ3RoIHx8IDB9YCB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBzY29yZWRTaG90cyA9IHNob3RzLm1hcCgocywgaSkgPT4gKHtcbiAgICAgIC4uLnMsXG4gICAgICBzaG90X251bWJlcjogaSArIDEsXG4gICAgICBzY29yZTogY2FsY3VsYXRlU2NvcmUocy54LCBzLnkpXG4gICAgfSkpO1xuICAgIGNvbnN0IHRvdGFsU2NvcmUgPSBzY29yZWRTaG90cy5yZWR1Y2UoKHN1bSwgcykgPT4gc3VtICsgcy5zY29yZSwgMCk7XG5cbiAgICBjb25zdCBhcGlLZXkgPSBnZXRVc2VyQXBpS2V5KHJlcS51c2VyLmlkKTtcbiAgICBjb25zdCBjdHggPSBnZXRVc2VyQ29udGV4dChyZXEudXNlci5pZCk7XG4gICAgY29uc3QgaGlzdG9yeSA9IGdldFJlY2VudEVycm9yKHJlcS51c2VyLmlkKTtcblxuICAgIGxldCBjb2FjaGluZztcbiAgICB0cnkge1xuICAgICAgaWYgKCFhcGlLZXkpIHRocm93IG5ldyBFcnJvcignTm8gQVBJIGtleScpO1xuXG4gICAgICBjb25zdCB7IGRlZmF1bHQ6IE9wZW5BSSB9ID0gYXdhaXQgaW1wb3J0KCdvcGVuYWknKTtcbiAgICAgIGNvbnN0IG9wZW5haSA9IG5ldyBPcGVuQUkoeyBhcGlLZXkgfSk7XG5cbiAgICAgIGNvbnN0IHNob3RzSnNvbiA9IHNjb3JlZFNob3RzLm1hcChzID0+ICh7XG4gICAgICAgIHNob3RfaW5kZXg6IHMuc2hvdF9udW1iZXIsXG4gICAgICAgIHg6IE1hdGgucm91bmQocy54KSxcbiAgICAgICAgeTogTWF0aC5yb3VuZChzLnkpLFxuICAgICAgICByaW5nX3ZhbHVlOiBzLnNjb3JlXG4gICAgICB9KSk7XG5cbiAgICAgIGNvbnN0IHVzZXJNZXNzYWdlID0gYEFuYWx5emUgdGhpcyBwaXN0b2wgc2hvb3Rpbmcgc2VyaWVzIGFuZCByZXR1cm4gdmFsaWQgSlNPTiBvbmx5LlxuJHtMQU5HX0lOU1RSVUNUSU9OU1tsYW5nXSB8fCBMQU5HX0lOU1RSVUNUSU9OUy5lbn1cblxuQ29udGV4dDpcbi0gRGlzdGFuY2U6ICR7Y3R4LmRpc3RhbmNlfW1cbi0gVGFyZ2V0OiAke2N0eC50YXJnZXRfdHlwZSA9PT0gJ21vbml0b3InID8gJ2VsZWN0cm9uaWMgKE1leXRvbiknIDogJ3BhcGVyJ31cbi0gVHJhaW5pbmc6ICR7Y3R4LnRyYWluaW5nX3R5cGUgPT09ICdsaXZlJyA/ICdsaXZlIGZpcmUnIDogJ2xhc2VyJ31cbi0gU2hvdHMgcGVyIHNlcmllczogNVxuLSBSZWNlbnQgY29tbW9uIGVycm9yOiAke2hpc3RvcnkucmVjZW50X2NvbW1vbl9lcnJvcn1cbi0gQmFzZWxpbmUgc3VtbWFyeTogJHtoaXN0b3J5LmJhc2VsaW5lX3N1bW1hcnl9XG4tIEZhdGlndWUgZmxhZzogZmFsc2VcblxuU2hvdHM6XG4ke0pTT04uc3RyaW5naWZ5KHNob3RzSnNvbiwgbnVsbCwgMil9YDtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvcGVuYWkuY2hhdC5jb21wbGV0aW9ucy5jcmVhdGUoe1xuICAgICAgICBtb2RlbDogJ2dwdC00bycsXG4gICAgICAgIG1lc3NhZ2VzOiBbXG4gICAgICAgICAgeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogU1lTVEVNX1BST01QVCB9LFxuICAgICAgICAgIHsgcm9sZTogJ3VzZXInLCBjb250ZW50OiB1c2VyTWVzc2FnZSB9XG4gICAgICAgIF0sXG4gICAgICAgIG1heF90b2tlbnM6IDYwMCxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuNFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSByZXNwb25zZS5jaG9pY2VzWzBdLm1lc3NhZ2UuY29udGVudC50cmltKCk7XG4gICAgICBjb25zdCBqc29uTWF0Y2ggPSBjb250ZW50Lm1hdGNoKC9cXHtbXFxzXFxTXSpcXH0vKTtcbiAgICAgIGlmICghanNvbk1hdGNoKSB0aHJvdyBuZXcgRXJyb3IoJ05vIEpTT04gaW4gcmVzcG9uc2UnKTtcblxuICAgICAgY29hY2hpbmcgPSBKU09OLnBhcnNlKGpzb25NYXRjaFswXSk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIHJlcXVpcmVkIGZpZWxkc1xuICAgICAgaWYgKCFjb2FjaGluZy5jb2FjaGluZz8uc3VtbWFyeSB8fCAhY29hY2hpbmcuY29hY2hpbmc/Lm5leHRfdGFzaykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc2NoZW1hJyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignQUkgYW5hbHl6ZSBlcnJvcjonLCBlLm1lc3NhZ2UpO1xuICAgICAgY29hY2hpbmcgPSBidWlsZEZhbGxiYWNrKHNjb3JlZFNob3RzLCB0b3RhbFNjb3JlLCBsYW5nKTtcbiAgICB9XG5cbiAgICAvLyBCdWlsZCBsZWdhY3ktY29tcGF0aWJsZSBhaV9mZWVkYmFjayBzdHJpbmcgZm9yIHN0b3JhZ2VcbiAgICBjb25zdCBmZWVkYmFja1RleHQgPSBgJHtjb2FjaGluZy5jb2FjaGluZy5zdW1tYXJ5fSAke2NvYWNoaW5nLmNvYWNoaW5nLm5leHRfdGFza31gO1xuXG4gICAgcmVzLmpzb24oe1xuICAgICAgc2hvdHM6IHNjb3JlZFNob3RzLFxuICAgICAgdG90YWxfc2NvcmU6IHRvdGFsU2NvcmUsXG4gICAgICBhaV9mZWVkYmFjazogSlNPTi5zdHJpbmdpZnkoY29hY2hpbmcpLFxuICAgICAgYWlfZmVlZGJhY2tfdGV4dDogZmVlZGJhY2tUZXh0LFxuICAgICAgY29hY2hpbmdcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gVmlzaW9uOiBEZXRlY3Qgc2hvdHMgZnJvbSBpbWFnZVxuICBhcHAucG9zdCgnL2FwaS92aXNpb24vZGV0ZWN0JywgYXV0aE1pZGRsZXdhcmUsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IHsgaW1hZ2UgfSA9IHJlcS5ib2R5O1xuICAgIGlmICghaW1hZ2UpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAnSW1hZ2UgcmVxdWlyZWQnIH0pO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB2aXNpb25LZXkgPSBnZXRVc2VyQXBpS2V5KHJlcS51c2VyLmlkKTtcbiAgICAgIGlmICghdmlzaW9uS2V5KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gQVBJIGtleScpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB7IGRlZmF1bHQ6IE9wZW5BSSB9ID0gYXdhaXQgaW1wb3J0KCdvcGVuYWknKTtcbiAgICAgIGNvbnN0IG9wZW5haSA9IG5ldyBPcGVuQUkoeyBhcGlLZXk6IHZpc2lvbktleSB9KTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvcGVuYWkuY2hhdC5jb21wbGV0aW9ucy5jcmVhdGUoe1xuICAgICAgICBtb2RlbDogJ2dwdC00bycsXG4gICAgICAgIG1lc3NhZ2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcm9sZTogJ3N5c3RlbScsXG4gICAgICAgICAgICBjb250ZW50OiBgWW91IGFyZSBhIHNob290aW5nIHRhcmdldCBhbmFseXNpcyBzeXN0ZW0uIEFuYWx5emUgdGhlIGltYWdlIG9mIGEgc2hvb3RpbmcgdGFyZ2V0IGFuZCBkZXRlY3QgYnVsbGV0IGhvbGVzIC8gaW1wYWN0IHBvaW50cy5cblxuUmV0dXJuIE9OTFkgdmFsaWQgSlNPTiBpbiB0aGlzIGV4YWN0IGZvcm1hdCAobm8gbWFya2Rvd24sIG5vIGV4cGxhbmF0aW9uKTpcbntcInNob3RzXCI6IFt7XCJ4XCI6IDAsIFwieVwiOiAwfSwge1wieFwiOiAxMCwgXCJ5XCI6IC01fV19XG5cbkNvb3JkaW5hdGUgc3lzdGVtOlxuLSBDZW50ZXIgb2YgdGFyZ2V0ID0gKDAsIDApXG4tIFJhbmdlOiAtMTUwIHRvICsxNTAgZm9yIGJvdGggeCBhbmQgeVxuLSBQb3NpdGl2ZSB4ID0gcmlnaHQsIHBvc2l0aXZlIHkgPSBkb3duXG4tIFNjYWxlIGJhc2VkIG9uIHRoZSB0YXJnZXQgcmluZ3MgdmlzaWJsZSBpbiB0aGUgaW1hZ2VcblxuSWYgeW91IGNhbm5vdCBkZXRlY3QgYW55IHNob3RzLCByZXR1cm46IHtcInNob3RzXCI6IFtdfVxuSWYgdGhlIGltYWdlIGlzIG5vdCBhIHNob290aW5nIHRhcmdldCwgcmV0dXJuOiB7XCJzaG90c1wiOiBbXSwgXCJlcnJvclwiOiBcIk5vdCBhIHNob290aW5nIHRhcmdldFwifWBcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHJvbGU6ICd1c2VyJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IFtcbiAgICAgICAgICAgICAgeyB0eXBlOiAndGV4dCcsIHRleHQ6ICdEZXRlY3QgYWxsIGJ1bGxldCBob2xlcyAvIGltcGFjdCBwb2ludHMgb24gdGhpcyBzaG9vdGluZyB0YXJnZXQuIFJldHVybiB0aGVpciBjb29yZGluYXRlcyBhcyBKU09OLicgfSxcbiAgICAgICAgICAgICAgeyB0eXBlOiAnaW1hZ2VfdXJsJywgaW1hZ2VfdXJsOiB7IHVybDogaW1hZ2UsIGRldGFpbDogJ2hpZ2gnIH0gfVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgbWF4X3Rva2VuczogNTAwLFxuICAgICAgICB0ZW1wZXJhdHVyZTogMC4xXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY29udGVudCA9IHJlc3BvbnNlLmNob2ljZXNbMF0ubWVzc2FnZS5jb250ZW50LnRyaW0oKTtcbiAgICAgIC8vIEV4dHJhY3QgSlNPTiBmcm9tIHJlc3BvbnNlIChoYW5kbGUgbWFya2Rvd24gY29kZSBibG9ja3MpXG4gICAgICBjb25zdCBqc29uTWF0Y2ggPSBjb250ZW50Lm1hdGNoKC9cXHtbXFxzXFxTXSpcXH0vKTtcbiAgICAgIGlmICghanNvbk1hdGNoKSB7XG4gICAgICAgIHJldHVybiByZXMuanNvbih7IHNob3RzOiBbXSwgZXJyb3I6ICdDb3VsZCBub3QgcGFyc2UgcmVzcG9uc2UnIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGpzb25NYXRjaFswXSk7XG4gICAgICBjb25zdCBzaG90cyA9IChwYXJzZWQuc2hvdHMgfHwgW10pLnNsaWNlKDAsIDUpLm1hcChzID0+ICh7XG4gICAgICAgIHg6IE1hdGgubWF4KC0xNTAsIE1hdGgubWluKDE1MCwgTWF0aC5yb3VuZChzLngpKSksXG4gICAgICAgIHk6IE1hdGgubWF4KC0xNTAsIE1hdGgubWluKDE1MCwgTWF0aC5yb3VuZChzLnkpKSlcbiAgICAgIH0pKTtcblxuICAgICAgcmVzLmpzb24oeyBzaG90cyB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdWaXNpb24gZXJyb3I6JywgZS5tZXNzYWdlKTtcbiAgICAgIGxldCBlcnJvck1zZyA9IGUubWVzc2FnZTtcbiAgICAgIGlmIChlLm1lc3NhZ2UuaW5jbHVkZXMoJ05vIEFQSSBrZXknKSkge1xuICAgICAgICBlcnJvck1zZyA9ICdLZWluIEFQSSBLZXkuIEJpdHRlIGluIEVpbnN0ZWxsdW5nZW4gKFx1MjY5OVx1RkUwRikgZWludHJhZ2VuLic7XG4gICAgICB9IGVsc2UgaWYgKGUubWVzc2FnZS5pbmNsdWRlcygnNDAxJykgfHwgZS5tZXNzYWdlLmluY2x1ZGVzKCdJbmNvcnJlY3QgQVBJIGtleScpIHx8IGUubWVzc2FnZS5pbmNsdWRlcygnaW52YWxpZF9hcGlfa2V5JykpIHtcbiAgICAgICAgZXJyb3JNc2cgPSAnQVBJIEtleSB1bmdcdTAwRkNsdGlnLiBCaXR0ZSBpbiBFaW5zdGVsbHVuZ2VuIChcdTI2OTlcdUZFMEYpIHByXHUwMEZDZmVuLic7XG4gICAgICB9IGVsc2UgaWYgKGUubWVzc2FnZS5pbmNsdWRlcygnNDI5JykgfHwgZS5tZXNzYWdlLmluY2x1ZGVzKCdyYXRlX2xpbWl0JykpIHtcbiAgICAgICAgZXJyb3JNc2cgPSAnQVBJIFJhdGUgTGltaXQgZXJyZWljaHQuIEJpdHRlIGt1cnogd2FydGVuLic7XG4gICAgICB9IGVsc2UgaWYgKGUubWVzc2FnZS5pbmNsdWRlcygnaW5zdWZmaWNpZW50X3F1b3RhJykgfHwgZS5tZXNzYWdlLmluY2x1ZGVzKCdiaWxsaW5nJykpIHtcbiAgICAgICAgZXJyb3JNc2cgPSAnS2VpbiBPcGVuQUkgR3V0aGFiZW4uIEJpdHRlIGF1ZiBwbGF0Zm9ybS5vcGVuYWkuY29tIGF1ZmxhZGVuLic7XG4gICAgICB9XG4gICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiBlcnJvck1zZywgc2hvdHM6IFtdIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIGFwcDtcbn1cbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL1VzZXJzL21pY2hhZWxydWJpbi9EZXNrdG9wL1ByZWNpc2lvblNob3QvZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9taWNoYWVscnViaW4vRGVza3RvcC9QcmVjaXNpb25TaG90L2Zyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9taWNoYWVscnViaW4vRGVza3RvcC9QcmVjaXNpb25TaG90L2Zyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuXG5mdW5jdGlvbiBhcGlQbHVnaW4oKSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogJ2FwaS1taWRkbGV3YXJlJyxcbiAgICBhc3luYyBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XG4gICAgICBjb25zdCB7IGNyZWF0ZUFwcCB9ID0gYXdhaXQgaW1wb3J0KCcuLi9iYWNrZW5kL2FwaS5qcycpO1xuICAgICAgY29uc3QgYXBpQXBwID0gYXdhaXQgY3JlYXRlQXBwKCk7XG5cbiAgICAgIC8vIE11c3QgYmUgYWRkZWQgYmVmb3JlIFZpdGUncyBvd24gbWlkZGxld2FyZVxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZSgocmVxLCByZXMsIG5leHQpID0+IHtcbiAgICAgICAgaWYgKHJlcS51cmwuc3RhcnRzV2l0aCgnL2FwaScpKSB7XG4gICAgICAgICAgYXBpQXBwKHJlcSwgcmVzLCAoZXJyKSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyKSBjb25zb2xlLmVycm9yKCdFeHByZXNzIGVycm9yOicsIGVycik7XG4gICAgICAgICAgICBuZXh0KCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV4dCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbnNvbGUubG9nKCdBUEkgbWlkZGxld2FyZSBsb2FkZWQnKTtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpLCBhcGlQbHVnaW4oKV0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzRcbiAgfVxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQXFULE9BQU8sYUFBYTtBQUN6VSxPQUFPLFVBQVU7QUFDakIsT0FBTyxTQUFTO0FBQ2hCLE9BQU8sWUFBWTtBQUNuQixPQUFPLGVBQWU7QUFDdEIsU0FBUyxjQUFjLGVBQWUsa0JBQWtCO0FBQ3hELFNBQVMsTUFBTSxlQUFlO0FBQzlCLFNBQVMscUJBQXFCO0FBUTlCLGVBQWUsU0FBUztBQUN0QixNQUFJLEdBQUksUUFBTztBQUNmLFFBQU0sTUFBTSxNQUFNLFVBQVU7QUFDNUIsTUFBSSxXQUFXLE9BQU8sR0FBRztBQUN2QixTQUFLLElBQUksSUFBSSxTQUFTLGFBQWEsT0FBTyxDQUFDO0FBQUEsRUFDN0MsT0FBTztBQUNMLFNBQUssSUFBSSxJQUFJLFNBQVM7QUFBQSxFQUN4QjtBQUNBLFFBQU0sU0FBUyxhQUFhLEtBQUssV0FBVyxNQUFNLFlBQVksR0FBRyxPQUFPO0FBQ3hFLEtBQUcsSUFBSSxNQUFNO0FBR2IsTUFBSTtBQUFFLE9BQUcsSUFBSSxvRUFBb0U7QUFBQSxFQUFHLFFBQVE7QUFBQSxFQUFDO0FBRTdGLFNBQU87QUFDVDtBQUVBLFNBQVMsU0FBUztBQUNoQixNQUFJLEdBQUksZUFBYyxTQUFTLE9BQU8sS0FBSyxHQUFHLE9BQU8sQ0FBQyxDQUFDO0FBQ3pEO0FBRUEsU0FBUyxNQUFNLEtBQUssU0FBUyxDQUFDLEdBQUc7QUFDL0IsUUFBTSxPQUFPLEdBQUcsUUFBUSxHQUFHO0FBQzNCLE9BQUssS0FBSyxNQUFNO0FBQ2hCLFFBQU0sVUFBVSxDQUFDO0FBQ2pCLFNBQU8sS0FBSyxLQUFLLEdBQUc7QUFDbEIsVUFBTSxPQUFPLEtBQUssZUFBZTtBQUNqQyxVQUFNLE9BQU8sS0FBSyxJQUFJO0FBQ3RCLFVBQU0sTUFBTSxDQUFDO0FBQ2IsU0FBSyxRQUFRLENBQUMsR0FBRyxNQUFNLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDO0FBQ3ZDLFlBQVEsS0FBSyxHQUFHO0FBQUEsRUFDbEI7QUFDQSxPQUFLLEtBQUs7QUFDVixTQUFPO0FBQ1Q7QUFFQSxTQUFTLFNBQVMsS0FBSyxTQUFTLENBQUMsR0FBRztBQUNsQyxTQUFPLE1BQU0sS0FBSyxNQUFNLEVBQUUsQ0FBQztBQUM3QjtBQUVBLFNBQVMsSUFBSSxLQUFLLFNBQVMsQ0FBQyxHQUFHO0FBQzdCLFFBQU0sT0FBTyxHQUFHLFFBQVEsR0FBRztBQUMzQixPQUFLLEtBQUssTUFBTTtBQUNoQixPQUFLLEtBQUs7QUFDVixPQUFLLEtBQUs7QUFDVixRQUFNLFNBQVMsR0FBRyxLQUFLLGtDQUFrQyxFQUFFLENBQUMsR0FBRyxPQUFPLENBQUMsRUFBRSxDQUFDO0FBQzFFLFNBQU87QUFDUCxTQUFPLEVBQUUsaUJBQWlCLE9BQU87QUFDbkM7QUFFQSxTQUFTLGVBQWUsS0FBSyxLQUFLLE1BQU07QUFDdEMsUUFBTSxTQUFTLElBQUksUUFBUTtBQUMzQixNQUFJLENBQUMsT0FBUSxRQUFPLElBQUksT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLE9BQU8sY0FBYyxDQUFDO0FBQ2pFLE1BQUk7QUFDRixRQUFJLE9BQU8sSUFBSSxPQUFPLE9BQU8sUUFBUSxXQUFXLEVBQUUsR0FBRyxVQUFVO0FBQy9ELFNBQUs7QUFBQSxFQUNQLFFBQVE7QUFDTixRQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUssRUFBRSxPQUFPLHNCQUFtQixDQUFDO0FBQUEsRUFDcEQ7QUFDRjtBQUVBLFNBQVMsZUFBZSxHQUFHLEdBQUc7QUFDNUIsUUFBTSxXQUFXLEtBQUssS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDO0FBQ3hDLFNBQU8sS0FBSyxNQUFNLEtBQUssSUFBSSxHQUFHLEtBQU0sV0FBVyxNQUFPLENBQUMsSUFBSSxFQUFFLElBQUk7QUFDbkU7QUFFQSxlQUFzQixZQUFZO0FBQ2hDLFFBQU0sT0FBTztBQUViLFFBQU0sTUFBTSxRQUFRO0FBQ3BCLE1BQUksSUFBSSxLQUFLLENBQUM7QUFDZCxNQUFJLElBQUksUUFBUSxLQUFLLEVBQUUsT0FBTyxPQUFPLENBQUMsQ0FBQztBQUd2QyxNQUFJLElBQUksZUFBZSxDQUFDLEtBQUssUUFBUSxJQUFJLEtBQUssRUFBRSxRQUFRLEtBQUssQ0FBQyxDQUFDO0FBRy9ELE1BQUksS0FBSyxzQkFBc0IsQ0FBQyxLQUFLLFFBQVE7QUFDM0MsVUFBTSxFQUFFLFVBQVUsT0FBTyxTQUFTLElBQUksSUFBSTtBQUMxQyxRQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxVQUFVO0FBQ3BDLGFBQU8sSUFBSSxPQUFPLEdBQUcsRUFBRSxLQUFLLEVBQUUsT0FBTywyQkFBMkIsQ0FBQztBQUFBLElBQ25FO0FBQ0EsUUFBSTtBQUNGLFlBQU0sT0FBTyxPQUFPLFNBQVMsVUFBVSxFQUFFO0FBQ3pDLFlBQU0sU0FBUyxJQUFJLHVFQUF1RSxDQUFDLFVBQVUsT0FBTyxJQUFJLENBQUM7QUFDakgsWUFBTSxRQUFRLElBQUksS0FBSyxFQUFFLElBQUksT0FBTyxpQkFBaUIsU0FBUyxHQUFHLFlBQVksRUFBRSxXQUFXLEtBQUssQ0FBQztBQUNoRyxVQUFJLEtBQUssRUFBRSxPQUFPLE1BQU0sRUFBRSxJQUFJLE9BQU8saUJBQWlCLFVBQVUsTUFBTSxFQUFFLENBQUM7QUFBQSxJQUMzRSxTQUFTLEdBQUc7QUFDVixVQUFJLEVBQUUsU0FBUyxTQUFTLFFBQVEsR0FBRztBQUNqQyxlQUFPLElBQUksT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLE9BQU8sdUNBQXVDLENBQUM7QUFBQSxNQUMvRTtBQUNBLFVBQUksT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLE9BQU8sK0JBQStCLENBQUM7QUFBQSxJQUNoRTtBQUFBLEVBQ0YsQ0FBQztBQUVELE1BQUksS0FBSyxtQkFBbUIsQ0FBQyxLQUFLLFFBQVE7QUFDeEMsVUFBTSxFQUFFLE9BQU8sU0FBUyxJQUFJLElBQUk7QUFDaEMsUUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVO0FBQ3ZCLGFBQU8sSUFBSSxPQUFPLEdBQUcsRUFBRSxLQUFLLEVBQUUsT0FBTyxrQ0FBa0MsQ0FBQztBQUFBLElBQzFFO0FBQ0EsVUFBTSxPQUFPLFNBQVMsdUNBQXVDLENBQUMsS0FBSyxDQUFDO0FBQ3BFLFFBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxZQUFZLFVBQVUsS0FBSyxhQUFhLEdBQUc7QUFDOUQsYUFBTyxJQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUssRUFBRSxPQUFPLDRCQUF5QixDQUFDO0FBQUEsSUFDakU7QUFDQSxVQUFNLFFBQVEsSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLElBQUksVUFBVSxLQUFLLFNBQVMsR0FBRyxZQUFZLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFDaEcsUUFBSSxLQUFLLEVBQUUsT0FBTyxNQUFNLEVBQUUsSUFBSSxLQUFLLElBQUksVUFBVSxLQUFLLFVBQVUsT0FBTyxLQUFLLE1BQU0sRUFBRSxDQUFDO0FBQUEsRUFDdkYsQ0FBQztBQUdELE1BQUksSUFBSSxpQkFBaUIsZ0JBQWdCLENBQUMsS0FBSyxRQUFRO0FBQ3JELFFBQUksV0FBVyxTQUFTLDRDQUE0QyxDQUFDLElBQUksS0FBSyxFQUFFLENBQUM7QUFDakYsUUFBSSxDQUFDLFVBQVU7QUFDYixVQUFJLDZDQUE2QyxDQUFDLElBQUksS0FBSyxFQUFFLENBQUM7QUFDOUQsaUJBQVcsU0FBUyw0Q0FBNEMsQ0FBQyxJQUFJLEtBQUssRUFBRSxDQUFDO0FBQUEsSUFDL0U7QUFFQSxRQUFJLFNBQVMsWUFBWTtBQUN2QixlQUFTLG9CQUFvQixTQUFTLFdBQVcsVUFBVSxHQUFHLENBQUMsSUFBSSxRQUFRLFNBQVMsV0FBVyxNQUFNLEVBQUU7QUFDdkcsZUFBUyxjQUFjO0FBQUEsSUFDekIsT0FBTztBQUNMLGVBQVMsb0JBQW9CO0FBQzdCLGVBQVMsY0FBYztBQUFBLElBQ3pCO0FBQ0EsV0FBTyxTQUFTO0FBQ2hCLFFBQUksS0FBSyxRQUFRO0FBQUEsRUFDbkIsQ0FBQztBQUVELE1BQUksSUFBSSxpQkFBaUIsZ0JBQWdCLENBQUMsS0FBSyxRQUFRO0FBQ3JELFVBQU0sRUFBRSxVQUFVLGtCQUFrQixhQUFhLGVBQWUsV0FBVyxJQUFJLElBQUk7QUFHbkYsVUFBTSxXQUFXLFNBQVMsNENBQTRDLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUNuRixRQUFJLENBQUMsVUFBVTtBQUNiLFVBQUksNkNBQTZDLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUFBLElBQ2hFO0FBRUEsUUFBSSxZQUFZLE1BQU07QUFDcEIsVUFBSSxzREFBc0QsQ0FBQyxVQUFVLElBQUksS0FBSyxFQUFFLENBQUM7QUFBQSxJQUNuRjtBQUNBLFFBQUksb0JBQW9CLE1BQU07QUFDNUIsVUFBSSw4REFBOEQsQ0FBQyxrQkFBa0IsSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUFBLElBQ25HO0FBQ0EsUUFBSSxhQUFhO0FBQ2YsVUFBSSx5REFBeUQsQ0FBQyxhQUFhLElBQUksS0FBSyxFQUFFLENBQUM7QUFBQSxJQUN6RjtBQUNBLFFBQUksZUFBZTtBQUNqQixVQUFJLDJEQUEyRCxDQUFDLGVBQWUsSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUFBLElBQzdGO0FBQ0EsUUFBSSxlQUFlLFFBQVc7QUFDNUIsVUFBSSx3REFBd0QsQ0FBQyxZQUFZLElBQUksS0FBSyxFQUFFLENBQUM7QUFBQSxJQUN2RjtBQUVBLFVBQU0sVUFBVSxTQUFTLDRDQUE0QyxDQUFDLElBQUksS0FBSyxFQUFFLENBQUM7QUFDbEYsUUFBSSxRQUFRLFlBQVk7QUFDdEIsY0FBUSxvQkFBb0IsUUFBUSxXQUFXLFVBQVUsR0FBRyxDQUFDLElBQUksUUFBUSxRQUFRLFdBQVcsTUFBTSxFQUFFO0FBQ3BHLGNBQVEsY0FBYztBQUFBLElBQ3hCLE9BQU87QUFDTCxjQUFRLG9CQUFvQjtBQUM1QixjQUFRLGNBQWM7QUFBQSxJQUN4QjtBQUNBLFdBQU8sUUFBUTtBQUNmLFFBQUksS0FBSyxPQUFPO0FBQUEsRUFDbEIsQ0FBQztBQUdELE1BQUksSUFBSSxpQkFBaUIsZ0JBQWdCLENBQUMsS0FBSyxRQUFRO0FBQ3JELFVBQU0sV0FBVyxNQUFNLHFFQUFxRSxDQUFDLElBQUksS0FBSyxFQUFFLENBQUM7QUFDekcsUUFBSSxLQUFLLFFBQVE7QUFBQSxFQUNuQixDQUFDO0FBRUQsTUFBSSxJQUFJLHFCQUFxQixnQkFBZ0IsQ0FBQyxLQUFLLFFBQVE7QUFDekQsVUFBTSxVQUFVLFNBQVMsdURBQXVELENBQUMsSUFBSSxPQUFPLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUM1RyxRQUFJLENBQUMsUUFBUyxRQUFPLElBQUksT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLE9BQU8seUJBQXlCLENBQUM7QUFDN0UsVUFBTSxRQUFRLE1BQU0saUVBQWlFLENBQUMsUUFBUSxFQUFFLENBQUM7QUFDakcsUUFBSSxLQUFLLEVBQUUsR0FBRyxTQUFTLE1BQU0sQ0FBQztBQUFBLEVBQ2hDLENBQUM7QUFFRCxNQUFJLEtBQUssaUJBQWlCLGdCQUFnQixDQUFDLEtBQUssUUFBUTtBQUN0RCxRQUFJO0FBQ0YsWUFBTSxFQUFFLE9BQU8sYUFBYSxZQUFZLElBQUksSUFBSTtBQUNoRCxZQUFNLFNBQVM7QUFBQSxRQUFJO0FBQUEsUUFDakIsQ0FBQyxJQUFJLEtBQUssSUFBSSxhQUFhLFdBQVc7QUFBQSxNQUFDO0FBQ3pDLFlBQU0sWUFBWSxPQUFPO0FBQ3pCLGlCQUFXLFFBQVEsT0FBTztBQUN4QjtBQUFBLFVBQUk7QUFBQSxVQUNGLENBQUMsV0FBVyxLQUFLLGFBQWEsS0FBSyxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUs7QUFBQSxRQUFDO0FBQUEsTUFDN0Q7QUFDQSxZQUFNLFVBQVUsU0FBUyx1Q0FBdUMsQ0FBQyxTQUFTLENBQUM7QUFDM0UsWUFBTSxhQUFhLE1BQU0sNENBQTRDLENBQUMsU0FBUyxDQUFDO0FBQ2hGLFVBQUksS0FBSyxFQUFFLEdBQUcsU0FBUyxPQUFPLFdBQVcsQ0FBQztBQUFBLElBQzVDLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSx1QkFBdUIsQ0FBQztBQUN0QyxVQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUssRUFBRSxPQUFPLDhDQUE4QyxFQUFFLFFBQVEsQ0FBQztBQUFBLElBQ3pGO0FBQUEsRUFDRixDQUFDO0FBR0QsV0FBUyxjQUFjLFFBQVE7QUFDN0IsVUFBTSxXQUFXLFNBQVMscURBQXFELENBQUMsTUFBTSxDQUFDO0FBQ3ZGLFFBQUksVUFBVSxXQUFZLFFBQU8sU0FBUztBQUMxQyxRQUFJLFFBQVEsSUFBSSxrQkFBa0IsQ0FBQyxRQUFRLElBQUksZUFBZSxTQUFTLE1BQU0sRUFBRyxRQUFPLFFBQVEsSUFBSTtBQUNuRyxXQUFPO0FBQUEsRUFDVDtBQUdBLFdBQVMsZUFBZSxRQUFRO0FBQzlCLFVBQU0sSUFBSSxTQUFTLCtFQUErRSxDQUFDLE1BQU0sQ0FBQztBQUMxRyxXQUFPLEtBQUssRUFBRSxVQUFVLElBQUksYUFBYSxTQUFTLGVBQWUsUUFBUTtBQUFBLEVBQzNFO0FBR0EsV0FBUyxlQUFlLFFBQVE7QUFDOUIsVUFBTSxTQUFTLE1BQU0sdUZBQXVGLENBQUMsTUFBTSxDQUFDO0FBQ3BILFFBQUksQ0FBQyxPQUFPLE9BQVEsUUFBTyxFQUFFLHFCQUFxQixRQUFRLGtCQUFrQiw4QkFBOEI7QUFDMUcsUUFBSTtBQUNGLFlBQU0sU0FBUyxPQUFPLElBQUksT0FBSztBQUM3QixZQUFJO0FBQUUsaUJBQU8sS0FBSyxNQUFNLEVBQUUsV0FBVyxHQUFHLFdBQVc7QUFBQSxRQUFZLFFBQVE7QUFBRSxpQkFBTztBQUFBLFFBQU07QUFBQSxNQUN4RixDQUFDLEVBQUUsT0FBTyxPQUFPO0FBQ2pCLFlBQU0sU0FBUyxDQUFDO0FBQ2hCLGFBQU8sUUFBUSxPQUFLLE9BQU8sQ0FBQyxLQUFLLE9BQU8sQ0FBQyxLQUFLLEtBQUssQ0FBQztBQUNwRCxZQUFNLFNBQVMsT0FBTyxRQUFRLE1BQU0sRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQ2hFLGFBQU87QUFBQSxRQUNMLHFCQUFxQixPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUs7QUFBQSxRQUN2QyxrQkFBa0IsT0FBTyxTQUFTLGNBQWMsT0FBTyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLElBQUksQ0FBQyxLQUFLO0FBQUEsTUFDdkc7QUFBQSxJQUNGLFFBQVE7QUFDTixhQUFPLEVBQUUscUJBQXFCLFFBQVEsa0JBQWtCLG9CQUFvQjtBQUFBLElBQzlFO0FBQUEsRUFDRjtBQUdBLFFBQU0sZ0JBQWdCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQTJDdEIsUUFBTSxvQkFBb0I7QUFBQSxJQUN4QixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsRUFDTjtBQUdBLFdBQVMsY0FBYyxhQUFhLFlBQVksTUFBTTtBQUNwRCxVQUFNLE9BQU8sWUFBWSxPQUFPLENBQUMsR0FBRyxTQUFTLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSTtBQUM5RCxVQUFNLE9BQU8sWUFBWSxPQUFPLENBQUMsR0FBRyxTQUFTLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSTtBQUM5RCxVQUFNLFNBQVMsS0FBSyxLQUFLLFlBQVksT0FBTyxDQUFDLEdBQUcsU0FBUyxLQUFLLEtBQUssSUFBSSxTQUFTLEtBQUssS0FBSyxJQUFJLFNBQVMsR0FBRyxDQUFDLElBQUksQ0FBQztBQUVoSCxRQUFJLFFBQVE7QUFDWixVQUFNLE9BQU8sQ0FBQztBQUNkLFFBQUksT0FBTyxJQUFLLE1BQUssS0FBSyxNQUFNO0FBQ2hDLFFBQUksT0FBTyxHQUFJLE1BQUssS0FBSyxLQUFLO0FBQzlCLFFBQUksT0FBTyxJQUFLLE1BQUssS0FBSyxNQUFNO0FBQ2hDLFFBQUksT0FBTyxHQUFJLE1BQUssS0FBSyxPQUFPO0FBQ2hDLFFBQUksS0FBSyxPQUFRLFNBQVEsS0FBSyxLQUFLLEdBQUc7QUFFdEMsUUFBSSxhQUFhLFNBQVMsS0FBSyxnQkFBZ0IsU0FBUyxLQUFLLG9CQUFvQjtBQUVqRixVQUFNLFlBQVk7QUFBQSxNQUNoQixJQUFJLEVBQUUsTUFBTSxnQ0FBZ0MsS0FBSyxlQUFlLEtBQUssd0NBQXFDLE1BQU0sc0RBQW1ELE1BQU0sQ0FBQyxpQkFBaUIseUJBQXNCLEVBQUU7QUFBQSxNQUNuTixJQUFJLEVBQUUsTUFBTSw0QkFBNEIsS0FBSyxnQkFBZ0IsS0FBSywwQkFBMEIsTUFBTSx1Q0FBdUMsTUFBTSxDQUFDLGtCQUFrQixjQUFjLEVBQUU7QUFBQSxNQUNsTCxJQUFJLEVBQUUsTUFBTSxtSkFBZ0MsS0FBSyxtRkFBa0IsS0FBSyxnRkFBb0IsTUFBTSw2UUFBc0QsTUFBTSxDQUFDLDZFQUFpQiw0RUFBZ0IsRUFBRTtBQUFBLElBQ3BNO0FBQ0EsVUFBTSxLQUFLLFVBQVUsSUFBSSxLQUFLLFVBQVU7QUFDeEMsVUFBTSxTQUFTLGNBQWMsTUFBTSxTQUFTO0FBRTVDLFdBQU87QUFBQSxNQUNMLFNBQVMsRUFBRSxhQUFhLE9BQU8sYUFBYSxZQUFZLFlBQVksSUFBSTtBQUFBLE1BQ3hFLFdBQVcsRUFBRSxZQUFZLFNBQVMsU0FBUyxPQUFPLFlBQVksU0FBUyxTQUFTLHlCQUF5QixnQkFBZ0IsT0FBTztBQUFBLE1BQ2hJLFVBQVUsRUFBRSxTQUFTLFNBQVMsR0FBRyxPQUFPLEdBQUcsS0FBSyxXQUFXLEdBQUcsTUFBTSxZQUFZLEdBQUcsS0FBSztBQUFBLE1BQ3hGLGtCQUFrQixFQUFFLGdCQUFnQixNQUFNLE1BQU0sQ0FBQyxZQUFZLEtBQUssRUFBRTtBQUFBLElBQ3RFO0FBQUEsRUFDRjtBQUVBLE1BQUksS0FBSyxnQkFBZ0IsZ0JBQWdCLE9BQU8sS0FBSyxRQUFRO0FBQzNELFVBQU0sRUFBRSxPQUFPLE9BQU8sS0FBSyxJQUFJLElBQUk7QUFDbkMsVUFBTSxlQUFlLFNBQVMsMkRBQTJELENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUN0RyxVQUFNLGdCQUFnQixjQUFjLG9CQUFvQjtBQUN4RCxRQUFJLENBQUMsU0FBUyxNQUFNLFNBQVMsS0FBSyxNQUFNLFNBQVMsSUFBSTtBQUNuRCxhQUFPLElBQUksT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLE9BQU8sNEJBQTRCLE9BQU8sVUFBVSxDQUFDLEdBQUcsQ0FBQztBQUFBLElBQ3pGO0FBRUEsVUFBTSxjQUFjLE1BQU0sSUFBSSxDQUFDLEdBQUcsT0FBTztBQUFBLE1BQ3ZDLEdBQUc7QUFBQSxNQUNILGFBQWEsSUFBSTtBQUFBLE1BQ2pCLE9BQU8sZUFBZSxFQUFFLEdBQUcsRUFBRSxDQUFDO0FBQUEsSUFDaEMsRUFBRTtBQUNGLFVBQU0sYUFBYSxZQUFZLE9BQU8sQ0FBQyxLQUFLLE1BQU0sTUFBTSxFQUFFLE9BQU8sQ0FBQztBQUVsRSxVQUFNLFNBQVMsY0FBYyxJQUFJLEtBQUssRUFBRTtBQUN4QyxVQUFNLE1BQU0sZUFBZSxJQUFJLEtBQUssRUFBRTtBQUN0QyxVQUFNLFVBQVUsZUFBZSxJQUFJLEtBQUssRUFBRTtBQUUxQyxRQUFJO0FBQ0osUUFBSTtBQUNGLFVBQUksQ0FBQyxPQUFRLE9BQU0sSUFBSSxNQUFNLFlBQVk7QUFFekMsWUFBTSxFQUFFLFNBQVMsT0FBTyxJQUFJLE1BQU0sT0FBTyx3RkFBUTtBQUNqRCxZQUFNLFNBQVMsSUFBSSxPQUFPLEVBQUUsT0FBTyxDQUFDO0FBRXBDLFlBQU0sWUFBWSxZQUFZLElBQUksUUFBTTtBQUFBLFFBQ3RDLFlBQVksRUFBRTtBQUFBLFFBQ2QsR0FBRyxLQUFLLE1BQU0sRUFBRSxDQUFDO0FBQUEsUUFDakIsR0FBRyxLQUFLLE1BQU0sRUFBRSxDQUFDO0FBQUEsUUFDakIsWUFBWSxFQUFFO0FBQUEsTUFDaEIsRUFBRTtBQUVGLFlBQU0sY0FBYztBQUFBLEVBQ3hCLGtCQUFrQixJQUFJLEtBQUssa0JBQWtCLEVBQUU7QUFBQTtBQUFBO0FBQUEsY0FHbkMsSUFBSSxRQUFRO0FBQUEsWUFDZCxJQUFJLGdCQUFnQixZQUFZLHdCQUF3QixPQUFPO0FBQUEsY0FDN0QsSUFBSSxrQkFBa0IsU0FBUyxjQUFjLE9BQU87QUFBQTtBQUFBLHlCQUV6QyxRQUFRLG1CQUFtQjtBQUFBLHNCQUM5QixRQUFRLGdCQUFnQjtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBSTVDLEtBQUssVUFBVSxXQUFXLE1BQU0sQ0FBQyxDQUFDO0FBRTlCLFlBQU0sV0FBVyxNQUFNLE9BQU8sS0FBSyxZQUFZLE9BQU87QUFBQSxRQUNwRCxPQUFPO0FBQUEsUUFDUCxVQUFVO0FBQUEsVUFDUixFQUFFLE1BQU0sVUFBVSxTQUFTLGNBQWM7QUFBQSxVQUN6QyxFQUFFLE1BQU0sUUFBUSxTQUFTLFlBQVk7QUFBQSxRQUN2QztBQUFBLFFBQ0EsWUFBWTtBQUFBLFFBQ1osYUFBYTtBQUFBLE1BQ2YsQ0FBQztBQUVELFlBQU0sVUFBVSxTQUFTLFFBQVEsQ0FBQyxFQUFFLFFBQVEsUUFBUSxLQUFLO0FBQ3pELFlBQU0sWUFBWSxRQUFRLE1BQU0sYUFBYTtBQUM3QyxVQUFJLENBQUMsVUFBVyxPQUFNLElBQUksTUFBTSxxQkFBcUI7QUFFckQsaUJBQVcsS0FBSyxNQUFNLFVBQVUsQ0FBQyxDQUFDO0FBR2xDLFVBQUksQ0FBQyxTQUFTLFVBQVUsV0FBVyxDQUFDLFNBQVMsVUFBVSxXQUFXO0FBQ2hFLGNBQU0sSUFBSSxNQUFNLGdCQUFnQjtBQUFBLE1BQ2xDO0FBQUEsSUFDRixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0scUJBQXFCLEVBQUUsT0FBTztBQUM1QyxpQkFBVyxjQUFjLGFBQWEsWUFBWSxJQUFJO0FBQUEsSUFDeEQ7QUFHQSxVQUFNLGVBQWUsR0FBRyxTQUFTLFNBQVMsT0FBTyxJQUFJLFNBQVMsU0FBUyxTQUFTO0FBRWhGLFFBQUksS0FBSztBQUFBLE1BQ1AsT0FBTztBQUFBLE1BQ1AsYUFBYTtBQUFBLE1BQ2IsYUFBYSxLQUFLLFVBQVUsUUFBUTtBQUFBLE1BQ3BDLGtCQUFrQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSCxDQUFDO0FBR0QsTUFBSSxLQUFLLHNCQUFzQixnQkFBZ0IsT0FBTyxLQUFLLFFBQVE7QUFDakUsVUFBTSxFQUFFLE1BQU0sSUFBSSxJQUFJO0FBQ3RCLFFBQUksQ0FBQyxPQUFPO0FBQ1YsYUFBTyxJQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUssRUFBRSxPQUFPLGlCQUFpQixDQUFDO0FBQUEsSUFDekQ7QUFFQSxRQUFJO0FBQ0YsWUFBTSxZQUFZLGNBQWMsSUFBSSxLQUFLLEVBQUU7QUFDM0MsVUFBSSxDQUFDLFdBQVc7QUFDZCxjQUFNLElBQUksTUFBTSxZQUFZO0FBQUEsTUFDOUI7QUFFQSxZQUFNLEVBQUUsU0FBUyxPQUFPLElBQUksTUFBTSxPQUFPLHdGQUFRO0FBQ2pELFlBQU0sU0FBUyxJQUFJLE9BQU8sRUFBRSxRQUFRLFVBQVUsQ0FBQztBQUUvQyxZQUFNLFdBQVcsTUFBTSxPQUFPLEtBQUssWUFBWSxPQUFPO0FBQUEsUUFDcEQsT0FBTztBQUFBLFFBQ1AsVUFBVTtBQUFBLFVBQ1I7QUFBQSxZQUNFLE1BQU07QUFBQSxZQUNOLFNBQVM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxVQWFYO0FBQUEsVUFDQTtBQUFBLFlBQ0UsTUFBTTtBQUFBLFlBQ04sU0FBUztBQUFBLGNBQ1AsRUFBRSxNQUFNLFFBQVEsTUFBTSxxR0FBcUc7QUFBQSxjQUMzSCxFQUFFLE1BQU0sYUFBYSxXQUFXLEVBQUUsS0FBSyxPQUFPLFFBQVEsT0FBTyxFQUFFO0FBQUEsWUFDakU7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLFFBQ0EsWUFBWTtBQUFBLFFBQ1osYUFBYTtBQUFBLE1BQ2YsQ0FBQztBQUVELFlBQU0sVUFBVSxTQUFTLFFBQVEsQ0FBQyxFQUFFLFFBQVEsUUFBUSxLQUFLO0FBRXpELFlBQU0sWUFBWSxRQUFRLE1BQU0sYUFBYTtBQUM3QyxVQUFJLENBQUMsV0FBVztBQUNkLGVBQU8sSUFBSSxLQUFLLEVBQUUsT0FBTyxDQUFDLEdBQUcsT0FBTywyQkFBMkIsQ0FBQztBQUFBLE1BQ2xFO0FBRUEsWUFBTSxTQUFTLEtBQUssTUFBTSxVQUFVLENBQUMsQ0FBQztBQUN0QyxZQUFNLFNBQVMsT0FBTyxTQUFTLENBQUMsR0FBRyxNQUFNLEdBQUcsQ0FBQyxFQUFFLElBQUksUUFBTTtBQUFBLFFBQ3ZELEdBQUcsS0FBSyxJQUFJLE1BQU0sS0FBSyxJQUFJLEtBQUssS0FBSyxNQUFNLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFBQSxRQUNoRCxHQUFHLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSSxLQUFLLEtBQUssTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQUEsTUFDbEQsRUFBRTtBQUVGLFVBQUksS0FBSyxFQUFFLE1BQU0sQ0FBQztBQUFBLElBQ3BCLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSxpQkFBaUIsRUFBRSxPQUFPO0FBQ3hDLFVBQUksV0FBVyxFQUFFO0FBQ2pCLFVBQUksRUFBRSxRQUFRLFNBQVMsWUFBWSxHQUFHO0FBQ3BDLG1CQUFXO0FBQUEsTUFDYixXQUFXLEVBQUUsUUFBUSxTQUFTLEtBQUssS0FBSyxFQUFFLFFBQVEsU0FBUyxtQkFBbUIsS0FBSyxFQUFFLFFBQVEsU0FBUyxpQkFBaUIsR0FBRztBQUN4SCxtQkFBVztBQUFBLE1BQ2IsV0FBVyxFQUFFLFFBQVEsU0FBUyxLQUFLLEtBQUssRUFBRSxRQUFRLFNBQVMsWUFBWSxHQUFHO0FBQ3hFLG1CQUFXO0FBQUEsTUFDYixXQUFXLEVBQUUsUUFBUSxTQUFTLG9CQUFvQixLQUFLLEVBQUUsUUFBUSxTQUFTLFNBQVMsR0FBRztBQUNwRixtQkFBVztBQUFBLE1BQ2I7QUFDQSxVQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUssRUFBRSxPQUFPLFVBQVUsT0FBTyxDQUFDLEVBQUUsQ0FBQztBQUFBLElBQ3JEO0FBQUEsRUFDRixDQUFDO0FBRUQsU0FBTztBQUNUO0FBMWVBLElBQXdNLDBDQVNsTSxXQUNBLFNBQ0EsWUFFRjtBQWJKO0FBQUE7QUFBa00sSUFBTSwyQ0FBMkM7QUFTblAsSUFBTSxZQUFZLFFBQVEsY0FBYyx3Q0FBZSxDQUFDO0FBQ3hELElBQU0sVUFBVSxLQUFLLFdBQVcsTUFBTSxrQkFBa0I7QUFDeEQsSUFBTSxhQUFhLFFBQVEsSUFBSSxjQUFjO0FBQUE7QUFBQTs7O0FDWDJSLFNBQVMsb0JBQW9CO0FBQ3JXLE9BQU8sV0FBVztBQUVsQixTQUFTLFlBQVk7QUFDbkIsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sTUFBTSxnQkFBZ0IsUUFBUTtBQUM1QixZQUFNLEVBQUUsV0FBQUEsV0FBVSxJQUFJLE1BQU07QUFDNUIsWUFBTSxTQUFTLE1BQU1BLFdBQVU7QUFHL0IsYUFBTyxZQUFZLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztBQUN6QyxZQUFJLElBQUksSUFBSSxXQUFXLE1BQU0sR0FBRztBQUM5QixpQkFBTyxLQUFLLEtBQUssQ0FBQyxRQUFRO0FBQ3hCLGdCQUFJLElBQUssU0FBUSxNQUFNLGtCQUFrQixHQUFHO0FBQzVDLGlCQUFLO0FBQUEsVUFDUCxDQUFDO0FBQUEsUUFDSCxPQUFPO0FBQ0wsZUFBSztBQUFBLFFBQ1A7QUFBQSxNQUNGLENBQUM7QUFDRCxjQUFRLElBQUksdUJBQXVCO0FBQUEsSUFDckM7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxHQUFHLFVBQVUsQ0FBQztBQUFBLEVBQzlCLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFsiY3JlYXRlQXBwIl0KfQo=
