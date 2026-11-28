import Phaser from 'phaser'

/**
 * Art for Pegasus Jump, all of it on one pixel grid.
 *
 * The rule the whole look depends on: **every sprite is drawn at exactly
 * `PIXEL` world px per art px.** Mixed pixel sizes are the one thing that stops
 * a screen reading as a single piece of art, so the clouds, butterflies,
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

/**
 * Every platform in every zone is drawn on the same grid as a cloud: the same
 * 26 rows, the same landing ledge on row 9, the same three widths. A saucer
 * and a cloud are the same shape to the simulation and to the camera, and only
 * the picture changes — so collision, the sprite origin and the squash on a
 * bounce are written once and cannot drift apart from the art.
 */
export const platformKey = (kind: string, size: number) => `skyjump-px-plat-${kind}-${size}`
export const cloudKey = (size: number) => platformKey('cloud', size)

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
// The other zones' platforms
// ---------------------------------------------------------------------------

/*
 * Cirrus, rock, saucer, planet, halo. Each fills the same 26-row mask with its
 * landing surface on row 9, so rows 0-8 are the part that stands above where
 * you land — a cloud's crown, a saucer's dome, a halo's ring.
 */

const A = 1
const B = 2
const C = 3
const D = 4

type Platform = {
  colours: Record<number, string>
  outline: string
  draw: (m: Mask, w: number) => void
}

const PLATFORMS: Record<string, Platform> = {
  // Thin high cirrus: the cloud cover breaking up as the air gives out.
  wisp: {
    colours: { [A]: '#ffffff', [B]: '#d4e4fa' },
    outline: '#9db4d8',
    draw: (m, w) => {
      ellipse(m, w * 0.5, 12, w * 0.5, 3.4, A)
      ellipse(m, w * 0.28, 10.4, w * 0.24, 1.9, A)
      ellipse(m, w * 0.66, 10.2, w * 0.2, 1.7, A)
      ellipse(m, w * 0.84, 12.5, w * 0.14, 1.3, A)
      shadeRows(m, 13, A, B)
    },
  },

  // Tumbling rock. The craters are painted over the body only, so they never
  // punch a hole in the silhouette.
  asteroid: {
    colours: { [A]: '#9a9088', [B]: '#6d655f', [C]: '#7f766f' },
    outline: '#4a443f',
    draw: (m, w) => {
      ellipse(m, w / 2, 16, w / 2 - 1, 7.4, A)
      ellipse(m, w * 0.27, 11.2, w * 0.17, 3.4, A)
      ellipse(m, w * 0.63, 10.6, w * 0.21, 3.9, A)
      ellipse(m, w * 0.4, 14, 2.6, 1.7, C, A)
      ellipse(m, w * 0.68, 17.5, 3.1, 2.1, C, A)
      ellipse(m, w * 0.2, 17, 2.2, 1.5, C, A)
      shadeRows(m, 19, A, B)
    },
  },

  // A disc with a dome above the deck and lamps under it. The dome sits in
  // rows 3-9, which is the space a cloud spends on its crown.
  saucer: {
    colours: { [A]: '#b9c6d8', [B]: '#7c8ba3', [C]: '#8ef0ff', [D]: '#ffe066' },
    outline: '#3f4a5e',
    draw: (m, w) => {
      ellipse(m, w / 2, 9.5, w * 0.2, 5.2, C)
      ellipse(m, w / 2, 8.4, w * 0.13, 3.1, A, C)
      ellipse(m, w / 2, 12, w / 2 - 1, 3.2, A)
      shadeRows(m, 13, A, B)
      for (let i = 0; i < 3; i += 1) ellipse(m, w * (0.3 + 0.2 * i), 15, 1.5, 1.5, D)
    },
  },

  /*
   * A banded gas giant, seen nearly edge-on. It has to be an oblate ellipse
   * rather than a circle: the mask is 26 rows and up to 75 wide, and a sphere
   * drawn to those rows would be a third the width of the box you actually
   * land on — a planet you fall straight past on either side.
   */
  planet: {
    colours: { [A]: '#d98f6a', [B]: '#b56a4c', [C]: '#f0c9a0', [D]: '#e8d7b8' },
    outline: '#6b3b2a',
    draw: (m, w) => {
      const rx = w / 2 - 1
      const ry = 7.4
      const cy = 9 + ry
      // The ring passes behind, so it is drawn first and the body covers it.
      ellipse(m, w / 2, cy - 1, rx, 2.2, D)
      ellipse(m, w / 2, cy, rx, ry, A)
      ellipse(m, w / 2, cy - ry * 0.45, rx * 0.86, ry * 0.2, C, A)
      ellipse(m, w / 2, cy + ry * 0.3, rx * 0.8, ry * 0.16, C, A)
      shadeRows(m, Math.round(cy + ry * 0.5), A, B)
      // ...and in front of it on the near side, below the body's midline.
      ellipse(m, w / 2, cy + 2.4, rx, 1.6, D)
    },
  },

  // Unicorn heaven: a lit cloud with a halo standing over it.
  halo: {
    colours: { [A]: '#fff3c4', [B]: '#edcf84', [C]: '#ffcc33' },
    outline: '#c9a94a',
    draw: (m, w) => {
      ellipse(m, w / 2, 16, w / 2 - 1, 7.2, A)
      ellipse(m, w * 0.3, 11, w * 0.18, 4, A)
      ellipse(m, w * 0.66, 10.6, w * 0.2, 4.2, A)
      shadeRows(m, 20, A, B)
      // The halo floats clear of the body, so hollowing it cannot eat the
      // ledge: it lives in the rows above where you land. Kept narrow and
      // deep, because a wide flat ring at this size just reads as a gold bar.
      ellipse(m, w / 2, 4.5, 9, 3.4, C)
      ellipse(m, w / 2, 4.5, 6, 1.7, 0)
    },
  },
}

