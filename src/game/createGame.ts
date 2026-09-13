import Phaser from 'phaser'
import MainScene from './scenes/MainScene'
import PegasusScene from './scenes/PegasusScene'
import MazeScene from './scenes/MazeScene'
import CupcakeCatchScene from './scenes/CupcakeCatchScene'
import TugScene from './scenes/TugScene'
import MirrorDanceScene from './scenes/MirrorDanceScene'
import BalloonPopScene from './scenes/BalloonPopScene'
import FruitDashScene from './scenes/FruitDashScene'
import { levelEntry } from './levels'

export type GameOptions = {
  playerCount: 1 | 2
}

const GAME_WIDTH = 960
const GAME_HEIGHT = 540

export const createGame = (parent: HTMLElement, options: GameOptions) => {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#8fd3ff',
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 900 },
        debug: false,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
  }

  const game = new Phaser.Game(config)

  // Dev helper: open the page with ?level=N to jump straight to a level.
  // See LEVEL_SEQUENCE in levels.ts for the rotation.
  const requestedLevel = Number(new URLSearchParams(window.location.search).get('level'))
  const startLevel = Number.isFinite(requestedLevel) && requestedLevel >= 1 ? Math.floor(requestedLevel) : 1
  const startData = { playerCount: options.playerCount, level: startLevel, scores: [] }
  const startScene = levelEntry(startLevel).scene

  // Scenes are added here (not in the config) so only the requested one auto-starts.
  const scenes: [string, typeof Phaser.Scene][] = [
    ['MainScene', MainScene],
    ['PegasusScene', PegasusScene],
    ['MazeScene', MazeScene],
    ['CupcakeCatchScene', CupcakeCatchScene],
    ['TugScene', TugScene],
    ['MirrorDanceScene', MirrorDanceScene],
    ['BalloonPopScene', BalloonPopScene],
    ['FruitDashScene', FruitDashScene],
  ]
  scenes.forEach(([key, sceneClass]) => {
    game.scene.add(key, sceneClass, key === startScene, startData)
  })
  if (import.meta.env.DEV) {
    // Handy for poking at the game from the browser console while developing.
    ;(window as unknown as { __cupcakeGame?: Phaser.Game }).__cupcakeGame = game
  }
  return game
}
