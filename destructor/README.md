# Destructor

A browser tool that turns ordinary photos into abstract, distorted canvases: release covers, banners, stories, posters.

**File:** `index.html` — a single self-contained HTML file. No build, no dependencies, no backend.
**Status:** working version 2 (arbitrary aspect ratios added).

---

## 1. Why it exists

Context: a techno project with a steady stream of sketches on SoundCloud and regular releases. It needs a visual identity that is:

- **not AI-generated** — the destruction has to be real, applied to your own photo, not a painted imitation of a glitch;
- **repeatable** — fifteen covers made with one method read as a signature; fifteen different ones read as a folder;
- **fast** — a cover must not become a project of its own and hold up a release.

Hence the core idea of the tool: **a preset is a rule**. You find your set of numbers once, save the string, and from then on every cover is "drop the photo → paste the rule → save". The fixed preset *is* the style.

Source material is your own footage: concrete, rust, wires, mesh, night reflections, blurred neon. Shot on a phone or an Osmo during a 20-minute walk.

---

## 2. Technical basis

- Plain HTML + CSS + vanilla JS. No frameworks, no bundler.
- All processing uses the Canvas 2D API: `getImageData` / `putImageData` and hand-written pixel loops.
- Files are **never uploaded**: `createImageBitmap` from a local `File`, everything lives in the tab's memory.
- The network is only needed for Google Fonts (Archivo, Space Mono). Offline, it falls back to Arial Narrow and the system monospace font.
- Works offline from `file://` and opens with a double click.

---

## 3. Processing pipeline

The order of steps is fixed and deliberate. The logic: **destroy first, then impose a new structure, and only at the end lay down the text.** Blur on its own reads as a mistake; blur + dithering + grain + typography reads as intent.

```
drawBase      crop to the aspect ratio + brightness/contrast/saturation/blur
   ↓
pixelate      downscale to a grid and back up with nearest neighbour
   ↓
sliceShift    random bands shift sideways with edge wrap-around
   ↓
pixelSort     sort pixels in rows/columns within a brightness threshold
   ↓
rgbShift      split the red and blue channels at a given angle
   ↓
dither        Floyd–Steinberg / Atkinson / Bayer 8×8 / hard threshold
   ↓
duotone       map luminance onto a two-colour gradient
   ↓
wear          inversion + grain
   ↓
jpegLoss      N cycles of re-saving as low-quality JPEG
   ↓
typography    two lines with manual per-character tracking
```

**Why dithering comes after sorting:** sorting works on brightness, so it needs the full tonal range. After dithering only 2–8 levels remain, and there is nothing left to sort.

**Why the JPEG cycles come second to last:** compression artefacts should land on the finished structure, not on the source photo; otherwise the later steps simply wipe them out.

**Why typography comes last:** the text must stay clean and legible on top of the destroyed image. That contrast is what separates a cover from a merely broken photo.

---

## 4. Scaling and determinism

Two things make the tool fit for real work rather than just play.

**Reference size `REF = 1000`.** Every pixel parameter (blur, band thickness, sort length, type size) is defined relative to a notional 1000 px canvas. The actual factor is `s = √(w × h) / 1000`, tied to area rather than to one side. As a result, one preset looks the same on a 1:1 square and a 16:9 banner, and you never rebuild settings per format.

**Seed and deterministic noise.** Instead of `Math.random()`, the `mulberry32` PRNG is used, initialised with `seed`. Grain and band shifts draw numbers from one stream in a fixed order. Consequence: **the 760 px preview matches the 3000 px export exactly**, and changing the seed gives another variant of the same rule.

---

## 5. Parameters

All parameters live in a single object `P` and serialise to JSON — that is the "rule string".

### Format
| Key | Range | Description |
|---|---|---|
| `rw`, `rh` | 1–100 | aspect ratio; presets 1:1, 16:9, 9:16, 4:5, 3:2, 2:3, 21:9, 2:1 |

### Frame
| Key | Range | Description |
|---|---|---|
| `cropX` | 0–1 | horizontal frame offset |
| `cropY` | 0–1 | vertical frame offset |
| `zoom` | 1–4 | zoom |

### Base
| Key | Range | Description |
|---|---|---|
| `bright` | 20–220 | brightness, % |
| `contrast` | 20–500 | contrast, % |
| `sat` | 0–250 | saturation, % (0 = black and white) |
| `blur` | 0–60 | blur |
| `pixel` | 0–80 | pixelation block size |

### Slice shift
| Key | Range | Description |
|---|---|---|
| `slAmt` | 0–300 | maximum shift |
| `slCnt` | 1–120 | number of bands |
| `slH` | 1–140 | band thickness |
| `slVert` | bool | vertical instead of horizontal |

### Pixel sort
| Key | Range | Description |
|---|---|---|
| `psOn` | bool | enabled |
| `psDir` | `h` / `v` | rows or columns |
| `psLo` | 0–1 | lower brightness threshold |
| `psHi` | 0–1 | upper brightness threshold |
| `psLen` | 8–1400 | maximum length of one run |
| `psKey` | `lum` `sat` `hue` `r` `b` | sort key |
| `psRev` | bool | reverse order |

### RGB shift
| Key | Range | Description |
|---|---|---|
| `rgbAmt` | 0–120 | channel separation |
| `rgbAng` | 0–360 | direction |

