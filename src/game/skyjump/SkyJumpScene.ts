import Phaser from 'phaser'
import { ASSET_KEYS, UNICORN_FRAMES, getFrameKey, loadAssets } from '../assets'
import { createPegasusTextures } from '../pegasusTextures'
import { Wings } from '../wings'
import { FONT } from '../levelKit'
import { MOVEMENT, STORAGE_KEY, VIEW } from './config'
import { SkyJumpCore, type GameEvent } from './core'
import {
  BUTTERFLY_COLOURS,
  CLOUD_BODY_ROWS,
  CLOUD_TOP_ROW,
  PIXEL,
  PIXEL_TEXTURES,
  HUD_BUTTERFLY,
  PX_CUPCAKE,
  UNICORN_ART,
  butterflyAnimKey,
  butterflyKey,
  cloudKey,
  createPixelArt,
  pxUnicornFrame,
} from './pixelArt'

/** Tints for the sparkle bursts, roughly matching the butterfly palettes. */
const BURST_TINTS = [0xff8fb8, 0xffd977, 0x9af0bd, 0x92cfff, 0xd6aaff]
const SUPER_TINTS = [0xff6b6b, 0xffc857, 0x7ae582, 0x5cc8ff, 0xb96bff]

// The view for Pegasus Jump. It owns no rules: every frame it steps the core
// and then moves sprites to match. World y is altitude (up is positive), so
// everything is placed through `core.toScreenY`.

const DEPTH = {
  sky: 0,
  haze: 1,
  cloud: 10,
  butterfly: 14,
  player: 20,
  fx: 30,
  hud: 40,
  overlay: 50,
}

/** The unicorn frames are 56 px; this lands the Pegasus near its 68 px hit box. */
/**
 * Everything in the world is drawn at exactly PIXEL world px per art px — the
 * clouds, the butterflies, the wings, the cupcake and the Pegasus alike. That
 * single rule is what makes the screen read as one piece of pixel art, so
 * nothing here gets its own scale factor.
 */
const PLAYER_SCALE = PIXEL

/** Snaps a screen coordinate to the art grid so every sprite's pixels line up. */
const snap = (v: number) => Math.round(v / PIXEL) * PIXEL

/** How far the backdrop drifts relative to the camera. */
const HAZE_PARALLAX = 0.25
const HAZE_SPACING = 420

type PlayerRig = {
  sprite: Phaser.GameObjects.Sprite
  /** The 2D game's vector wings, shown only while a cupcake is in effect. */
  wings: Wings
}

/**
 * The wings are the 2D game's own art, drawn and rotated as vectors rather than
 * resampled onto the pixel grid: baking them into pixel frames lost the shape
 * that makes them read as wings at all. This scale puts them on the Pegasus at
 * the proportion the flight level uses, where a 56 px native body is drawn at
 * UNICORN_ART * PIXEL.
 */
const WING_SCALE = (UNICORN_ART * PIXEL) / 56

export default class SkyJumpScene extends Phaser.Scene {
  private core!: SkyJumpCore
  private rig!: PlayerRig
  /** Mirror of the rig, shown only while the Pegasus straddles a screen edge. */
  private ghost!: PlayerRig

  private cloudSprites = new Map<number, Phaser.GameObjects.Image>()
  private butterflySprites = new Map<number, Phaser.GameObjects.Sprite>()
  private cupcakeSprites = new Map<number, Phaser.GameObjects.Image>()
  private hazes: Phaser.GameObjects.Image[] = []
  /** Seconds since the last rainbow puff, while a Super Jump is running. */
  private trailClock = 0

  private heightText!: Phaser.GameObjects.Text
  private butterflyText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private chainText!: Phaser.GameObjects.Text
  private overlay?: Phaser.GameObjects.Container
  private hint?: Phaser.GameObjects.Text

  private keyLeft?: Phaser.Input.Keyboard.Key[]
  private keyRight?: Phaser.Input.Keyboard.Key[]
  private keyRestart?: Phaser.Input.Keyboard.Key
  private keyVanish?: Phaser.Input.Keyboard.Key
  private modeText!: Phaser.GameObjects.Text
  /**
   * Set by the first click on the canvas. After that the Pegasus follows the
   * pointer without the button being held: clicking is how you take the
   * controls, not how you steer.
   */
  private pointerSteering = false

  private best = 0


  constructor() {
    super('SkyJumpScene')
  }

  preload() {
    loadAssets(this)
  }

