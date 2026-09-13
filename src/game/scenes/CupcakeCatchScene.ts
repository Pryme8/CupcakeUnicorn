import Phaser from 'phaser'
import { ASSET_KEYS, UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, loadAssets } from '../assets'
import { createPegasusTextures } from '../pegasusTextures'
import { difficultyTier, type LevelSceneData } from '../levels'
import {
  type LevelState,
  type PlayerKeys,
  type ScoreHud,
  type UnicornActor,
  addScore,
  bounceSprite,
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
} from '../levelKit'

// ---------------------------------------------------------------------------
// Level 4: Cupcake Catch.
//
// One unicorn walks along a cloud ledge dropping cupcakes; the other runs
// along the ground catching them. Every catch scores for the whole team.
// Halfway through the roles swap. With one player the rainbow cloud does the
// dropping. Missed cupcakes just puff into sparkles - no penalty.
// ---------------------------------------------------------------------------

const LEDGE_Y = 180
const GROUND_Y = 500
const DURATION = 40000
const SWAP_AT = DURATION / 2
const FALL_SPEED = 230
const DROPPER_SPEED = 240
const CATCHER_SPEED = 290

type Role = 'dropper' | 'catcher'

type Player = {
  actor: UnicornActor
  keys?: PlayerKeys
  hud: ScoreHud
  role: Role
  label: Phaser.GameObjects.Text
  eatingUntil: number
  dropReadyAt: number
}

export default class CupcakeCatchScene extends Phaser.Scene {
  private state: LevelState = { playerCount: 1, level: 4, scores: [] }
  private players: Player[] = []
  private items?: Phaser.Physics.Arcade.Group
  private cloudDropper?: Phaser.GameObjects.Image
  private phase: 'intro' | 'play' | 'done' = 'intro'
  private elapsed = 0
  private swapped = false
  private nextAutoDrop = 0
  private caught = 0
  private progress?: { set: (progress: number) => void }
  private tier = 0

  constructor() {
    super('CupcakeCatchScene')
  }

