# Si Dios Quiere

Browser tool, built step by step.

**Step 1: Separate the hands.** Drop a photo on the Photo box (or click to choose one). Click on the hands and an AI model selects them. Click again to add missed parts, or use the brush, undo and invert for fixes.
**Step 2: Print layers.** There are three flat-colour screens, printed in order: 1 background, 2 hands, 3 ink (the photo film, on top). The ink can share the background's colour. The film is a solid stencil or halftone dots, and ink amount is set separately for hands and background. Each ink-film slider has a dice and a random range (min–max); "Randomize ink film" rolls them all, and a range with both handles together locks that slider. Default ranges: ink on hands 40–70, ink on background 15–65, detail 0–2, dot size 3–6. "Shuffle colours between layers" swaps the current colours between background, hands and ink.

**Download.** You can save a PNG, or a print-files zip containing:
- black-and-white films for each screen, 300 DPI, with registration marks (the background reaches slightly under the hands so no paper shows at the edge);
- a transparent colour PNG for each layer;
- a recipe with print order, colours, size and halftone lines per inch.

Everything runs locally in the browser. Photos are never uploaded.

## Run locally
The app uses ES modules and WebAssembly, so serve it over HTTP instead of opening the file directly:

    python3 -m http.server 8000

Then open http://localhost:8000. It also deploys as-is to any static host (Vercel, Netlify, GitHub Pages).

## Third-party
- `vendor/mediapipe/`: MediaPipe Tasks Vision 1.2.2 (Apache-2.0).
- `models/magic_touch.tflite`: MediaPipe interactive segmenter model (Apache-2.0).
