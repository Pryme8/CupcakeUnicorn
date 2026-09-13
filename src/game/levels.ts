import type Phaser from 'phaser'

// The level rotation. Levels loop forever, carrying each player's score along:
// level 1 is the first entry, level 8 wraps back around to it, and so on.
export type LevelSceneData = {
  playerCount?: 1 | 2
  level?: number
  scores?: number[]
}

export type LevelEntry = {
  scene: string
  title: string
}

export const LEVEL_SEQUENCE: LevelEntry[] = [
  { scene: 'MainScene', title: 'Cupcake Chase!' },
  { scene: 'PegasusScene', title: 'Pegasus Flight!' },
  { scene: 'MazeScene', title: 'Rainbow Garden Maze!' },
  { scene: 'CupcakeCatchScene', title: 'Cupcake Catch!' },
  { scene: 'TugScene', title: 'Tug of Rainbow!' },
  { scene: 'MirrorDanceScene', title: 'Mirror Dance!' },
  { scene: 'BalloonPopScene', title: 'Balloon Pop!' },
  { scene: 'FruitDashScene', title: 'Fruit Dash!' },
]

const FALLBACK: LevelEntry = { scene: 'MainScene', title: 'Cupcake Chase!' }

export const levelEntry = (level: number): LevelEntry => {
  const index = (Math.max(1, Math.floor(level)) - 1) % LEVEL_SEQUENCE.length
  return LEVEL_SEQUENCE[index] ?? FALLBACK
}

/** How many full trips through the rotation happened before this level (0 on the first pass). */
export const levelCycle = (level: number) => Math.floor((Math.max(1, Math.floor(level)) - 1) / LEVEL_SEQUENCE.length)

/**
 * Difficulty grows a notch every lap through the rotation and stops growing
 * after MAX_TIER laps, so it never becomes unfair for small players.
 * 0 on the first lap, 1 on the second, and so on.
 */
export const MAX_TIER = 4
export const difficultyTier = (level: number) => Math.min(MAX_TIER, levelCycle(level))

/** A short note for the level banner once things start getting trickier. */
export const lapLabel = (level: number) => {
  const cycle = levelCycle(level)
  if (cycle === 0) return ''
  return cycle >= MAX_TIER ? `Lap ${cycle + 1}: as tricky as it gets!` : `Lap ${cycle + 1}: a bit trickier!`
}

export const startLevel = (scene: Phaser.Scene, data: Required<LevelSceneData>) => {
  scene.scene.start(levelEntry(data.level).scene, data)
}
