const TARGET_RADIUS = 150;

export function calculateScore(x, y) {
  const distance = Math.sqrt(x * x + y * y);
  const score = Math.max(1, 10 - (distance / TARGET_RADIUS) * 9);
  return Math.round(score * 10) / 10;
}

export function calculateTotalScore(shots) {
  return shots.reduce((sum, s) => sum + s.score, 0);
}
