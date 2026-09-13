import Phaser from 'phaser'
import { ASSET_KEYS, UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, loadAssets } from '../assets'
import { createPegasusTextures } from '../pegasusTextures'
import { difficultyTier, type LevelSceneData } from '../levels'
import {
  RAINBOW,
  type LevelState,
  type PlayerKeys,
  type ScoreHud,
  type UnicornActor,
  addScore,
  completeLevel,
  createPlayerKeys,
  createScoreHud,
  createUnicornActor,
  emitBurst,
  flashMessage,
  hudStyle,
  justDown,
  paintSky,
  playActor,
  playerColor,
  playerName,
  playerTint,
  rainbowFlash,
  readLevelData,
  showLevelBanner,
} from '../levelKit'

// ---------------------------------------------------------------------------
// Level 5: Tug of Rainbow.
//
// A gentle mash game. Each press of your magic key tugs the rainbow toward
// your side; pull the star knot past your flag to win the round. Best of
// three. The round winner gets 3 stars, the other player still gets 1, and
// everyone gets a friendship bonus at the end. In solo mode the Rainbow Cloud
// pulls back.
// ---------------------------------------------------------------------------

const GROUND_Y = 470
const ROPE_Y = 425
const CENTER_X = 480
const WIN_OFFSET = 200
const ROUNDS = 3
const PULL_IMPULSE = 75
const DECAY_PER_SECOND = 0.08
const CLOUD_RATES = [3.0, 3.5, 4.0]

type Puller = {
  actor: UnicornActor
  keys?: PlayerKeys
  hud: ScoreHud
  baseX: number
  direction: -1 | 1
  walkUntil: number
  hint?: Phaser.GameObjects.Text
}

export default class TugScene extends Phaser.Scene {
  private state: LevelState = { playerCount: 1, level: 5, scores: [] }
  private pullers: Puller[] = []
  private cloud?: Phaser.GameObjects.Image
  private cloudNextPull = 0
  private rope?: Phaser.GameObjects.Graphics
  private knot?: Phaser.GameObjects.Image
  private roundMarks: Phaser.GameObjects.Image[] = []
  private offset = 0
  private velocity = 0
  private round = 0
  private wins = [0, 0]
  private phase: 'intro' | 'pulling' | 'between' | 'done' = 'intro'

  constructor() {
    super('TugScene')
  }

  init(data: LevelSceneData) {
    this.state = readLevelData(data, 5)
    this.pullers = []
    this.roundMarks = []
    this.offset = 0
    this.velocity = 0
    this.round = 0
    this.wins = [0, 0]
    this.phase = 'intro'
    this.cloud = undefined
  }

  preload() {
    loadAssets(this)
  }

  create() {
    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)
    createPegasusTextures(this)

    const width = this.scale.width
    const height = this.scale.height
    paintSky(this, 0x8fd3ff, 0xfff1f8)
    const ground = this.add.rectangle(width / 2, (GROUND_Y + height) / 2, width, height - GROUND_Y, 0x9be27a)
    ground.setStrokeStyle(3, 0x5fae4b)
    ground.setDepth(2)

    // Flags mark where the knot has to go.
    const flag = (x: number, color: number) => {
      this.add.rectangle(x, GROUND_Y - 30, 4, 60, 0x6b3fa0).setDepth(3)
      this.add.triangle(x + 2, GROUND_Y - 60, 0, 0, 30, 10, 0, 20, color).setOrigin(0, 0).setDepth(3)
    }
    flag(CENTER_X - WIN_OFFSET, playerTint(0))
    flag(CENTER_X + WIN_OFFSET, this.state.playerCount === 2 ? playerTint(1) : 0xffffff)
    this.add.rectangle(CENTER_X, GROUND_Y - 6, 6, 12, 0xffffff).setDepth(3)

    this.rope = this.add.graphics()
    this.rope.setDepth(5)
    this.knot = this.add.image(CENTER_X, ROPE_Y + 10, ASSET_KEYS.star)
    this.knot.setScale(1.5)
    this.knot.setDepth(6)

