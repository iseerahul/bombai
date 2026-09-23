# Sprite brief

Prompts for generating (or commissioning) the artwork that replaces the
hand-drawn canvas shapes in `src/map/sprites.ts`.

---

## The constraint everything else follows from

**This is a map seen from directly above.** Every sprite must be drawn in
**orthographic top-down view** — you are looking straight down at the object
from the sky. Not three-quarter, not isometric, not side-on.

Image generators get this wrong by default and will hand you a side view of a
boat unless you fight them on it. Say "top-down", "bird's-eye", "seen directly
from above", and "orthographic" in the same prompt, every time.

The one exception is clouds, which sit *between the viewer and the ground* — so
you see their tops, lit from above.

## Shared style rules — paste into every prompt

> Clean modern vector illustration, flat shapes with soft subtle gradients, gentle
> ambient occlusion, no hard black outlines, no cel-shading, no cartoon faces, no
> text, no logos, no drop shadow, no ground plane, no background scenery.
> Isolated single object, centred, generous transparent padding on all sides.
> Muted realistic palette. Rendered on a pure transparent background (alpha).

Two reasons for "no drop shadow": the engine draws cloud shadows itself as a
separate sprite so they can lag and scale independently, and a baked shadow on a
train would rotate with the train and point the wrong way.

## ⚠️ On transparency

Most image generators produce unreliable alpha. Generate on a **flat chroma
background** (`#FF00FF` magenta — it appears in none of these objects) and key
it out afterwards, or use a model that genuinely supports transparency. Check
the edges: a magenta fringe around a white cloud will be very visible against
the map.

---

## 1. Clouds — 5 variants

**Size:** 1280 × 680 px each (engine draws at 320 × 170, so this is 4× for retina)

> Top-down aerial view of a single isolated cumulus cloud, seen from directly
> above from a high-altitude aircraft. Soft billowing puffs, bright sunlit white
> on the upper surfaces, cool pale blue-grey in the crevices between puffs.
> Wispy, feathered, indistinct edges fading gradually to fully transparent — no
> defined outline anywhere. Lit from the top-left by a high sun. Volumetric and
> three-dimensional, not a flat sticker. Photorealistic softness with a clean
> illustrative palette. Isolated on a transparent background, generous padding.

Generate **five distinctly different silhouettes** — one long and streaky, one
compact and dense, one wide and broken, two mid-size irregular. Repetition is
what makes a sky look fake, and the engine cycles through them.

## 2. Cloud shadow — 1 sprite

**Size:** 1280 × 600 px

> A soft diffuse shadow blob seen from above, as a cloud casts on the ground.
> Irregular elongated organic shape. Very soft feathered edges fading completely
> to transparent. Uniform dark slate-blue-grey at roughly 18% opacity at the
> centre, no internal detail, no texture, no outline. Transparent background.

Should loosely echo a cloud silhouette without matching any one of them.

## 3. Birds — 10-frame flap cycle

**Size:** 2560 × 256 px sprite sheet — **10 frames of 256 × 256, laid out
horizontally in a single row**

> Sprite sheet of a seagull in flight seen from directly above, orthographic
> bird's-eye view, looking down at its back and outstretched wings. Ten frames
> in one horizontal row showing a single complete wingbeat cycle: frame 1 wings
> fully raised above the body, frames 2–5 sweeping down, frame 6 fully extended
> downward below the body, frames 7–10 sweeping back up to the start so the loop
> is seamless. Head pointing to the right in every frame, body centred and in
> exactly the same position in all ten frames. Dark charcoal-grey silhouette with
> soft edges, subtle paler grey on the wing undersides. Simple and readable at
> very small size. Consistent scale and lighting across all frames. Transparent
> background, each frame centred in its own cell.

**The two things that break this:** the body drifting between frames (causes a
jitter when they play), and frame 10 not flowing into frame 1 (causes a hitch
every cycle). Check both before accepting.

## 4. Boats — 3 variants

**Size:** 576 × 272 px each

Small fishing boat:

