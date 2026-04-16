/**
 * Auto-calibration: detects 4 black calibration markers on the printed A4 target.
 * Returns target bounds (centerX, centerY, radius) for accurate coordinate mapping.
 *
 * Runs 100% client-side using canvas pixel data — no API calls needed.
 */

const DARK_THRESHOLD = 80;       // pixels below this = "dark"
const MIN_BLOB_AREA = 20;        // minimum pixels in a blob
const MAX_BLOB_AREA = 800;       // maximum pixels in a blob
const MIN_CIRCULARITY = 0.55;    // aspect ratio + fill ratio
const TARGET_ASPECT = 188 / 275; // width/height of calibration dot rectangle on A4

/**
 * Detect 4 calibration markers and compute target bounds.
 * @param {ImageData} imageData - Canvas ImageData (from ctx.getImageData)
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @returns {{ success: boolean, bounds?: { centerX, centerY, radius }, corners?: object, reason?: string }}
 */
export function detectCalibrationMarkers(imageData, width, height) {
  const pixels = imageData instanceof ImageData ? imageData.data : imageData;

  // Step 1: Build binary mask of dark pixels
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const gray = (r * 299 + g * 587 + b * 114) / 1000;
    mask[i] = gray < DARK_THRESHOLD ? 1 : 0;
  }

  // Step 2: Find connected components via flood fill
  const visited = new Uint8Array(width * height);
  const blobs = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] && !visited[idx]) {
        const blob = floodFill(mask, visited, x, y, width, height);
        if (blob.area >= MIN_BLOB_AREA && blob.area <= MAX_BLOB_AREA) {
          blobs.push(blob);
        }
      }
    }
  }

  // Step 3: Filter by circularity (round blobs only)
  const circular = blobs.filter(b => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const aspectRatio = Math.min(bw, bh) / Math.max(bw, bh);
    const expectedArea = Math.PI * (bw / 2) * (bh / 2);
    const fillRatio = b.area / expectedArea;
    return aspectRatio > MIN_CIRCULARITY && fillRatio > MIN_CIRCULARITY;
  });

  if (circular.length < 4) {
    return { success: false, reason: 'too_few_markers', found: circular.length };
  }

  // Step 4: Find best quadrilateral matching A4 aspect ratio
  const quad = findBestQuad(circular, width, height);
  if (!quad) {
    return { success: false, reason: 'no_valid_quad', found: circular.length };
  }

  // Step 5: Label corners (TL, TR, BL, BR)
  const corners = labelCorners(quad);

  // Step 6: Compute target bounds
  const bounds = computeBounds(corners);

  return { success: true, bounds, corners };
}

/**
 * Stack-based flood fill — finds a connected dark blob.
 */
function floodFill(mask, visited, startX, startY, width, height) {
  const stack = [[startX, startY]];
  let sumX = 0, sumY = 0, area = 0;
  let minX = startX, maxX = startX, minY = startY, maxY = startY;

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    sumX += x; sumY += y; area++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // 4-connected neighbors
    if (x > 0 && mask[idx - 1] && !visited[idx - 1]) stack.push([x - 1, y]);
    if (x < width - 1 && mask[idx + 1] && !visited[idx + 1]) stack.push([x + 1, y]);
    if (y > 0 && mask[idx - width] && !visited[idx - width]) stack.push([x, y - 1]);
    if (y < height - 1 && mask[idx + width] && !visited[idx + width]) stack.push([x, y + 1]);
  }

  return { cx: sumX / area, cy: sumY / area, area, minX, maxX, minY, maxY };
}

/**
 * Find 4 blobs that best form an A4-proportioned rectangle.
 */
