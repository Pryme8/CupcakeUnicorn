import Phaser from 'phaser'

/**
 * Art for Pegasus Jump, all of it on one pixel grid.
 *
 * The rule the whole look depends on: **every sprite is drawn at exactly
 * `PIXEL` world px per art px.** Mixed pixel sizes are the one thing that stops
 * a screen reading as a single piece of art, so the clouds, butterflies, wings,
 * cupcake and Pegasus all share this grid.
 *
 * The 2D game's sprites are painted rather than chunky, so the grid is fine (2),
 * not coarse. The unicorn arrives at 56 px and is resampled to 50, the cupcake
 * 32 to 30 — close enough to native that almost nothing is lost — and the
 * clouds and butterflies are generated at a matching 26-75 px so they carry the
 * same density instead of looking blocky beside them.
 *
 * Generated shapes are rasterised with hard edges (no anti-aliasing) and given
 * a one-pixel skirt, which keeps them crisp when the canvas is scaled.
 */

/** World px per art px. */
export const PIXEL = 2

// ---------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------

/** A grid of layer ids; 0 is empty, any other value indexes a colour. */
type Mask = { w: number; h: number; cells: Uint8Array }

const mask = (w: number, h: number): Mask => ({ w, h, cells: new Uint8Array(w * h) })

const poke = (m: Mask, x: number, y: number, layer: number) => {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return
  m.cells[y * m.w + x] = layer
}

/**
 * Hard-edged ellipse. Pixel centres are tested, so the boundary lands on whole
 * pixels and there is no soft fringe to blur when the sprite is scaled up.
 * `onlyOver` lets a highlight paint over one layer but not over empty sky.
 */
const ellipse = (m: Mask, cx: number, cy: number, rx: number, ry: number, layer: number, onlyOver = 0) => {
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(m.w - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(m.h - 1, Math.ceil(cy + ry))
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - cx) / rx
      const dy = (y + 0.5 - cy) / ry
      if (dx * dx + dy * dy > 1) continue
      if (onlyOver && m.cells[y * m.w + x] !== onlyOver) continue
      m.cells[y * m.w + x] = layer
    }
  }
}

/** Repaints filled cells from `fromRow` down, for a shaded underside. */
const shadeRows = (m: Mask, fromRow: number, from: number, to: number) => {
  for (let y = fromRow; y < m.h; y += 1) {
    for (let x = 0; x < m.w; x += 1) {
      if (m.cells[y * m.w + x] === from) m.cells[y * m.w + x] = to
    }
  }
}

/**
 * Turns a mask into a canvas texture, adding a one-pixel outline around the
 * silhouette (so the sprite grows by 1 px a side) and setting nearest filtering
 * so it is never resampled soft.
 */
const paint = (scene: Phaser.Scene, key: string, m: Mask, colours: Record<number, string>, outline?: string) => {
  if (scene.textures.exists(key)) return
  const pad = outline ? 1 : 0
  const w = m.w + pad * 2
  const h = m.h + pad * 2
  const texture = scene.textures.createCanvas(key, w, h)
  if (!texture?.context) {
    texture?.destroy()
    return
  }
  const ctx = texture.context
  ctx.clearRect(0, 0, w, h)

  const filled = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false
    const layer = m.cells[y * m.w + x] ?? 0
    return layer !== 0 && colours[layer] !== undefined
  }

  for (let y = 0; y < m.h; y += 1) {
    for (let x = 0; x < m.w; x += 1) {
      if (!filled(x, y)) continue
      ctx.fillStyle = colours[m.cells[y * m.w + x] as number] as string
      ctx.fillRect(x + pad, y + pad, 1, 1)
    }
  }

  if (outline) {
    ctx.fillStyle = outline
    for (let y = -1; y <= m.h; y += 1) {
      for (let x = -1; x <= m.w; x += 1) {
        if (filled(x, y)) continue
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          ctx.fillRect(x + pad, y + pad, 1, 1)
        }
      }
    }
  }

  texture.refresh()
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Strings to mask, for the few sprites small enough to be worth hand-placing. */
const fromRows = (rows: string[], legend: Record<string, number>): Mask => {
  const w = Math.max(...rows.map((r) => r.length))
  const m = mask(w, rows.length)
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const layer = legend[row[x] as string]
      if (layer) poke(m, x, y, layer)
    }
  })
  return m
}

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------