> Top-down orthographic view of a small wooden fishing boat, seen from directly
> above looking down at the open deck. Pointed bow at the right, squared stern
> at the left. Weathered pale wood deck, small blue wheelhouse near the stern,
> coiled ropes and nets on the deck. Soft realistic shading, gentle gradient on
> the hull sides. No water, no wake, no shadow. Transparent background.

Passenger ferry:

> Top-down orthographic view of a small passenger ferry, seen from directly
> above. White hull, pointed bow at the right, long covered cabin running most
> of the length with a flat roof, rows of skylights along the roof. Clean modern
> vector illustration with subtle gradients. No water, no wake, no shadow.
> Transparent background.

Cargo ship:

> Top-down orthographic view of a small cargo ship, seen from directly above.
> Dark red hull, pointed bow at the right, flat deck stacked with a few small
> shipping containers in muted blue, green and rust, white superstructure block
> near the stern. Soft realistic shading. No water, no wake, no shadow.
> Transparent background.

**Every boat must point right.** The engine rotates from a right-facing rest
position; one boat drawn facing left will sail backwards forever.

## 5. Train carriages — 2 per line colour

**Size:** 448 × 208 px each

Engine:

> Top-down orthographic view of the lead carriage of a modern metro train, seen
> from directly above looking down at its roof. Rounded nose at the right end,
> flat coupling at the left. Roof painted in {COLOUR}, with a pale grey
> air-conditioning unit running down the centre. A row of four rectangular
> windows visible along each side edge, glowing pale blue-white. Two small
> headlights at the rounded nose. Clean modern vector illustration, subtle
> gradient with the roof lighter along its spine. No track, no shadow.
> Transparent background.

Middle carriage:

> Same as above, but both ends squared flat for coupling, and no headlights.
> Identical width, roof colour and window spacing so it tiles seamlessly behind
> the engine.

Generate a pair per line colour, matching the `colour` field in
`rail_lines.geojson` — Metro Line 1 blue, Line 2 red, Line 3 aqua, Line 7
orange, Monorail. The engine already reads those colours from OSM.

## 6. Autumn leaves — 5 variants

**Size:** 224 × 224 px each

> Top-down view of a single dry autumn leaf lying flat, seen from directly
> above. {SHAPE: a maple leaf / an oval peepal leaf with a long drip tip / a
> narrow willow leaf / a simple rounded leaf / a small compound neem leaflet}.
> Warm autumn colour — {burnt orange / deep amber / golden yellow / rust red /
> ochre brown} — with visible central vein and finer side veins, subtle colour
> variation across the blade, slightly curled edge. Flat matte illustration with
> soft shading. No stem shadow, no background. Transparent background.

## 7. Rain splash — 6-frame ripple

**Size:** 1536 × 256 px sprite sheet — **6 frames of 256 × 256, horizontal row**

> Sprite sheet of a water ripple expanding, seen from directly above. Six frames
> in one horizontal row: frame 1 a tiny bright ring at the centre, each
> subsequent frame the ring wider, thinner and more transparent, frame 6 a very
> large very faint ring almost gone. Pale blue-white thin outline rings only, no
> fill, no droplet, no splash crown. Concentric and perfectly centred in every
> frame. Transparent background.

---

## Delivering them

Drop the files into `public/sprites/` and they load with no engine changes —
`sprites.ts` swaps from drawing shapes to `new Image()` loads. The functions
already return canvases, so the call sites don't change at all.

Naming the loader expects:

```
public/sprites/
  cloud-1.png … cloud-5.png
  cloud-shadow.png
  bird-sheet.png          (10 frames, one row)
  boat-fishing.png  boat-ferry.png  boat-cargo.png
  train-{colour}-engine.png   train-{colour}-car.png
  leaf-1.png … leaf-5.png
  splash-sheet.png        (6 frames, one row)
```

**Budget check:** at 4× retina these total roughly 2–4 MB of PNG. That is a lot
on a 4G connection for decoration. Either export at 2× instead of 4×, compress
hard as WebP, or lazy-load the whole set only when someone first turns an effect
on — the last is probably right, since most people never will.
