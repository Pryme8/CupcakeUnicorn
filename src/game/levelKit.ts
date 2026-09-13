import Phaser from 'phaser'
import { ASSET_KEYS, UNICORN_FRAMES, UNICORN_VARIANTS, getUnicornAnimSet, getVariantFrameKey } from './assets'
import { PEGASUS_TEXTURES, createPegasusTextures } from './pegasusTextures'
import { lapLabel, startLevel, type LevelSceneData } from './levels'

// Shared bits for the mini-game levels: banners, sparkles, keys, unicorn
// actors, score HUDs and the "Level Complete" hand-off to the next level.

export const FONT = '"Fredoka", sans-serif'
export const PLAYER_NAMES = ['P1', 'P2']
export const PLAYER_COLORS = ['#c2418f', '#2f5aa8']
export const PLAYER_TINTS = [0xff7ac3, 0x7ad1ff]
export const RAINBOW = [0xff3b3b, 0xffc857, 0x7ae582, 0x5cc8ff, 0xb96bff]

export const bannerStyle = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT,
  fontSize: `${size}px`,
  color,
  stroke: '#6b3fa0',
  strokeThickness: 6,
  align: 'center',
})

export const hudStyle = (size = 22, color = '#1f2a44'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT,
  fontSize: `${size}px`,
  color,
})

export const playerName = (index: number) => PLAYER_NAMES[index] ?? `P${index + 1}`
export const playerColor = (index: number) => PLAYER_COLORS[index] ?? '#1f2a44'
export const playerTint = (index: number) => PLAYER_TINTS[index] ?? 0xffffff

/** "Level N" plus a subtitle, fading out after a short hold. */
export const showLevelBanner = (
  scene: Phaser.Scene,
  level: number,
  subtitle: string,
  options: { x?: number; y?: number; depth?: number; hold?: number } = {}
) => {
  const x = options.x ?? scene.scale.width / 2
  const y = options.y ?? scene.scale.height * 0.4
  const depth = options.depth ?? 50
  const title = scene.add.text(x, y, `Level ${level}`, bannerStyle(40)).setOrigin(0.5).setDepth(depth)
  const sub = scene.add.text(x, y + 44, subtitle, bannerStyle(26)).setOrigin(0.5).setDepth(depth)
  const texts = [title, sub]
  const lap = lapLabel(level)
  if (lap) {
    const lines = subtitle.split('\n').length
    texts.push(scene.add.text(x, y + 44 + lines * 30 + 8, lap, bannerStyle(20, '#ffe08a')).setOrigin(0.5).setDepth(depth))
  }
  scene.tweens.add({
    targets: texts,
    alpha: 0,
    delay: options.hold ?? 1700,
    duration: 500,
    onComplete: () => texts.forEach((text) => text.destroy()),
  })
  return { title, sub }
}

/** A short message in the middle of the screen, such as "Swap!" or "Your turn!". */
export const flashMessage = (
  scene: Phaser.Scene,
  text: string,
  options: { x?: number; y?: number; size?: number; hold?: number; depth?: number; color?: string } = {}
) => {
  const label = scene.add.text(options.x ?? scene.scale.width / 2, options.y ?? scene.scale.height * 0.3, text, bannerStyle(options.size ?? 34, options.color))
    .setOrigin(0.5)
    .setDepth(options.depth ?? 50)
    .setScale(0.6)
  scene.tweens.add({ targets: label, scale: 1, duration: 220, ease: 'Back.out' })
  scene.tweens.add({
    targets: label,
    alpha: 0,
    delay: options.hold ?? 1100,
    duration: 350,
    onComplete: () => label.destroy(),
  })
  return label
}