  create() {
    // The flight frames and the cupcake are resampled onto the same art grid
    // as the clouds, so the whole screen shares one pixel size.
    // The jump poses the other levels use, not the running loop: which one is
    // drawn is picked from vertical velocity every frame, so the Pegasus
    // launches, hangs and dives instead of galloping on the spot. See POSES.
    const poseFrames = Array.from({ length: UNICORN_FRAMES.jump.frames }, (_, i) =>
      getFrameKey(UNICORN_FRAMES.jump, i)
    )
    createPegasusTextures(this) // the 2D game's vector wing
    createPixelArt(this, poseFrames, ASSET_KEYS.cupcake)

    this.best = this.readBest()
    this.core = new SkyJumpCore()
    // ?vanish=1 starts in one-use-cloud mode; V flips it mid-run so the two
    // can be compared back to back.
    if (new URLSearchParams(window.location.search).get('vanish') === '1') this.core.vanishOnBounce = true

    this.paintBackdrop()
    this.rig = this.createRig(1)
    this.ghost = this.createRig(0.999)
    this.setRigVisible(this.ghost, false)
    this.createHud()
    this.bindInput()

    this.hint = this.add
      .text(VIEW.width / 2, VIEW.height * 0.62, 'Hold  ←  /  →   to steer\n(or drag anywhere)', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#ffffff',
        align: 'center',
        stroke: '#4a6fa5',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud)
    this.tweens.add({ targets: this.hint, alpha: 0, delay: 2600, duration: 700 })
  }

  // -- setup -----------------------------------------------------------------

