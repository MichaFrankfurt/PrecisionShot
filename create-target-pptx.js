const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.author = "PrecisionShot.ai";
pres.title = "PrecisionShot Laser-Trainingsscheibe";

// A4 Portrait: 210mm x 297mm = 8.27" x 11.69"
pres.defineLayout({ name: "A4_PORTRAIT", width: 8.27, height: 11.69 });
pres.layout = "A4_PORTRAIT";

const slide = pres.addSlide({ bkgd: "FFFFFF" });

// Target center position (inches)
const cx = 8.27 / 2;  // 4.135
const cy = 5.2;       // slightly above center for footer room

// Ring radii in inches (total diameter ~7 inches = 178mm)
const ringWidth = 0.35; // ~9mm per ring
const rings = [];
for (let i = 10; i >= 1; i--) {
  rings.push({ num: i, r: ringWidth * (11 - i) }); // ring 1 = outermost
}

// Draw rings from outside to inside
rings.forEach(ring => {
  const d = ring.r * 2;
  const x = cx - ring.r;
  const y = cy - ring.r;

  if (ring.num === 5 || ring.num === 6) {
    // Gray filled rings
    slide.addShape(pres.shapes.OVAL, {
      x, y, w: d, h: d,
      fill: { color: "888888" },
      line: { color: "888888", width: 0.5 }
    });
  } else if (ring.num >= 7) {
    // White rings (inner, for laser visibility)
    slide.addShape(pres.shapes.OVAL, {
      x, y, w: d, h: d,
      fill: { color: "FFFFFF" },
      line: { color: ring.num >= 9 ? "DDDDDD" : "CCCCCC", width: 0.5 }
    });
  } else {
    // Outer white rings (1-4)
    slide.addShape(pres.shapes.OVAL, {
      x, y, w: d, h: d,
      fill: { color: "FFFFFF" },
      line: { color: "999999", width: 0.5 }
    });
  }
});

// Center dot (gray, not red)
slide.addShape(pres.shapes.OVAL, {
  x: cx - 0.08, y: cy - 0.08, w: 0.16, h: 0.16,
  fill: { color: "AAAAAA" },
  line: { color: "AAAAAA", width: 0 }
});

// Small inner center dot
slide.addShape(pres.shapes.OVAL, {
  x: cx - 0.03, y: cy - 0.03, w: 0.06, h: 0.06,
  fill: { color: "888888" },
  line: { color: "888888", width: 0 }
});

// Ring numbers — all 4 sides
const numStyle = { fontFace: "Arial", fontSize: 7, align: "center", valign: "middle", margin: 0 };

for (let i = 1; i <= 9; i++) {
  const dist = ringWidth * (10 - i) + ringWidth * 0.5; // center of each ring band
  const isGray = (i === 5 || i === 6); // on gray background
  const color = isGray ? "FFFFFF" : (i >= 7 ? "999999" : "666666");
  const bold = isGray;

  // Top
  slide.addText(String(i), {
    x: cx - 0.1, y: cy - dist - 0.08, w: 0.2, h: 0.16,
    ...numStyle, color, bold
  });
  // Bottom
  slide.addText(String(i), {
    x: cx - 0.1, y: cy + dist - 0.08, w: 0.2, h: 0.16,
    ...numStyle, color, bold
  });
  // Left
  slide.addText(String(i), {
    x: cx - dist - 0.1, y: cy - 0.08, w: 0.2, h: 0.16,
    ...numStyle, color, bold
  });
  // Right
  slide.addText(String(i), {
    x: cx + dist - 0.1, y: cy - 0.08, w: 0.2, h: 0.16,
    ...numStyle, color, bold
  });
}

// Crosshair lines (very subtle)
const outerR = ringWidth * 10;
// Top
slide.addShape(pres.shapes.LINE, {
  x: cx, y: cy - outerR, w: 0, h: outerR * 0.35,
  line: { color: "DDDDDD", width: 0.3 }
});
// Bottom
slide.addShape(pres.shapes.LINE, {
  x: cx, y: cy + outerR * 0.65, w: 0, h: outerR * 0.35,
  line: { color: "DDDDDD", width: 0.3 }
});
// Left
slide.addShape(pres.shapes.LINE, {
  x: cx - outerR, y: cy, w: outerR * 0.35, h: 0,
  line: { color: "DDDDDD", width: 0.3 }
});
// Right
slide.addShape(pres.shapes.LINE, {
  x: cx + outerR * 0.65, y: cy, w: outerR * 0.35, h: 0,
  line: { color: "DDDDDD", width: 0.3 }
});

// Calibration dots (4 corners, matching target.html)
const dotDiam = 0.236; // 6mm in inches
const edgeOff = 0.433; // 11mm from edge (8mm margin + 3mm radius)
const calDots = [
  { x: edgeOff - dotDiam / 2, y: edgeOff - dotDiam / 2 },                          // TL
  { x: 8.27 - edgeOff - dotDiam / 2, y: edgeOff - dotDiam / 2 },                   // TR
  { x: edgeOff - dotDiam / 2, y: 11.69 - edgeOff - dotDiam / 2 },                  // BL
  { x: 8.27 - edgeOff - dotDiam / 2, y: 11.69 - edgeOff - dotDiam / 2 },           // BR
];
calDots.forEach(dot => {
  slide.addShape(pres.shapes.OVAL, {
    x: dot.x, y: dot.y, w: dotDiam, h: dotDiam,
    fill: { color: "000000" },
    line: { color: "000000", width: 0 }
  });
});

// Footer: PRECISIONSHOT.ai branding
slide.addText([
  { text: "PRECISION", options: { bold: true, color: "333333", fontSize: 14, charSpacing: 2, fontFace: "Arial" } },
  { text: "SHOT", options: { bold: true, color: "E31B23", fontSize: 14, charSpacing: 2, fontFace: "Arial" } },
  { text: ".ai", options: { color: "999999", fontSize: 10, fontFace: "Arial" } }
], { x: 0, y: 10.5, w: 8.27, h: 0.4, align: "center", valign: "middle" });

slide.addText("Laser-Trainingsscheibe · A4 · precisionshot.ai", {
  x: 0, y: 10.9, w: 8.27, h: 0.3,
  fontFace: "Arial", fontSize: 7, color: "999999", align: "center", valign: "middle"
});

pres.writeFile({ fileName: "/Users/michaelrubin/Desktop/PrecisionShot/PrecisionShot-Target-A4.pptx" })
  .then(() => console.log("PPTX created!"))
  .catch(err => console.error("Error:", err));
