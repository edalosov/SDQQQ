# Si Dios Quiere

Browser tool, built step by step.

**Step 1: Separate the hands.** Click on the hands and an AI model selects them. Click again to add missed parts, or use the brush, undo and invert for fixes.
**Step 2: Colour each layer.** Pick one colour for the hands and one for the background. Each layer can keep its shading, be a flat colour, or stay original. Download a PNG.

Everything runs locally in the browser. Photos are never uploaded.

## Run locally
The app uses ES modules and WebAssembly, so serve it over HTTP instead of opening the file directly:

    python3 -m http.server 8000

Then open http://localhost:8000. It also deploys as-is to any static host (Vercel, Netlify, GitHub Pages).

## Third-party
- `vendor/mediapipe/`: MediaPipe Tasks Vision 1.2.2 (Apache-2.0).
- `models/magic_touch.tflite`: MediaPipe interactive segmenter model (Apache-2.0).