    for (let i = 0; i < ROUNDS; i += 1) {
      const mark = this.add.image(width / 2 - (ROUNDS - 1) * 20 + i * 40, 30, ASSET_KEYS.star)
      mark.setScale(0.9)
      mark.setTint(0xbbbbbb)
      mark.setDepth(45)
      this.roundMarks.push(mark)
    }

    this.pullers = [this.createPuller(0, CENTER_X - 230, -1)]
    if (this.state.playerCount === 2) {
      this.pullers.push(this.createPuller(1, CENTER_X + 230, 1))
    } else {
      this.cloud = this.add.image(CENTER_X + 230, ROPE_Y - 16, ASSET_KEYS.cloud)
      this.cloud.setScale(1.5)
      this.cloud.setDepth(10)
      this.add.text(CENTER_X + 230, ROPE_Y - 80, 'Rainbow Cloud', hudStyle(16, '#6b3fa0')).setOrigin(0.5).setDepth(11)
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.state.playerCount === 2) {
        const index = pointer.x < width / 2 ? 0 : 1
        const puller = this.pullers[index]
        if (puller) this.pull(puller)
      } else {
        const puller = this.pullers[0]
        if (puller) this.pull(puller)
      }
    })

    this.cameras.main.fadeIn(400, 255, 255, 255)
    showLevelBanner(this, this.state.level, 'Tug of Rainbow!\nTap your magic key fast', { y: height * 0.34 })
    this.time.delayedCall(2700, () => this.startRound())
  }

  private createPuller(index: number, baseX: number, direction: -1 | 1): Puller {
    const actor = createUnicornActor(this, baseX, GROUND_Y, index, { originY: 1, depth: 10, scale: 1.2 })
    if (direction === 1) actor.sprite.setFlipX(true)
    const hud = createScoreHud(this, index, this.state.scores[index] ?? 0, this.state.playerCount)
    const hint = this.add.text(baseX, ROPE_Y - 100, index === 0 ? 'Mash  W !' : 'Mash  ↑ !', hudStyle(20, playerColor(index)))
      .setOrigin(0.5)
      .setDepth(11)
      .setAlpha(0)
    return { actor, keys: createPlayerKeys(this, index), hud, baseX, direction, walkUntil: 0, hint }
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------

  private startRound() {
    this.offset = 0
    this.velocity = 0
    this.phase = 'pulling'
    this.cloudNextPull = this.time.now + 600
    flashMessage(this, `Round ${this.round + 1}`, { size: 40, hold: 700 })
    this.pullers.forEach((puller) => {
      this.tweens.add({ targets: puller.hint, alpha: 1, duration: 300 })
    })
  }

  private pull(puller: Puller) {
    if (this.phase !== 'pulling') return
    this.velocity += PULL_IMPULSE * puller.direction
    puller.walkUntil = this.time.now + 260
    const sprite = puller.actor.sprite
    this.tweens.add({ targets: sprite, y: GROUND_Y - 10, duration: 70, yoyo: true })
    this.tweens.add({ targets: sprite, rotation: -0.12 * puller.direction, duration: 80, yoyo: true })
    if (puller.hint && puller.hint.alpha > 0) {
      this.tweens.add({ targets: puller.hint, alpha: 0, duration: 400 })
    }
    emitBurst(this, sprite.x, sprite.y - 30, playerTint(puller.actor.index), 4, 16)
  }

  private cloudPull() {
    this.velocity += PULL_IMPULSE
    if (this.cloud) {
      this.tweens.add({ targets: this.cloud, scale: 1.65, duration: 80, yoyo: true })
    }
  }

  private endRound(winner: number) {
    this.phase = 'between'
    const winnerIsPlayer = winner < this.pullers.length
    const mark = this.roundMarks[this.round]
    if (mark) {
      mark.setTint(winnerIsPlayer ? playerTint(winner) : 0xffffff)
      this.tweens.add({ targets: mark, scale: 1.3, duration: 150, yoyo: true })
    }
    this.wins[winner] = (this.wins[winner] ?? 0) + 1

    this.pullers.forEach((puller) => {
      const isWinner = puller.actor.index === winner
      addScore(this, puller.hud, isWinner ? 3 : 1)
      if (isWinner) {
        playActor(puller.actor, 'jumpStart')
        emitBurst(this, puller.actor.sprite.x, puller.actor.sprite.y - 40, playerTint(winner), 24, 60)
      }
    })
    if (!winnerIsPlayer && this.cloud) {
      rainbowFlash(this, this.cloud, 2)
    }

    const name = winnerIsPlayer ? playerName(winner) : 'Rainbow Cloud'
    flashMessage(this, `${name} wins the round!`, { size: 34, hold: 1300, color: winnerIsPlayer ? playerColor(winner) : '#ffffff' })
    if (this.knot) rainbowFlash(this, this.knot, 2)

    this.round += 1
    this.time.delayedCall(1900, () => {
      if (this.round >= ROUNDS) {
        this.finish()
      } else {
        this.startRound()
      }
    })
  }

  private finish() {
    this.phase = 'done'
    const p1 = this.wins[0] ?? 0
    const p2 = this.wins[1] ?? 0
    const winner = p1 === p2 ? -1 : p1 > p2 ? 0 : 1
    const winnerIsPlayer = winner >= 0 && winner < this.pullers.length
    // Friendship bonus for everyone.
    this.pullers.forEach((puller) => addScore(this, puller.hud, 2))
    const scores = this.pullers.map((puller) => puller.hud.score)
    const message = winner === -1
      ? 'A tie! Everyone gets a friendship bonus'
      : winnerIsPlayer
        ? `${playerName(winner)} wins the tug!  +2 friendship bonus for all`
        : 'The Rainbow Cloud wins this time!  +2 friendship bonus'
    completeLevel(this, this.state, scores, message)
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000)

    if (this.phase === 'pulling') {
      this.pullers.forEach((puller) => {
        if (justDown(puller.keys?.up)) this.pull(puller)
      })
      if (this.cloud && time >= this.cloudNextPull) {
        this.cloudPull()
        const rate = (CLOUD_RATES[Math.min(this.round, CLOUD_RATES.length - 1)] ?? 3) + difficultyTier(this.state.level) * 0.45
        this.cloudNextPull = time + (1000 / rate) * Phaser.Math.FloatBetween(0.6, 1.4)
      }

      this.offset += this.velocity * dt
      this.velocity *= Math.pow(DECAY_PER_SECOND, dt)
      if (Math.abs(this.offset) >= WIN_OFFSET) {
        this.offset = Math.sign(this.offset) * WIN_OFFSET
        this.endRound(this.offset < 0 ? 0 : 1)
      }
    }

    // Everyone slides along with the rope.
    this.pullers.forEach((puller) => {
      const sprite = puller.actor.sprite
      sprite.x = puller.baseX + this.offset
      if (puller.hint) puller.hint.x = sprite.x
      if (time < puller.walkUntil) {
        playActor(puller.actor, 'walk')
      } else if (sprite.anims.currentAnim?.key !== puller.actor.anims.jumpStart || !sprite.anims.isPlaying) {
        playActor(puller.actor, 'idle')
      }
    })
    if (this.cloud) {
      this.cloud.x = CENTER_X + 230 + this.offset
      this.cloud.y = ROPE_Y - 16 + Math.sin(time / 300) * 4
    }
    this.knot?.setPosition(CENTER_X + this.offset, ROPE_Y + 10)
    this.drawRope()
  }

  private drawRope() {
    if (!this.rope) return
    const left = this.pullers[0]
    const rightX = this.pullers[1]?.actor.sprite.x ?? this.cloud?.x ?? CENTER_X + 230
    const leftX = left ? left.actor.sprite.x : CENTER_X - 230
    this.rope.clear()
    RAINBOW.forEach((color, index) => {
      this.rope?.lineStyle(5, color, 1)
      this.rope?.lineBetween(leftX + 26, ROPE_Y + index * 5, rightX - 26, ROPE_Y + index * 5)
    })
  }
}
