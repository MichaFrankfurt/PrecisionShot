import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'db', 'precisionshot.db');
const JWT_SECRET = process.env.JWT_SECRET || 'precisionshot-dev-secret-2024';

let db;

async function initDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    db = new SQL.Database(readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8');
  db.run(schema);

  // Migrations: add columns if missing (safe - sql.js throws if column exists)
  try { db.run('ALTER TABLE settings ADD COLUMN shots_per_series INTEGER DEFAULT 5'); } catch (e) { /* exists */ }
  try { db.run("ALTER TABLE settings ADD COLUMN ai_provider TEXT DEFAULT 'openai'"); } catch (e) { /* exists */ }
  try { db.run("ALTER TABLE settings ADD COLUMN anthropic_key TEXT DEFAULT ''"); } catch (e) { /* exists */ }
  try { db.run("ALTER TABLE settings ADD COLUMN camera_device_id TEXT DEFAULT ''"); } catch (e) { /* exists */ }

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
  const lastId = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
  saveDb();
  return { lastInsertRowid: lastId };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token fehlt' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

// Ring boundaries: Ring 10 = 0-15px, Ring 9 = 15-30px, ..., Ring 1 = 135-150px
// If shot touches a ring line (within 3px tolerance), count the higher ring
// 10* (Innenzehner/X): center hit within 5px, not touching the 10-ring line
const RING_WIDTH = 15; // each ring is 15px wide
const LINE_TOLERANCE = 3; // px tolerance for "touching the line"
const INNER_TEN_RADIUS = 5; // radius for 10* (Mouche/X)

function calculateScore(x, y) {
  const distance = Math.sqrt(x * x + y * y);

  // Outside target
  if (distance >= 150) return { score: 0, display: '0', innerTen: false };

  // Calculate which ring (1-10, where 10 = center)
  const ringFromCenter = Math.floor(distance / RING_WIDTH); // 0 = innermost, 9 = outermost
  const distToNextLine = distance - (ringFromCenter * RING_WIDTH); // distance past the last ring line
  const distToLine = RING_WIDTH - distToNextLine; // distance to the next ring line outward

  let ring = 10 - ringFromCenter; // Convert to score (10 = center, 1 = outer)

  // If touching the line inward (within tolerance), give the higher ring
  if (distToNextLine <= LINE_TOLERANCE && ringFromCenter > 0) {
    ring = 10 - ringFromCenter + 1;
  }

  ring = Math.max(1, Math.min(10, ring));

  // Inner ten (10* / Mouche / X): within 5px of dead center, NOT touching the 10-ring line
  const innerTen = distance <= INNER_TEN_RADIUS;

  return {
    score: ring,
    display: innerTen ? '10*' : String(ring),
    innerTen
  };
}

export async function createApp() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  // Health
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Auth
  app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Alle Felder erforderlich' });
    }
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hash]);
      const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id: result.lastInsertRowid, username, email } });
    } catch (e) {
      if (e.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username oder Email bereits vergeben' });
      }
      res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }
    const user = queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  });

  // Settings
  app.get('/api/settings', authMiddleware, (req, res) => {
    let settings = queryOne('SELECT * FROM settings WHERE user_id = ?', [req.user.id]);
    if (!settings) {
      run('INSERT INTO settings (user_id) VALUES (?)', [req.user.id]);
      settings = queryOne('SELECT * FROM settings WHERE user_id = ?', [req.user.id]);
    }
    // Mask API keys for security
    if (settings.openai_key) {
      settings.openai_key_masked = settings.openai_key.substring(0, 7) + '...' + settings.openai_key.slice(-4);
      settings.has_openai_key = true;
    } else {
      settings.openai_key_masked = '';
      settings.has_openai_key = false;
    }
    if (settings.anthropic_key) {
      settings.anthropic_key_masked = settings.anthropic_key.substring(0, 10) + '...' + settings.anthropic_key.slice(-4);
      settings.has_anthropic_key = true;
    } else {
      settings.anthropic_key_masked = '';
      settings.has_anthropic_key = false;
    }
    // Legacy compat
    settings.has_api_key = settings.has_openai_key || settings.has_anthropic_key;
    delete settings.openai_key;
    delete settings.anthropic_key;
    res.json(settings);
  });

  app.put('/api/settings', authMiddleware, (req, res) => {
    const { distance, shots_per_series, target_type, training_type, openai_key, ai_provider, anthropic_key, camera_device_id } = req.body;

    // Ensure settings row exists
    const existing = queryOne('SELECT * FROM settings WHERE user_id = ?', [req.user.id]);
    if (!existing) {
      run('INSERT INTO settings (user_id) VALUES (?)', [req.user.id]);
    }

    if (distance != null) {
      run('UPDATE settings SET distance = ? WHERE user_id = ?', [distance, req.user.id]);
    }
    if (shots_per_series != null) {
      run('UPDATE settings SET shots_per_series = ? WHERE user_id = ?', [shots_per_series, req.user.id]);
    }
    if (target_type) {
      run('UPDATE settings SET target_type = ? WHERE user_id = ?', [target_type, req.user.id]);
    }
    if (training_type) {
      run('UPDATE settings SET training_type = ? WHERE user_id = ?', [training_type, req.user.id]);
    }
    if (openai_key !== undefined) {
      run('UPDATE settings SET openai_key = ? WHERE user_id = ?', [openai_key, req.user.id]);
    }
    if (ai_provider) {
      run('UPDATE settings SET ai_provider = ? WHERE user_id = ?', [ai_provider, req.user.id]);
    }
    if (anthropic_key !== undefined) {
      run('UPDATE settings SET anthropic_key = ? WHERE user_id = ?', [anthropic_key, req.user.id]);
    }
    if (camera_device_id !== undefined) {
      run('UPDATE settings SET camera_device_id = ? WHERE user_id = ?', [camera_device_id, req.user.id]);
    }

    const updated = queryOne('SELECT * FROM settings WHERE user_id = ?', [req.user.id]);
    if (updated.openai_key) {
      updated.openai_key_masked = updated.openai_key.substring(0, 7) + '...' + updated.openai_key.slice(-4);
      updated.has_openai_key = true;
    } else { updated.openai_key_masked = ''; updated.has_openai_key = false; }
    if (updated.anthropic_key) {
      updated.anthropic_key_masked = updated.anthropic_key.substring(0, 10) + '...' + updated.anthropic_key.slice(-4);
      updated.has_anthropic_key = true;
    } else { updated.anthropic_key_masked = ''; updated.has_anthropic_key = false; }
    updated.has_api_key = updated.has_openai_key || updated.has_anthropic_key;
    delete updated.openai_key;
    delete updated.anthropic_key;
    res.json(updated);
  });

  // Sessions (protected)
  app.get('/api/sessions', authMiddleware, (req, res) => {
    const sessions = query('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(sessions);
  });

  app.get('/api/sessions/:id', authMiddleware, (req, res) => {
    const session = queryOne('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const shots = query('SELECT * FROM shots WHERE session_id = ? ORDER BY shot_number', [session.id]);
    res.json({ ...session, shots });
  });

  app.post('/api/sessions', authMiddleware, (req, res) => {
    try {
      const { shots, total_score, ai_feedback } = req.body;
      const result = run('INSERT INTO sessions (user_id, date, total_score, ai_feedback) VALUES (?, date("now"), ?, ?)',
        [req.user.id, total_score, ai_feedback]);
      const sessionId = result.lastInsertRowid;
      for (const shot of shots) {
        run('INSERT INTO shots (session_id, shot_number, x, y, score) VALUES (?, ?, ?, ?, ?)',
          [sessionId, shot.shot_number, shot.x, shot.y, shot.score]);
      }
      const session = queryOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
      const savedShots = query('SELECT * FROM shots WHERE session_id = ?', [sessionId]);
      res.json({ ...session, shots: savedShots });
    } catch (e) {
      console.error('Session save error:', e);
      res.status(500).json({ error: 'Session konnte nicht gespeichert werden: ' + e.message });
    }
  });

  // Usage statistics
  app.get('/api/usage', authMiddleware, (req, res) => {
    const since = req.query.since || '2024-01-01';
    const usage = query(
      `SELECT provider, model, endpoint,
        SUM(tokens_in) as total_tokens_in,
        SUM(tokens_out) as total_tokens_out,
        SUM(cost_estimate) as total_cost,
        COUNT(*) as request_count
      FROM api_usage WHERE user_id = ? AND created_at >= ?
      GROUP BY provider, endpoint
      ORDER BY total_cost DESC`,
      [req.user.id, since]
    );
    const totals = queryOne(
      `SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out,
        SUM(cost_estimate) as total_cost, COUNT(*) as requests
      FROM api_usage WHERE user_id = ? AND created_at >= ?`,
      [req.user.id, since]
    );
    res.json({ breakdown: usage, totals: totals || { tokens_in: 0, tokens_out: 0, total_cost: 0, requests: 0 } });
  });

  // Progress / Development
  app.get('/api/progress', authMiddleware, (req, res) => {
    const sessions = query(
      `SELECT s.id, s.date, s.total_score, s.created_at,
        (SELECT COUNT(*) FROM shots WHERE session_id = s.id) as shots_count
      FROM sessions s WHERE s.user_id = ? ORDER BY s.created_at ASC`,
      [req.user.id]
    );

    if (sessions.length < 1) {
      return res.json({ totalSessions: 0 });
    }

    const scores = sessions.map(s => s.total_score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const bestScore = Math.max(...scores);

    // Trend: compare last 5 vs previous 5
    let trend = 0;
    if (sessions.length >= 6) {
      const recent5 = scores.slice(-5);
      const prev5 = scores.slice(-10, -5);
      if (prev5.length >= 3) {
        const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
        const prevAvg = prev5.reduce((a, b) => a + b, 0) / prev5.length;
        trend = recentAvg - prevAvg;
      }
    }

    res.json({
      totalSessions: sessions.length,
      avgScore,
      bestScore,
      trend,
      history: sessions.slice(-30).map(s => ({
        date: s.date,
        total_score: s.total_score,
        shots_count: s.shots_count
      }))
    });
  });

  // AI Progress Analysis
  app.get('/api/progress/ai', authMiddleware, async (req, res) => {
    const lang = req.query.lang || 'de';
    const sessions = query(
      `SELECT s.date, s.total_score, s.ai_feedback,
        (SELECT COUNT(*) FROM shots WHERE session_id = s.id) as shots_count
      FROM sessions s WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 20`,
      [req.user.id]
    );

    if (sessions.length < 3) {
      return res.json({ summary: 'Noch nicht genug Daten. Mindestens 3 Serien nötig.' });
    }

    const aiConfig = getUserAIConfig(req.user.id);
    if (!aiConfig.key) {
      return res.json({ summary: 'API Key erforderlich für AI-Analyse.' });
    }

    const sessionsDesc = sessions.map(s =>
      `${s.date}: ${s.total_score?.toFixed(1)} Punkte (${s.shots_count} Schuss)`
    ).join('\n');

    const LANG = { de: 'Deutsch', en: 'English', ru: 'Русский' };

    try {
      const summary = await callAI({
        ...aiConfig,
        systemPrompt: `Du bist ein erfahrener Schießtrainer der die langfristige Entwicklung eines Schützen analysiert. Schreibe einen flüssigen, natürlichen Text (4-8 Sätze) der vorgelesen werden kann. Analysiere Trends, erkenne Muster, gib konkrete Empfehlungen für das weitere Training.`,
        userMessage: `Antworte auf ${LANG[lang] || 'Deutsch'}.

Letzte ${sessions.length} Serien dieses Schützen:
${sessionsDesc}

Analysiere die Entwicklung dieses Schützen. Was sind die Trends? Wo hat er sich verbessert? Wo gibt es noch Potenzial? Was empfiehlst du als nächsten Trainings-Schwerpunkt?`,
        maxTokens: 600,
        temperature: 0.5,
        userId: req.user.id,
        endpoint: 'progress'
      });
      res.json({ summary });
    } catch (e) {
      res.json({ summary: 'Analyse konnte nicht erstellt werden: ' + e.message });
    }
  });

  // Helper: get user's AI provider config
  function getUserAIConfig(userId) {
    const settings = queryOne('SELECT ai_provider, openai_key, anthropic_key FROM settings WHERE user_id = ?', [userId]);
    const provider = settings?.ai_provider || 'openai';
    let key = null;

    if (provider === 'claude') {
      key = settings?.anthropic_key || process.env.ANTHROPIC_API_KEY || null;
    } else {
      key = settings?.openai_key || null;
      if (!key && process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your')) {
        key = process.env.OPENAI_API_KEY;
      }
    }
    return { provider, key };
  }

  // Cost per 1M tokens (USD)
  const COSTS = {
    'gpt-4o': { input: 2.5, output: 10 },
    'claude-sonnet-4-20250514': { input: 3, output: 15 }
  };

  function logUsage(userId, provider, model, endpoint, tokensIn, tokensOut) {
    const cost = COSTS[model] || { input: 3, output: 10 };
    const costEstimate = (tokensIn / 1_000_000 * cost.input) + (tokensOut / 1_000_000 * cost.output);
    try {
      run('INSERT INTO api_usage (user_id, provider, model, endpoint, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, provider, model, endpoint, tokensIn, tokensOut, costEstimate]);
    } catch (e) { console.error('Usage log error:', e.message); }
  }

  // Helper: call AI (OpenAI or Claude) with messages
  async function callAI({ provider, key, systemPrompt, userMessage, maxTokens = 600, temperature = 0.4, userId, endpoint = 'analyze' }) {
    if (!key) throw new Error('No API key');

    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      });
      if (userId && response.usage) {
        logUsage(userId, 'claude', 'claude-sonnet-4-20250514', endpoint, response.usage.input_tokens, response.usage.output_tokens);
      }
      return response.content[0].text;
    } else {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: key });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: maxTokens,
        temperature
      });
      if (userId && response.usage) {
        logUsage(userId, 'openai', 'gpt-4o', endpoint, response.usage.prompt_tokens, response.usage.completion_tokens);
      }
      return response.choices[0].message.content;
    }
  }

  // Helper: call AI with vision (image analysis)
  async function callAIVision({ provider, key, systemPrompt, textPrompt, imageBase64, maxTokens = 500, userId }) {
    if (!key) throw new Error('No API key');

    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key });
      // Extract mime type and data from base64 data URL
      const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
      const mediaType = match ? match[1] : 'image/jpeg';
      const data = match ? match[2] : imageBase64;
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: textPrompt }
          ]
        }]
      });
      if (userId && response.usage) {
        logUsage(userId, 'claude', 'claude-sonnet-4-20250514', 'vision', response.usage.input_tokens, response.usage.output_tokens);
      }
      return response.content[0].text;
    } else {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: key });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: textPrompt },
            { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } }
          ]}
        ],
        max_tokens: maxTokens,
        temperature: 0.1
      });
      if (userId && response.usage) {
        logUsage(userId, 'openai', 'gpt-4o', 'vision', response.usage.prompt_tokens, response.usage.completion_tokens);
      }
      return response.choices[0].message.content;
    }
  }

  // Legacy compat
  function getUserApiKey(userId) {
    return getUserAIConfig(userId).key;
  }

  // Helper: get user settings for AI context
  function getUserContext(userId) {
    const s = queryOne('SELECT distance, target_type, training_type FROM settings WHERE user_id = ?', [userId]);
    return s || { distance: 10, target_type: 'paper', training_type: 'laser' };
  }

  // Helper: get recent common error from last 5 sessions
  function getRecentError(userId) {
    const recent = query('SELECT ai_feedback FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [userId]);
    if (!recent.length) return { recent_common_error: 'none', baseline_summary: 'New shooter, no history yet' };
    try {
      const errors = recent.map(r => {
        try { return JSON.parse(r.ai_feedback)?.diagnosis?.main_error; } catch { return null; }
      }).filter(Boolean);
      const counts = {};
      errors.forEach(e => counts[e] = (counts[e] || 0) + 1);
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return {
        recent_common_error: sorted[0]?.[0] || 'none',
        baseline_summary: sorted.length ? `Recurring: ${sorted.map(([e, c]) => `${e}(${c}x)`).join(', ')}` : 'No clear pattern yet'
      };
    } catch {
      return { recent_common_error: 'none', baseline_summary: 'No history parsed' };
    }
  }

  // Production System Prompt
  // Production Coach Prompt — fluent text output for TTS
  const SYSTEM_PROMPT = `Du bist PrecisionShot Coach — ein erfahrener Schießtrainer für Präzisionspistole.

Du analysierst eine Schussserie und gibst dem Schützen eine ausführliche, aber natürlich klingende Rückmeldung. Der Text wird direkt vorgelesen (Text-to-Speech), also schreibe flüssig und natürlich, wie ein Trainer der zwischen den Serien zum Schützen spricht.

Deine Analyse umfasst IMMER diese vier Teile in einem zusammenhängenden Text:

1. BEOBACHTUNG: Was siehst du im Trefferbild? Wo liegt die Gruppe? Wie ist die Streuung? Gibt es Ausreißer?

2. DIAGNOSE: Was ist die wahrscheinliche Ursache? Abzugsfehler? Atemkontrolle? Griff? Rhythmus? Ermüdung? Erkläre kurz die Biomechanik dahinter — warum entsteht dieses Trefferbild?

3. KORREKTUR: Was genau soll der Schütze ändern? Sei konkret und praktisch. Nicht "besser zielen", sondern "Druckpunkt halten, dann gleichmäßig durchziehen" oder "Atem anhalten, bevor du den Abzug anfasst".

4. NÄCHSTE SERIE: Gib eine klare Aufgabe für die nächste Serie. Nur EINE Sache, auf die sich der Schütze konzentrieren soll.

Stil:
- Wie ein persönlicher Trainer, der neben dir steht
- Natürlich, direkt, motivierend
- Fachbegriffe sind OK, aber erkläre sie kurz
- 4-8 Sätze insgesamt
- Kein JSON, keine Aufzählungszeichen, keine Überschriften
- Ein flüssiger Absatz, der vorgelesen werden kann

Koordinatensystem: Zentrum = (0,0), Bereich -150 bis +150, positiv x = rechts, positiv y = unten.`;

  const LANG_INSTRUCTIONS = {
    de: 'Antworte auf Deutsch.',
    en: 'Answer in English.',
    ru: 'Отвечай на русском языке.'
  };

  // Fallback when no API key
  function buildFallbackText(scoredShots, totalScore, lang, numShots) {
    const avgX = scoredShots.reduce((s, shot) => s + shot.x, 0) / numShots;
    const avgY = scoredShots.reduce((s, shot) => s + shot.y, 0) / numShots;
    const maxScore = numShots * 10;
    const pct = totalScore / maxScore;

    const texts = {
      de: {
        good: `Gute Serie mit ${totalScore.toFixed(1)} von ${maxScore} Punkten. Die Gruppe liegt gut im Zentrum. Für die nächste Serie: halte den gleichen Rhythmus bei, achte darauf dass jeder Schuss den gleichen Ablauf hat.`,
        ok: `${totalScore.toFixed(1)} von ${maxScore} Punkten. Das Trefferbild zeigt eine Tendenz nach ${avgX > 20 ? 'rechts' : avgX < -20 ? 'links' : ''}${avgY > 20 ? ' unten' : avgY < -20 ? ' oben' : ''}. Das deutet auf einen ungleichmäßigen Abzug hin. Für die nächste Serie: konzentrier dich auf einen gleichmäßigen Abzug, zieh durch bis der Schuss bricht.`,
        bad: `${totalScore.toFixed(1)} von ${maxScore} Punkten. Die Streuung ist noch zu groß. Wahrscheinlich fehlt dir der gleichmäßige Ablauf zwischen den Schüssen. Für die nächste Serie: nimm dir mehr Zeit, atme ruhig, und achte darauf dass jeder Schuss den exakt gleichen Prozess durchläuft.`
      },
      en: {
        good: `Good series with ${totalScore.toFixed(1)} out of ${maxScore} points. The group is well centered. For the next series: maintain the same rhythm and make sure every shot follows the same process.`,
        ok: `${totalScore.toFixed(1)} out of ${maxScore} points. The shot group shows a tendency ${avgX > 20 ? 'right' : avgX < -20 ? 'left' : ''}${avgY > 20 ? ' low' : avgY < -20 ? ' high' : ''}. This suggests inconsistent trigger control. For the next series: focus on a smooth, even trigger pull straight through the break.`,
        bad: `${totalScore.toFixed(1)} out of ${maxScore} points. The spread is still too wide. You likely lack a consistent shot process between shots. For the next series: take more time, breathe calmly, and make sure every shot follows the exact same routine.`
      },
      ru: {
        good: `Хорошая серия: ${totalScore.toFixed(1)} из ${maxScore} очков. Группа хорошо центрирована. На следующую серию: сохраняй тот же ритм и следи, чтобы каждый выстрел проходил по одному и тому же процессу.`,
        ok: `${totalScore.toFixed(1)} из ${maxScore} очков. Группа попаданий смещена ${avgX > 20 ? 'вправо' : avgX < -20 ? 'влево' : ''}${avgY > 20 ? ' вниз' : avgY < -20 ? ' вверх' : ''}. Это говорит о неравномерном спуске. На следующую серию: сосредоточься на плавном, равномерном нажатии спуска.`,
        bad: `${totalScore.toFixed(1)} из ${maxScore} очков. Разброс ещё слишком большой. Скорее всего, нет единообразного процесса между выстрелами. На следующую серию: не торопись, дыши спокойно, и убедись что каждый выстрел проходит по одной и той же схеме.`
      }
    };
    const fb = texts[lang] || texts.de;
    if (pct >= 0.9) return fb.good;
    if (pct >= 0.6) return fb.ok;
    return fb.bad;
  }

  app.post('/api/analyze', authMiddleware, async (req, res) => {
    const { shots, lang = 'de' } = req.body;
    if (!shots || shots.length < 1 || shots.length > 99) {
      return res.status(400).json({ error: `Invalid shot count: ${shots?.length || 0}` });
    }

    const scoredShots = shots.map((s, i) => {
      const result = calculateScore(s.x, s.y);
      return {
        ...s,
        shot_number: i + 1,
        score: result.score,
        display: result.display,
        innerTen: result.innerTen
      };
    });
    const totalScore = scoredShots.reduce((sum, s) => sum + s.score, 0);
    const numShots = scoredShots.length;

    const aiConfig = getUserAIConfig(req.user.id);
    const ctx = getUserContext(req.user.id);
    const history = getRecentError(req.user.id);

    let feedbackText;
    try {
      const shotsDesc = scoredShots.map(s =>
        `Schuss ${s.shot_number}: x=${Math.round(s.x)}, y=${Math.round(s.y)}, Ring=${s.score.toFixed(1)}`
      ).join('\n');

      const userMessage = `${LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.de}

Kontext:
- Entfernung: ${ctx.distance}m
- Zielscheibe: ${ctx.target_type === 'monitor' ? 'Elektronisch (Meyton)' : 'Papier'}
- Training: ${ctx.training_type === 'live' ? 'Scharfschuss' : 'Laser'}
- Schüsse in dieser Serie: ${numShots}
- Gesamtpunktzahl: ${totalScore.toFixed(1)} von ${numShots * 10}
- Bekannter wiederkehrender Fehler: ${history.recent_common_error}
- Bisheriges Niveau: ${history.baseline_summary}

Schussdaten:
${shotsDesc}

Bitte analysiere diese Serie.`;

      feedbackText = await callAI({
        ...aiConfig, systemPrompt: SYSTEM_PROMPT, userMessage, maxTokens: 800, temperature: 0.5,
        userId: req.user.id, endpoint: 'analyze'
      });

      // Clean up any markdown formatting
      feedbackText = feedbackText.replace(/[#*_`]/g, '').replace(/\n{3,}/g, '\n\n').trim();

    } catch (e) {
      console.error('AI analyze error:', e.message);
      feedbackText = buildFallbackText(scoredShots, totalScore, lang, numShots);
    }

    res.json({
      shots: scoredShots,
      total_score: totalScore,
      ai_feedback: feedbackText
    });
  });

  // Vision: Detect shots from image
  app.post('/api/vision/detect', authMiddleware, async (req, res) => {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image required' });
    }

    try {
      const aiConfig = getUserAIConfig(req.user.id);

      const ctx = getUserContext(req.user.id);
      const visionSystemPrompt = `You are a professional shooting target analysis system with expertise in competitive pistol shooting targets.

Your task: Detect ALL bullet holes, laser hits, or impact points on the shooting target in the image.

CRITICAL RULES:
1. Look carefully at the ENTIRE target surface for holes, tears, marks, or dark spots
2. Bullet holes appear as small dark circles or tears in the paper/surface
3. Laser marks appear as small dots or burns
4. Do NOT confuse printing artifacts, dirt, or shadows with bullet holes
5. Count each distinct hole/mark separately
6. Pay attention to holes that might overlap or be close together

Target information:
- Type: ${ctx.target_type === 'monitor' ? 'Electronic target (Meyton or similar)' : 'Paper target'}
- Training: ${ctx.training_type === 'live' ? 'Live ammunition (look for actual holes/tears)' : 'Laser training (look for laser marks/dots)'}
- Standard pistol target with 10 concentric rings
- Ring 10 (center/bullseye) is the smallest circle
- Ring 1 is the outermost scoring ring

Coordinate system (IMPORTANT):
- Center of the bullseye (ring 10) = (0, 0)
- Range: -150 to +150 for both x and y axes
- The TOTAL target diameter spans 300 units (-150 to +150)
- Each ring is approximately 15 units wide
- Positive x = RIGHT of center
- Positive y = BELOW center (down)
- Negative x = LEFT of center
- Negative y = ABOVE center (up)

Calibration guide:
- A hole at the edge of ring 10 (bullseye border): approximately x,y within ±15 of center
- A hole at ring 5: approximately 75-90 units from center
- A hole at ring 1 (outer edge): approximately 135-150 units from center

Return ONLY valid JSON (no markdown, no explanation, no code blocks):
{"shots": [{"x": 0, "y": -5}, {"x": 25, "y": 10}]}

If no shots detected: {"shots": []}`;

      const content = await callAIVision({
        ...aiConfig,
        systemPrompt: visionSystemPrompt,
        textPrompt: `Carefully examine this shooting target image. Detect and locate ALL bullet holes or impact marks. Return their precise coordinates as JSON. The target has ${ctx.target_type === 'monitor' ? 'electronic scoring rings' : 'printed paper rings'} and was used for ${ctx.training_type === 'live' ? 'live fire training' : 'laser training'}.`,
        imageBase64: image,
        maxTokens: 600,
        userId: req.user.id
      });

      const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ shots: [], error: 'Could not parse response' });
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const shots = (parsed.shots || []).slice(0, 5).map(s => ({
        x: Math.max(-150, Math.min(150, Math.round(s.x))),
        y: Math.max(-150, Math.min(150, Math.round(s.y)))
      }));

      res.json({ shots });
    } catch (e) {
      console.error('Vision error:', e.message);
      let errorMsg = e.message;
      if (e.message.includes('No API key')) {
        errorMsg = 'Kein API Key. Bitte in Einstellungen (⚙️) eintragen.';
      } else if (e.message.includes('401') || e.message.includes('Incorrect API key') || e.message.includes('invalid_api_key')) {
        errorMsg = 'API Key ungültig. Bitte in Einstellungen (⚙️) prüfen.';
      } else if (e.message.includes('429') || e.message.includes('rate_limit')) {
        errorMsg = 'API Rate Limit erreicht. Bitte kurz warten.';
      } else if (e.message.includes('insufficient_quota') || e.message.includes('billing')) {
        errorMsg = 'Kein OpenAI Guthaben. Bitte auf platform.openai.com aufladen.';
      }
      res.status(500).json({ error: errorMsg, shots: [] });
    }
  });

  return app;
}
