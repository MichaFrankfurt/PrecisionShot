import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Du bist ein erfahrener Schießtrainer. Du analysierst eine Serie von 5 Schüssen auf eine Zielscheibe.
Die Zielscheibe hat einen Radius von 150 Pixel. Das Zentrum ist bei (0,0).
Score 10 = Zentrum, Score 1 = Randtreffer.

Deine Antwort:
- Maximal 2 kurze Sätze
- Direkte Kommandos wie ein Trainer
- Auf Deutsch
- Konkrete Verbesserung nennen

Beispiele:
"Du zielst konsistent nach links unten. Korrigiere deine Visierung nach rechts oben."
"Gute Streuung, aber zu tief. Halte die Waffe beim Abzug ruhiger."`;

export async function analyzeShots(shots) {
  const shotsDescription = shots
    .map((s, i) => `Schuss ${i + 1}: x=${s.x.toFixed(1)}, y=${s.y.toFixed(1)}, Score=${s.score.toFixed(1)}`)
    .join('\n');

  const avgScore = shots.reduce((sum, s) => sum + s.score, 0) / shots.length;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analysiere diese Serie (Durchschnitt: ${avgScore.toFixed(1)}):\n${shotsDescription}`
      }
    ],
    max_tokens: 150,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}