  private paintBackdrop() {
    // A fixed sky, like the original: the hazy layer is wallpaper, the puffy
    // platform clouds are the only thing that really scrolls.
    const g = this.add.graphics().setDepth(DEPTH.sky)
    const top = Phaser.Display.Color.ValueToColor(0x8e9bc4)
    const bottom = Phaser.Display.Color.ValueToColor(0xc9d8ef)
    const strips = 32
    const stripHeight = Math.ceil(VIEW.height / strips)
    for (let i = 0; i < strips; i += 1) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, strips - 1, i)
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      g.fillRect(0, i * stripHeight, VIEW.width, stripHeight + 1)
    }

    const count = Math.ceil(VIEW.height / HAZE_SPACING) + 2
    for (let i = 0; i < count; i += 1) {
      const haze = this.add
        .image(Phaser.Math.Between(60, VIEW.width - 60), 0, PIXEL_TEXTURES.haze)
        .setDepth(DEPTH.haze)
        .setScale(Phaser.Math.FloatBetween(1.3, 2.2))
        .setAlpha(Phaser.Math.FloatBetween(0.5, 0.9))
      this.hazes.push(haze)
    }
  }

  private createRig(alpha: number): PlayerRig {
    const first = pxUnicornFrame(SkyJumpScene.POSES[0] as number)
    const sprite = this.add
      .sprite(0, 0, this.textures.exists(first) ? first : '__DEFAULT')
      .setDepth(DEPTH.player)
      .setScale(PLAYER_SCALE)
      .setAlpha(alpha)
    const wings = new Wings(this, 0, WING_SCALE, DEPTH.player)
    wings.near.setAlpha(alpha)
    wings.far.setAlpha(alpha)
    // Earned, not worn: the wings are out only during a Super Jump.
    wings.setVisible(false)
    return { sprite, wings }
  }

  private setRigVisible(rig: PlayerRig, visible: boolean) {
    rig.sprite.setVisible(visible)
    rig.wings.setVisible(visible && this.core.superJumping)
  }

  /**
   * Jump poses in order, fastest rise to fastest fall. These are the unicorn's
   * attack frames, which are what the other levels use for a jump: 2 rears up
   * off the launch, 1 gathers, 0 is level, 3 reaches the front legs out to
   * land, 4 drops the head into a dive.
   */
  private static readonly POSES = [2, 1, 0, 3, 4]
  /** The velocity cuts between them, as fractions of one plain bounce. */
  private static readonly POSE_BANDS = [0.55, 0.12, -0.12, -0.7]

  /** The pose for a given vertical velocity. */
  private poseFrame(vy: number) {
    const t = vy / MOVEMENT.bounceVelocity
    let i = 0
    while (i < SkyJumpScene.POSE_BANDS.length && t < (SkyJumpScene.POSE_BANDS[i] as number)) i += 1
    return pxUnicornFrame(SkyJumpScene.POSES[i] as number)
  }

  private createHud() {
    const style = (size: number): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: FONT,
      fontSize: `${size}px`,
      color: '#ffe9a8',
      stroke: '#3c2a52',
      strokeThickness: 5,
    })

    this.heightText = this.add.text(20, 16, '0', style(38)).setDepth(DEPTH.hud)

    this.add.image(VIEW.width / 2 - 36, 36, HUD_BUTTERFLY).setDepth(DEPTH.hud).setScale(PIXEL)
    this.butterflyText = this.add.text(VIEW.width / 2 - 8, 16, '0', style(38)).setDepth(DEPTH.hud)

    this.bestText = this.add
      .text(VIEW.width - 20, 16, `best ${this.best}`, style(28))
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud)

    this.modeText = this.add
      .text(VIEW.width - 20, 52, '', { ...style(20), color: '#cfe3ff' })
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud)

    this.chainText = this.add
      .text(VIEW.width / 2, 74, '', { ...style(26), color: '#ffffff' })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.hud)
      .setAlpha(0)
  }

  private bindInput() {
    const keyboard = this.input.keyboard
    if (keyboard) {
      const codes = Phaser.Input.Keyboard.KeyCodes
      this.keyLeft = [keyboard.addKey(codes.LEFT), keyboard.addKey(codes.A)]
      this.keyRight = [keyboard.addKey(codes.RIGHT), keyboard.addKey(codes.D)]
      this.keyRestart = keyboard.addKey(codes.SPACE)
      this.keyVanish = keyboard.addKey(codes.V)
    }
    this.input.on('pointerdown', () => {
      if (this.core.phase === 'dead') this.restart()
      else this.pointerSteering = true
    })
  }

  // -- loop ------------------------------------------------------------------

  update(_time: number, delta: number) {
    const dt = delta / 1000

    if (this.core.phase === 'dead') {
      if (this.keyRestart && Phaser.Input.Keyboard.JustDown(this.keyRestart)) this.restart()
      return
    }

    if (this.keyVanish && Phaser.Input.Keyboard.JustDown(this.keyVanish)) this.toggleVanish()
    this.core.update(dt, { steer: this.readSteer() })
    this.handleEvents(this.core.drainEvents())
    this.syncClouds()
    this.syncButterflies()
    this.syncCupcakes()
    this.syncPlayer(dt)
    this.syncTrail(dt)
    this.syncHaze()
    this.syncHud()
  }

  /** Distance from the pointer at which steering is already flat out. */
  private static readonly POINTER_FULL_TILT = 80
  private static readonly POINTER_DEADZONE = 8

  private readSteer() {
    let keys = 0
    if (this.keyLeft?.some((k) => k.isDown)) keys -= 1
    if (this.keyRight?.some((k) => k.isDown)) keys += 1
    if (keys !== 0) {
      // Touching the keyboard hands the controls back to it, so a parked
      // pointer cannot keep tugging the Pegasus sideways.
      this.pointerSteering = false
      return keys
    }

    if (!this.pointerSteering) return 0
    const pointer = this.input.activePointer
    const delta = pointer.worldX - this.core.player.x
    if (Math.abs(delta) <= SkyJumpScene.POINTER_DEADZONE) return 0
    // Proportional, so the Pegasus eases onto the pointer instead of
    // overshooting it and sawing back and forth.
    return Phaser.Math.Clamp(delta / SkyJumpScene.POINTER_FULL_TILT, -1, 1)
  }

  private handleEvents(events: GameEvent[]) {
    for (const event of events) {
      if (event.type === 'death') {
        this.showGameOver()
        continue
      }
      const screenY = this.core.toScreenY(event.y)

      if (event.type === 'super') {
        this.releasePickup(this.cupcakeSprites, event.id, 1.6)
        this.superJumpFx(event.x, screenY)
      } else if (event.source === 'butterfly') {
        this.releasePickup(this.butterflySprites, event.id, 1.3)
        this.burst(event.x, screenY, BURST_TINTS[event.id % BURST_TINTS.length] ?? 0xffffff, 14)
        this.showChain(event.chain, event.boost)
      } else {
        if (event.vanished) {
          // One-use clouds: puff the sprite out rather than letting the sweep
          // blink it away, so a spent cloud reads as spent.
          this.releasePickup(this.cloudSprites, event.id, 1.25, -14)
        } else {
          this.squashCloud(event.id, event.underside)
        }
        // A cloud clipped from below puffs downward as you shoot through it.
        this.burst(event.x, screenY, 0xffffff, event.underside ? 10 : 8)
      }
      if (this.core.superJumping) this.rig.wings.flap()
    }
  }

  /**
   * Landing squashes a cloud flat; clipping its underside while rising pushes
   * it up and apart instead, so the two bounces read differently.
   */
  private squashCloud(id: number, underside: boolean) {
    const sprite = this.cloudSprites.get(id)
    if (!sprite) return
    // Scaling a pixel sprite would shear its grid, so the hit reads as a shove
    // of whole pixels instead: down when landed on, up when clipped from below.
    const home = sprite.y
    this.tweens.killTweensOf(sprite)
    sprite.setY(home + (underside ? -PIXEL * 2 : PIXEL * 2))
    this.tweens.add({ targets: sprite, y: home, duration: 230, ease: 'Back.out' })
  }

  private superJumpFx(x: number, y: number) {
    // The wings come out with the cupcake, so a Super Jump opens on a flap.
    this.rig.wings.flap()
    this.cameras.main.flash(180, 255, 240, 200)
    this.cameras.main.shake(160, 0.004)
    SUPER_TINTS.forEach((tint, i) => this.time.delayedCall(i * 35, () => this.burst(x, y, tint, 8)))
    this.chainText.setText('SUPER JUMP!')
    this.chainText.setAlpha(1)
    this.tweens.killTweensOf(this.chainText)
    this.tweens.add({ targets: this.chainText, alpha: 0, delay: 1100, duration: 500 })
  }

  /** The rainbow streak behind a cupcake-powered climb. */
  private syncTrail(dt: number) {
    if (!this.core.superJumping) {
      this.trailClock = 0
      return
    }
    this.trailClock += dt
    if (this.trailClock < 0.03) return
    this.trailClock = 0
    const p = this.core.player
    const tint = SUPER_TINTS[Math.floor(this.core.elapsed * 22) % SUPER_TINTS.length] ?? 0xffffff
    const puff = this.add
      .image(p.x + Phaser.Math.Between(-10, 10), this.core.toScreenY(p.y) + 16, PIXEL_TEXTURES.sparkle)
      .setDepth(DEPTH.player - 1)
      .setTint(tint)
      .setScale(PIXEL)
    this.tweens.add({
      targets: puff,
      alpha: 0,
      scale: PIXEL,
      y: puff.y + 60,
      duration: 420,
      ease: 'Sine.out',
      onComplete: () => puff.destroy(),
    })
  }

  /**
   * Takes a collected pickup out of the sync map and lets it fly off instead of
   * blinking out of existence: the core has already dropped it, so the sprite
   * is ours to animate and destroy.
   */
  private releasePickup(
    map: Map<number, Phaser.GameObjects.Sprite> | Map<number, Phaser.GameObjects.Image>,
    id: number,
    grow: number,
    rise = 46
  ) {
    const sprite = (map as Map<number, Phaser.GameObjects.Sprite>).get(id)
    if (!sprite) return
    ;(map as Map<number, Phaser.GameObjects.Sprite>).delete(id)
    sprite.setDepth(DEPTH.fx)
    this.tweens.add({
      targets: sprite,
      y: sprite.y - rise,
      alpha: 0,
      scaleX: sprite.scaleX * grow,
      scaleY: sprite.scaleY * grow,
      duration: 320,
      ease: 'Sine.out',
      onComplete: () => sprite.destroy(),
    })
  }

  private burst(x: number, y: number, tint: number, count: number) {
    for (let i = 0; i < count; i += 1) {
      const spark = this.add.image(x, y, PIXEL_TEXTURES.sparkle).setDepth(DEPTH.fx).setTint(tint)
      spark.setScale(PIXEL)
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const reach = Phaser.Math.Between(26, 74)
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * reach,
        y: y + Math.sin(angle) * reach,
        alpha: 0,
        duration: Phaser.Math.Between(280, 460),
        ease: 'Sine.out',
        onComplete: () => spark.destroy(),
      })
    }
  }

  private showChain(chain: number, boost: number) {
    if (chain < 2) return
    this.chainText.setText(`${chain} in a row!  +${Math.round(boost * 100)}% lift`)
    this.chainText.setAlpha(1)
    this.tweens.killTweensOf(this.chainText)
    this.tweens.add({ targets: this.chainText, alpha: 0, delay: 900, duration: 500 })
  }

  // -- sync ------------------------------------------------------------------

  private syncClouds() {
    const seen = new Set<number>()
    for (const cloud of this.core.clouds) {
      seen.add(cloud.id)
      let sprite = this.cloudSprites.get(cloud.id)
      if (!sprite) {
        sprite = this.add.image(0, 0, cloudKey(cloud.size)).setDepth(DEPTH.cloud)
        // Pixel art is never stretched: one art px is always PIXEL world px,
        // and the sprite hangs from the ledge row the Pegasus lands on. The
        // +1 accounts for the outline skirt the texture adds on every side.
        sprite.setOrigin(0.5, (CLOUD_TOP_ROW + 1) / (CLOUD_BODY_ROWS + 2))
        sprite.setScale(PIXEL)
        this.cloudSprites.set(cloud.id, sprite)
      }
      sprite.setPosition(snap(cloud.x), snap(this.core.toScreenY(cloud.y)))
    }
    this.sweep(this.cloudSprites, seen)
  }

  private syncCupcakes() {
    const seen = new Set<number>()
    for (const cake of this.core.cupcakes) {
      seen.add(cake.id)
      let sprite = this.cupcakeSprites.get(cake.id)
      if (!sprite) {
        const key = this.textures.exists(PX_CUPCAKE) ? PX_CUPCAKE : ASSET_KEYS.cupcake
        sprite = this.add.image(0, 0, key).setDepth(DEPTH.butterfly).setScale(PIXEL)
        this.cupcakeSprites.set(cake.id, sprite)
      }
      sprite.setPosition(snap(cake.x), snap(this.core.toScreenY(cake.y)))
    }
    this.sweep(this.cupcakeSprites, seen)
  }

  private syncButterflies() {
    const seen = new Set<number>()
    for (const b of this.core.butterflies) {
      seen.add(b.id)
      let sprite = this.butterflySprites.get(b.id)
      if (!sprite) {
        // Each colour is its own baked palette rather than a tint, so the
        // dark body and the wing shading stay right whatever the colour is.
        const colour = b.colour % BUTTERFLY_COLOURS
        sprite = this.add.sprite(0, 0, butterflyKey(colour, 0)).setDepth(DEPTH.butterfly)
        sprite.setScale(PIXEL)
        if (this.anims.exists(butterflyAnimKey(colour))) {
          sprite.play(butterflyAnimKey(colour))
          sprite.anims.setProgress(Math.random())
        }
        this.butterflySprites.set(b.id, sprite)
      }
      // Snapped to the art grid: a pixel sprite on a half pixel shimmers.
      sprite.setPosition(snap(b.x), snap(this.core.toScreenY(b.y)))
      sprite.setFlipX(Math.cos(b.swayPhase) < 0)
    }
    this.sweep(this.butterflySprites, seen)
  }

  private sweep(map: Map<number, Phaser.GameObjects.GameObject>, seen: Set<number>) {
    for (const [id, sprite] of map) {
      if (seen.has(id)) continue
      sprite.destroy()
      map.delete(id)
    }
  }

  private syncPlayer(_dt: number) {
    const p = this.core.player
    const screenY = this.core.toScreenY(p.y)

    // No rotation: a rotated pixel sprite shears its own grid. The arc is read
    // from the pose and a whole-pixel bob instead.
    const bob = p.vy > 0 ? -PIXEL : PIXEL
    const frame = this.poseFrame(p.vy)
    if (this.textures.exists(frame)) {
      this.rig.sprite.setTexture(frame)
      this.ghost.sprite.setTexture(frame)
    }
    this.rig.wings.idle(this.time.now)
    this.ghost.wings.angle = this.rig.wings.angle

    this.placeRig(this.rig, p.x, screenY + bob, p.facing)

    // Draw the wrapped copy while the Pegasus straddles an edge.
    const margin = 80
    let ghostX: number | null = null
    if (p.x < margin) ghostX = p.x + VIEW.width
    else if (p.x > VIEW.width - margin) ghostX = p.x - VIEW.width
    if (ghostX === null) {
      this.setRigVisible(this.ghost, false)
    } else {
      this.setRigVisible(this.ghost, true)
      this.placeRig(this.ghost, ghostX, screenY + bob, p.facing)
    }
  }

  private placeRig(rig: PlayerRig, x: number, y: number, facing: 1 | -1) {
    const px = snap(x)
    const py = snap(y)
    rig.sprite.setPosition(px, py)
    rig.sprite.setScale(PLAYER_SCALE * facing, PLAYER_SCALE)

    rig.wings.setVisible(rig.sprite.visible && this.core.superJumping)
    if (!this.core.superJumping) return
    // Pinned to the shoulder and mirrored when the Pegasus turns. The 0.9/0.8
    // near-far split and the sweep are the flight level's, so the pair reads
    // the same; the offsets sit a few px lower and further back than there,
    // because the jump poses carry the head higher than the flying one and the
    // flight level's own offsets put the wing across the neck.
    const put = (wing: Phaser.GameObjects.Image, dx: number, dy: number, angle: number, size: number) => {
      wing.setPosition(px + facing * dx * WING_SCALE, py + dy * WING_SCALE)
      wing.setScale(WING_SCALE * size * facing, WING_SCALE * size)
      wing.setRotation(facing * angle)
    }
    const a = rig.wings.angle
    put(rig.wings.near, -1, -2, a, 0.9)
    put(rig.wings.far, -7, -5, a * 0.8 + 0.15, 0.8)
  }

  private syncHaze() {
    // The backdrop creeps at a fraction of the climb and recycles endlessly.
    const offset = -this.core.cameraY * HAZE_PARALLAX
    this.hazes.forEach((haze, i) => {
      const span = HAZE_SPACING * this.hazes.length
      let y = (offset + i * HAZE_SPACING) % span
      if (y < 0) y += span
      haze.setY(y - HAZE_SPACING)
    })
  }

  private syncHud() {
    this.heightText.setText(`${this.core.metres}`)
    this.butterflyText.setText(`${this.core.butterfliesCaught}`)
    this.modeText.setText(this.core.vanishOnBounce ? 'one-use clouds  [V]' : '')
  }

  /** Flips one-use clouds on or off without interrupting the run. */
  private toggleVanish() {
    this.core.vanishOnBounce = !this.core.vanishOnBounce
    this.chainText.setText(this.core.vanishOnBounce ? 'One-use clouds: ON' : 'One-use clouds: OFF')
    this.chainText.setAlpha(1)
    this.tweens.killTweensOf(this.chainText)
    this.tweens.add({ targets: this.chainText, alpha: 0, delay: 900, duration: 400 })
  }

  // -- game over -------------------------------------------------------------

  private showGameOver() {
    const score = this.core.score
    if (score > this.best) {
      this.best = score
      this.writeBest(score)
    }
    this.bestText.setText(`best ${this.best}`)

    const panel = this.add.container(0, 0).setDepth(DEPTH.overlay)
    panel.add(this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x2a2140, 0.55))
    const big = (text: string, y: number, size: number, color = '#ffffff') =>
      this.add
        .text(VIEW.width / 2, y, text, {
          fontFamily: FONT,
          fontSize: `${size}px`,
          color,
          align: 'center',
          stroke: '#3c2a52',
          strokeThickness: 6,
        })
        .setOrigin(0.5)

    panel.add(big('Down you go!', VIEW.height * 0.33, 54, '#ffd9ec'))
    panel.add(big(`${this.core.metres} m   •   ${this.core.butterfliesCaught} butterflies`, VIEW.height * 0.42, 32))
    panel.add(big(`score ${this.core.score}`, VIEW.height * 0.49, 42, '#ffe9a8'))
    panel.add(big(`best ${this.best}`, VIEW.height * 0.55, 28, '#cfe3ff'))
    const again = big('Space / tap to fly again', VIEW.height * 0.66, 30, '#ffffff')
    panel.add(again)
    this.tweens.add({ targets: again, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 })

    this.overlay = panel
  }

  private restart() {
    this.overlay?.destroy(true)
    this.overlay = undefined
    this.tweens.killAll()
    for (const [, sprite] of this.cloudSprites) sprite.destroy()
    for (const [, sprite] of this.butterflySprites) sprite.destroy()
    for (const [, sprite] of this.cupcakeSprites) sprite.destroy()
    this.cloudSprites.clear()
    this.butterflySprites.clear()
    this.cupcakeSprites.clear()
    this.chainText.setAlpha(0)
    this.core.reset()
  }

  // -- high score ------------------------------------------------------------

  private readBest() {
    try {
      return Number(window.localStorage.getItem(STORAGE_KEY)) || 0
    } catch {
      return 0
    }
  }

  private writeBest(score: number) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(score))
    } catch {
      /* private browsing: the score just does not persist */
    }
  }
}
