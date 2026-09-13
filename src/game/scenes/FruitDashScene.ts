import Phaser from 'phaser'
import { UNICORN_FRAMES, UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, getVariantFrameKey, loadAssets } from '../assets'
import { PEGASUS_TEXTURES, createPegasusTextures } from '../pegasusTextures'
import { difficultyTier, type LevelSceneData } from '../levels'
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
  flashMessage,
  hudStyle,
  justDown,
  paintSky,
  pickupColor,
  pickupTexture,
  playActor,
  playerColor,
  playerName,
  readLevelData,
  showLevelBanner,
  wobbleSprite,
} from '../levelKit'

// ---------------------------------------------------------------------------
// Level 8: Fruit Dash.
//
// An auto-running side level where the only control is jump. Fresh fruit is
// good: run straight through it for a point. Rotten fruit is yucky: jump over
// it for a bonus. Touching rotten fruit only costs a wobble and a moment of
// slow-down, never points. With two players the screen is split into two
// full-width lanes, top and bottom, so both see the same run.
// ---------------------------------------------------------------------------

const SCROLL_SPEED = 260
const GRAVITY = 1500
const JUMP_VELOCITY = -600
const PLAYER_X = 200
const GROUND_HEIGHT = 34
const FRUIT_COUNT = 40
const INTRO_DURATION = 2200
const GOOD_FRUIT = ['strawberry', 'grapes', 'cupcake']
const ROTTEN_TINT = 0x7c8a3a
const STINK_TEXTURE = 'stink-lines'

type Fruit = {
  image: Phaser.GameObjects.Image
  stink?: Phaser.GameObjects.Image
  rotten: boolean
  type: string
  done: boolean
}

type Lane = {
  index: number
  top: number
  height: number
  groundY: number
}

type Runner = {
  lane: Lane
  actor: UnicornActor
  keys?: PlayerKeys
  hud: ScoreHud
  y: number
  vy: number
  grounded: boolean
  pointerJump: boolean
  fruits: Fruit[]
  spawned: number
  nextSpawn: number
  slowUntil: number
  stumbleUntil: number
  clouds: Phaser.GameObjects.Image[]
  hint: Phaser.GameObjects.Text
  cleared: number
  eaten: number
  finished: boolean
}

export default class FruitDashScene extends Phaser.Scene {
  private state: LevelState = { playerCount: 1, level: 8, scores: [] }
  private runners: Runner[] = []
  private phase: 'intro' | 'play' | 'done' = 'intro'
  private progress?: { set: (progress: number) => void }
  private tier = 0

  constructor() {
    super('FruitDashScene')
  }

  init(data: LevelSceneData) {
    this.state = readLevelData(data, 8)
    this.runners = []
    this.phase = 'intro'
    this.tier = difficultyTier(this.state.level)
  }

  preload() {
    loadAssets(this)
  }

  create() {
    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)
    createPegasusTextures(this)
    this.createStinkTexture()

    const width = this.scale.width
    const height = this.scale.height
    paintSky(this, 0x8fd3ff, 0xfff3d6)

    const lanes: Lane[] = this.state.playerCount === 2
      ? [
          { index: 0, top: 0, height: height / 2, groundY: height / 2 - GROUND_HEIGHT },
          { index: 1, top: height / 2, height: height / 2, groundY: height - GROUND_HEIGHT },
        ]
      : [{ index: 0, top: 0, height, groundY: height - GROUND_HEIGHT }]

    this.runners = lanes.map((lane) => this.createRunner(lane))
    this.progress = createProgressBar(this)

