import Phaser from 'phaser'
import MainScene from './scenes/MainScene'

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
        gravity: { y: 900 },
        debug: false,
      },
    },
    scene: [MainScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
  }

  const game = new Phaser.Game(config)
  game.scene.start('MainScene', { playerCount: options.playerCount })
  return game
}
