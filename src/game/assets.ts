import Phaser from 'phaser'

const BASE_URL = import.meta.env.BASE_URL

export const USE_ASSETS = true

export const ASSET_KEYS = {
  cloud: 'rainbow-cloud',
  cupcake: 'cupcake',
  flower: 'flower',
  grapes: 'grapes',
  heart: 'heart',
  star: 'star',
  strawberry: 'strawberry',
}

export const ASSET_PATHS = {
  cloud: `${BASE_URL}assets/rainbow_cloud.png`,
  cupcake: `${BASE_URL}assets/cupcake.png`,
  flower: `${BASE_URL}assets/flower.png`,
  grapes: `${BASE_URL}assets/grapes.png`,
  heart: `${BASE_URL}assets/heart.png`,
  star: `${BASE_URL}assets/star.png`,
  strawberry: `${BASE_URL}assets/strawberry.png`,
}

type FrameSequence = {
  key: string
  path: string
  frames: number
  pad: number
}

export const UNICORN_FRAMES = {
  idle: {
    key: 'unicorn-idle',
    path: `${BASE_URL}assets/unicorn/animations/rest-idle/east/frame_`,
    frames: 9,
    pad: 3,
  },
  eatStart: {
    key: 'unicorn-eat-start',
    path: `${BASE_URL}assets/unicorn/animations/eat-start/east/frame_`,
    frames: 6,
    pad: 3,
  },
  eatEnd: {
    key: 'unicorn-eat-end',
    path: `${BASE_URL}assets/unicorn/animations/eat-end/east/frame_`,
    frames: 7,
    pad: 3,
  },
  walk: {
    key: 'unicorn-walk',
    path: `${BASE_URL}assets/unicorn/animations/walk-6-frames/east/frame_`,
    frames: 6,
    pad: 3,
  },
  jump: {
    key: 'unicorn-jump',
    path: `${BASE_URL}assets/unicorn/animations/attack/east/frame_`,
    frames: 6,
    pad: 3,
  },
} satisfies Record<string, FrameSequence>

export const UNICORN_ANIMS = {
  idle: UNICORN_FRAMES.idle.key,
  eatStart: 'unicorn-eat-start',
  eatEnd: 'unicorn-eat-end',
  walk: UNICORN_FRAMES.walk.key,
  jumpStart: 'unicorn-jump-start',
  jumpLand: 'unicorn-jump-land',
}

export const UNICORN_VARIANTS = {
  blue: 'blue',
}

export const getFrameKey = (sequence: FrameSequence, index: number) =>
  `${sequence.key}-${String(index).padStart(sequence.pad, '0')}`

export const getVariantFrameKey = (sequence: FrameSequence, index: number, variant?: string) =>
  variant ? `${sequence.key}-${variant}-${String(index).padStart(sequence.pad, '0')}` : getFrameKey(sequence, index)

export const getVariantAnimKey = (baseKey: string, variant?: string) =>
  variant ? `${baseKey}-${variant}` : baseKey

export const getUnicornAnimSet = (variant?: string) => ({
  idle: getVariantAnimKey(UNICORN_ANIMS.idle, variant),
  eatStart: getVariantAnimKey(UNICORN_ANIMS.eatStart, variant),
  eatEnd: getVariantAnimKey(UNICORN_ANIMS.eatEnd, variant),
  walk: getVariantAnimKey(UNICORN_ANIMS.walk, variant),
  jumpStart: getVariantAnimKey(UNICORN_ANIMS.jumpStart, variant),
  jumpLand: getVariantAnimKey(UNICORN_ANIMS.jumpLand, variant),
})