    if (this.state.playerCount === 2) {
      this.add.rectangle(width / 2, height / 2, width, 6, 0xffffff, 0.9).setDepth(20)
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const runner = this.runners.find((entry) => pointer.y >= entry.lane.top && pointer.y < entry.lane.top + entry.lane.height)
      if (runner) runner.pointerJump = true
    })

    this.cameras.main.fadeIn(400, 255, 255, 255)
    showLevelBanner(this, this.state.level, 'Fruit Dash!\nJump the rotten fruit', { y: height * 0.42 })
    this.time.delayedCall(INTRO_DURATION, () => {
      this.phase = 'play'
      this.runners.forEach((runner) => {
        runner.nextSpawn = this.time.now + 900
      })
    })
  }

  private createStinkTexture() {
    if (this.textures.exists(STINK_TEXTURE)) return
    const g = this.add.graphics()
    g.lineStyle(2, 0x5d6b2a, 1)
    for (let i = 0; i < 3; i += 1) {
      const x = 4 + i * 7
      g.beginPath()
      g.moveTo(x, 18)
      g.lineTo(x + 3, 13)
      g.lineTo(x, 8)
      g.lineTo(x + 3, 3)
      g.strokePath()
    }
    g.generateTexture(STINK_TEXTURE, 24, 20)
    g.destroy()
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private createRunner(lane: Lane): Runner {
    const width = this.scale.width
    const index = lane.index

    // Ground strip with a darker path line.
    const ground = this.add.rectangle(width / 2, lane.groundY + GROUND_HEIGHT / 2, width, GROUND_HEIGHT, 0x9be27a)
    ground.setStrokeStyle(3, 0x5fae4b)
    ground.setDepth(2)
    this.add.rectangle(width / 2, lane.groundY + 4, width, 4, 0xc9a86a, 0.8).setDepth(3)

    const clouds: Phaser.GameObjects.Image[] = []
    for (let i = 0; i < 4; i += 1) {
      const cloud = this.add.image(
        Phaser.Math.Between(0, width),
        lane.top + Phaser.Math.Between(40, Math.max(60, lane.height - 120)),
        PEGASUS_TEXTURES.cloud
      )
      cloud.setScale(Phaser.Math.FloatBetween(0.7, 1.2))
      cloud.setAlpha(0.7)
      cloud.setDepth(1)
      clouds.push(cloud)
    }

    const actor = createUnicornActor(this, PLAYER_X, lane.groundY, index, { originY: 1, depth: 10, scale: 1.1 })
    const flyKey = getVariantFrameKey(UNICORN_FRAMES.fly, 0, actor.variant)
    if (this.textures.exists(flyKey)) actor.sprite.setTexture(flyKey)
    playActor(actor, 'fly')

    const hud = createScoreHud(this, index, this.state.scores[index] ?? 0, this.state.playerCount)
    if (this.state.playerCount === 2) {
      hud.text.setY(lane.top + 16)
      hud.icon.setY(lane.top + 28)
    }

    const hint = this.add.text(PLAYER_X, lane.groundY - 110, index === 1 ? 'Press  ↑  to jump!' : 'Press  W  to jump!', {
      ...hudStyle(20, playerColor(index)),
      backgroundColor: 'rgba(255,255,255,0.75)',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setDepth(12)

    return {
      lane,
      actor,
      keys: createPlayerKeys(this, index),
      hud,
      y: lane.groundY,
      vy: 0,
      grounded: true,
      pointerJump: false,
      fruits: [],
      spawned: 0,
      nextSpawn: 0,
      slowUntil: 0,
      stumbleUntil: 0,
      clouds,
      hint,
      cleared: 0,
      eaten: 0,
      finished: false,
    }
  }

  // -------------------------------------------------------------------------
  // Fruit
  // -------------------------------------------------------------------------

  private spawnFruit(runner: Runner) {
    const width = this.scale.width
    const rotten = Phaser.Math.FloatBetween(0, 1) < 0.4 + this.tier * 0.05
    const type = Phaser.Utils.Array.GetRandom(GOOD_FRUIT) ?? 'strawberry'
    const image = this.add.image(width + 40, runner.lane.groundY - 16, pickupTexture(type))
    image.setDepth(6)
    let stink: Phaser.GameObjects.Image | undefined
    if (rotten) {
      image.setTint(ROTTEN_TINT)
      image.setScale(1.1)
      stink = this.add.image(image.x, image.y - 26, STINK_TEXTURE)
      stink.setDepth(6)
      this.tweens.add({ targets: stink, y: image.y - 32, alpha: 0.5, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
    } else {
      this.tweens.add({ targets: image, angle: 8, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
    }
    runner.fruits.push({ image, stink, rotten, type, done: false })
    runner.spawned += 1
  }

  private removeFruit(runner: Runner, fruit: Fruit) {
    fruit.image.destroy()
    fruit.stink?.destroy()
    runner.fruits = runner.fruits.filter((entry) => entry !== fruit)
  }

  private eatFruit(runner: Runner, fruit: Fruit) {
    fruit.done = true
    runner.eaten += 1
    addScore(this, runner.hud, 1)
    emitBurst(this, fruit.image.x, fruit.image.y, pickupColor(fruit.type), 12, 30)
    this.removeFruit(runner, fruit)
  }

  private stumble(runner: Runner, fruit: Fruit) {
    fruit.done = true
    runner.slowUntil = this.time.now + 800
    runner.stumbleUntil = this.time.now + 500
    wobbleSprite(this, runner.actor.sprite)
    emitBurst(this, fruit.image.x, fruit.image.y, 0x8fbf3f, 12, 30)
    flashMessage(this, 'Yuck!', { x: PLAYER_X + 60, y: runner.lane.groundY - 120, size: 26, hold: 500, color: '#8fbf3f' })
    this.tweens.add({
      targets: fruit.image,
      alpha: 0,
      scale: 0.4,
      duration: 250,
      onComplete: () => this.removeFruit(runner, fruit),
    })
    fruit.stink?.destroy()
    fruit.stink = undefined
  }

  private clearedFruit(runner: Runner, fruit: Fruit) {
    fruit.done = true
    runner.cleared += 1
    addScore(this, runner.hud, 2)
    emitBurst(this, PLAYER_X, runner.y - 40, 0xffd166, 10, 34)
    flashMessage(this, 'Nice jump!', { x: PLAYER_X + 60, y: runner.lane.groundY - 120, size: 24, hold: 500, color: playerColor(runner.actor.index) })
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000)
    this.runners.forEach((runner) => this.updateRunner(runner, dt, time))

    const total = FRUIT_COUNT * this.runners.length
    const passed = this.runners.reduce((sum, runner) => sum + runner.spawned - runner.fruits.length, 0)
    this.progress?.set(passed / total)

    if (this.phase === 'play' && this.runners.every((runner) => runner.finished)) {
      this.finish()
    }
  }

  private updateRunner(runner: Runner, dt: number, time: number) {
    const width = this.scale.width
    const sprite = runner.actor.sprite
    const playing = this.phase === 'play' && !runner.finished
    const slow = time < runner.slowUntil
    const runSpeed = SCROLL_SPEED + this.tier * 22
    const speed = playing ? (slow ? runSpeed * 0.45 : runSpeed) : 0

    runner.clouds.forEach((cloud) => {
      cloud.x -= (speed * 0.15 + 6) * dt * cloud.scale
      if (cloud.x < -80) cloud.x = width + 80
    })

    const wantsJump = justDown(runner.keys?.up) || runner.pointerJump
    runner.pointerJump = false
    if (playing && wantsJump && runner.grounded) {
      runner.vy = JUMP_VELOCITY
      runner.grounded = false
      playActor(runner.actor, 'jumpStart')
      emitBurst(this, PLAYER_X - 10, runner.lane.groundY - 4, 0xffffff, 5, 16)
      if (runner.hint.alpha > 0) {
        this.tweens.add({ targets: runner.hint, alpha: 0, duration: 300 })
      }
    }

    if (!runner.grounded) {
      runner.vy += GRAVITY * dt
      runner.y += runner.vy * dt
      if (runner.y >= runner.lane.groundY) {
        runner.y = runner.lane.groundY
        runner.vy = 0
        runner.grounded = true
        playActor(runner.actor, 'fly')
      }
    }
    sprite.setY(runner.y)
    sprite.setRotation(runner.grounded ? 0 : Phaser.Math.Clamp(runner.vy / 2000, -0.25, 0.25))
    if (runner.grounded) {
      const animKey = time < runner.stumbleUntil ? runner.actor.anims.idle : runner.actor.anims.fly
      if (sprite.anims.currentAnim?.key !== animKey) playActor(runner.actor, time < runner.stumbleUntil ? 'idle' : 'fly')
    }

    if (!playing) return

    if (runner.spawned < FRUIT_COUNT && time >= runner.nextSpawn) {
      this.spawnFruit(runner)
      // Sometimes two fruits close together, otherwise a comfortable gap.
      const pairChance = 0.25 + this.tier * 0.05
      const gapMin = Math.max(800, 1100 - this.tier * 80)
      runner.nextSpawn = time + (Phaser.Math.FloatBetween(0, 1) < pairChance ? 520 : Phaser.Math.Between(gapMin, gapMin + 500))
    }

    const bodyLeft = PLAYER_X - 16
    const bodyRight = PLAYER_X + 18
    const feetY = runner.y
    runner.fruits.slice().forEach((fruit) => {
      fruit.image.x -= speed * dt
      if (fruit.stink) fruit.stink.x = fruit.image.x
      const fx = fruit.image.x
      if (!fruit.done && fx > bodyLeft && fx < bodyRight) {
        const touching = feetY > fruit.image.y - 12
        if (fruit.rotten) {
          if (touching) this.stumble(runner, fruit)
        } else if (touching || feetY > fruit.image.y - 60) {
          this.eatFruit(runner, fruit)
        }
      }
      if (!fruit.done && fx <= bodyLeft && fruit.rotten) {
        this.clearedFruit(runner, fruit)
      }
      if (fruit.image.active && fx < -60) {
        this.removeFruit(runner, fruit)
      }
    })

    if (runner.spawned >= FRUIT_COUNT && runner.fruits.length === 0) {
      runner.finished = true
    }
  }

  private finish() {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.runners.forEach((runner) => playActor(runner.actor, 'idle'))
    const scores = this.runners.map((runner) => runner.hud.score)
    const message = this.state.playerCount === 2
      ? this.runners.map((runner) => `${playerName(runner.actor.index)}: ${runner.cleared} jumps, ${runner.eaten} snacks`).join('   ')
      : `${this.runners[0]?.cleared ?? 0} great jumps, ${this.runners[0]?.eaten ?? 0} snacks!`
    completeLevel(this, this.state, scores, message)
  }
}
