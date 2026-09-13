import Phaser from 'phaser'
import {
  ASSET_KEYS,
  UNICORN_FRAMES,
  UNICORN_VARIANTS,
  createUnicornAnimations,
  createUnicornVariant,
  getUnicornAnimSet,
  getVariantFrameKey,
  loadAssets,
} from '../assets'
import { PEGASUS_TEXTURES, createPegasusTextures } from '../pegasusTextures'
import { Wings } from '../wings'
import { difficultyTier, lapLabel, startLevel } from '../levels'

// ---------------------------------------------------------------------------
// Level 2: Pegasus Flight.
//
// A side-scrolling "flappy" level. Each player gets their own lane (a camera
// viewport). Every lane has a private strip of world space stacked vertically
// (WORLD_STRIDE apart) so the two lanes never overlap in the display list; the
// lane camera scrolls to its strip and clips it to the on-screen viewport.
// With two players the screen is split down the middle (left / right halves).
//
// Physics are done by hand (gravity + flap impulse) - there is nothing to
// collide with, only stars to fly through, and no fail state. It's for
// four-to-six year olds: bumping the top or bottom just stops you.
// ---------------------------------------------------------------------------

const WORLD_STRIDE = 2000
const GRAVITY = 1300
const FLAP_VELOCITY = -400
const MAX_FALL_SPEED = 560
const SCROLL_SPEED = 175
const STAR_SPACING = 100
const STAR_COUNT = 50
const LEAD_IN = 420
const TAIL = 260
const LEVEL_LENGTH = LEAD_IN + STAR_SPACING * STAR_COUNT + TAIL
const UNICORN_SCALE = 1.5
const INTRO_DURATION = 2600
const FINISH_HOLD = 2600
const VERTICAL_MARGIN = 64
const LANE_GAP = 6

type SceneData = {
  playerCount?: 1 | 2
  level?: number
  scores?: number[]
}

type Lane = {
  index: number
  viewport: Phaser.Geom.Rectangle
  originY: number
  width: number
  height: number
  camera: Phaser.Cameras.Scene2D.Camera
}

type PathNode = {
  worldX: number
  y: number
  image: Phaser.GameObjects.Image
  collected: boolean
  missed: boolean
}

type DriftCloud = {
  image: Phaser.GameObjects.Image
  speed: number
}

type Flyer = {
  lane: Lane
  variant?: string
  playerX: number
  sprite: Phaser.GameObjects.Sprite
  wings: Wings
  y: number
  vy: number
  tilt: number
  flapKey?: Phaser.Input.Keyboard.Key
  pendingPointerFlap: boolean
  distance: number
  stars: PathNode[]
  dots: { worldX: number; y: number; image: Phaser.GameObjects.Image }[]
  finishCloud: Phaser.GameObjects.Image
  finishY: number
  clouds: DriftCloud[]
  score: number
  scoreText: Phaser.GameObjects.Text
  hintText: Phaser.GameObjects.Text
  hintTween?: Phaser.Tweens.Tween
  introTexts: Phaser.GameObjects.Text[]
  progressFill: Phaser.GameObjects.Rectangle
  progressWidth: number
  finished: boolean
  done: boolean
}

export default class PegasusScene extends Phaser.Scene {
  private playerCount: 1 | 2 = 1
  private level = 2
  private carriedScores: number[] = []
  private lanes: Lane[] = []
  private flyers: Flyer[] = []
  private phase: 'intro' | 'flying' | 'leaving' = 'intro'
  private introEndsAt = 0
  private pathYs: number[] = []
  private pathSpan = 1
  private scrollSpeed = SCROLL_SPEED
  private pathSwing = 120

  constructor() {
    super('PegasusScene')
  }

