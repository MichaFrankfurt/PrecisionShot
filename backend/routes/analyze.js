import { Router } from 'express';
import { analyzeShots } from '../services/openai.js';
import { calculateScore, calculateTotalScore } from '../services/analysis.js';

const router = Router();

router.post('/', async (req, res) => {
  const { shots } = req.body;

  if (!shots || shots.length !== 5) {
    return res.status(400).json({ error: 'Genau 5 Schüsse erforderlich' });
  }

  const scoredShots = shots.map((s, i) => ({
    ...s,
    shot_number: i + 1,
    score: calculateScore(s.x, s.y)
  }));

  const totalScore = calculateTotalScore(scoredShots);

  try {
    const feedback = await analyzeShots(scoredShots);
    res.json({ shots: scoredShots, total_score: totalScore, ai_feedback: feedback });
  } catch (e) {
    console.error('OpenAI Error:', e.message);
    res.json({
      shots: scoredShots,
      total_score: totalScore,
      ai_feedback: `Gesamt: ${totalScore.toFixed(1)} von 50. ${totalScore >= 40 ? 'Gute Serie!' : 'Weiter üben!'}`
    });
  }
});

export default router;