export const PLATFORM_KINDS = Object.keys(PLATFORMS)

const createPlatforms = (scene: Phaser.Scene) => {
  for (const [kind, spec] of Object.entries(PLATFORMS)) {
    CLOUD_WIDTHS.forEach((w, index) => {
      const m = mask(w, CLOUD_BODY_ROWS)
      spec.draw(m, w)
      paint(scene, platformKey(kind, index), m, spec.colours, spec.outline)
    })
  }
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

}

// ---------------------------------------------------------------------------
// The other zones' pickups
// ---------------------------------------------------------------------------

/*
 * A star in space and a feather in heaven take the butterfly's place: same
 * three frames, same per-colour animation, so the renderer treats all three
 * the same way and only the key changes.
 */

const STAR_ROWS = [
  '......X......',
  '.....XXX.....',
  '.....XXX.....',
  '....XXXXX....',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '...XXXXXXX...',
  '...XXXXXXX...',
  '..XXX...XXX..',
  '..XX.....XX..',
  '.XX.......XX.',
  '.X.........X.',
]

const FEATHER_ROWS = [
  '....XX.....',
  '...XXXX....',
  '..XXXXXX...',
  '..XXXXXXX..',
  '.XXXXXXXX..',
  '.XXXXXXXX..',
  '.XXXXXXX...',
  '.XXXXXX....',
  '..XXXXX....',
  '..XXXX.....',
  '...XXX.....',
  '...XX......',
  '....Q......',
  '....Q......',
  '....Q......',
  '....Q......',
  '....Q......',
]

const STAR_PALETTES: Record<number, string>[] = [
  { [UPPER]: '#ffe066', [GLINT]: '#fffbe0', [LOWER]: '#e0a92b' },
  { [UPPER]: '#a8d8ff', [GLINT]: '#eaf6ff', [LOWER]: '#5f9ad6' },
  { [UPPER]: '#ffb3e6', [GLINT]: '#ffe6f7', [LOWER]: '#d966ab' },
]
const STAR_OUTLINES = ['#8a6212', '#2f5d8c', '#8c3f70']

const FEATHER_PALETTES: Record<number, string>[] = [
  // Amber rather than cream: heaven's sky runs gold at the top and near-white
  // at the bottom, and a cream feather disappeared into both ends of it.
  { [UPPER]: '#e8a94f', [GLINT]: '#ffe9b0', [LOWER]: '#b87a2e', [BODY]: '#7d4f1a' },
  { [UPPER]: '#ffd9ec', [GLINT]: '#fff2f8', [LOWER]: '#e0a6c6', [BODY]: '#b9739a' },
  { [UPPER]: '#dff0ff', [GLINT]: '#ffffff', [LOWER]: '#a8c8e6', [BODY]: '#6f93b5' },
]
const FEATHER_OUTLINES = ['#543a12', '#8d5478', '#587892']

/** A twinkle rather than a flap: the glint moves, the shape holds. */
const starMask = (frame: number) => {
  const m = fromRows(STAR_ROWS, { X: UPPER })
  shadeRows(m, 8, UPPER, LOWER)
  const glints: [number, number][][] = [
    [[5, 5], [6, 5], [5, 6]],
    [[6, 4], [6, 5]],
    [[5, 5], [6, 6], [7, 5]],
  ]
  for (const [x, y] of glints[frame % glints.length] ?? []) poke(m, x, y, GLINT)
  return m
}

/** Three leans, so a feather turns over as it falls. */
const featherMask = (frame: number) => {
  const base = fromRows(FEATHER_ROWS, { X: UPPER, Q: BODY })
  const lean = [0, 1, 2][frame % 3] as number
  const m = mask(base.w + 2, base.h)
  for (let y = 0; y < base.h; y += 1) {
    const shift = Math.round((y / (base.h - 1)) * lean)
    for (let x = 0; x < base.w; x += 1) {
      const cell = base.cells[y * base.w + x] ?? 0
      if (cell) poke(m, x + shift, y, cell)
    }
  }
  shadeRows(m, 7, UPPER, LOWER)
  poke(m, 4, 1, GLINT)
  poke(m, 4, 2, GLINT)
  poke(m, 3, 3, GLINT)
  return m
}

