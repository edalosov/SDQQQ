# Si Dios Quiere

Browser tool, built step by step.

**Step 1: Separate the hands.** Drop a photo on the Photo box (or click to choose one). Click on the hands and an AI model selects them. Click again to add missed parts, or use the brush, undo and invert for fixes.
**Step 2: Print layers.** There are three flat-colour screens, printed in order: 1 background, 2 hands, 3 ink (the photo film, on top). The ink can share the background's colour. The film is halftone dots (default) or a solid stencil, and ink amount is set separately for hands and background. Each ink-film slider has a dice and a random range (min–max); "Randomize ink film" rolls them all, and a range with both handles together locks that slider. Default ranges: ink on hands 40–70, ink on background 15–65, detail 0–2, dot size 3–6. Each print layer has a lock. "Random" picks new, clearly different colours for the unlocked layers, and "Shuffle" swaps the current colours between the unlocked layers. "Randomize everything" (between steps 1 and 2) does random colours and every ink-film slider at once, respecting locks and ranges.

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

## Layout
On screens 1200 px and wider, the controls sit in two columns beside the image, so everything is visible without scrolling. Below that, the controls stack in one column beside or under the image, and the image stays pinned while you scroll.
