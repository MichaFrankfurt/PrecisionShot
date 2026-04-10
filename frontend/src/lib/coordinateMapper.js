/**
 * Maps pixel coordinates from camera frame to target coordinates (-150 to +150).
 * MVP: assumes target fills most of the camera frame.
 */

/**
 * Map a pixel position to target coordinates.
 * @param {number} px - Pixel X in camera frame
 * @param {number} py - Pixel Y in camera frame
 * @param {number} frameWidth - Camera frame width
 * @param {number} frameHeight - Camera frame height
 * @param {object} bounds - Target bounds in pixel space (optional)
 * @returns {{x: number, y: number}} Target coordinates (-150 to +150)
 */
export function mapPixelToTarget(px, py, frameWidth, frameHeight, bounds = null) {
  // Default: assume target center is at frame center, radius = 45% of smaller dimension
  const centerX = bounds?.centerX ?? frameWidth / 2;
  const centerY = bounds?.centerY ?? frameHeight / 2;
  const radius = bounds?.radius ?? Math.min(frameWidth, frameHeight) * 0.45;

  const x = ((px - centerX) / radius) * 150;
  const y = ((py - centerY) / radius) * 150;

  // Clamp to valid range
  return {
    x: Math.max(-150, Math.min(150, Math.round(x))),
    y: Math.max(-150, Math.min(150, Math.round(y)))
  };
}
