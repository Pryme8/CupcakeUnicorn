import Phaser from 'phaser'
import { ASSET_KEYS, UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, loadAssets } from '../assets'
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
  createScoreHud,
  createUnicornActor,
  emitBurst,
  paintSky,
  pickupColor,
  pickupTexture,
  playActor,
  playerName,
  playerTint,
  rainbowFlash,
  readLevelData,
  showLevelBanner,
} from '../levelKit'

// ---------------------------------------------------------------------------
// Level 3: Rainbow Garden Maze.
//
// A top-down hedge maze generated fresh every visit. Pickups hide in the dead
// ends so exploring pays off, and the rainbow cloud sits in the middle for a
// bonus. The level ends once every pickup is found. Two players share one maze
// and start in opposite corners.
// ---------------------------------------------------------------------------

const COLS = 15
const ROWS = 7
const CELL = 60
const WALL = 8
const ORIGIN_X = 30
const ORIGIN_Y = 100
const MOVE_SPEED = 170
const EXTRA_OPENINGS = 10
const PICKUP_TARGET = 24
const PICKUP_TYPES = ['heart', 'star', 'flower', 'grapes', 'strawberry']

type Walls = { up: boolean; right: boolean; down: boolean; left: boolean }
type Cell = { col: number; row: number; walls: Walls; visited: boolean }

type Runner = {
  actor: UnicornActor
  keys?: PlayerKeys
  hud: ScoreHud
  levelScore: number
  trailAt: number
  gotCloud: boolean
}

const cellCenter = (col: number, row: number) => ({
  x: ORIGIN_X + col * CELL + CELL / 2,
  y: ORIGIN_Y + row * CELL + CELL / 2,
})

export default class MazeScene extends Phaser.Scene {
  private state: LevelState = { playerCount: 1, level: 3, scores: [] }
  private cells: Cell[] = []
  private walls?: Phaser.Physics.Arcade.StaticGroup
  private pickups?: Phaser.Physics.Arcade.Group
  private runners: Runner[] = []
  private remaining = 0
  private finished = false

  constructor() {
    super('MazeScene')
  }

  init(data: LevelSceneData) {
    this.state = readLevelData(data, 3)
    this.cells = []
    this.runners = []
    this.remaining = 0
    this.finished = false
  }

  preload() {
    loadAssets(this)
  }

  create() {
    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)
    createPegasusTextures(this)

    paintSky(this, 0xbfe9ff, 0xdbf7d2)
    const floor = this.add.rectangle(ORIGIN_X + (COLS * CELL) / 2, ORIGIN_Y + (ROWS * CELL) / 2, COLS * CELL + WALL, ROWS * CELL + WALL, 0xd9f5cf)
    floor.setDepth(1)

    this.generateMaze()
    this.buildWalls()
    this.decorate()
    this.placePickups()
    this.placeCloud()

    const spawns = this.state.playerCount === 2
      ? [cellCenter(0, 0), cellCenter(COLS - 1, ROWS - 1)]
      : [cellCenter(0, 0)]
    this.runners = spawns.map((spawn, index) => this.createRunner(spawn.x, spawn.y, index))

