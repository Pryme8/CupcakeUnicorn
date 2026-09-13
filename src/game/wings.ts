import Phaser from 'phaser'
import { PEGASUS_TEXTURES, WING_ORIGIN } from './pegasusTextures'

// A pair of flapping wings pinned to a unicorn sprite. Used by the Pegasus
// flight and balloon pop levels. Call `place` every frame and `flap` on input.
export class Wings {
  readonly near: Phaser.GameObjects.Image
  readonly far: Phaser.GameObjects.Image
  angle = 0.35
  private tween?: Phaser.Tweens.Tween
  private readonly scene: Phaser.Scene
  private readonly scale: number

  constructor(scene: Phaser.Scene, index: number, scale: number, bodyDepth: number) {
    this.scene = scene
    this.scale = scale

    this.far = scene.add.image(0, 0, PEGASUS_TEXTURES.wing)
    this.far.setOrigin(WING_ORIGIN.x, WING_ORIGIN.y)
    this.far.setScale(scale * 0.8)
    this.far.setDepth(bodyDepth - 1)
    this.far.setTint(index === 1 ? 0xcfe3ff : 0xf1e4f7)

    this.near = scene.add.image(0, 0, PEGASUS_TEXTURES.wing)
    this.near.setOrigin(WING_ORIGIN.x, WING_ORIGIN.y)
    this.near.setScale(scale * 0.9)
    this.near.setDepth(bodyDepth + 1)
    if (index === 1) this.near.setTint(0xe6f1ff)
  }

  /** Pin both wings to the body at (x, y), rotated with the body's tilt. */
  place(x: number, y: number, tilt: number) {
    const s = this.scale
    const cos = Math.cos(tilt)
    const sin = Math.sin(tilt)
    const put = (wing: Phaser.GameObjects.Image, offsetX: number, offsetY: number, angle: number) => {
      const ox = offsetX * s
      const oy = offsetY * s
      wing.setPosition(x + ox * cos - oy * sin, y + ox * sin + oy * cos)
      wing.setRotation(tilt + angle)
    }
    put(this.near, 2, -6, this.angle)
    put(this.far, -4, -9, this.angle * 0.8 + 0.15)
  }

  /** Gentle ambient motion while gliding; skipped while a flap tween runs. */
  idle(time: number) {
    if (!this.tween?.isPlaying()) {
      this.angle = 0.35 + Math.sin(time / 170) * 0.12
    }
  }

  flap() {
    this.tween?.remove()
    this.angle = 0.55
    this.tween = this.scene.tweens.add({
      targets: this,
      angle: -0.6,
      duration: 90,
      ease: 'Sine.out',
      yoyo: true,
      hold: 20,
    })
  }

  setVisible(visible: boolean) {
    this.near.setVisible(visible)
    this.far.setVisible(visible)
  }

  destroy() {
    this.tween?.remove()
    this.near.destroy()
    this.far.destroy()
  }
}