/**
 * Every cloud is the same 26 rows tall with its landing ledge on row 9 and its
 * deepest row at 24 — fifteen art pixels of belly, which times PIXEL is the
 * 30 world px CLOUD.thickness encodes for the underside bounce.
 */
export const CLOUD_BODY_ROWS = 26
export const CLOUD_TOP_ROW = 9
export const CLOUD_BELLY_ROWS = 15

/** Art widths; at PIXEL these are 80, 110 and 150 world px across. */
const CLOUD_WIDTHS = [40, 55, 75]
/** Crown puffs per size, as [cx, cy, r] in art px. */
const CLOUD_PUFFS: [number, number, number][][] = [
  [
    [12, 10, 6],
    [22, 8, 7],
    [31, 11, 5],
  ],
  [
    [14, 10, 7],
    [28, 8, 8],
    [42, 10, 6.5],
  ],
  [
    [16, 11, 7],
    [33, 9, 9],
    [52, 9, 7.5],
    [66, 12, 5.5],
  ],
]

export const CLOUD_HALF_WIDTHS = CLOUD_WIDTHS.map((w) => (w * PIXEL) / 2)
export const cloudKey = (size: number) => `skyjump-px-cloud-${size}`

const LIT = 1
const SHADE = 2
const CLOUD_COLOURS: Record<number, string> = { [LIT]: '#ffffff', [SHADE]: '#cfdff5' }
const CLOUD_OUTLINE = '#8ea6cc'

const createClouds = (scene: Phaser.Scene) => {
  CLOUD_WIDTHS.forEach((w, index) => {
    const m = mask(w, CLOUD_BODY_ROWS)
    // One flat body gives a solid ledge to land on...
    ellipse(m, w / 2, 16, w / 2, 8, LIT)
    // ...and the crown puffs break up the top so it is not just a lozenge.
    for (const [cx, cy, r] of CLOUD_PUFFS[index] ?? []) ellipse(m, cx, cy, r, r, LIT)
    shadeRows(m, 21, LIT, SHADE)
    paint(scene, cloudKey(index), m, CLOUD_COLOURS, CLOUD_OUTLINE)
  })
}

// ---------------------------------------------------------------------------
// Butterflies
// ---------------------------------------------------------------------------

const BUTTERFLY_W = 26
const BUTTERFLY_H = 22
/** Wing spread per flutter frame. */
const FLUTTER = [1, 0.72, 0.46]

const UPPER = 1
const GLINT = 2
const LOWER = 3
const BODY = 4

const BUTTERFLY_PALETTES: Record<number, string>[] = [
  { [UPPER]: '#ff7faf', [GLINT]: '#ffc2d9', [LOWER]: '#dd4a81', [BODY]: '#3a2b4d' },
  { [UPPER]: '#ffcf5f', [GLINT]: '#ffe9a8', [LOWER]: '#dd9a22', [BODY]: '#4a3420' },
  { [UPPER]: '#79e6a6', [GLINT]: '#c2f5d8', [LOWER]: '#3fae77', [BODY]: '#2b4a39' },
  { [UPPER]: '#79c2ff', [GLINT]: '#c4e4ff', [LOWER]: '#3d8fd6', [BODY]: '#2b3f5a' },
  { [UPPER]: '#c89bff', [GLINT]: '#e3cfff', [LOWER]: '#8a55cc', [BODY]: '#3a2b4d' },
]
const BUTTERFLY_OUTLINES = ['#7d2f52', '#8a6218', '#2a7352', '#2c5d8c', '#5c3390']

export const BUTTERFLY_COLOURS = BUTTERFLY_PALETTES.length
export const butterflyKey = (colour: number, frame: number) => `skyjump-px-butterfly-${colour}-${frame}`
export const butterflyAnimKey = (colour: number) => `skyjump-px-butterfly-anim-${colour}`

const butterflyMask = (spread: number) => {
  const m = mask(BUTTERFLY_W, BUTTERFLY_H)
  const cx = BUTTERFLY_W / 2
  const cy = 11
  for (const dir of [-1, 1]) {
    ellipse(m, cx + dir * 6.6 * spread, cy - 3.5, 6.2 * spread, 6.4, UPPER)
    ellipse(m, cx + dir * 5.0 * spread, cy + 4.5, 4.6 * spread, 5.2, LOWER)
    ellipse(m, cx + dir * 7.8 * spread, cy - 5.4, 2.6 * spread, 2.3, GLINT, UPPER)
  }
  ellipse(m, cx, cy, 1.6, 8.5, BODY)
  for (let i = 0; i < 4; i += 1) {
    poke(m, Math.round(cx - 2 - i), 3 - i, BODY)
    poke(m, Math.round(cx + 1 + i), 3 - i, BODY)
  }
  return m
}

