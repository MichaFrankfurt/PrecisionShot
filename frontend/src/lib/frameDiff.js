/**
 * Laser dot detection using brightness thresholding + color validation.
 * Based on ShootOFF / python-laser-tracker approach.
 *
 * Key insight: laser dots are ALWAYS the brightest pixels in the frame.
 * No reference frame needed — just find the brightest cluster.
 */

const DEFAULT_OPTIONS = {
  brightnessThreshold: 200,  // min brightness (max of R,G,B) to consider
  coreThreshold: 240,        // brightness for "laser core" (nearly white)
  minClusterSize: 3,         // min pixels in a cluster to count as laser
  maxClusterSize: 400,       // max pixels (reject large bright areas like lamps)
  clusterRadius: 20,         // max distance between pixels in same cluster
  dedupeRadius: 40,          // min distance from existing shots
  laserColor: 'red',         // 'red' or 'green'
};

/**
 * Detect laser dot in current frame (no reference frame needed).
 * @param {Uint8ClampedArray} pixelData - Current frame RGBA pixel data
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @param {Array<{px: number, py: number}>} existingShots - Already detected shots
 * @param {object} options - Detection options
 * @returns {{newShots: Array<{px: number, py: number, brightness: number}>}}
 */
export function detectLaserShot(pixelData, width, height, existingShots = [], options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const candidates = [];

  // Stage 1: Find bright pixels that match laser color
  // Use Uint32Array view for faster iteration
  const buf32 = new Uint32Array(pixelData.buffer);

  for (let i = 0; i < buf32.length; i++) {
    const pixel = buf32[i];
    const r = pixel & 0xFF;
    const g = (pixel >> 8) & 0xFF;
    const b = (pixel >> 16) & 0xFF;

    const brightness = Math.max(r, g, b);
    if (brightness < opts.brightnessThreshold) continue;

    let isLaser = false;

    if (opts.laserColor === 'red') {
      // Laser core: nearly white, very bright
      const isCore = brightness >= opts.coreThreshold;
      // Red halo: R dominant over G and B
      const isRedHalo = r > 200 && r > g * 1.4 && r > b * 1.4;
      isLaser = isCore || isRedHalo;
    } else {
      // Green laser
      const isCore = brightness >= opts.coreThreshold;
      const isGreenHalo = g > 200 && g > r * 1.4 && g > b * 1.4;
      isLaser = isCore || isGreenHalo;
    }

    if (isLaser) {
      const x = i % width;
      const y = Math.floor(i / width);
      candidates.push({ x, y, brightness });
    }
  }

  if (candidates.length === 0) return { newShots: [] };

  // Stage 2: Cluster nearby pixels
  const clusters = clusterPixels(candidates, opts.clusterRadius, opts.minClusterSize, opts.maxClusterSize);

  if (clusters.length === 0) return { newShots: [] };

  // Stage 3: Deduplicate against existing shots
  const newShots = [];
  for (const cluster of clusters) {
    const tooClose = existingShots.some(s => {
      const dx = cluster.cx - s.px;
      const dy = cluster.cy - s.py;
      return Math.sqrt(dx * dx + dy * dy) < opts.dedupeRadius;
    });

    if (!tooClose) {
      newShots.push({
        px: Math.round(cluster.cx),
        py: Math.round(cluster.cy),
        brightness: cluster.maxBrightness,
        size: cluster.size
      });
    }
  }

  return { newShots };
}

/**
 * Optional: detect laser with reference frame comparison (hybrid mode).
 * First checks brightness, then validates against reference.
 */
export function detectLaserShotWithReference(pixelData, refData, width, height, existingShots = [], options = {}) {
  // First: find candidates via brightness
  const result = detectLaserShot(pixelData, width, height, existingShots, options);

  if (result.newShots.length === 0 || !refData) return result;

  // Second: validate candidates — they should NOT be bright in reference frame
  const validatedShots = result.newShots.filter(shot => {
    const idx = (shot.py * width + shot.px) * 4;
    const refBrightness = Math.max(refData[idx], refData[idx + 1], refData[idx + 2]);
    // If this pixel was already bright in reference → it's a lamp/reflection, not a new laser
    return refBrightness < 180;
  });

  return { newShots: validatedShots };
}

function clusterPixels(candidates, maxRadius, minSize, maxSize) {
  const clusters = [];
  const visited = new Set();

  // Sort by brightness descending — process brightest first
  candidates.sort((a, b) => b.brightness - a.brightness);

  for (let i = 0; i < candidates.length; i++) {
    if (visited.has(i)) continue;

    const cluster = { pixels: [candidates[i]], sumX: candidates[i].x, sumY: candidates[i].y, maxBrightness: candidates[i].brightness };
    visited.add(i);

    for (let j = i + 1; j < candidates.length; j++) {
      if (visited.has(j)) continue;

      // Check distance to any pixel in cluster (single-linkage)
      let close = false;
      for (const p of cluster.pixels) {
        const dx = candidates[j].x - p.x;
        const dy = candidates[j].y - p.y;
        if (dx * dx + dy * dy <= maxRadius * maxRadius) {
          close = true;
          break;
        }
      }

      if (close) {
        cluster.pixels.push(candidates[j]);
        cluster.sumX += candidates[j].x;
        cluster.sumY += candidates[j].y;
        if (candidates[j].brightness > cluster.maxBrightness) {
          cluster.maxBrightness = candidates[j].brightness;
        }
        visited.add(j);
      }
    }

    const size = cluster.pixels.length;
    if (size >= minSize && size <= maxSize) {
      clusters.push({
        cx: cluster.sumX / size,
        cy: cluster.sumY / size,
        size,
        maxBrightness: cluster.maxBrightness
      });
    }
  }

  // Sort by size (largest first) — biggest cluster is most likely the real laser
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}
