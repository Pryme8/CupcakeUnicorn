import Phaser from 'phaser'
import { UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, loadAssets } from '../assets'
import { createPegasusTextures } from '../pegasusTextures'
import { difficultyTier, levelCycle, type LevelSceneData } from '../levels'
import {
  DIRECTIONS,
  DIRECTION_VECTORS,
  type Direction,
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
  justPressedDirection,
  paintSky,
  playActor,
  playerColor,
  playerName,
  playerTint,
  readLevelData,
  showLevelBanner,
  wobbleSprite,
} from '../levelKit'

// ---------------------------------------------------------------------------
// Level 6: Mirror Dance.
//
// Two dance floors. The leader makes up a little dance by hopping around
// their 3x3 floor; then the follower copies it step by step. Arrows at the
// top show the dance, so it's about matching, not memory. Both players score
// for every matched step. The leader swaps every time this level comes
// around. In solo mode a ghost unicorn leads.
// ---------------------------------------------------------------------------

const TILE = 84
const GAP = 8
const GRID_TOP = 150
const LEFT_GRID_X = 250
const RIGHT_GRID_X = 710
const ROUND_LENGTHS = [2, 3, 3, 4, 4]
const HOP_DURATION = 220
const GHOST_STEP_DELAY = 600
const TILE_COLORS = [0xffe3f1, 0xe3f0ff]
const ARROW_TEXTURE = 'dance-arrow'

type Dancer = {
  actor: UnicornActor
  keys?: PlayerKeys
  hud?: ScoreHud
  gridX: number
  col: number
  row: number
  tiles: Phaser.GameObjects.Rectangle[]
  isGhost: boolean
  hopping: boolean
}

type Phase = 'intro' | 'leader' | 'follower' | 'celebrate' | 'done'

const tileCenter = (gridX: number, col: number, row: number) => ({
  x: gridX + (col - 1) * (TILE + GAP),
  y: GRID_TOP + row * (TILE + GAP) + TILE / 2,
})

const DIRECTION_ANGLE: Record<Direction, number> = { up: 0, right: 90, down: 180, left: 270 }

export default class MirrorDanceScene extends Phaser.Scene {
  private state: LevelState = { playerCount: 1, level: 6, scores: [] }
  private dancers: Dancer[] = []
  private leader?: Dancer
  private follower?: Dancer
  private phase: Phase = 'intro'
  private round = 0
  private sequence: Direction[] = []
  private followIndex = 0
  private arrows: Phaser.GameObjects.Image[] = []
  private turnText?: Phaser.GameObjects.Text
  private matched = 0

  constructor() {
    super('MirrorDanceScene')
  }

  init(data: LevelSceneData) {
    this.state = readLevelData(data, 6)
    this.dancers = []
    this.leader = undefined
    this.follower = undefined
    this.phase = 'intro'
    this.round = 0
    this.sequence = []
    this.followIndex = 0
    this.arrows = []
    this.matched = 0
  }

  preload() {
    loadAssets(this)
  }

  create() {
    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)
    createPegasusTextures(this)
    this.createArrowTexture()

    const height = this.scale.height
    paintSky(this, 0xf3e4ff, 0xfff0f7)

    if (this.state.playerCount === 2) {
      const leaderIndex = levelCycle(this.state.level) % 2
      const p1 = this.createDancer(0, LEFT_GRID_X, false)
      const p2 = this.createDancer(1, RIGHT_GRID_X, false)
      this.dancers = [p1, p2]
      this.leader = leaderIndex === 0 ? p1 : p2
      this.follower = leaderIndex === 0 ? p2 : p1
    } else {
      const ghost = this.createDancer(0, LEFT_GRID_X, true)
      const player = this.createDancer(0, RIGHT_GRID_X, false)
      this.dancers = [ghost, player]
      this.leader = ghost
      this.follower = player
    }

    this.turnText = this.add.text(this.scale.width / 2, 108, '', hudStyle(24, '#6b3fa0')).setOrigin(0.5).setDepth(45)