    this.cameras.main.fadeIn(400, 255, 255, 255)
    showLevelBanner(this, this.state.level, 'Rainbow Garden Maze!\nFind every sparkle', { y: this.scale.height * 0.42 })
  }

  // -------------------------------------------------------------------------
  // Maze generation (recursive backtracker, then a few extra openings)
  // -------------------------------------------------------------------------

  private cellAt(col: number, row: number) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return undefined
    return this.cells[row * COLS + col]
  }

  private generateMaze() {
    this.cells = []
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        this.cells.push({ col, row, walls: { up: true, right: true, down: true, left: true }, visited: false })
      }
    }

    const start = this.cellAt(Phaser.Math.Between(0, COLS - 1), Phaser.Math.Between(0, ROWS - 1))
    if (!start) return
    start.visited = true
    const stack: Cell[] = [start]

    while (stack.length > 0) {
      const current = stack[stack.length - 1]
      if (!current) break
      const neighbours = [
        { cell: this.cellAt(current.col, current.row - 1), from: 'up' as const, to: 'down' as const },
        { cell: this.cellAt(current.col + 1, current.row), from: 'right' as const, to: 'left' as const },
        { cell: this.cellAt(current.col, current.row + 1), from: 'down' as const, to: 'up' as const },
        { cell: this.cellAt(current.col - 1, current.row), from: 'left' as const, to: 'right' as const },
      ].filter((entry) => entry.cell && !entry.cell.visited)

      const next = Phaser.Utils.Array.GetRandom(neighbours)
      if (!next || !next.cell) {
        stack.pop()
        continue
      }
      current.walls[next.from] = false
      next.cell.walls[next.to] = false
      next.cell.visited = true
      stack.push(next.cell)
    }

    // Knock out a few extra walls so there are loops and fewer long dead ends.
    // Later laps get fewer shortcuts, so the maze is more of a maze.
    const openings = Math.max(0, EXTRA_OPENINGS - difficultyTier(this.state.level) * 3)
    let opened = 0
    let attempts = 0
    while (opened < openings && attempts < 200) {
      attempts += 1
      const cell = this.cellAt(Phaser.Math.Between(1, COLS - 2), Phaser.Math.Between(1, ROWS - 2))
      if (!cell) continue
      const options = [
        { wall: 'up' as const, other: this.cellAt(cell.col, cell.row - 1), otherWall: 'down' as const },
        { wall: 'right' as const, other: this.cellAt(cell.col + 1, cell.row), otherWall: 'left' as const },
      ].filter((entry) => entry.other && cell.walls[entry.wall])
      const pick = Phaser.Utils.Array.GetRandom(options)
      if (!pick || !pick.other) continue
      cell.walls[pick.wall] = false
      pick.other.walls[pick.otherWall] = false
      opened += 1
    }
  }

  private buildWalls() {
    const walls = this.physics.add.staticGroup()
    this.walls = walls
    const addWall = (x: number, y: number, width: number, height: number) => {
      const rect = this.add.rectangle(x, y, width, height, 0x6fcf7a)
      rect.setStrokeStyle(2, 0x3f9a52)
      rect.setDepth(3)
      this.physics.add.existing(rect, true)
      walls.add(rect)
    }

    this.cells.forEach((cell) => {
      const left = ORIGIN_X + cell.col * CELL
      const top = ORIGIN_Y + cell.row * CELL
      const center = cellCenter(cell.col, cell.row)
      if (cell.walls.up) addWall(center.x, top, CELL + WALL, WALL)
      if (cell.walls.left) addWall(left, center.y, WALL, CELL + WALL)
      if (cell.col === COLS - 1 && cell.walls.right) addWall(left + CELL, center.y, WALL, CELL + WALL)
      if (cell.row === ROWS - 1 && cell.walls.down) addWall(center.x, top + CELL, CELL + WALL, WALL)
    })
  }

  private decorate() {
    // Little flowers on random hedge corners.
    for (let i = 0; i < 14; i += 1) {
      const col = Phaser.Math.Between(0, COLS)
      const row = Phaser.Math.Between(0, ROWS)
      const flower = this.add.image(ORIGIN_X + col * CELL, ORIGIN_Y + row * CELL, ASSET_KEYS.flower)
      flower.setScale(0.5)
      flower.setDepth(4)
      flower.setAngle(Phaser.Math.Between(-20, 20))
    }
  }

  // -------------------------------------------------------------------------
  // Pickups and the rainbow cloud
  // -------------------------------------------------------------------------

  private isReserved(cell: Cell) {
    const isSpawn = (cell.col === 0 && cell.row === 0) || (cell.col === COLS - 1 && cell.row === ROWS - 1)
    const isCenter = cell.col === Math.floor(COLS / 2) && cell.row === Math.floor(ROWS / 2)
    return isSpawn || isCenter
  }

  private placePickups() {
    const pickups = this.physics.add.group()
    this.pickups = pickups
    this.remaining = 0

    const deadEnds = this.cells.filter((cell) => {
      const wallCount = Number(cell.walls.up) + Number(cell.walls.right) + Number(cell.walls.down) + Number(cell.walls.left)
      return wallCount === 3 && !this.isReserved(cell)
    })
    const chosen = new Set<Cell>(deadEnds)
    const others = this.cells.filter((cell) => !chosen.has(cell) && !this.isReserved(cell))
    Phaser.Utils.Array.Shuffle(others)
    for (const cell of others) {
      if (chosen.size >= PICKUP_TARGET) break
      chosen.add(cell)
    }

    chosen.forEach((cell) => {
      const type = Phaser.Utils.Array.GetRandom(PICKUP_TYPES) ?? 'star'
      const center = cellCenter(cell.col, cell.row)
      const image = this.add.image(center.x, center.y, pickupTexture(type))
      image.setScale(0.9)
      image.setDepth(5)
      image.setData('type', type)
      this.physics.add.existing(image)
      const body = image.body as Phaser.Physics.Arcade.Body
      body.setAllowGravity(false)
      body.setImmovable(true)
      body.moves = false
      pickups.add(image)
      this.tweens.add({
        targets: image,
        scale: 1.05,
        duration: Phaser.Math.Between(600, 900),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      })
      this.remaining += 1
    })
  }

  private placeCloud() {
    const center = cellCenter(Math.floor(COLS / 2), Math.floor(ROWS / 2))
    const cloud = this.add.image(center.x, center.y, ASSET_KEYS.cloud)
    cloud.setScale(0.8)
    cloud.setDepth(5)
    this.physics.add.existing(cloud)
    const body = cloud.body as Phaser.Physics.Arcade.Body
    body.setAllowGravity(false)
    body.setImmovable(true)
    body.moves = false
    this.tweens.add({ targets: cloud, y: center.y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
    cloud.setData('isCloud', true)
    this.cloud = cloud
  }

  private cloud?: Phaser.GameObjects.Image

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  private createRunner(x: number, y: number, index: number): Runner {
    const actor = createUnicornActor(this, x, y, index, {
      scale: 0.7,
      physics: true,
      bodyWidth: 0.7,
      bodyHeight: 0.7,
      bodyTop: 0.2,
      depth: 10,
    })
    if (index === 1) actor.sprite.setFlipX(true)
    const hud = createScoreHud(this, index, this.state.scores[index] ?? 0, this.state.playerCount)
    const runner: Runner = { actor, keys: createPlayerKeys(this, index), hud, levelScore: 0, trailAt: 0, gotCloud: false }

    if (this.walls) this.physics.add.collider(actor.sprite, this.walls)
    if (this.pickups) {
      this.physics.add.overlap(actor.sprite, this.pickups, (_runnerObj, pickupObj) => {
        this.collect(runner, pickupObj as Phaser.GameObjects.Image)
      })
    }
    if (this.cloud) {
      this.physics.add.overlap(actor.sprite, this.cloud, () => this.touchCloud(runner))
    }
    return runner
  }

  private collect(runner: Runner, pickup: Phaser.GameObjects.Image) {
    if (!pickup.active) return
    const type = (pickup.getData('type') as string | undefined) ?? 'star'
    emitBurst(this, pickup.x, pickup.y, pickupColor(type), 14, 34, 12)
    pickup.destroy()
    runner.levelScore += 1
    addScore(this, runner.hud, 1)
    this.remaining = Math.max(0, this.remaining - 1)
    if (this.remaining === 0) this.finish()
  }

  private touchCloud(runner: Runner) {
    if (runner.gotCloud || !this.cloud) return
    runner.gotCloud = true
    runner.levelScore += 3
    addScore(this, runner.hud, 3)
    emitBurst(this, this.cloud.x, this.cloud.y, 0xffffff, 20, 50, 12)
    rainbowFlash(this, this.cloud, 2)
    this.tweens.add({ targets: this.cloud, scale: 1.1, duration: 200, yoyo: true })
  }

  private finish() {
    if (this.finished) return
    this.finished = true
    this.runners.forEach((runner) => {
      runner.actor.body?.setVelocity(0, 0)
      playActor(runner.actor, 'idle')
    })
    const scores = this.runners.map((runner) => runner.hud.score)
    const message = this.state.playerCount === 2
      ? this.runners.map((runner) => `${playerName(runner.actor.index)} ${runner.levelScore}`).join('     ')
      : `${this.runners[0]?.levelScore ?? 0} sparkles found!`
    completeLevel(this, this.state, scores, message)
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(time: number) {
    if (this.finished) return
    this.runners.forEach((runner) => {
      const keys = runner.keys
      const body = runner.actor.body
      if (!keys || !body) return
      let vx = 0
      let vy = 0
      if (keys.left.isDown) vx -= 1
      if (keys.right.isDown) vx += 1
      if (keys.up.isDown) vy -= 1
      if (keys.down.isDown) vy += 1
      const moving = vx !== 0 || vy !== 0
      if (moving) {
        const length = Math.hypot(vx, vy)
        body.setVelocity((vx / length) * MOVE_SPEED, (vy / length) * MOVE_SPEED)
        if (vx < 0) runner.actor.sprite.setFlipX(true)
        if (vx > 0) runner.actor.sprite.setFlipX(false)
        playActor(runner.actor, 'walk')
        if (time >= runner.trailAt) {
          runner.trailAt = time + 110
          this.dropTrail(runner)
        }
      } else {
        body.setVelocity(0, 0)
        playActor(runner.actor, 'idle')
      }
    })
  }

  private dropTrail(runner: Runner) {
    const sprite = runner.actor.sprite
    const dot = this.add.image(sprite.x + Phaser.Math.Between(-6, 6), sprite.y + 14, PEGASUS_TEXTURES.dot)
    dot.setTint(playerTint(runner.actor.index))
    dot.setAlpha(0.8)
    dot.setDepth(6)
    this.tweens.add({
      targets: dot,
      alpha: 0,
      scale: 0.3,
      duration: 1400,
      onComplete: () => dot.destroy(),
    })
  }
}