const createButterflies = (scene: Phaser.Scene) => {
  BUTTERFLY_PALETTES.forEach((palette, colour) => {
    FLUTTER.forEach((spread, frame) => {
      paint(scene, butterflyKey(colour, frame), butterflyMask(spread), palette, BUTTERFLY_OUTLINES[colour])
    })
    const key = butterflyAnimKey(colour)
    if (scene.anims.exists(key)) return
    scene.anims.create({
      key,
      frames: [0, 1, 2, 1].map((frame) => ({ key: butterflyKey(colour, frame) })),
      frameRate: 10,
      repeat: -1,
    })
  })
}

// ---------------------------------------------------------------------------
// Resampling the 2D game's own sprites onto the grid
// ---------------------------------------------------------------------------

type Source = CanvasImageSource & { width: number; height: number }

/**
 * Box downsample with a hard alpha cut. Averaging alone leaves a soft
 * anti-aliased rim, which is what makes a sprite look out of place beside
 * generated art; the cut keeps the silhouette crisp.
 */
const resample = (source: Source, outW: number, outH: number) => {
  const sw = source.width
  const sh = source.height
  const scratch = document.createElement('canvas')
  scratch.width = sw
  scratch.height = sh
  const sctx = scratch.getContext('2d')
  if (!sctx) return null
  sctx.drawImage(source, 0, 0)
  const src = sctx.getImageData(0, 0, sw, sh).data

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')
  if (!octx) return null
  const img = octx.createImageData(outW, outH)

  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const x0 = Math.floor((x * sw) / outW)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / outW))
      const y0 = Math.floor((y * sh) / outH)
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / outH))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * sw + sx) * 4
          const alpha = (src[i + 3] ?? 0) / 255
          r += (src[i] ?? 0) * alpha
          g += (src[i + 1] ?? 0) * alpha
          b += (src[i + 2] ?? 0) * alpha
          a += alpha
          n += 1
        }
      }
      const o = (y * outW + x) * 4
      if (a === 0 || a / n < 0.42) continue
      img.data[o] = Math.round(r / a)
      img.data[o + 1] = Math.round(g / a)
      img.data[o + 2] = Math.round(b / a)
      img.data[o + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}

const adopt = (scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement) => {
  if (scene.textures.exists(key)) return
  const texture = scene.textures.createCanvas(key, canvas.width, canvas.height)
  if (!texture?.context) {
    texture?.destroy()
    return
  }
  texture.context.drawImage(canvas, 0, 0)
  texture.refresh()
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
}

const sourceOf = (scene: Phaser.Scene, key: string) =>
  scene.textures.get(key)?.getSourceImage() as Source | undefined

/** 50 x PIXEL = 100 world px, and only a 56 -> 50 step down from native. */
export const UNICORN_ART = 50
export const CUPCAKE_ART = 30
export const PX_UNICORN_ANIM = 'skyjump-px-unicorn-fly'
export const PX_CUPCAKE = 'skyjump-px-cupcake'
export const pxUnicornFrame = (index: number) => `skyjump-px-unicorn-${index}`

const createQuantizedActors = (scene: Phaser.Scene, unicornFrames: string[], cupcakeKey: string) => {
  unicornFrames.forEach((key, index) => {
    const src = sourceOf(scene, key)
    if (!src?.width) return
    const canvas = resample(src, UNICORN_ART, UNICORN_ART)
    if (canvas) adopt(scene, pxUnicornFrame(index), canvas)
  })

  const cake = sourceOf(scene, cupcakeKey)
  if (cake?.width) {
    const canvas = resample(cake, CUPCAKE_ART, CUPCAKE_ART)
    if (canvas) adopt(scene, PX_CUPCAKE, canvas)
  }

  const available = unicornFrames.map((_, i) => pxUnicornFrame(i)).filter((k) => scene.textures.exists(k))
  if (available.length && !scene.anims.exists(PX_UNICORN_ANIM)) {
    scene.anims.create({
      key: PX_UNICORN_ANIM,
      frames: available.map((key) => ({ key })),
      frameRate: 10,
      repeat: -1,
    })
  }
}

// ---------------------------------------------------------------------------
// Wings
// ---------------------------------------------------------------------------