export const emitBurst = (scene: Phaser.Scene, x: number, y: number, color: number, count = 14, distance = 34, depth = 40) => {
  if (!scene.textures.exists(PEGASUS_TEXTURES.spark)) createPegasusTextures(scene)
  for (let i = 0; i < count; i += 1) {
    const spark = scene.add.image(x, y, PEGASUS_TEXTURES.spark)
    spark.setTint(color)
    spark.setBlendMode(Phaser.BlendModes.ADD)
    spark.setScale(Phaser.Math.FloatBetween(1.2, 2))
    spark.setDepth(depth)
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const reach = Phaser.Math.Between(Math.round(distance * 0.5), distance)
    scene.tweens.add({
      targets: spark,
      x: x + Math.cos(angle) * reach,
      y: y + Math.sin(angle) * reach,
      alpha: 0,
      duration: Phaser.Math.Between(260, 420),
      ease: 'Sine.out',
      onComplete: () => spark.destroy(),
    })
  }
}

/** Cycles a sprite through rainbow tints, then clears it. */
export const rainbowFlash = (scene: Phaser.Scene, target: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, loops = 1, delay = 80) => {
  let index = 0
  const total = RAINBOW.length * loops
  scene.time.addEvent({
    delay,
    repeat: total,
    callback: () => {
      if (!target.active) return
      if (index >= total) {
        target.clearTint()
      } else {
        target.setTint(RAINBOW[index % RAINBOW.length])
      }
      index += 1
    },
  })
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type PlayerKeys = {
  left: Phaser.Input.Keyboard.Key
  right: Phaser.Input.Keyboard.Key
  up: Phaser.Input.Keyboard.Key
  down: Phaser.Input.Keyboard.Key
}

/** Player 1 uses WASD, player 2 the arrow keys. "Up" doubles as the action key. */
export const createPlayerKeys = (scene: Phaser.Scene, index: number): PlayerKeys | undefined => {
  const keyboard = scene.input.keyboard
  if (!keyboard) return undefined
  const codes = Phaser.Input.Keyboard.KeyCodes
  return index === 0
    ? {
        left: keyboard.addKey(codes.A),
        right: keyboard.addKey(codes.D),
        up: keyboard.addKey(codes.W),
        down: keyboard.addKey(codes.S),
      }
    : {
        left: keyboard.addKey(codes.LEFT),
        right: keyboard.addKey(codes.RIGHT),
        up: keyboard.addKey(codes.UP),
        down: keyboard.addKey(codes.DOWN),
      }
}

export const justDown = (key?: Phaser.Input.Keyboard.Key) => (key ? Phaser.Input.Keyboard.JustDown(key) : false)

export type Direction = 'up' | 'right' | 'down' | 'left'
export const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left']
export const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

/** The direction whose key was just pressed this frame, if any. */
export const justPressedDirection = (keys?: PlayerKeys): Direction | undefined => {
  if (!keys) return undefined
  if (justDown(keys.up)) return 'up'
  if (justDown(keys.right)) return 'right'
  if (justDown(keys.down)) return 'down'
  if (justDown(keys.left)) return 'left'
  return undefined
}

// ---------------------------------------------------------------------------
// Unicorn actors
// ---------------------------------------------------------------------------

export type UnicornActor = {
  index: number
  variant?: string
  sprite: Phaser.GameObjects.Sprite
  body?: Phaser.Physics.Arcade.Body
  anims: ReturnType<typeof getUnicornAnimSet>
}

export type ActorOptions = {
  scale?: number
  physics?: boolean
  /** Body box as a fraction of the frame, centred horizontally. */
  bodyWidth?: number
  bodyHeight?: number
  /** Vertical position of the body box's top as a fraction of the frame. */
  bodyTop?: number
  depth?: number
  originY?: number
}

/**
 * A unicorn sprite (pink for player 1, blue for player 2). With `physics: true`
 * it gets an arcade body sized to the visible body of the drawing, gravity off.
 */
export const createUnicornActor = (scene: Phaser.Scene, x: number, y: number, index: number, options: ActorOptions = {}): UnicornActor => {
  const variant = index === 1 ? UNICORN_VARIANTS.blue : undefined
  const frameKey = getVariantFrameKey(UNICORN_FRAMES.idle, 0, variant)
  const key = scene.textures.exists(frameKey) ? frameKey : '__DEFAULT'
  const scale = options.scale ?? 1
  const anims = getUnicornAnimSet(variant)

  let sprite: Phaser.GameObjects.Sprite
  let body: Phaser.Physics.Arcade.Body | undefined
  if (options.physics) {
    const physicsSprite = scene.physics.add.sprite(x, y, key)
    sprite = physicsSprite
    body = physicsSprite.body as Phaser.Physics.Arcade.Body
    const w = physicsSprite.width
    const h = physicsSprite.height
    const bw = w * (options.bodyWidth ?? 0.6)
    const bh = h * (options.bodyHeight ?? 0.5)
    body.setSize(bw, bh)
    body.setOffset((w - bw) / 2, h * (options.bodyTop ?? 0.26))
    body.setAllowGravity(false)
    body.setCollideWorldBounds(true)
  } else {
    sprite = scene.add.sprite(x, y, key)
  }
  sprite.setOrigin(0.5, options.originY ?? 0.5)
  sprite.setScale(scale)
  sprite.setDepth(options.depth ?? 10)
  if (scene.anims.exists(anims.idle)) sprite.play(anims.idle)
  return { index, variant, sprite, body, anims }
}

export const playActor = (actor: UnicornActor, key: keyof UnicornActor['anims'], ignoreIfPlaying = true) => {
  const animKey = actor.anims[key]
  if (actor.sprite.scene.anims.exists(animKey)) actor.sprite.play(animKey, ignoreIfPlaying)
}

/** A quick squash-and-stretch pop for feedback. */
export const bounceSprite = (scene: Phaser.Scene, target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, amount = 0.2) => {
  const baseX = target.scaleX
  const baseY = target.scaleY
  scene.tweens.add({
    targets: target,
    scaleX: baseX * (1 + amount),
    scaleY: baseY * (1 - amount * 0.6),
    duration: 90,
    yoyo: true,
    ease: 'Sine.out',
    onComplete: () => target.setScale(baseX, baseY),
  })
}

/** A side-to-side "oops" wobble. */
export const wobbleSprite = (scene: Phaser.Scene, target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) => {
  const baseX = target.x
  scene.tweens.add({
    targets: target,
    x: baseX - 8,
    duration: 50,
    yoyo: true,
    repeat: 3,
    onComplete: () => target.setX(baseX),
  })
}

// ---------------------------------------------------------------------------
// Score HUD
// ---------------------------------------------------------------------------

export type ScoreHud = {
  index: number
  score: number
  text: Phaser.GameObjects.Text
  icon: Phaser.GameObjects.Image
  label: string
}

const placeHudIcon = (hud: ScoreHud) => {
  hud.icon.setX(hud.index === 1 ? hud.text.x - hud.text.width - 18 : hud.text.x + hud.text.width + 18)
}

export const createScoreHud = (scene: Phaser.Scene, index: number, initial: number, playerCount: number): ScoreHud => {
  const width = scene.scale.width
  const rightSide = index === 1
  const x = rightSide ? width - 24 : 24
  const label = playerCount === 2 ? `${playerName(index)}  ` : ''
  const text = scene.add.text(x, 16, `${label}${initial}`, hudStyle(22, playerCount === 2 ? playerColor(index) : '#1f2a44'))
    .setOrigin(rightSide ? 1 : 0, 0)
    .setDepth(45)
  const icon = scene.add.image(0, 28, ASSET_KEYS.star).setScale(0.7).setDepth(45)
  const hud: ScoreHud = { index, score: initial, text, icon, label }
  placeHudIcon(hud)
  return hud
}

export const addScore = (scene: Phaser.Scene, hud: ScoreHud, amount: number) => {
  hud.score += amount
  hud.text.setText(`${hud.label}${hud.score}`)
  placeHudIcon(hud)
  scene.tweens.add({ targets: hud.text, scale: 1.3, duration: 90, yoyo: true })
}

// ---------------------------------------------------------------------------
// Level state and completion
// ---------------------------------------------------------------------------

export type LevelState = Required<LevelSceneData>

export const readLevelData = (data: LevelSceneData, defaultLevel: number): LevelState => ({
  playerCount: data.playerCount ?? 1,
  level: data.level ?? defaultLevel,
  scores: data.scores ?? [],
})

/**
 * Shows "Level Complete!" with a message and sparkles, then fades to white and
 * starts the next level in the rotation with the given scores.
 */
export const completeLevel = (scene: Phaser.Scene, state: LevelState, scores: number[], message = '', hold = 2600) => {
  const width = scene.scale.width
  const height = scene.scale.height
  scene.add.text(width / 2, height * 0.32, 'Level Complete!', bannerStyle(40)).setOrigin(0.5).setDepth(60)
  if (message) {
    scene.add.text(width / 2, height * 0.32 + 50, message, bannerStyle(28)).setOrigin(0.5).setDepth(60)
  }
  emitBurst(scene, width / 2, height * 0.32, 0xffd166, 26, 100, 61)
  scene.time.delayedCall(hold, () => {
    scene.cameras.main.fadeOut(600, 255, 255, 255)
    scene.time.delayedCall(650, () => {
      startLevel(scene, { playerCount: state.playerCount, level: state.level + 1, scores })
    })
  })
}

/** Paints a soft vertical gradient using horizontal strips (works in Canvas and WebGL). */
export const paintSky = (scene: Phaser.Scene, top: number, bottom: number, depth = 0) => {
  const width = scene.scale.width
  const height = scene.scale.height
  const g = scene.add.graphics()
  g.setDepth(depth)
  const c1 = Phaser.Display.Color.ValueToColor(top)
  const c2 = Phaser.Display.Color.ValueToColor(bottom)
  const strips = 28
  const stripHeight = Math.ceil(height / strips)
  for (let i = 0; i < strips; i += 1) {
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(c1, c2, strips - 1, i)
    g.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1)
    g.fillRect(0, i * stripHeight, width, stripHeight + 1)
  }
  return g
}