### Dithering
| Key | Range | Description |
|---|---|---|
| `dtMode` | `none` `fs` `atk` `bayer` `thr` | method |
| `dtLev` | 2–8 | number of tonal levels |
| `dtScale` | 1–10 | dither grain size |
| `dtMono` | bool | monochrome or per channel |

### Duotone, wear
| Key | Range | Description |
|---|---|---|
| `duoOn` | bool | enabled |
| `duoA`, `duoB` | hex | shadow and highlight colour |
| `inv` | bool | invert |
| `grain` | 0–90 | grain |
| `jpgIt` | 0–30 | number of re-save cycles |
| `jpgQ` | 1–60 | JPEG quality in the cycles, % |

### Typography, seed
| Key | Range | Description |
|---|---|---|
| `t1`, `t2` | text | top (bold) and bottom (light) line |
| `txPos` | `tl` `tr` `bl` `br` | corner |
| `txSize` | 8–120 | type size |
| `txTrack` | −0.05–0.6 | tracking as a fraction of type size |
| `txCol` | hex | colour |
| `seed` | 1–9999 | noise seed |

---

## 6. Export

- **Save** — the active photo in the current aspect ratio. Long side: 1000 / 1500 / 2000 / 3000 px. PNG or JPEG 92%.
- **Batch** — every loaded photo with one preset. This is the main mode for a series.
- **Save set** — one frame in four formats in a row: 1:1 (release), 16:9 (banner, YouTube), 9:16 (stories, Reels), 4:5 (post). Same seed and preset, so everything reads as one piece.

Naming: `{file name}__{rw}x{rh}.{png|jpg}`.

---

## 7. Interface design

The direction is risograph and zines, not a "photo studio". It is the same world techno graphics came from: cheap print, a limited palette, monospaced text.

- Palette: paper `#EDE9E0`, second surface `#E2DDD2`, ink `#14110F`, muted text `#6B655C`, riso-pink accent `#FF3D6E`, utility blue `#1B4FA0`.
- Typography: **Archivo 900** for headings, **Space Mono** for the whole interface.
- Zero border radius, solid 1 px rules, sliders with square thumbs.
- A background of fine horizontal raster lines imitating scanlines.
- The canvas is framed by corner crop marks, as on a proof print.
- Parameter groups are numbered 01–11 because they really are the pipeline sequence, not decoration.
- The key element is the **rule strip** under the canvas: live JSON of the current preset, always in view. The project's central idea is made a visible part of the interface.

Responsive down to mobile, visible keyboard focus, `prefers-reduced-motion` respected.

---

## 8. Known limitations

- Processing is synchronous on the main thread. Pixel sort and dithering at 3000×3000 take a few seconds, and the interface freezes meanwhile.
- JPEG cycles at large sizes are the slowest operation: each cycle is a full encode and decode.
- No action history or undo.
- Presets are not kept between sessions — only manual copying of the string.
- Typography: exactly two lines, one typeface, four positions.
- Batch export and the format set cannot be combined.
- This is **not** real data-bending: the file's bytes are not corrupted; the destruction happens at the pixel level. Visually close, conceptually not the same thing.

---

## 9. Ideas for development

**Performance**
- Move the pipeline into a Web Worker with OffscreenCanvas so the interface does not block.
- A progress bar with real percentages instead of an indeterminate strip.

**New effects**
- Real data-bending: read the file as an `ArrayBuffer`, corrupt bytes after the header, show the result. This closes the one conceptual gap.
- Slit-scan from video: one pixel column from every frame of a clip, turning time into space. The material already exists — Osmo footage.
- Coarse halftone, separate from dithering.
- Texture overlay: paper scan, photocopy, scratches — via multiply or overlay.
- Curves and levels instead of plain brightness and contrast.
- Displacement map: distorting one image by the brightness of another.

**Workflow**
- A preset library in `localStorage` with names and thumbnails.
- Contact sheet: 9 variants of one preset with different seeds at once, pick with a click.
- Drag the frame with the mouse instead of two sliders.
- History and undo.
- Export the rule as a short code instead of long JSON.

**Long term**
- Tie it to real audio: analyse a track and generate the cover from its spectrum. A cover as an indexical trace of the music itself — conceptually the strongest option of all.

---

## 10. Picking it up later

What not to break when extending it:

1. **Pipeline order.** It is designed, not accidental.
2. **Determinism.** Any new effect with randomness must draw numbers from the same `rand`, or the preview will stop matching the export.
3. **Size independence.** Every new px parameter is multiplied by `s`.
4. **One file, zero dependencies.** The whole value is that it opens with a double click and still works in five years.

---

## 11. Working recipes

Starting points to push off from.

**Industrial photocopy** — contrast 280, saturation 0, Atkinson dithering, grain size 2, 2 levels, grain 15.

**Drips** — pixel sort on, columns, thresholds 0.15 / 0.70, max length 900, key "luminance", contrast 200, grain 8.

**Signal decay** — slice shift: amount 120, count 40, thickness 6; RGB shift 25 at 90°; 14 JPEG cycles at 8% quality.

**Two-colour print** — saturation 0, Bayer dithering, grain size 3, duotone from two contrasting colours.

Then pick one and don't change it for a year.
