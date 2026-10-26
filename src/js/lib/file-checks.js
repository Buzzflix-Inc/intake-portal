// ---- Blank-file guard (documents & timesheets) ----
// Two checks: (1) reject files that are empty or implausibly tiny to
// contain real content, and (2) for photos/scans, sample the image on
// a canvas and flag ones that are almost entirely a single light color
// (i.e. a blank sheet of paper). This is a heuristic, not perfect —
// very light handwriting or faint print could still slip through, and
// it only runs on image files (not PDFs).
function isImageFile(file) {
  return !!(file.type && file.type.startsWith("image/"));
}

function checkLikelyBlankImage(file) {
  return new Promise((resolve) => {
    if (!isImageFile(file)) { resolve(false); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const size = 120;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let sum = 0, sumSq = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += lum; sumSq += lum * lum; n++;
        }
        const mean = sum / n;
        const variance = Math.max(sumSq / n - mean * mean, 0);
        const stdDev = Math.sqrt(variance);
        URL.revokeObjectURL(url);
        // Mostly-white (mean) AND almost no variation (stdDev) reads as blank paper.
        resolve(mean > 235 && stdDev < 10);
      } catch (e) {
        URL.revokeObjectURL(url);
        resolve(false); // fail open — never block on a canvas error
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    img.src = url;
  });
}

const MIN_UPLOAD_BYTES = 200; // anything smaller can't realistically hold real content

function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

// Loads pdf.js from a CDN on first use (only needed when someone uploads
// a PDF); cached after that so it's not re-fetched on every upload.
let pdfjsReady = null;
function ensurePdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("Could not load PDF checker"));
    document.head.appendChild(script);
  });
  return pdfjsReady;
}

function pixelStats(imageData) {
  const { data } = imageData;
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum; sumSq += lum * lum; n++;
  }
  const mean = sum / n;
  const variance = Math.max(sumSq / n - mean * mean, 0);
  return { mean, stdDev: Math.sqrt(variance) };
}

// Renders page 1 and checks both the extracted text AND the rendered
// pixels — a page that's visually blank but has invisible/zero-width
// text (rare) or has real text but a render glitch shouldn't get
// rejected off just one signal, so both have to agree it's blank.
async function checkLikelyBlankPdf(file) {
  try {
    const pdfjsLib = await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);

    const textContent = await page.getTextContent();
    const text = textContent.items.map((it) => it.str).join("").trim();
    if (text.length > 0) return false; // has real text — not blank

    const viewport = page.getViewport({ scale: 0.6 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const { mean, stdDev } = pixelStats(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return mean > 235 && stdDev < 10;
  } catch (e) {
    return false; // fail open — never block on a parsing error
  }
}

async function checkLikelyBlank(file) {
  if (isImageFile(file)) return checkLikelyBlankImage(file);
  if (isPdfFile(file)) return checkLikelyBlankPdf(file);
  return false;
}
