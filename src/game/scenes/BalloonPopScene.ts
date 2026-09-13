import Phaser from 'phaser'
import { ASSET_KEYS, UNICORN_FRAMES, UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, getVariantFrameKey, loadAssets } from '../assets'
import { PEGASUS_TEXTURES, createPegasusTextures } from '../pegasusTextures'
import { difficultyTier, type LevelSceneData } from '../levels'
import { Wings } from '../wings'
import {
  type LevelState,
  type PlayerKeys,
  type ScoreHud,
  type UnicornActor,
  addScore,
  completeLevel,
  createPlayerKeys,
  createProgressBar,
  createScoreHud,
  createUnicornActor,
  emitBurst,
  justDown,
  paintSky,
  playActor,
  readLevelData,
  showLevelBanner,
} from '../levelKit'

// ---------------------------------------------------------------------------
// Level 7: Balloon Pop.
//
// Both unicorns get their Pegasus wings back and share one big sky. Balloons
// drift up from below; fly into them to pop them. Gold star balloons are worth
// three. Bumping into each other just bounces you apart in a puff of sparkles.
// The level ends once the last balloon has floated by.
// ---------------------------------------------------------------------------

const GRAVITY = 1100
const FLAP_VELOCITY = -380
const THRUST = 240
const MAX_FALL_SPEED = 480
const BOUNDS = { left: 50, right: 910, top: 80, bottom: 500 }
const TOTAL_BALLOONS = 45
const SPAWN_INTERVAL = 900
const UNICORN_SCALE = 1.3
const BALLOON_TEXTURE = 'balloon'
const BALLOON_COLORS = [0xff7ac3, 0x7ad1ff, 0x9d4edd, 0x7ae582, 0xffb347, 0xff6b6b]

type Flyer = {
  actor: UnicornActor
  wings: Wings
  keys?: PlayerKeys
  hud: ScoreHud
  vx: number
  vy: number
  tilt: number
  bumpUntil: number
  pointerFlap: boolean
}

type Balloon = {
  image: Phaser.GameObjects.Image
  star?: Phaser.GameObjects.Image
  baseX: number
  riseSpeed: number
  swayPhase: number
  swayAmount: number
  value: number
  color: number
  radius: number
}

export default class BalloonPopScene extends Phaser.Scene {
  private state: LevelState = { playerCount: 1, level: 7, scores: [] }
  private flyers: Flyer[] = []
  private balloons: Balloon[] = []
  private spawned = 0
  private popped = 0
  private nextSpawn = 0
  private phase: 'intro' | 'play' | 'done' = 'intro'
  private progress?: { set: (progress: number) => void }
  private clouds: Phaser.GameObjects.Image[] = []
  private tier = 0

  constructor() {
    super('BalloonPopScene')
  }

  init(data: LevelSceneData) {
    this.state = readLevelData(data, 7)
    this.flyers = []
    this.balloons = []
    this.spawned = 0
    this.popped = 0
    this.nextSpawn = 0
    this.phase = 'intro'
    this.clouds = []
    this.tier = difficultyTier(this.state.level)
  }

  preload() {
    loadAssets(this)
  }

  create() {
    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)
    createPegasusTextures(this)
    this.createBalloonTexture()

    const width = this.scale.width
    const height = this.scale.height
    paintSky(this, 0x7cc4ff, 0xeaf8ff)
    for (let i = 0; i < 6; i += 1) {
      const cloud = this.add.image(Phaser.Math.Between(0, width), Phaser.Math.Between(60, height - 60), PEGASUS_TEXTURES.cloud)
      cloud.setScale(Phaser.Math.FloatBetween(0.8, 1.5))
      cloud.setAlpha(0.7)
      cloud.setDepth(1)
      this.clouds.push(cloud)
    }