  init(data: SceneData) {
    this.playerCount = data.playerCount ?? 1
    this.level = data.level ?? 2
    this.carriedScores = data.scores ?? []
    this.lanes = []
    this.flyers = []
    this.phase = 'intro'
    // Each lap scrolls a little faster with a wilder star path.
    const tier = difficultyTier(this.level)
    this.scrollSpeed = SCROLL_SPEED + tier * 14
    this.pathSwing = 120 + tier * 18
  }

  preload() {
    loadAssets(this)
  }

  create() {
    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)
    createPegasusTextures(this)

    this.buildPath()
    this.createLanes()
    this.flyers = this.lanes.map((lane, index) => this.createFlyer(lane, index))

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const flyer = this.flyers.find((entry) => Phaser.Geom.Rectangle.Contains(entry.lane.viewport, pointer.x, pointer.y))
      if (flyer) flyer.pendingPointerFlap = true
    })

    this.introEndsAt = this.time.now + INTRO_DURATION
    this.flyers.forEach((flyer) => this.showIntro(flyer))
    this.lanes.forEach((lane) => lane.camera.fadeIn(500, 255, 255, 255))
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private buildPath() {
    // A gentle random walk of control points, smoothed with Catmull-Rom.
    // Shared by both lanes so two players fly the same pattern.
    const laneHeight = this.scale.height
    const minY = VERTICAL_MARGIN + 30
    const maxY = laneHeight - VERTICAL_MARGIN - 30
    const step = 150
    const count = Math.ceil((LEVEL_LENGTH + 600) / step) + 1
    const ys: number[] = []
    let y = laneHeight / 2
    for (let i = 0; i < count; i += 1) {
      if (i > 2) {
        const delta = Phaser.Math.Between(-this.pathSwing, this.pathSwing)
        y = Phaser.Math.Clamp(y + delta, minY, maxY)
      }
      ys.push(y)
    }
    this.pathYs = ys
    this.pathSpan = step * (count - 1)
  }

  private pathYAt(worldX: number) {
    const t = Phaser.Math.Clamp(worldX / this.pathSpan, 0, 1)
    return Phaser.Math.Interpolation.CatmullRom(this.pathYs, t)
  }

  private createLanes() {
    const width = this.scale.width
    const height = this.scale.height

    const rects: Phaser.Geom.Rectangle[] = this.playerCount === 2
      ? [
          new Phaser.Geom.Rectangle(0, 0, Math.floor((width - LANE_GAP) / 2), height),
          new Phaser.Geom.Rectangle(Math.ceil((width + LANE_GAP) / 2), 0, Math.floor((width - LANE_GAP) / 2), height),
        ]
      : [new Phaser.Geom.Rectangle(0, 0, width, height)]

    this.lanes = rects.map((rect, index) => {
      const originY = index * WORLD_STRIDE
      const camera = index === 0 ? this.cameras.main : this.cameras.add()
      camera.setViewport(rect.x, rect.y, rect.width, rect.height)
      camera.setScroll(0, originY)
      camera.setBackgroundColor(0x8fd3ff)
      return { index, viewport: rect, originY, width: rect.width, height: rect.height, camera }
    })
  }

  private createFlyer(lane: Lane, index: number): Flyer {
    const { width, height, originY } = lane
    const playerX = Math.round(width * 0.28)

    this.paintSky(lane)
    const clouds = this.createDriftClouds(lane)

    // Star trail: small dots between stars make the path easy to read.
    const dots: Flyer['dots'] = []
    const dotSpacing = 25
    for (let worldX = LEAD_IN; worldX <= LEAD_IN + STAR_SPACING * (STAR_COUNT - 1); worldX += dotSpacing) {
      if ((worldX - LEAD_IN) % STAR_SPACING === 0) continue
      const y = this.pathYAt(worldX)
      const image = this.add.image(-100, originY + y, PEGASUS_TEXTURES.dot)
      image.setAlpha(0.55)
      image.setDepth(2)
      image.setVisible(false)
      dots.push({ worldX, y, image })
    }

    const stars: PathNode[] = []
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const worldX = LEAD_IN + i * STAR_SPACING
      const y = this.pathYAt(worldX)
      const image = this.add.image(-100, originY + y, ASSET_KEYS.star)
      image.setDepth(3)
      image.setVisible(false)
      stars.push({ worldX, y, image, collected: false, missed: false })
    }

    const finishY = this.pathYAt(LEVEL_LENGTH)
    const finishCloud = this.add.image(-200, originY + finishY, ASSET_KEYS.cloud)
    finishCloud.setDepth(3)
    finishCloud.setScale(1.4)
    finishCloud.setVisible(false)

    // The unicorn and its wings.
    const variant = index === 1 ? UNICORN_VARIANTS.blue : undefined
    const flyKey = getVariantFrameKey(UNICORN_FRAMES.fly, 0, variant)
    const startY = height / 2
    const sprite = this.add.sprite(playerX, originY + startY, this.textures.exists(flyKey) ? flyKey : '__DEFAULT')
    sprite.setOrigin(0.5, 0.5)
    sprite.setScale(UNICORN_SCALE)
    sprite.setDepth(5)
    const anims = getUnicornAnimSet(variant)
    if (this.anims.exists(anims.fly)) {
      sprite.play(anims.fly)
    }

    const wings = new Wings(this, index, UNICORN_SCALE, 5)

    // HUD: star icon + count on the left, progress bar in the middle.
    const hudY = originY + 22
    const icon = this.add.image(22, hudY, ASSET_KEYS.star)
    icon.setScale(0.8)
    icon.setDepth(10)
    const scoreText = this.add.text(42, hudY, '0', {
      fontFamily: '"Fredoka", sans-serif',
      fontSize: '24px',
      color: '#1f2a44',
    }).setOrigin(0, 0.5).setDepth(10)

    const progressWidth = Math.round(width * 0.42)
    const progressX = Math.round(width / 2 - progressWidth / 2)
    const track = this.add.rectangle(progressX, hudY, progressWidth, 10, 0xffffff, 0.6)
    track.setOrigin(0, 0.5)
    track.setDepth(10)
    const progressFill = this.add.rectangle(progressX, hudY, progressWidth, 10, 0xffc857, 1)
    progressFill.setOrigin(0, 0.5)
    progressFill.setDepth(11)
    progressFill.setScale(0, 1)
    const goal = this.add.image(progressX + progressWidth + 14, hudY, ASSET_KEYS.cloud)
    goal.setScale(0.45)
    goal.setDepth(11)

    const label = this.playerCount === 2 ? `P${index + 1}` : ''
    if (label) {
      this.add.text(width - 14, hudY, label, {
        fontFamily: '"Fredoka", sans-serif',
        fontSize: '22px',
        color: index === 1 ? '#2f5aa8' : '#c2418f',
      }).setOrigin(1, 0.5).setDepth(10)
    }

    if (this.playerCount === 2) {
      const frame = this.add.graphics()
      frame.lineStyle(4, 0xffffff, 0.7)
      frame.strokeRect(2, originY + 2, width - 4, height - 4)
      frame.setDepth(9)
    }

    const hintText = this.add.text(playerX, originY + 64, index === 1 ? 'Press  ↑  to flap!' : 'Press  W  to flap!', {
      fontFamily: '"Fredoka", sans-serif',
      fontSize: '22px',
      color: '#6b3fa0',
      backgroundColor: 'rgba(255,255,255,0.75)',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(12)

    const flapKey = index === 1
      ? this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.UP)
      : this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W)

    return {
      lane,
      variant,
      playerX,
      sprite,
      wings,
      y: startY,
      vy: 0,
      tilt: 0,
      flapKey,
      pendingPointerFlap: false,
      distance: 0,
      stars,
      dots,
      finishCloud,
      finishY,
      clouds,
      score: 0,
      scoreText,
      hintText,
      introTexts: [],
      progressFill,
      progressWidth,
      finished: false,
      done: false,
    }
  }

  private paintSky(lane: Lane) {
    const { width, height, originY } = lane
    const g = this.add.graphics()
    g.setDepth(0)
    const top = Phaser.Display.Color.ValueToColor(0x6fbcff)
    const bottom = Phaser.Display.Color.ValueToColor(0xe4f6ff)
    const strips = 28
    const stripHeight = Math.ceil(height / strips)
    for (let i = 0; i < strips; i += 1) {
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, strips - 1, i)
      g.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1)
      g.fillRect(0, originY + i * stripHeight, width, stripHeight + 1)
    }
  }

  private createDriftClouds(lane: Lane): DriftCloud[] {
    const { width, height, originY } = lane
    const clouds: DriftCloud[] = []
    const count = Math.max(4, Math.round(width / 160))
    for (let i = 0; i < count; i += 1) {
      const image = this.add.image(
        Phaser.Math.Between(0, width),
        originY + Phaser.Math.Between(50, height - 50),
        PEGASUS_TEXTURES.cloud
      )
      const scale = Phaser.Math.FloatBetween(0.7, 1.4)
      image.setScale(scale)
      image.setAlpha(Phaser.Math.FloatBetween(0.55, 0.9))
      image.setDepth(1)
      clouds.push({ image, speed: 14 + scale * 16 })
    }
    return clouds
  }

  private showIntro(flyer: Flyer) {
    const { width, height, originY } = flyer.lane
    const centerX = width / 2
    const style = {
      fontFamily: '"Fredoka", sans-serif',
      color: '#ffffff',
      stroke: '#6b3fa0',
      strokeThickness: 6,
      align: 'center',
    }
    const title = this.add.text(centerX, originY + height * 0.36, `Level ${this.level}`, { ...style, fontSize: '40px' })
      .setOrigin(0.5).setDepth(20)
    const subtitle = this.add.text(centerX, originY + height * 0.36 + 46, 'Pegasus Flight!\nFollow the stars', { ...style, fontSize: '26px' })
      .setOrigin(0.5).setDepth(20)
    flyer.introTexts = [title, subtitle]
    const lap = lapLabel(this.level)
    if (lap) {
      flyer.introTexts.push(this.add.text(centerX, originY + height * 0.36 + 112, lap, { ...style, fontSize: '20px', color: '#ffe08a' }).setOrigin(0.5).setDepth(20))
    }

    this.time.delayedCall(INTRO_DURATION - 700, () => {
      subtitle.setText('FLY!')
      subtitle.setFontSize(44)
      this.tweens.add({ targets: [title, subtitle], alpha: 0, delay: 500, duration: 500, onComplete: () => this.clearIntro(flyer) })
    })

    // The control hint fades on its own a few seconds into the flight.
    this.time.delayedCall(INTRO_DURATION + 4000, () => this.hideHint(flyer))
  }

  private clearIntro(flyer: Flyer) {
    flyer.introTexts.forEach((text) => text.destroy())
    flyer.introTexts = []
  }

  private hideHint(flyer: Flyer, duration = 300) {
    if (flyer.hintTween || !flyer.hintText.active) return
    flyer.hintTween = this.tweens.add({
      targets: flyer.hintText,
      alpha: 0,
      duration,
      onComplete: () => flyer.hintText.setVisible(false),
    })
  }

  // -------------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000)

    if (this.phase === 'intro' && time >= this.introEndsAt) {
      this.phase = 'flying'
    }

    this.flyers.forEach((flyer) => this.updateFlyer(flyer, dt, time))

    if (this.phase === 'flying' && this.flyers.every((flyer) => flyer.done)) {
      this.leaveLevel()
    }
  }

  private wantsFlap(flyer: Flyer) {
    const keyPressed = flyer.flapKey ? Phaser.Input.Keyboard.JustDown(flyer.flapKey) : false
    const pointer = flyer.pendingPointerFlap
    flyer.pendingPointerFlap = false
    return keyPressed || pointer
  }

  private updateFlyer(flyer: Flyer, dt: number, time: number) {
    const { height, originY } = flyer.lane
    const flapped = this.wantsFlap(flyer)

    if (flapped) {
      this.animateFlap(flyer)
      if (this.phase !== 'intro') {
        this.hideHint(flyer)
      }
    }

    if (this.phase === 'intro') {
      // Hover in place until the countdown finishes.
      flyer.y = height / 2 + Math.sin(time / 260) * 8
      flyer.vy = 0
    } else if (!flyer.finished) {
      if (flapped) {
        flyer.vy = FLAP_VELOCITY
      }
      flyer.vy = Math.min(MAX_FALL_SPEED, flyer.vy + GRAVITY * dt)
      flyer.y += flyer.vy * dt
      if (flyer.y < VERTICAL_MARGIN) {
        flyer.y = VERTICAL_MARGIN
        flyer.vy = Math.max(0, flyer.vy)
      }
      if (flyer.y > height - VERTICAL_MARGIN) {
        flyer.y = height - VERTICAL_MARGIN
        flyer.vy = Math.min(0, flyer.vy)
      }

      flyer.distance += this.scrollSpeed * dt
      if (flyer.distance >= LEVEL_LENGTH) {
        flyer.distance = LEVEL_LENGTH
        this.finishFlyer(flyer)
      }
    }

    // Body tilt follows vertical speed.
    const targetTilt = flyer.finished || this.phase === 'intro'
      ? 0
      : Phaser.Math.Clamp(flyer.vy / 1100, -0.35, 0.45)
    flyer.tilt = Phaser.Math.Linear(flyer.tilt, targetTilt, 0.12)

    if (!flyer.finished) {
      flyer.sprite.setPosition(flyer.playerX, originY + flyer.y)
    }
    flyer.sprite.setRotation(flyer.tilt)
    flyer.wings.idle(time)
    flyer.wings.place(flyer.sprite.x, flyer.sprite.y, flyer.tilt)

    this.scrollLane(flyer)
    this.updateClouds(flyer, dt)
    if (!flyer.finished && this.phase === 'flying') {
      this.collectStars(flyer)
    }

    const progress = Phaser.Math.Clamp(flyer.distance / LEVEL_LENGTH, 0, 1)
    flyer.progressFill.setScale(progress, 1)
  }

  private animateFlap(flyer: Flyer) {
    flyer.wings.flap()
    // A little puff of sparkle behind the wings.
    this.emitBurst(flyer.sprite.x - 20, flyer.sprite.y + 6, 0xffffff, 5, 14)
  }

  private scrollLane(flyer: Flyer) {
    const { width } = flyer.lane
    const toScreen = (worldX: number) => flyer.playerX + (worldX - flyer.distance)
    const isOnScreen = (x: number) => x > -80 && x < width + 80

    flyer.dots.forEach((dot) => {
      const x = toScreen(dot.worldX)
      const visible = isOnScreen(x)
      dot.image.setVisible(visible)
      if (visible) dot.image.setX(x)
    })

    flyer.stars.forEach((star) => {
      const x = toScreen(star.worldX)
      const visible = isOnScreen(x) && !star.collected
      star.image.setVisible(visible)
      if (visible) star.image.setX(x)
    })

    const cloudX = toScreen(LEVEL_LENGTH)
    flyer.finishCloud.setVisible(isOnScreen(cloudX))
    if (!flyer.finished) flyer.finishCloud.setX(cloudX)
  }

  private updateClouds(flyer: Flyer, dt: number) {
    const { width } = flyer.lane
    const moving = this.phase === 'flying' && !flyer.finished
    flyer.clouds.forEach((cloud) => {
      const speed = moving ? cloud.speed + this.scrollSpeed * 0.12 : cloud.speed * 0.3
      cloud.image.x -= speed * dt
      if (cloud.image.x < -80) {
        cloud.image.x = width + 80
      }
    })
  }

  private collectStars(flyer: Flyer) {
    const { originY } = flyer.lane
    flyer.stars.forEach((star) => {
      if (star.collected) return
      const dx = star.image.x - flyer.playerX
      const dy = star.y - flyer.y
      if (Math.abs(dx) < 40 && Math.abs(dy) < 50) {
        star.collected = true
        flyer.score += 1
        flyer.scoreText.setText(String(flyer.score))
        this.emitBurst(star.image.x, originY + star.y, 0xffd166, 14, 34)
        this.tweens.add({
          targets: flyer.scoreText,
          scale: 1.35,
          duration: 90,
          yoyo: true,
        })
        star.image.setVisible(false)
      } else if (!star.missed && dx < -50) {
        star.missed = true
        star.image.setAlpha(0.35)
      }
    })
  }

  private emitBurst(x: number, y: number, color: number, count: number, distance: number) {
    if (!this.textures.exists(PEGASUS_TEXTURES.spark)) return
    for (let i = 0; i < count; i += 1) {
      const spark = this.add.image(x, y, PEGASUS_TEXTURES.spark)
      spark.setTint(color)
      spark.setBlendMode(Phaser.BlendModes.ADD)
      spark.setScale(Phaser.Math.FloatBetween(1.2, 2))
      spark.setDepth(7)
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const reach = Phaser.Math.Between(Math.round(distance * 0.5), distance)
      this.tweens.add({
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

  // -------------------------------------------------------------------------
  // Finishing
  // -------------------------------------------------------------------------

  private finishFlyer(flyer: Flyer) {
    if (flyer.finished) return
    flyer.finished = true
    flyer.vy = 0
    const { width, height, originY } = flyer.lane
    this.clearIntro(flyer)
    this.hideHint(flyer, 150)

    // Glide onto the rainbow cloud.
    const cloud = flyer.finishCloud
    cloud.setVisible(true)
    this.tweens.add({
      targets: flyer.sprite,
      x: cloud.x,
      y: cloud.y - 38,
      duration: 700,
      ease: 'Sine.inOut',
    })
    this.tweens.add({
      targets: cloud,
      scale: 2.2,
      duration: 700,
      ease: 'Sine.out',
    })

    const colors = [0xff3b3b, 0xffc857, 0x7ae582, 0x5cc8ff, 0xb96bff]
    let index = 0
    this.time.addEvent({
      delay: 90,
      repeat: colors.length * 2,
      callback: () => {
        cloud.setTint(colors[index % colors.length])
        index += 1
        if (index > colors.length * 2) cloud.clearTint()
      },
    })

    const style = {
      fontFamily: '"Fredoka", sans-serif',
      color: '#ffffff',
      stroke: '#6b3fa0',
      strokeThickness: 6,
      align: 'center',
    }
    this.add.text(width / 2, originY + height * 0.3, 'Level Complete!', { ...style, fontSize: '40px' })
      .setOrigin(0.5).setDepth(20)
    const summary = this.add.text(width / 2, originY + height * 0.3 + 52, `${flyer.score} / ${STAR_COUNT}`, { ...style, fontSize: '32px' })
      .setOrigin(0.5).setDepth(20)
    const star = this.add.image(summary.x - summary.width / 2 - 22, summary.y, ASSET_KEYS.star)
    star.setDepth(20)
    this.emitBurst(width / 2, originY + height * 0.3, 0xffd166, 24, 90)

    this.time.delayedCall(FINISH_HOLD, () => {
      flyer.done = true
    })
  }

  private leaveLevel() {
    if (this.phase === 'leaving') return
    this.phase = 'leaving'

    const scores = this.flyers.map((flyer, index) => (this.carriedScores[index] ?? 0) + flyer.score)
    this.lanes.forEach((lane) => lane.camera.fadeOut(600, 255, 255, 255))
    this.time.delayedCall(650, () => {
      startLevel(this, { playerCount: this.playerCount, level: this.level + 1, scores })
    })
  }
}
