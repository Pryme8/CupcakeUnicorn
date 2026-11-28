import Phaser from 'phaser'
import SkyJumpScene from './SkyJumpScene'
import { VIEW } from './config'

/**
 * Pegasus Jump runs in its own portrait game instance rather than joining the
 * level rotation: the main game is 960x540 landscape, and an endless climber
 * needs the tall column. Arcade physics is deliberately off — the climb is
 * simulated in core.ts, not by Phaser.
 */
export const createSkyJumpGame = (parent: HTMLElement) => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW.width,
    height: VIEW.height,
    backgroundColor: '#8e9bc4',
    scene: [SkyJumpScene],
    scale: {
      mode: Phaser.Scale.FIT,
      // The stylesheet already gives the parent the exact 9:16 box, so letting
      // Phaser centre as well just nudges the canvas out of it.
      autoCenter: Phaser.Scale.NO_CENTER,
      width: VIEW.width,
      height: VIEW.height,
      // Phaser otherwise forces width/height: 100% onto the parent element,
      // which fights the portrait box the stylesheet sets up.
      expandParent: false,
    },
  })

  if (import.meta.env.DEV) {
    // Same hook style as the main game, for poking at a run from the console.
    ;(window as unknown as { __pegasusJump?: Phaser.Game }).__pegasusJump = game
  }
  return game
}