type PickupSpec = {
  palettes: Record<number, string>[]
  outlines: string[]
  build: (frame: number) => Mask
}

const PICKUPS: Record<string, PickupSpec> = {
  star: { palettes: STAR_PALETTES, outlines: STAR_OUTLINES, build: starMask },
  feather: { palettes: FEATHER_PALETTES, outlines: FEATHER_OUTLINES, build: featherMask },
}

/** How many palettes each kind has, so the spawner can pick one. */
export const PICKUP_COLOURS: Record<string, number> = {
  butterfly: BUTTERFLY_PALETTES.length,
  star: STAR_PALETTES.length,
  feather: FEATHER_PALETTES.length,
}

export const pickupKey = (kind: string, colour: number, frame: number) =>
  kind === 'butterfly' ? butterflyKey(colour, frame) : `skyjump-px-${kind}-${colour}-${frame}`

export const pickupAnimKey = (kind: string, colour: number) =>
  kind === 'butterfly' ? butterflyAnimKey(colour) : `skyjump-px-${kind}-anim-${colour}`

const createOtherPickups = (scene: Phaser.Scene) => {
  for (const [kind, spec] of Object.entries(PICKUPS)) {
    spec.palettes.forEach((palette, colour) => {
      for (let frame = 0; frame < 3; frame += 1) {
        paint(scene, pickupKey(kind, colour, frame), spec.build(frame), palette, spec.outlines[colour])
      }
      const key = pickupAnimKey(kind, colour)
      if (scene.anims.exists(key)) return
      if (!scene.textures.exists(pickupKey(kind, colour, 0))) return
      scene.anims.create({
        key,
        frames: [0, 1, 2, 1].map((frame) => ({ key: pickupKey(kind, colour, frame) })),
        frameRate: 6,
        repeat: -1,
      })
    })
  }
}

// ---------------------------------------------------------------------------
// HUD and effects
// ---------------------------------------------------------------------------

/** A 16x14 butterfly for the counter, so the HUD sits on the grid too. */
export const HUD_BUTTERFLY = 'skyjump-px-hud-butterfly'

/**
 * The counter's icon follows the zone, because the count does: in space it is
 * stars and in heaven it is feathers, and a butterfly beside that number is
 * simply a lie. One icon per pickup kind, all about the butterfly's weight so
 * the HUD does not shift when the zone changes.
 */
export const hudIconKey = (kind: string) =>
  kind === 'butterfly' ? HUD_BUTTERFLY : `skyjump-px-hud-${kind}`

/** Shorter than the falling feather: the HUD has 14 rows, not 17. */
const HUD_FEATHER_ROWS = [
  '....XX.....',
  '...XXXX....',
  '..XXXXXX...',
  '.XXXXXXX...',
  '.XXXXXXXX..',
  '.XXXXXXX...',
  '.XXXXXX....',
  '..XXXXX....',
  '..XXXX.....',
  '...XXX.....',
  '...XX......',
  '....Q......',
  '....Q......',
  '....Q......',
]

const createHudIcon = (scene: Phaser.Scene) => {
  const m = mask(16, 14)
  for (const dir of [-1, 1]) {
    ellipse(m, 8 + dir * 4, 5, 3.8, 4, UPPER)
    ellipse(m, 8 + dir * 3, 10, 2.8, 3.2, LOWER)
  }
  ellipse(m, 8, 7, 1, 5.5, BODY)
  paint(scene, HUD_BUTTERFLY, m, BUTTERFLY_PALETTES[0] as Record<number, string>, BUTTERFLY_OUTLINES[0])

  const star = fromRows(STAR_ROWS, { X: UPPER })
  shadeRows(star, 8, UPPER, LOWER)
  poke(star, 5, 5, GLINT)
  poke(star, 6, 5, GLINT)
  poke(star, 5, 6, GLINT)
  paint(scene, hudIconKey('star'), star, STAR_PALETTES[0] as Record<number, string>, STAR_OUTLINES[0])

  const feather = fromRows(HUD_FEATHER_ROWS, { X: UPPER, Q: BODY })
  shadeRows(feather, 7, UPPER, LOWER)
  poke(feather, 4, 1, GLINT)
  poke(feather, 4, 2, GLINT)
  poke(feather, 3, 3, GLINT)
  paint(scene, hudIconKey('feather'), feather, FEATHER_PALETTES[0] as Record<number, string>, FEATHER_OUTLINES[0])
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

export const createPixelArt = (scene: Phaser.Scene, unicornFrames: string[], cupcakeKey: string) => {
  createClouds(scene)
  createPlatforms(scene)
  createButterflies(scene)
  createOtherPickups(scene)
  createHudIcon(scene)
  createSparkle(scene)
  createHaze(scene)
  createQuantizedActors(scene, unicornFrames, cupcakeKey)
}