export const loadAssets = (scene: Phaser.Scene) => {
  if (!USE_ASSETS) return

  Object.values(UNICORN_FRAMES).forEach((sequence) => {
    for (let i = 0; i < sequence.frames; i += 1) {
      const key = getFrameKey(sequence, i)
      scene.load.image(key, `${sequence.path}${String(i).padStart(sequence.pad, '0')}.png`)
    }
  })

  scene.load.image(ASSET_KEYS.cloud, ASSET_PATHS.cloud)
  scene.load.image(ASSET_KEYS.cupcake, ASSET_PATHS.cupcake)
  scene.load.image(ASSET_KEYS.flower, ASSET_PATHS.flower)
  scene.load.image(ASSET_KEYS.grapes, ASSET_PATHS.grapes)
  scene.load.image(ASSET_KEYS.heart, ASSET_PATHS.heart)
  scene.load.image(ASSET_KEYS.star, ASSET_PATHS.star)
  scene.load.image(ASSET_KEYS.strawberry, ASSET_PATHS.strawberry)
}

export const createUnicornAnimations = (scene: Phaser.Scene) => {
  if (!USE_ASSETS) return

  const idle = UNICORN_FRAMES.idle
  if (!scene.anims.exists(UNICORN_ANIMS.idle)) {
    scene.anims.create({
      key: UNICORN_ANIMS.idle,
      frames: Array.from({ length: idle.frames }, (_, index) => ({ key: getFrameKey(idle, index) })),
      frameRate: 8,
      repeat: -1,
    })
  }

  const eatStart = UNICORN_FRAMES.eatStart
  if (!scene.anims.exists(UNICORN_ANIMS.eatStart)) {
    scene.anims.create({
      key: UNICORN_ANIMS.eatStart,
      frames: Array.from({ length: eatStart.frames }, (_, index) => ({ key: getFrameKey(eatStart, index) })),
      frameRate: 12,
      repeat: 0,
    })
  }

  const eatEnd = UNICORN_FRAMES.eatEnd
  if (!scene.anims.exists(UNICORN_ANIMS.eatEnd)) {
    scene.anims.create({
      key: UNICORN_ANIMS.eatEnd,
      frames: Array.from({ length: eatEnd.frames }, (_, index) => ({ key: getFrameKey(eatEnd, index) })),
      frameRate: 12,
      repeat: 0,
    })
  }

  const walk = UNICORN_FRAMES.walk
  if (!scene.anims.exists(UNICORN_ANIMS.walk)) {
    scene.anims.create({
      key: UNICORN_ANIMS.walk,
      frames: Array.from({ length: walk.frames }, (_, index) => ({ key: getFrameKey(walk, index) })),
      frameRate: 12,
      repeat: -1,
    })
  }

  const jump = UNICORN_FRAMES.jump
  if (!scene.anims.exists(UNICORN_ANIMS.jumpStart)) {
    scene.anims.create({
      key: UNICORN_ANIMS.jumpStart,
      frames: Array.from({ length: 4 }, (_, index) => ({ key: getFrameKey(jump, index) })),
      frameRate: 12,
      repeat: 0,
    })
  }

  if (!scene.anims.exists(UNICORN_ANIMS.jumpLand)) {
    scene.anims.create({
      key: UNICORN_ANIMS.jumpLand,
      frames: [4, 5].map((index) => ({ key: getFrameKey(jump, index) })),
      frameRate: 12,
      repeat: 0,
    })
  }
}

