/**
 * Frame differencing for laser shot detection.
 * Compares current frame against reference to find new bright spots (laser hits).
 */

const DEFAULT_OPTIONS = {
  threshold: 150,       // Brightness difference threshold
  minBlobSize: 3,       // Minimum blob area in pixels
  maxBlobSize: 200,     // Maximum blob area in pixels
  dedupeRadius: 20,     // Minimum distance from existing shots (pixels)
  laserColor: 'red',    // 'red' or 'green'
};

/**
 * Detect new laser shots by comparing two frames.
 * @param {Uint8ClampedArray} refData - Reference frame pixel data (RGBA)
 * @param {Uint8ClampedArray} curData - Current frame pixel data (RGBA)
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @param {Array<{px: number, py: number}>} existingShots - Already detected shots
 * @param {object} options - Detection options
 * @returns {{newShots: Array<{px: number, py: number, brightness: number}>}}
 */
export function detectNewShots(refData, curData, width, height, existingShots = [], options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const totalPixels = width * height;

  // Step 1: Compute per-pixel brightness difference
  const diffMap = new Uint8Array(totalPixels);
  const channelOffset = opts.laserColor === 'green' ? 1 : 0; // R=0, G=1

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const refVal = refData[idx + channelOffset];
    const curVal = curData[idx + channelOffset];
    const diff = curVal - refVal;

    // Also check saturation: laser should be dominant in its channel
    if (opts.laserColor === 'red') {
      const curG = curData[idx + 1];
      const curB = curData[idx + 2];
      // Red laser: R should be significantly higher than G and B
      if (diff > opts.threshold && curVal > curG + 50 && curVal > curB + 50) {
        diffMap[i] = diff;
      }
    } else {
      const curR = curData[idx];
      const curB = curData[idx + 2];
      if (diff > opts.threshold && curData[idx + 1] > curR + 50 && curData[idx + 1] > curB + 50) {
        diffMap[i] = diff;
      }
    }
  }

  // Step 2: Simple blob detection via flood fill
  const visited = new Uint8Array(totalPixels);
  const blobs = [];

  for (let i = 0; i < totalPixels; i++) {
    if (diffMap[i] > 0 && !visited[i]) {
      // Flood fill this blob
      const blob = { pixels: [], maxBrightness: 0, sumX: 0, sumY: 0 };
      const stack = [i];

      while (stack.length > 0) {
        const p = stack.pop();
        if (p < 0 || p >= totalPixels || visited[p] || diffMap[p] === 0) continue;
        visited[p] = 1;

        const px = p % width;
        const py = Math.floor(p / width);
        blob.pixels.push(p);
        blob.sumX += px;
        blob.sumY += py;
        if (diffMap[p] > blob.maxBrightness) blob.maxBrightness = diffMap[p];

        // 4-connected neighbors
        if (px > 0) stack.push(p - 1);
        if (px < width - 1) stack.push(p + 1);
        if (py > 0) stack.push(p - width);
        if (py < height - 1) stack.push(p + width);
      }

      if (blob.pixels.length >= opts.minBlobSize && blob.pixels.length <= opts.maxBlobSize) {
        blob.cx = blob.sumX / blob.pixels.length;
        blob.cy = blob.sumY / blob.pixels.length;
        blobs.push(blob);
      }
    }
  }

  // Step 3: Deduplicate against existing shots
  const newShots = [];
  for (const blob of blobs) {
    const tooClose = existingShots.some(s => {
      const dx = blob.cx - s.px;
      const dy = blob.cy - s.py;
      return Math.sqrt(dx * dx + dy * dy) < opts.dedupeRadius;
    });

    if (!tooClose) {
      newShots.push({
        px: Math.round(blob.cx),
        py: Math.round(blob.cy),
        brightness: blob.maxBrightness
      });
    }
  }

  return { newShots };
}