    this.progress = createProgressBar(this)
    const spawnXs = this.state.playerCount === 2 ? [width * 0.35, width * 0.65] : [width / 2]
    this.flyers = spawnXs.map((x, index) => this.createFlyer(x, height / 2, index))

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const flyer = this.state.playerCount === 2 ? this.flyers[pointer.x < width / 2 ? 0 : 1] : this.flyers[0]
      if (flyer) flyer.pointerFlap = true
    })

    this.cameras.main.fadeIn(400, 255, 255, 255)
    showLevelBanner(this, this.state.level, 'Balloon Pop!\nFly into the balloons', { y: height * 0.42 })
    this.time.delayedCall(2000, () => {
      this.phase = 'play'
      this.nextSpawn = this.time.now
    })
  }

  private createBalloonTexture() {
    if (this.textures.exists(BALLOON_TEXTURE)) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillEllipse(20, 22, 36, 44)
    g.fillTriangle(20, 44, 15, 50, 25, 50)
    g.lineStyle(2, 0xffffff, 0.8)
    g.lineBetween(20, 50, 22, 66)
    g.fillStyle(0xffffff, 0.5)
    g.fillEllipse(13, 14, 8, 12)
    g.generateTexture(BALLOON_TEXTURE, 40, 68)
    g.destroy()
  }

  private createFlyer(x: number, y: number, index: number): Flyer {
    const actor = createUnicornActor(this, x, y, index, { scale: UNICORN_SCALE, depth: 10 })
    const flyKey = getVariantFrameKey(UNICORN_FRAMES.fly, 0, actor.variant)
    if (this.textures.exists(flyKey)) actor.sprite.setTexture(flyKey)
    playActor(actor, 'fly')
    const wings = new Wings(this, index, UNICORN_SCALE, 10)
    const hud = createScoreHud(this, index, this.state.scores[index] ?? 0, this.state.playerCount)
    return { actor, wings, keys: createPlayerKeys(this, index), hud, vx: 0, vy: 0, tilt: 0, bumpUntil: 0, pointerFlap: false }
  }

  // -------------------------------------------------------------------------
  // Balloons
  // -------------------------------------------------------------------------

  private spawnBalloon() {
    const gold = Phaser.Math.FloatBetween(0, 1) < 0.12
    const color = gold ? 0xffd166 : (Phaser.Utils.Array.GetRandom(BALLOON_COLORS) ?? 0xff7ac3)
    const x = Phaser.Math.Between(BOUNDS.left + 20, BOUNDS.right - 20)
    const image = this.add.image(x, this.scale.height + 50, BALLOON_TEXTURE)
    image.setTint(color)
    image.setDepth(6)
    image.setScale(gold ? 1.25 : 1)
    let star: Phaser.GameObjects.Image | undefined
    if (gold) {
      star = this.add.image(x, image.y - 6, ASSET_KEYS.star)
      star.setScale(0.7)
      star.setDepth(7)
    }
    this.balloons.push({
      image,
      star,
      baseX: x,
      riseSpeed: Phaser.Math.Between(60, 110) + this.tier * 15,
      swayPhase: Phaser.Math.FloatBetween(0, Math.PI * 2),
      swayAmount: Phaser.Math.Between(12, 26) + this.tier * 5,
      value: gold ? 3 : 1,
      color,
      radius: gold ? 52 : 44,
    })
    this.spawned += 1
  }

  private removeBalloon(balloon: Balloon) {
    balloon.image.destroy()
    balloon.star?.destroy()
    this.balloons = this.balloons.filter((entry) => entry !== balloon)
  }

  private popBalloon(flyer: Flyer, balloon: Balloon) {
    emitBurst(this, balloon.image.x, balloon.image.y - 6, balloon.color, balloon.value === 3 ? 26 : 16, 46)
    addScore(this, flyer.hud, balloon.value)
    this.popped += 1
    this.tweens.add({
      targets: [balloon.image, balloon.star].filter(Boolean),
      scale: 1.6,
      alpha: 0,
      duration: 120,
      onComplete: () => {
        balloon.image.destroy()
        balloon.star?.destroy()
      },
    })
    this.balloons = this.balloons.filter((entry) => entry !== balloon)
  }

  private finish() {
    if (this.phase === 'done') return
    this.phase = 'done'
    const scores = this.flyers.map((flyer) => flyer.hud.score)
    completeLevel(this, this.state, scores, `Popped ${this.popped} balloons!`)
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000)
    const width = this.scale.width

    this.clouds.forEach((cloud) => {
      cloud.x -= 12 * dt * cloud.scale
      if (cloud.x < -80) cloud.x = width + 80
    })

    const playing = this.phase === 'play'
    if (playing && this.spawned < TOTAL_BALLOONS && time >= this.nextSpawn) {
      this.spawnBalloon()
      this.nextSpawn = time + Math.max(500, SPAWN_INTERVAL - this.tier * 90)
    }

    this.balloons.forEach((balloon) => {
      balloon.image.y -= balloon.riseSpeed * dt
      balloon.image.x = balloon.baseX + Math.sin(time / 600 + balloon.swayPhase) * balloon.swayAmount
      balloon.image.setAngle(Math.sin(time / 600 + balloon.swayPhase) * 6)
      balloon.star?.setPosition(balloon.image.x, balloon.image.y - 6)
    })
    this.balloons.filter((balloon) => balloon.image.y < -60).forEach((balloon) => this.removeBalloon(balloon))

    this.flyers.forEach((flyer) => this.updateFlyer(flyer, dt, time, playing))
    if (this.state.playerCount === 2) this.bumpCheck(time)

    this.progress?.set((this.spawned - this.balloons.length) / TOTAL_BALLOONS)
    if (playing && this.spawned >= TOTAL_BALLOONS && this.balloons.length === 0) {
      this.finish()
    }
  }

  private updateFlyer(flyer: Flyer, dt: number, time: number, playing: boolean) {
    const sprite = flyer.actor.sprite
    const keys = flyer.keys
    const flapped = justDown(keys?.up) || flyer.pointerFlap
    flyer.pointerFlap = false

    if (this.phase === 'done') {
      flyer.vx *= 0.9
      flyer.vy = Math.sin(time / 260) * 20
    } else if (!playing) {
      flyer.vy = Math.sin(time / 260) * 30
      flyer.vx = 0
    } else {
      let thrust = 0
      if (keys?.left.isDown) thrust -= 1
      if (keys?.right.isDown) thrust += 1
      flyer.vx = Phaser.Math.Linear(flyer.vx, thrust * THRUST, 0.12)
      if (flapped) {
        flyer.vy = FLAP_VELOCITY
        flyer.wings.flap()
        emitBurst(this, sprite.x - 20, sprite.y + 8, 0xffffff, 4, 14)
      }
      flyer.vy = Math.min(MAX_FALL_SPEED, flyer.vy + GRAVITY * dt)
    }

    sprite.x += flyer.vx * dt
    sprite.y += flyer.vy * dt
    if (sprite.x < BOUNDS.left) {
      sprite.x = BOUNDS.left
      flyer.vx = Math.max(0, flyer.vx)
    }
    if (sprite.x > BOUNDS.right) {
      sprite.x = BOUNDS.right
      flyer.vx = Math.min(0, flyer.vx)
    }
    if (sprite.y < BOUNDS.top) {
      sprite.y = BOUNDS.top
      flyer.vy = Math.max(0, flyer.vy)
    }
    if (sprite.y > BOUNDS.bottom) {
      sprite.y = BOUNDS.bottom
      flyer.vy = Math.min(0, flyer.vy)
    }

    const targetTilt = playing ? Phaser.Math.Clamp(flyer.vy / 1100, -0.35, 0.45) : 0
    flyer.tilt = Phaser.Math.Linear(flyer.tilt, targetTilt, 0.12)
    sprite.setRotation(flyer.tilt)
    flyer.wings.idle(time)
    flyer.wings.place(sprite.x, sprite.y, flyer.tilt)

    if (playing) {
      this.balloons
        .filter((balloon) => Phaser.Math.Distance.Between(sprite.x, sprite.y, balloon.image.x, balloon.image.y - 6) < balloon.radius)
        .forEach((balloon) => this.popBalloon(flyer, balloon))
    }
  }

  private bumpCheck(time: number) {
    const a = this.flyers[0]
    const b = this.flyers[1]
    if (!a || !b || time < a.bumpUntil) return
    const ax = a.actor.sprite.x
    const ay = a.actor.sprite.y
    const bx = b.actor.sprite.x
    const by = b.actor.sprite.y
    const distance = Phaser.Math.Distance.Between(ax, ay, bx, by)
    if (distance > 64) return
    const dx = distance > 0 ? (bx - ax) / distance : 1
    const dy = distance > 0 ? (by - ay) / distance : 0
    a.vx = -dx * 240
    a.vy = -dy * 240 - 80
    b.vx = dx * 240
    b.vy = dy * 240 - 80
    a.bumpUntil = time + 500
    b.bumpUntil = time + 500
    emitBurst(this, (ax + bx) / 2, (ay + by) / 2, 0xffffff, 16, 40)
  }
}