export const createUnicornVariant = (scene: Phaser.Scene, variant: string) => {
  if (!USE_ASSETS) return

  const replaceFrom = { r: 255, g: 122, b: 195 }
  const replaceFromDark = { r: 210, g: 90, b: 165 }
  const replaceTo = { r: 70, g: 130, b: 230 }
  const tint = { r: 120, g: 175, b: 245 }
  const tolerance = 120
  const tintStrength = 0.3

  Object.values(UNICORN_FRAMES).forEach((sequence) => {
    for (let i = 0; i < sequence.frames; i += 1) {
      const sourceKey = getFrameKey(sequence, i)
      const targetKey = getVariantFrameKey(sequence, i, variant)
      if (scene.textures.exists(targetKey)) continue

      const sourceImage = scene.textures.get(sourceKey)?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined
      if (!sourceImage) continue

      const canvasTexture = scene.textures.createCanvas(targetKey, sourceImage.width, sourceImage.height)
      if (!canvasTexture || !canvasTexture.context) {
        canvasTexture?.destroy()
        continue
      }
      const ctx = canvasTexture.context
      ctx.drawImage(sourceImage, 0, 0)
      const imageData = ctx.getImageData(0, 0, sourceImage.width, sourceImage.height)
      const data = imageData.data

      for (let p = 0; p < data.length; p += 4) {
        const alpha = data[p + 3] ?? 0
        if (alpha === 0) continue
        const r = data[p] ?? 0
        const g = data[p + 1] ?? 0
        const b = data[p + 2] ?? 0
        const distance = Math.abs(r - replaceFrom.r) + Math.abs(g - replaceFrom.g) + Math.abs(b - replaceFrom.b)
        const distanceDark = Math.abs(r - replaceFromDark.r) + Math.abs(g - replaceFromDark.g) + Math.abs(b - replaceFromDark.b)
        if (distance <= tolerance || distanceDark <= tolerance) {
          data[p] = replaceTo.r
          data[p + 1] = replaceTo.g
          data[p + 2] = replaceTo.b
        }

        data[p] = Math.round(r * (1 - tintStrength) + tint.r * tintStrength)
        data[p + 1] = Math.round(g * (1 - tintStrength) + tint.g * tintStrength)
        data[p + 2] = Math.round(b * (1 - tintStrength) + tint.b * tintStrength)
      }

      ctx.putImageData(imageData, 0, 0)
      canvasTexture.refresh()
    }
  })

  const anims = getUnicornAnimSet(variant)
  const idle = UNICORN_FRAMES.idle
  if (!scene.anims.exists(anims.idle)) {
    scene.anims.create({
      key: anims.idle,
      frames: Array.from({ length: idle.frames }, (_, index) => ({ key: getVariantFrameKey(idle, index, variant) })),
      frameRate: 8,
      repeat: -1,
    })
  }

  const eatStart = UNICORN_FRAMES.eatStart
  if (!scene.anims.exists(anims.eatStart)) {
    scene.anims.create({
      key: anims.eatStart,
      frames: Array.from({ length: eatStart.frames }, (_, index) => ({ key: getVariantFrameKey(eatStart, index, variant) })),
      frameRate: 12,
      repeat: 0,
    })
  }

  const eatEnd = UNICORN_FRAMES.eatEnd
  if (!scene.anims.exists(anims.eatEnd)) {
    scene.anims.create({
      key: anims.eatEnd,
      frames: Array.from({ length: eatEnd.frames }, (_, index) => ({ key: getVariantFrameKey(eatEnd, index, variant) })),
      frameRate: 12,
      repeat: 0,
    })
  }

  const walk = UNICORN_FRAMES.walk
  if (!scene.anims.exists(anims.walk)) {
    scene.anims.create({
      key: anims.walk,
      frames: Array.from({ length: walk.frames }, (_, index) => ({ key: getVariantFrameKey(walk, index, variant) })),
      frameRate: 12,
      repeat: -1,
    })
  }

  const jump = UNICORN_FRAMES.jump
  if (!scene.anims.exists(anims.jumpStart)) {
    scene.anims.create({
      key: anims.jumpStart,
      frames: Array.from({ length: 4 }, (_, index) => ({ key: getVariantFrameKey(jump, index, variant) })),
      frameRate: 12,
      repeat: 0,
    })
  }

  if (!scene.anims.exists(anims.jumpLand)) {
    scene.anims.create({
      key: anims.jumpLand,
      frames: [4, 5].map((index) => ({ key: getVariantFrameKey(jump, index, variant) })),
      frameRate: 12,
      repeat: 0,
    })
  }
}