/**
 * The 2D game already has a wing, drawn with vectors. Rather than redraw it,
 * each flap pose is rendered from that art at an angle and then resampled onto
 * the grid: the pose is baked into the frame, so nothing is rotated at runtime
 * (rotating a pixel sprite shears its own grid).
 */
/** Resample factor shared with the unicorn, so the wing has the same density. */
const NATIVE_TO_ART = UNICORN_ART / 56
export const WING_ANIM = 'skyjump-px-wing'
export const wingKey = (frame: number) => `skyjump-px-wing-${frame}`
const WING_ANGLES = [-0.5, 0.05, 0.6]

const createWings = (scene: Phaser.Scene, sourceKey: string) => {
  const src = sourceOf(scene, sourceKey)
  if (!src?.width) return

  WING_ANGLES.forEach((angle, frame) => {
    if (scene.textures.exists(wingKey(frame))) return
    // Canvas just big enough for the rotated art: padding beyond that would
    // spend art pixels on empty space and shrink the wing on the grid.
    const cos = Math.abs(Math.cos(angle))
    const sin = Math.abs(Math.sin(angle))
    const spin = document.createElement('canvas')
    spin.width = Math.ceil(src.width * cos + src.height * sin)
    spin.height = Math.ceil(src.width * sin + src.height * cos)
    const sctx = spin.getContext('2d')
    if (!sctx) return
    sctx.translate(spin.width / 2, spin.height / 2)
    sctx.rotate(angle)
    sctx.drawImage(src, -src.width / 2, -src.height / 2)

    const canvas = resample(
      spin as unknown as Source,
      Math.max(1, Math.round(spin.width * NATIVE_TO_ART)),
      Math.max(1, Math.round(spin.height * NATIVE_TO_ART))
    )
    if (canvas) adopt(scene, wingKey(frame), canvas)
  })

  if (!scene.anims.exists(WING_ANIM) && scene.textures.exists(wingKey(0))) {
    scene.anims.create({
      key: WING_ANIM,
      frames: [0, 1, 2, 1].map((frame) => ({ key: wingKey(frame) })),
      frameRate: 12,
      repeat: -1,
    })
  }
}

// ---------------------------------------------------------------------------
// HUD and effects
// ---------------------------------------------------------------------------

/** A 16x14 butterfly for the counter, so the HUD sits on the grid too. */
export const HUD_BUTTERFLY = 'skyjump-px-hud-butterfly'

const createHudIcon = (scene: Phaser.Scene) => {
  const m = mask(16, 14)
  for (const dir of [-1, 1]) {
    ellipse(m, 8 + dir * 4, 5, 3.8, 4, UPPER)
    ellipse(m, 8 + dir * 3, 10, 2.8, 3.2, LOWER)
  }
  ellipse(m, 8, 7, 1, 5.5, BODY)
  paint(scene, HUD_BUTTERFLY, m, BUTTERFLY_PALETTES[0] as Record<number, string>, BUTTERFLY_OUTLINES[0])
}

export const PIXEL_TEXTURES = {
  sparkle: 'skyjump-px-sparkle',
  haze: 'skyjump-px-haze',
}

const createSparkle = (scene: Phaser.Scene) => {
  paint(scene, PIXEL_TEXTURES.sparkle, fromRows(['..W..', '.WWW.', 'WWWWW', '.WWW.', '..W..'], { W: 1 }), {
    1: '#ffffff',
  })
}

/** The soft backdrop band. Deliberately not crisp: it reads as distance. */
const createHaze = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PIXEL_TEXTURES.haze)) return
  const w = 320
  const h = 110
  const g = scene.add.graphics()
  for (let i = 0; i < 9; i += 1) {
    const t = i / 8
    g.fillStyle(0xffffff, 0.09)
    g.fillEllipse(w * (0.1 + t * 0.8), h * (0.42 + Math.sin(t * 5) * 0.16), w * 0.34, h * 0.56)
  }
  g.generateTexture(PIXEL_TEXTURES.haze, w, h)
  g.destroy()
}

export const createPixelArt = (
  scene: Phaser.Scene,
  unicornFrames: string[],
  cupcakeKey: string,
  wingSourceKey: string
) => {
  createClouds(scene)
  createButterflies(scene)
  createHudIcon(scene)
  createSparkle(scene)
  createHaze(scene)
  createQuantizedActors(scene, unicornFrames, cupcakeKey)
  createWings(scene, wingSourceKey)
}