function findBestQuad(blobs, frameWidth, frameHeight) {
  // Sort by distance from frame center (furthest first — corner markers are near edges)
  const fcx = frameWidth / 2, fcy = frameHeight / 2;
  blobs.sort((a, b) => {
    const da = (a.cx - fcx) ** 2 + (a.cy - fcy) ** 2;
    const db = (b.cx - fcx) ** 2 + (b.cy - fcy) ** 2;
    return db - da;
  });

  // Try combinations from top candidates (limit to 12 for performance)
  const candidates = blobs.slice(0, 12);
  let bestScore = Infinity;
  let bestQuad = null;

  for (let i = 0; i < candidates.length - 3; i++) {
    for (let j = i + 1; j < candidates.length - 2; j++) {
      for (let k = j + 1; k < candidates.length - 1; k++) {
        for (let l = k + 1; l < candidates.length; l++) {
          const quad = [candidates[i], candidates[j], candidates[k], candidates[l]];
          const score = scoreQuad(quad, frameWidth);
          if (score !== null && score < bestScore) {
            bestScore = score;
            bestQuad = quad;
          }
        }
      }
    }
  }

  return bestQuad;
}

/**
 * Score how well 4 points match the expected A4 calibration dot layout.
 * Lower = better. Returns null if invalid.
 */
function scoreQuad(points, frameWidth) {
  const labeled = labelCorners(points);
  const { tl, tr, bl, br } = labeled;

  // Check convexity
  if (!isConvex(tl, tr, br, bl)) return null;

  const topW = dist(tl, tr);
  const botW = dist(bl, br);
  const leftH = dist(tl, bl);
  const rightH = dist(tr, br);

  const avgW = (topW + botW) / 2;
  const avgH = (leftH + rightH) / 2;
  const aspect = avgW / avgH;

  const aspectError = Math.abs(aspect - TARGET_ASPECT) / TARGET_ASPECT;
  const widthConsistency = Math.abs(topW - botW) / avgW;
  const heightConsistency = Math.abs(leftH - rightH) / avgH;

  // Reject if geometry is wrong
  if (aspectError > 0.35) return null;
  if (widthConsistency > 0.3) return null;
  if (heightConsistency > 0.3) return null;
  if (avgW < frameWidth * 0.1) return null; // too small

  return aspectError + widthConsistency * 0.5 + heightConsistency * 0.5;
}

/**
 * Label 4 points as TL, TR, BL, BR based on position.
 */
function labelCorners(points) {
  const sorted = [...points].sort((a, b) => a.cy - b.cy);
  const topPair = sorted.slice(0, 2).sort((a, b) => a.cx - b.cx);
  const botPair = sorted.slice(2, 4).sort((a, b) => a.cx - b.cx);
  return { tl: topPair[0], tr: topPair[1], bl: botPair[0], br: botPair[1] };
}

/**
 * Compute target bounds from labeled corners.
 * Maps the calibration dot positions to the target center and ring radius.
 */
function computeBounds(corners) {
  const { tl, tr, bl, br } = corners;

  // Center of the calibration rectangle
  const rectCenterX = (tl.cx + tr.cx + bl.cx + br.cx) / 4;
  const rectCenterY = (tl.cy + tr.cy + bl.cy + br.cy) / 4;

  // Average dimensions of the rectangle
  const rectWidth = (dist(tl, tr) + dist(bl, br)) / 2;
  const rectHeight = (dist(tl, bl) + dist(tr, br)) / 2;

  // Target center is 2.5% above rectangle center (SVG translate -52% offset)
  const targetCenterX = rectCenterX;
  const targetCenterY = rectCenterY - rectHeight * 0.025;

  // Ring 1 outer radius = 110mm, dot horizontal span = 188mm
  const radius = (110 / 188) * rectWidth;

  return { centerX: targetCenterX, centerY: targetCenterY, radius };
}

function dist(a, b) {
  return Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2);
}

function isConvex(a, b, c, d) {
  function cross(o, p, q) {
    return (p.cx - o.cx) * (q.cy - o.cy) - (p.cy - o.cy) * (q.cx - o.cx);
  }
  const d1 = cross(a, b, c);
  const d2 = cross(b, c, d);
  const d3 = cross(c, d, a);
  const d4 = cross(d, a, b);
  const allPos = d1 > 0 && d2 > 0 && d3 > 0 && d4 > 0;
  const allNeg = d1 < 0 && d2 < 0 && d3 < 0 && d4 < 0;
  return allPos || allNeg;
}