/** A progress bar across the top, used instead of visible timers. */
export const createProgressBar = (scene: Phaser.Scene, widthFraction = 0.42, y = 22, depth = 45) => {
  const width = scene.scale.width
  const barWidth = Math.round(width * widthFraction)
  const x = Math.round(width / 2 - barWidth / 2)
  scene.add.rectangle(x, y, barWidth, 10, 0xffffff, 0.6).setOrigin(0, 0.5).setDepth(depth)
  const fill = scene.add.rectangle(x, y, barWidth, 10, 0xffc857, 1).setOrigin(0, 0.5).setDepth(depth + 1)
  fill.setScale(0, 1)
  scene.add.image(x + barWidth + 14, y, ASSET_KEYS.cloud).setScale(0.45).setDepth(depth + 1)
  return {
    set: (progress: number) => fill.setScale(Phaser.Math.Clamp(progress, 0, 1), 1),
  }
}

export const pickupTexture = (type: string) => {
  const map: Record<string, string> = {
    cupcake: ASSET_KEYS.cupcake,
    heart: ASSET_KEYS.heart,
    star: ASSET_KEYS.star,
    flower: ASSET_KEYS.flower,
    grapes: ASSET_KEYS.grapes,
    strawberry: ASSET_KEYS.strawberry,
  }
  return map[type] ?? ASSET_KEYS.star
}

export const pickupColor = (type: string) => {
  const map: Record<string, number> = {
    cupcake: 0xffc857,
    heart: 0xff6b9b,
    star: 0xffd166,
    flower: 0x7ae582,
    grapes: 0x9d4edd,
    strawberry: 0xff6b6b,
  }
  return map[type] ?? 0xffffff
}