  init(data: LevelSceneData) {
    this.state = readLevelData(data, 4)
    this.players = []
    this.phase = 'intro'
    this.elapsed = 0
    this.swapped = false
    this.nextAutoDrop = 0
    this.caught = 0
    this.cloudDropper = undefined
    this.tier = difficultyTier(this.state.level)
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
    paintSky(this, 0x8fd3ff, 0xe8f8ff)

    // Cloud ledge and grassy ground.
    const ledge = this.add.rectangle(width / 2, LEDGE_Y + 10, width - 80, 22, 0xffffff, 0.95)
    ledge.setStrokeStyle(3, 0xd7e8ff)
    ledge.setDepth(2)
    for (let i = 0; i < 9; i += 1) {
      const puff = this.add.ellipse(60 + i * 105, LEDGE_Y + 14, 90, 34, 0xffffff, 0.95)
      puff.setDepth(2)
    }
    const ground = this.add.rectangle(width / 2, (GROUND_Y + height) / 2, width, height - GROUND_Y, 0x9be27a)
    ground.setStrokeStyle(3, 0x5fae4b)
    ground.setDepth(2)

    this.items = this.physics.add.group()
    this.progress = createProgressBar(this)

    if (this.state.playerCount === 2) {
      this.players = [this.createPlayer(0, 'dropper'), this.createPlayer(1, 'catcher')]
    } else {
      this.players = [this.createPlayer(0, 'catcher')]
      this.cloudDropper = this.add.image(width / 2, LEDGE_Y - 26, ASSET_KEYS.cloud)
      this.cloudDropper.setScale(1.3)
      this.cloudDropper.setDepth(8)
    }

    this.cameras.main.fadeIn(400, 255, 255, 255)
    showLevelBanner(this, this.state.level, 'Cupcake Catch!\nCatch what falls', { y: height * 0.42 })
    this.time.delayedCall(2000, () => {
      this.phase = 'play'
      this.nextAutoDrop = this.time.now + 600
    })
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  private roleX(index: number) {
    return this.state.playerCount === 2 ? (index === 0 ? 300 : 660) : this.scale.width / 2
  }

  private roleY(role: Role) {
    return role === 'dropper' ? LEDGE_Y : GROUND_Y
  }

  private createPlayer(index: number, role: Role): Player {
    const actor = createUnicornActor(this, this.roleX(index), this.roleY(role), index, {
      physics: true,
      originY: 1,
      bodyWidth: 0.7,
      bodyHeight: 0.6,
      bodyTop: 0.2,
      depth: 10,
    })
    actor.body?.setCollideWorldBounds(false)
    const hud = createScoreHud(this, index, this.state.scores[index] ?? 0, this.state.playerCount)
    const label = this.add.text(actor.sprite.x, actor.sprite.y - 66, '', hudStyle(16, playerColor(index)))
      .setOrigin(0.5, 1)
      .setDepth(11)
    const player: Player = { actor, keys: createPlayerKeys(this, index), hud, role, label, eatingUntil: 0, dropReadyAt: 0 }
    this.setRole(player, role)

    if (this.items) {
      this.physics.add.overlap(actor.sprite, this.items, (_playerObj, itemObj) => {
        if (player.role === 'catcher') this.catchItem(player, itemObj as Phaser.GameObjects.Image)
      })
    }
    return player
  }

  private setRole(player: Player, role: Role) {
    player.role = role
    const name = this.state.playerCount === 2 ? `${playerName(player.actor.index)}: ` : ''
    player.label.setText(role === 'dropper' ? `${name}Dropper` : `${name}Catcher`)
  }

  private swapRoles() {
    this.swapped = true
    flashMessage(this, 'Swap!', { size: 44 })
    this.players.forEach((player) => {
      const role: Role = player.role === 'dropper' ? 'catcher' : 'dropper'
      this.setRole(player, role)
      this.tweens.add({
        targets: player.actor.sprite,
        y: this.roleY(role),
        duration: 500,
        ease: 'Sine.inOut',
      })
      emitBurst(this, player.actor.sprite.x, player.actor.sprite.y - 30, 0xffffff, 12, 40)
    })
  }

  // -------------------------------------------------------------------------
  // Dropping and catching
  // -------------------------------------------------------------------------

  private dropItem(x: number) {
    if (!this.items) return
    const type = Phaser.Math.FloatBetween(0, 1) < 0.22 ? 'star' : 'cupcake'
    const item = this.add.image(x, LEDGE_Y - 6, pickupTexture(type))
    item.setDepth(9)
    item.setData('type', type)
    item.setData('value', type === 'star' ? 2 : 1)
    this.physics.add.existing(item)
    const body = item.body as Phaser.Physics.Arcade.Body
    body.setAllowGravity(false)
    body.setVelocity(Phaser.Math.Between(-20, 20), FALL_SPEED + this.tier * 30 + Phaser.Math.Between(-20, 30))
    body.setSize(item.width * 0.8, item.height * 0.8, true)
    this.items.add(item)
    this.tweens.add({ targets: item, angle: Phaser.Math.Between(-25, 25), duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
  }

  private catchItem(player: Player, item: Phaser.GameObjects.Image) {
    if (!item.active) return
    const type = (item.getData('type') as string | undefined) ?? 'cupcake'
    const value = (item.getData('value') as number | undefined) ?? 1
    emitBurst(this, item.x, item.y, pickupColor(type), 14, 36)
    item.destroy()
    this.caught += 1
    // Team game: every catch counts for everyone.
    this.players.forEach((entry) => addScore(this, entry.hud, value))
    bounceSprite(this, player.actor.sprite, 0.25)
    player.eatingUntil = this.time.now + 400
    playActor(player.actor, 'eatStart')
  }

  private missItem(item: Phaser.GameObjects.Image) {
    emitBurst(this, item.x, GROUND_Y - 6, 0xffffff, 6, 18)
    item.destroy()
  }

  private finish() {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.players.forEach((player) => {
      player.actor.body?.setVelocity(0, 0)
      playActor(player.actor, 'idle')
    })
    this.items?.getChildren().forEach((child) => {
      const body = (child as Phaser.GameObjects.Image).body as Phaser.Physics.Arcade.Body | null
      body?.setVelocity(0, 0)
    })
    const scores = this.players.map((player) => player.hud.score)
    completeLevel(this, this.state, scores, `Caught ${this.caught} treats!`)
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(time: number, delta: number) {
    const width = this.scale.width
    this.players.forEach((player) => player.label.setPosition(player.actor.sprite.x, player.actor.sprite.y - 66))

    if (this.phase !== 'play') return

    this.elapsed += delta
    this.progress?.set(this.elapsed / DURATION)
    if (this.state.playerCount === 2 && !this.swapped && this.elapsed >= SWAP_AT) {
      this.swapRoles()
    }
    if (this.elapsed >= DURATION) {
      this.finish()
      return
    }

    // The cloud does the dropping in solo mode.
    if (this.cloudDropper) {
      const pace = 1 + this.tier * 0.25
      this.cloudDropper.x = width / 2 + Math.sin(time * 0.0009 * pace) * 330 + Math.sin(time * 0.0023 * pace) * 60
      this.cloudDropper.y = LEDGE_Y - 26 + Math.sin(time * 0.004) * 4
    }

    // Automatic drops keep the game moving even if the dropper forgets.
    if (time >= this.nextAutoDrop) {
      const dropper = this.players.find((player) => player.role === 'dropper')
      const x = dropper ? dropper.actor.sprite.x : this.cloudDropper?.x ?? width / 2
      this.dropItem(x)
      this.nextAutoDrop = time + Math.max(600, (this.state.playerCount === 2 ? 1300 : 1100) - this.tier * 130)
    }

    this.players.forEach((player) => {
      const keys = player.keys
      const body = player.actor.body
      if (!keys || !body) return
      const speed = player.role === 'dropper' ? DROPPER_SPEED : CATCHER_SPEED
      let vx = 0
      if (keys.left.isDown) vx -= speed
      if (keys.right.isDown) vx += speed
      body.setVelocity(vx, 0)
      const sprite = player.actor.sprite
      sprite.x = Phaser.Math.Clamp(sprite.x, 60, width - 60)
      if (vx < 0) sprite.setFlipX(true)
      if (vx > 0) sprite.setFlipX(false)

      if (player.role === 'dropper' && justDown(keys.up) && time >= player.dropReadyAt) {
        player.dropReadyAt = time + 450
        this.nextAutoDrop = time + 1300
        this.dropItem(sprite.x)
        bounceSprite(this, sprite, 0.15)
      }

      if (time < player.eatingUntil) {
        // Let the munch animation play out.
      } else if (vx !== 0) {
        playActor(player.actor, 'walk')
      } else {
        playActor(player.actor, 'idle')
      }
    })

    this.items?.getChildren().forEach((child) => {
      const item = child as Phaser.GameObjects.Image
      if (item.active && item.y > GROUND_Y - 10) this.missItem(item)
    })
  }
}
