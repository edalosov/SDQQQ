# Si Dios Quiere Studio

In-browser layer separation and screenprint studio, built on the SDQ2 Screenprint Studio workflow. Open `index.html` locally, or deploy the folder as-is to any static host (e.g. Vercel).

## Workflow
1. **Source / Image**: load a photo; brightness/contrast shape the tone map.
2. **Separate layers**: split the photo into *subject* (e.g. hands) and *background*:
   - *Tone key*: automatic, offline: blur → brightness threshold → remove specks/fill holes.
   - *AI cut-out*: optional, loads `@imgly/background-removal` from jsDelivr and its model (~40 MB) on first use.
   - *Brush*: paint/erase the mask on the **Layer mask** tab (undo, invert, clear, edge softness).
3. **Layer colours**: flat background colour (optional two-colour split) and a flat base colour under the subject.
4. **Ink passes**: each pass targets Subject / Background / Whole image, inks Shadows / Highlights / Solid, as a hard Poster edge or a Halftone, with its own registration drift.
5. **Screenprint finish**: halftone shape/cell/angle (each screen is rotated 15° further), opaque or transparent (multiply) overprint, uneven ink coverage, pinholes, paper grain, and an optional texture scan overlay.
6. **Print**: full-res PNG, a print kit (.zip) with one 300 DPI film per screen plus the subject mask and a recipe, and saved looks stored in the browser.
