import { Router } from 'express';
import db from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const sessions = db.prepare(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json(sessions);
});

router.get('/:id', (req, res) => {
  const session = db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

  const shots = db.prepare(
    'SELECT * FROM shots WHERE session_id = ? ORDER BY shot_number'
  ).all(session.id);

  res.json({ ...session, shots });
});

router.post('/', (req, res) => {
  const { shots, total_score, ai_feedback } = req.body;

  const insertSession = db.prepare(
    'INSERT INTO sessions (user_id, date, total_score, ai_feedback) VALUES (?, date("now"), ?, ?)'
  );
  const insertShot = db.prepare(
    'INSERT INTO shots (session_id, shot_number, x, y, score) VALUES (?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    const result = insertSession.run(req.user.id, total_score, ai_feedback);
    const sessionId = result.lastInsertRowid;

    for (const shot of shots) {
      insertShot.run(sessionId, shot.shot_number, shot.x, shot.y, shot.score);
    }

    return sessionId;
  });

  const sessionId = transaction();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  const savedShots = db.prepare('SELECT * FROM shots WHERE session_id = ?').all(sessionId);

  res.json({ ...session, shots: savedShots });
});

export default router;
