import Phaser from 'phaser'

// Procedurally generated art for the Pegasus flight level. There is no wing or
// puffy-cloud art in /public/assets, so these are drawn once with Graphics and
// cached as textures. Everything here is idempotent (safe to call per scene).

export const PEGASUS_TEXTURES = {
  wing: 'pegasus-wing',
  cloud: 'pegasus-cloud',
  dot: 'pegasus-dot',
  spark: 'pickup-spark',
}

export const WING_SIZE = { width: 52, height: 36 }
// The wing sweeps back (left) from the unicorn's shoulder. The root point is the
// pivot both wings rotate around when flapping.
const WING_ROOT = { x: 46, y: 26 }
export const WING_ORIGIN = { x: WING_ROOT.x / WING_SIZE.width, y: WING_ROOT.y / WING_SIZE.height }

const mirror = (x: number) => WING_SIZE.width - x

const createWingTexture = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PEGASUS_TEXTURES.wing)) return

  const g = scene.add.graphics()

  // Outline of the wing: leading edge up to the tip, then feather scallops back to the root.
  const outline = [
    { x: 6, y: 26 },
    { x: 13, y: 9 },
    { x: 28, y: 2 },
    { x: 50, y: 4 },
    { x: 47, y: 15 },
    { x: 42, y: 11 },
    { x: 39, y: 24 },
    { x: 33, y: 17 },
    { x: 29, y: 31 },
    { x: 23, y: 22 },
    { x: 17, y: 33 },
    { x: 12, y: 25 },
  ].map((p) => ({ x: mirror(p.x), y: p.y }))

  g.fillStyle(0xffffff, 1)
  g.lineStyle(2, 0xd7c3ea, 1)
  g.fillPoints(outline, true)
  g.strokePoints(outline, true)

  // Soft pink coverts along the top of the wing.
  const coverts = [
    { x: 6, y: 26 },
    { x: 13, y: 9 },
    { x: 28, y: 2 },
    { x: 36, y: 9 },
    { x: 22, y: 13 },
    { x: 11, y: 22 },
  ].map((p) => ({ x: mirror(p.x), y: p.y }))
  g.fillStyle(0xffdcef, 1)
  g.fillPoints(coverts, true)

  // Feather separators.
  g.lineStyle(1, 0xe9dcf3, 1)
  const feathers = [
    [{ x: 42, y: 11 }, { x: 30, y: 6 }],
    [{ x: 33, y: 17 }, { x: 22, y: 9 }],
    [{ x: 23, y: 22 }, { x: 15, y: 12 }],
  ]
  feathers.forEach(([a, b]) => {
    if (!a || !b) return
    g.lineBetween(mirror(a.x), a.y, mirror(b.x), b.y)
  })

  g.generateTexture(PEGASUS_TEXTURES.wing, WING_SIZE.width, WING_SIZE.height)
  g.destroy()
}

const createCloudTexture = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PEGASUS_TEXTURES.cloud)) return
  const g = scene.add.graphics()
  g.fillStyle(0xffffff, 1)
  g.fillEllipse(48, 40, 88, 26)
  g.fillCircle(30, 32, 18)
  g.fillCircle(50, 24, 22)
  g.fillCircle(70, 32, 16)
  g.generateTexture(PEGASUS_TEXTURES.cloud, 96, 56)
  g.destroy()
}

const createDotTexture = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PEGASUS_TEXTURES.dot)) return
  const g = scene.add.graphics()
  g.fillStyle(0xffffff, 1)
  g.fillCircle(4, 4, 4)
  g.fillStyle(0xfff3b0, 1)
  g.fillCircle(4, 4, 2)
  g.generateTexture(PEGASUS_TEXTURES.dot, 8, 8)
  g.destroy()
}

const createSparkTexture = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PEGASUS_TEXTURES.spark)) return
  const g = scene.add.graphics()
  g.fillStyle(0xffffff, 1)
  g.fillCircle(2, 2, 2)
  g.generateTexture(PEGASUS_TEXTURES.spark, 4, 4)
  g.destroy()
}

export const createPegasusTextures = (scene: Phaser.Scene) => {
  createWingTexture(scene)
  createCloudTexture(scene)
  createDotTexture(scene)
  createSparkTexture(scene)
}