    this.cameras.main.fadeIn(400, 255, 255, 255)
    showLevelBanner(this, this.state.level, 'Mirror Dance!\nCopy the dance', { y: height * 0.42 })
    this.time.delayedCall(2200, () => this.startLeaderTurn())
  }

  private createArrowTexture() {
    if (this.textures.exists(ARROW_TEXTURE)) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillTriangle(14, 2, 26, 18, 2, 18)
    g.fillRect(9, 17, 10, 9)
    g.generateTexture(ARROW_TEXTURE, 28, 28)
    g.destroy()
  }

  private createDancer(index: number, gridX: number, isGhost: boolean): Dancer {
    const tiles: Phaser.GameObjects.Rectangle[] = []
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const center = tileCenter(gridX, col, row)
        const tile = this.add.rectangle(center.x, center.y, TILE, TILE, TILE_COLORS[(col + row) % 2] ?? 0xffffff)
        tile.setStrokeStyle(3, 0xffffff)
        tile.setDepth(2)
        tiles.push(tile)
      }
    }
    const frame = this.add.rectangle(gridX, GRID_TOP + (3 * TILE + 2 * GAP) / 2, 3 * TILE + 2 * GAP + 16, 3 * TILE + 2 * GAP + 16, 0xffffff, 0.35)
    frame.setStrokeStyle(4, isGhost ? 0xd8b4ff : playerTint(index))
    frame.setDepth(1)

    const start = tileCenter(gridX, 1, 1)
    const actor = createUnicornActor(this, start.x, start.y + 30, index, { originY: 1, depth: 10, scale: 0.9 })
    if (isGhost) {
      actor.sprite.setAlpha(0.75)
      actor.sprite.setTint(0xd8b4ff)
    }
    const labelText = isGhost ? 'Ghost Unicorn' : this.state.playerCount === 2 ? playerName(index) : 'You'
    this.add.text(gridX, GRID_TOP - 22, labelText, hudStyle(20, isGhost ? '#8a5fc9' : playerColor(index))).setOrigin(0.5).setDepth(45)

    return {
      actor,
      keys: isGhost ? undefined : createPlayerKeys(this, index),
      hud: isGhost ? undefined : createScoreHud(this, index, this.state.scores[index] ?? 0, this.state.playerCount),
      gridX,
      col: 1,
      row: 1,
      tiles,
      isGhost,
      hopping: false,
    }
  }

  // -------------------------------------------------------------------------
  // Turns
  // -------------------------------------------------------------------------

  private roundLength() {
    // Dances get one hop longer per lap, up to six.
    return Math.min(6, (ROUND_LENGTHS[this.round] ?? 4) + difficultyTier(this.state.level))
  }

  private setTurnText(text: string, color = '#6b3fa0') {
    this.turnText?.setText(text)
    this.turnText?.setColor(color)
  }

  private startLeaderTurn() {
    if (!this.leader || !this.follower) return
    this.phase = 'leader'
    this.sequence = []
    this.followIndex = 0
    this.clearArrows()
    this.resetDancer(this.leader)
    this.resetDancer(this.follower)

    if (this.leader.isGhost) {
      this.setTurnText('Watch the ghost unicorn dance...')
      this.runGhostDance()
    } else {
      const name = playerName(this.leader.actor.index)
      this.setTurnText(`${name}, make up a dance!  (${this.roundLength()} hops)`, playerColor(this.leader.actor.index))
      flashMessage(this, `${name} leads!`, { size: 36, hold: 900, color: playerColor(this.leader.actor.index) })
    }
  }

  private startFollowerTurn() {
    if (!this.follower) return
    this.phase = 'follower'
    this.followIndex = 0
    this.resetDancer(this.follower)
    this.highlightArrow(0)
    const name = this.state.playerCount === 2 ? playerName(this.follower.actor.index) : 'Now you'
    this.setTurnText(`${name}, copy the dance!`, playerColor(this.follower.actor.index))
    flashMessage(this, 'Your turn!', { size: 36, hold: 900, color: playerColor(this.follower.actor.index) })
  }

  private runGhostDance() {
    const ghost = this.leader
    if (!ghost) return
    let col = ghost.col
    let row = ghost.row
    const moves: Direction[] = []
    while (moves.length < this.roundLength()) {
      const options = DIRECTIONS.filter((direction) => {
        const vector = DIRECTION_VECTORS[direction]
        const nextCol = col + vector.x
        const nextRow = row + vector.y
        return nextCol >= 0 && nextCol < 3 && nextRow >= 0 && nextRow < 3
      })
      const pick = Phaser.Utils.Array.GetRandom(options)
      if (!pick) break
      moves.push(pick)
      col += DIRECTION_VECTORS[pick].x
      row += DIRECTION_VECTORS[pick].y
    }
    moves.forEach((direction, index) => {
      const stepDelay = Math.max(380, GHOST_STEP_DELAY - difficultyTier(this.state.level) * 60)
      this.time.delayedCall(700 + index * stepDelay, () => {
        if (this.phase !== 'leader') return
        this.leaderMove(direction)
      })
    })
  }

  private leaderMove(direction: Direction) {
    if (!this.leader || this.phase !== 'leader') return
    // The dance is full; the follower's turn is about to start.
    if (this.sequence.length >= this.roundLength()) return
    if (!this.tryHop(this.leader, direction)) return
    this.sequence.push(direction)
    this.addArrow(direction)
    if (this.sequence.length >= this.roundLength()) {
      this.time.delayedCall(HOP_DURATION + 500, () => this.startFollowerTurn())
    }
  }

  private followerMove(direction: Direction) {
    if (!this.follower || this.phase !== 'follower') return
    const expected = this.sequence[this.followIndex]
    if (!expected) return
    if (direction === expected) {
      if (!this.tryHop(this.follower, direction)) return
      this.followIndex += 1
      this.matched += 1
      this.markArrowDone(this.followIndex - 1)
      this.dancers.forEach((dancer) => {
        if (dancer.hud) addScore(this, dancer.hud, 1)
      })
      const sprite = this.follower.actor.sprite
      emitBurst(this, sprite.x, sprite.y - 30, playerTint(this.follower.actor.index), 10, 30)
      if (this.followIndex >= this.sequence.length) {
        this.celebrate()
      } else {
        this.highlightArrow(this.followIndex)
      }
    } else {
      wobbleSprite(this, this.follower.actor.sprite)
      const arrow = this.arrows[this.followIndex]
      if (arrow) this.tweens.add({ targets: arrow, scale: 1.6, duration: 120, yoyo: true, repeat: 1 })
    }
  }

  private celebrate() {
    this.phase = 'celebrate'
    this.setTurnText('Perfect!', '#c2418f')
    flashMessage(this, 'Perfect!', { size: 44, hold: 900 })
    this.dancers.forEach((dancer) => {
      const sprite = dancer.actor.sprite
      playActor(dancer.actor, 'jumpStart')
      emitBurst(this, sprite.x, sprite.y - 40, 0xffd166, 18, 60)
      if (dancer.hud) addScore(this, dancer.hud, 2)
    })
    this.round += 1
    this.time.delayedCall(1500, () => {
      if (this.round >= ROUND_LENGTHS.length) {
        this.finish()
      } else {
        this.startLeaderTurn()
      }
    })
  }

  private finish() {
    this.phase = 'done'
    this.setTurnText('')
    const scores = this.dancers.filter((dancer) => dancer.hud).map((dancer) => dancer.hud?.score ?? 0)
    completeLevel(this, this.state, scores, `${this.matched} dance steps matched!`)
  }

  // -------------------------------------------------------------------------
  // Movement and arrows
  // -------------------------------------------------------------------------

  private resetDancer(dancer: Dancer) {
    dancer.col = 1
    dancer.row = 1
    dancer.hopping = false
    const center = tileCenter(dancer.gridX, 1, 1)
    this.tweens.add({ targets: dancer.actor.sprite, x: center.x, y: center.y + 30, duration: 300, ease: 'Sine.inOut' })
  }

  private tryHop(dancer: Dancer, direction: Direction) {
    if (dancer.hopping) return false
    const vector = DIRECTION_VECTORS[direction]
    const col = dancer.col + vector.x
    const row = dancer.row + vector.y
    if (col < 0 || col > 2 || row < 0 || row > 2) {
      wobbleSprite(this, dancer.actor.sprite)
      return false
    }
    dancer.col = col
    dancer.row = row
    dancer.hopping = true
    const center = tileCenter(dancer.gridX, col, row)
    const sprite = dancer.actor.sprite
    if (direction === 'left') sprite.setFlipX(true)
    if (direction === 'right') sprite.setFlipX(false)
    playActor(dancer.actor, 'jumpStart')
    this.tweens.add({
      targets: sprite,
      x: center.x,
      y: center.y + 30,
      duration: HOP_DURATION,
      ease: 'Sine.inOut',
      onComplete: () => {
        dancer.hopping = false
        playActor(dancer.actor, 'idle')
      },
    })
    this.lightTile(dancer, col, row)
    return true
  }

  private lightTile(dancer: Dancer, col: number, row: number) {
    const tile = dancer.tiles[row * 3 + col]
    if (!tile) return
    const base = TILE_COLORS[(col + row) % 2] ?? 0xffffff
    tile.setFillStyle(dancer.isGhost ? 0xd8b4ff : playerTint(dancer.actor.index))
    this.time.delayedCall(380, () => tile.setFillStyle(base))
  }

  private clearArrows() {
    this.arrows.forEach((arrow) => arrow.destroy())
    this.arrows = []
  }

  private addArrow(direction: Direction) {
    const count = this.roundLength()
    const spacing = 44
    const startX = this.scale.width / 2 - ((count - 1) * spacing) / 2
    const index = this.arrows.length
    const arrow = this.add.image(startX + index * spacing, 66, ARROW_TEXTURE)
    arrow.setAngle(DIRECTION_ANGLE[direction])
    arrow.setTint(0x9a8fb0)
    arrow.setDepth(45)
    arrow.setScale(0)
    this.tweens.add({ targets: arrow, scale: 1.2, duration: 200, ease: 'Back.out' })
    this.arrows.push(arrow)
  }

  private highlightArrow(index: number) {
    this.arrows.forEach((arrow, i) => {
      if (i === index) {
        arrow.setTint(0xffc857)
        this.tweens.add({ targets: arrow, scale: 1.5, duration: 200, yoyo: true })
      } else if (i > index) {
        arrow.setTint(0x9a8fb0)
      }
    })
  }

  private markArrowDone(index: number) {
    const arrow = this.arrows[index]
    if (arrow) arrow.setTint(0x7ae582)
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update() {
    if (this.phase === 'leader' && this.leader && !this.leader.isGhost) {
      const direction = justPressedDirection(this.leader.keys)
      if (direction) this.leaderMove(direction)
      // Swallow the follower's presses so a key press does not carry over.
      justPressedDirection(this.follower?.keys)
    } else if (this.phase === 'follower' && this.follower) {
      const direction = justPressedDirection(this.follower.keys)
      if (direction) this.followerMove(direction)
      justPressedDirection(this.leader?.keys)
    } else {
      this.dancers.forEach((dancer) => justPressedDirection(dancer.keys))
    }
  }
}
