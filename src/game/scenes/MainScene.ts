import Phaser from 'phaser'
import { ASSET_KEYS, USE_ASSETS, UNICORN_VARIANTS, createUnicornAnimations, createUnicornVariant, getFrameKey, getUnicornAnimSet, getVariantFrameKey, loadAssets, UNICORN_FRAMES } from '../assets'

type PlayerInfo = {
  body: Phaser.Physics.Arcade.Body
  sprite: Phaser.GameObjects.GameObject
  bodySprite?: Phaser.Physics.Arcade.Sprite
  cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  keys?: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; jump: Phaser.Input.Keyboard.Key; eat: Phaser.Input.Keyboard.Key }
  wasGrounded: boolean
  walkOffsetY: number
  variant?: string
  isEating: boolean
  speedMultiplier: number
  jumpMultiplier: number
  powerUpUntil: number
  rainbowEvent?: Phaser.Time.TimerEvent
  score: number
  scoreText?: Phaser.GameObjects.Text
}

type PlatformSpec = {
  x: number
  y: number
  width: number
  height: number
}

type MovingPlatformSpec = {
  x: number
  y: number
  width: number
  height: number
  rangeX: number
  rangeY: number
  duration: number
}

type ItemZone = {
  x: number
  y: number
  width: number
  height: number
  count: number
}

type LevelTemplate = {
  name: string
  platforms: PlatformSpec[]
  itemZones: ItemZone[]
  movingPlatforms: MovingPlatformSpec[]
}

export default class MainScene extends Phaser.Scene {
  private playerCount: 1 | 2 = 1
  private players: PlayerInfo[] = []
  private platforms: Phaser.GameObjects.Rectangle[] = []
  private cupcakeGroup?: Phaser.Physics.Arcade.Group
  private pickupGroup?: Phaser.Physics.Arcade.Group
  private cloudSprite?: Phaser.GameObjects.Image
  private movingPlatforms: { platform: Phaser.GameObjects.Rectangle; prevX: number; prevY: number }[] = []
  private pickupsRemaining = 0
  private pendingAbsorbs = 0
  private roundInTransition = false
  private roundOverlay?: Phaser.GameObjects.Rectangle
  private roundTween?: Phaser.Tweens.Tween

  constructor() {
    super('MainScene')
  }

  preload() {
    loadAssets(this)
  }

  init(data: { playerCount?: 1 | 2 }) {
    this.playerCount = data.playerCount ?? 1
  }

  create() {
    const width = this.scale.width
    const height = this.scale.height

    this.add.rectangle(width / 2, height / 2, width, height, 0xbfe9ff)

    createUnicornAnimations(this)
    createUnicornVariant(this, UNICORN_VARIANTS.blue)

    if (!this.textures.exists('pickup-spark')) {
      const graphics = this.add.graphics()
      graphics.fillStyle(0xffffff, 1)
      graphics.fillCircle(2, 2, 2)
      graphics.generateTexture('pickup-spark', 4, 4)
      graphics.destroy()
    }


    if (USE_ASSETS && this.textures.exists(ASSET_KEYS.cloud)) {
      this.cloudSprite = this.add.image(width / 2, 70, ASSET_KEYS.cloud).setDepth(2)
    } else {
      const cloud = this.add.rectangle(width / 2, 70, 200, 70, 0xfff6cc)
      cloud.setStrokeStyle(4, 0xf2a7ff)
      this.add.text(width / 2, 70, 'Rainbow Cloud', {
        fontFamily: '"Fredoka", sans-serif',
        fontSize: '18px',
        color: '#6b3fa0',
      }).setOrigin(0.5)
    }

    this.roundOverlay = this.add.rectangle(width / 2, height / 2, width, height, 0xffffff)
    this.roundOverlay.setAlpha(0)
    this.roundOverlay.setDepth(60)

    const template = this.createPlatforms()

    const leftSpawn = { x: 80, y: height - 120 }
    const rightSpawn = { x: width - 80, y: height - 120 }

    const spawnPoints = this.playerCount === 2
      ? [leftSpawn, rightSpawn]
      : [Phaser.Math.Between(0, 1) === 0 ? leftSpawn : rightSpawn]

    this.players = spawnPoints.map((spawn, index) => this.spawnPlayer(spawn.x, spawn.y, index))

    this.players.forEach((player, index) => {
      const colliderObject = player.bodySprite ?? player.sprite
      this.platforms.forEach((platform) => {
        this.physics.add.collider(colliderObject, platform)
      })
      player.score = 0
      const textX = index === 0 ? 24 : width - 24
      player.scoreText = this.add.text(textX, 16, '0', {
        fontFamily: '"Fredoka", sans-serif',
        fontSize: '22px',
        color: '#1f2a44',
      }).setOrigin(index === 0 ? 0 : 1, 0)
      player.scoreText.setDepth(5)
    })

    this.cupcakeGroup = this.physics.add.group()
    this.pickupGroup = this.physics.add.group()
    this.createPickups(template)

    this.players.forEach((player) => {
      const colliderObject = player.bodySprite ?? player.sprite
      if (this.pickupGroup) {
        this.physics.add.overlap(colliderObject, this.pickupGroup, (_playerObj, pickupObj) => {
          this.collectPickup(player, pickupObj as Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle)
        })
      }
    })

    this.createWorldBounds()
  }

  private createWorldBounds() {
    this.physics.world.setBounds(0, 0, this.scale.width, this.scale.height)
    this.players.forEach((player) => {
      player.body.setCollideWorldBounds(false)
    })
  }

  private resetRound() {
    this.platforms.forEach((platform) => platform.destroy())
    this.platforms = []
    this.movingPlatforms.forEach((entry) => entry.platform.destroy())
    this.movingPlatforms = []
    this.cupcakeGroup?.clear(true, true)
    this.pickupGroup?.clear(true, true)

    const template = this.createPlatforms()
    this.createPickups(template)

    const height = this.scale.height
    const width = this.scale.width
    const leftSpawn = { x: 80, y: height - 120 }
    const rightSpawn = { x: width - 80, y: height - 120 }
    const spawnPoints = this.playerCount === 2
      ? [leftSpawn, rightSpawn]
      : [Phaser.Math.Between(0, 1) === 0 ? leftSpawn : rightSpawn]

    this.players.forEach((player, index) => {
      const spawn = spawnPoints[Math.min(index, spawnPoints.length - 1)] ?? spawnPoints[0]
      if (!spawn) {
        return
      }
      player.isEating = false
      this.clearPowerUp(player)
      player.body.setVelocity(0, 0)
      player.body.reset(spawn.x, spawn.y)
      if (player.bodySprite) {
        player.bodySprite.setPosition(spawn.x, spawn.y)
      }
      if (player.sprite instanceof Phaser.GameObjects.Sprite) {
        player.sprite.setPosition(spawn.x, spawn.y)
        player.sprite.setFlipX(spawn.x > width / 2)
      }
      player.wasGrounded = false

      const colliderObject = player.bodySprite ?? player.sprite
      this.platforms.forEach((platform) => {
        this.physics.add.collider(colliderObject, platform)
      })
    })
  }

  private beginRoundTransition() {
    if (this.roundInTransition) return
    this.roundInTransition = true

    this.players.forEach((player) => {
      player.isEating = false
      player.body.setVelocity(0, 0)
      this.clearPowerUp(player)
    })

    this.roundTween?.remove()
    const cloud = this.cloudSprite
    if (cloud) {
      cloud.clearTint()
      this.roundTween = this.tweens.add({
        targets: cloud,
        scale: 8,
        duration: 600,
        ease: 'Sine.in',
      })
    }

    if (this.roundOverlay) {
      this.tweens.add({
        targets: this.roundOverlay,
        alpha: 1,
        duration: 600,
        ease: 'Sine.in',
        onComplete: () => {
          if (cloud) {
            cloud.setScale(1)
          }
          this.roundOverlay?.setAlpha(0)
          this.resetRound()
          this.roundInTransition = false
        },
      })
    } else {
      this.resetRound()
      this.roundInTransition = false
    }
  }

  private checkRoundEnd() {
    if (this.pickupsRemaining <= 0 && this.pendingAbsorbs <= 0) {
      this.beginRoundTransition()
    }
  }

  private spawnPlayer(x: number, y: number, index: number): PlayerInfo {
    const colors = [0xff7ac3, 0x7ad1ff]
    let sprite: Phaser.GameObjects.GameObject
    let body: Phaser.Physics.Arcade.Body

    const variant = index === 1 ? UNICORN_VARIANTS.blue : undefined
    const firstFrameKey = getVariantFrameKey(UNICORN_FRAMES.idle, 0, variant)
    if (USE_ASSETS && this.textures.exists(firstFrameKey)) {
      const bodySprite = this.physics.add.sprite(x, y, firstFrameKey)
      bodySprite.setOrigin(0.5, 1)
      bodySprite.setVisible(false)
      const bodyWidth = bodySprite.width * 0.6
      const bodyHeight = bodySprite.height * 0.5
      const offsetX = (bodySprite.width - bodyWidth) / 2
      const offsetY = bodySprite.height - bodyHeight - bodySprite.height * 0.24
      bodySprite.body.setSize(bodyWidth, bodyHeight)
      bodySprite.body.setOffset(offsetX, offsetY)

      const visualSprite = this.add.sprite(x, y, firstFrameKey)
      visualSprite.setOrigin(0.5, 1)
      const anims = getUnicornAnimSet(variant)
      if (x > this.scale.width / 2) {
        visualSprite.setFlipX(true)
      }
      if (this.anims.exists(anims.idle)) {
        visualSprite.play(anims.idle)
      }

      sprite = visualSprite
      body = bodySprite.body as Phaser.Physics.Arcade.Body
      return { body, bodySprite, sprite, cursors: index === 0 ? undefined : this.input.keyboard?.createCursorKeys() as Phaser.Types.Input.Keyboard.CursorKeys, keys: index === 0 ? {
        left: this.input.keyboard?.addKey('A') as Phaser.Input.Keyboard.Key,
        right: this.input.keyboard?.addKey('D') as Phaser.Input.Keyboard.Key,
        jump: this.input.keyboard?.addKey('W') as Phaser.Input.Keyboard.Key,
        eat: this.input.keyboard?.addKey('S') as Phaser.Input.Keyboard.Key,
      } : undefined, wasGrounded: false, walkOffsetY: 2, variant, isEating: false, speedMultiplier: 1, jumpMultiplier: 1, powerUpUntil: 0, score: 0 }
    } else {
      const playerRect = this.add.rectangle(x, y, 40, 60, colors[index % colors.length])
      this.physics.add.existing(playerRect)
      sprite = playerRect
      body = playerRect.body as Phaser.Physics.Arcade.Body
      body.setSize(40, 60)
      body.setOffset(0, 0)
    }

    const cursors = index === 0
      ? undefined
      : this.input.keyboard?.createCursorKeys() as Phaser.Types.Input.Keyboard.CursorKeys

    let keys: PlayerInfo['keys']
    if (index === 0) {
      keys = {
        left: this.input.keyboard?.addKey('A') as Phaser.Input.Keyboard.Key,
        right: this.input.keyboard?.addKey('D') as Phaser.Input.Keyboard.Key,
        jump: this.input.keyboard?.addKey('W') as Phaser.Input.Keyboard.Key,
        eat: this.input.keyboard?.addKey('S') as Phaser.Input.Keyboard.Key,
      }
    }

    return { body, sprite, cursors, keys, wasGrounded: false, walkOffsetY: 0, variant, isEating: false, speedMultiplier: 1, jumpMultiplier: 1, powerUpUntil: 0, score: 0 }
  }

  private createPlatforms(): LevelTemplate {
    const width = this.scale.width
    const height = this.scale.height
    const groundTop = height - 40
    const cloudSafeTop = 140
    const gravityY = this.physics.world.gravity.y || 900
    const jumpSpeed = 420
    const maxJumpHeight = (jumpSpeed * jumpSpeed) / (2 * gravityY)
    const idleKey = getFrameKey(UNICORN_FRAMES.idle, 0)
    const idleTexture = this.textures.get(idleKey)
    const idleSource = idleTexture?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined
    const unicornHeight = idleSource?.height ?? 60
    const desiredZoneHeight = Math.max(70, maxJumpHeight + unicornHeight * 0.4)
    const usableHeight = Math.max(0, groundTop - cloudSafeTop)
    const zoneCount = Math.max(2, Math.ceil(usableHeight / desiredZoneHeight) + 1)
    const zoneHeight = usableHeight / zoneCount
    const halfWidth = width / 2
    const sidePadding = 22

    const buildHalfTemplate = (name: string) => {
      const platforms: PlatformSpec[] = []
      const movingPlatforms: MovingPlatformSpec[] = []
      const itemZones: ItemZone[] = []
      const occupied: Phaser.Geom.Rectangle[] = []

      const addOccupied = (rect: Phaser.Geom.Rectangle) => {
        occupied.push(rect)
      }

      const intersectsOccupied = (rect: Phaser.Geom.Rectangle) =>
        occupied.some((existing) => Phaser.Geom.Rectangle.Overlaps(existing, rect))

      for (let zoneIndex = 0; zoneIndex < zoneCount; zoneIndex += 1) {
        const zoneBottom = Math.max(cloudSafeTop + zoneHeight * 0.4, groundTop - zoneHeight * zoneIndex)
        const zoneLeft = sidePadding
        const zoneRight = halfWidth - sidePadding
        const sections = 8
        const sectionWidth = (zoneRight - zoneLeft) / sections
        const layout = Array.from({ length: sections }, () => 1)
        const blanks = Phaser.Math.Between(1, 2)
        for (let b = 0; b < blanks; b += 1) {
          const start = Phaser.Math.Between(0, sections - 2)
          layout[start] = 0
          layout[start + 1] = 0
        }

        let index = 0
        while (index < layout.length) {
          if (layout[index] === 0) {
            index += 1
            continue
          }
          const startIndex = index
          while (index < layout.length && layout[index] === 1) {
            index += 1
          }
          const length = index - startIndex
          const rawWidth = sectionWidth * length
          const platformWidth = Math.max(90, rawWidth - 8)
          const platformX = zoneLeft + sectionWidth * (startIndex + length / 2)
          const platformY = Math.floor(zoneBottom - 11)
          const allowMove = Phaser.Math.FloatBetween(0, 1) < 0.35

          if (allowMove) {
            const maxLeft = platformX - platformWidth / 2 - sidePadding
            const maxRight = halfWidth - sidePadding - (platformX + platformWidth / 2)
            const maxRangeX = Math.min(maxLeft, maxRight, halfWidth * 0.2)
            const rangeX = maxRangeX > 14
              ? Phaser.Math.Between(14, Math.floor(maxRangeX)) * (Phaser.Math.Between(0, 1) === 0 ? -1 : 1)
              : 0
            const rangeY = rangeX === 0 ? Phaser.Math.Between(-48, 48) : 0
            const left = platformX - platformWidth / 2 + Math.min(0, rangeX)
            const right = platformX + platformWidth / 2 + Math.max(0, rangeX)
            const top = platformY + Math.min(0, rangeY) - 9
            const rect = new Phaser.Geom.Rectangle(left, top, right - left, 18 + Math.abs(rangeY))

            if (!intersectsOccupied(rect)) {
              movingPlatforms.push({
                x: platformX,
                y: platformY,
                width: platformWidth,
                height: 18,
                rangeX,
                rangeY,
                duration: Phaser.Math.Between(2100, 3100),
              })
              addOccupied(rect)
              itemZones.push({
                x: platformX,
                y: platformY - 34,
                width: platformWidth,
                height: 70,
                count: 5,
              })
              continue
            }
          }

          const rect = new Phaser.Geom.Rectangle(
            platformX - platformWidth / 2,
            platformY - 11,
            platformWidth,
            22
          )
          if (!intersectsOccupied(rect)) {
            platforms.push({ x: platformX, y: platformY, width: platformWidth, height: 22 })
            addOccupied(rect)
            itemZones.push({
              x: platformX,
              y: platformY - 34,
              width: platformWidth,
              height: 70,
              count: 5,
            })
          }
        }
      }

      return { name, platforms, movingPlatforms, itemZones }
    }

    const templates: LevelTemplate[] = [
      buildHalfTemplate('sparse'),
      buildHalfTemplate('balanced'),
      buildHalfTemplate('dense'),
    ]

    const halfTemplate = Phaser.Utils.Array.GetRandom(templates)
    const template: LevelTemplate = {
      name: halfTemplate.name,
      platforms: [...halfTemplate.platforms],
      movingPlatforms: [...halfTemplate.movingPlatforms],
      itemZones: [...halfTemplate.itemZones],
    }

    const mirrorX = (x: number) => width - x
    halfTemplate.platforms.forEach((platform) => {
      template.platforms.push({
        ...platform,
        x: mirrorX(platform.x),
      })
    })
    halfTemplate.movingPlatforms.forEach((platform) => {
      template.movingPlatforms.push({
        ...platform,
        x: mirrorX(platform.x),
        rangeX: -platform.rangeX,
      })
    })
    halfTemplate.itemZones.forEach((zone) => {
      template.itemZones.push({
        ...zone,
        x: mirrorX(zone.x),
      })
    })
    this.platforms = template.platforms.map((spec) => {
      const platform = this.add.rectangle(spec.x, spec.y, spec.width, spec.height, 0x5c9ded)
      platform.setStrokeStyle(3, 0x2f5aa8)
      this.physics.add.existing(platform, true)
      return platform
    })

    template.movingPlatforms.forEach((spec) => {
      const platform = this.add.rectangle(spec.x, spec.y, spec.width, spec.height, 0x68a1f7)
      platform.setStrokeStyle(3, 0x2b4f96)
      this.physics.add.existing(platform)
      const body = platform.body as Phaser.Physics.Arcade.Body
      body.setImmovable(true)
      body.setAllowGravity(false)
      this.tweens.add({
        targets: platform,
        x: spec.x + spec.rangeX,
        y: spec.y + spec.rangeY,
        duration: spec.duration,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      })
      this.platforms.push(platform)
      this.movingPlatforms.push({ platform, prevX: platform.x, prevY: platform.y })
    })

    return template
  }

  private createPickups(template: LevelTemplate) {
    this.pickupsRemaining = 0
    this.pendingAbsorbs = 0
    const itemColors: Record<string, number> = {
      cupcake: 0xffc857,
      heart: 0xff6b9b,
      star: 0xffd166,
      flower: 0x7ae582,
      grapes: 0x9d4edd,
      strawberry: 0xff6b6b,
    }

    const perZoneItems: string[] = [
      'heart',
      'star',
      'flower',
      'grapes',
      'strawberry',
    ]
    const width = this.scale.width
    const leftZones = template.itemZones.filter((zone) => zone.x <= width / 2)
    const placedPickups: Phaser.Geom.Rectangle[] = []
    const leftMaxX = width / 2 - 6

    const minCenterDistance = 64

    const cupcakeZones = [...leftZones]
    Phaser.Utils.Array.Shuffle(cupcakeZones)
    const cupcakeCount = Math.min(3, cupcakeZones.length)
    let cupcakesPlaced = 0
    for (let i = 0; i < cupcakeZones.length && cupcakesPlaced < cupcakeCount; i += 1) {
      const zone = cupcakeZones[i]
      if (!zone) {
        continue
      }
      const visual = this.getPickupVisual('cupcake')
      const position = this.getPickupPosition('cupcake', zone, visual, placedPickups, leftMaxX)
      if (!position) {
        continue
      }
      this.spawnPickupAt('cupcake', position.x, position.y, visual, itemColors)
      placedPickups.push(this.getPickupRect(position.x, position.y, visual))

      const mirrorX = width - position.x
      const mirrorZone = { ...zone, x: width - zone.x }
      const mirrorY = this.getCupcakeY(mirrorX, mirrorZone, visual.height)
      const mirrorRect = this.getPickupRect(mirrorX, mirrorY, visual)
      if (!this.isOverlappingPickups(mirrorRect, placedPickups)) {
        this.spawnPickupAt('cupcake', mirrorX, mirrorY, visual, itemColors)
        placedPickups.push(mirrorRect)
      }
      cupcakesPlaced += 1
    }

    leftZones.forEach((zone) => {
      const items = [...perZoneItems]
      Phaser.Utils.Array.Shuffle(items)
      const maxByWidth = Math.max(1, Math.floor(zone.width / minCenterDistance))
      const spawnCount = Math.min(zone.count, items.length, maxByWidth)
      for (let i = 0; i < spawnCount; i += 1) {
        const type = items[i]
        if (!type) {
          continue
        }
        const visual = this.getPickupVisual(type)
        const position = this.getPickupPosition(type, zone, visual, placedPickups, leftMaxX)
        if (!position) {
          continue
        }
        this.spawnPickupAt(type, position.x, position.y, visual, itemColors)
        placedPickups.push(this.getPickupRect(position.x, position.y, visual))

        const mirrorX = width - position.x
        const mirrorZone = { ...zone, x: width - zone.x }
        const mirrorY = type === 'cupcake'
          ? this.getCupcakeY(mirrorX, mirrorZone, visual.height)
          : position.y
        const mirrorRect = this.getPickupRect(mirrorX, mirrorY, visual)
        if (!this.isOverlappingPickups(mirrorRect, placedPickups)) {
          this.spawnPickupAt(type, mirrorX, mirrorY, visual, itemColors)
          placedPickups.push(mirrorRect)
        }
      }
    })
  }

  private getPickupVisual(type: string) {
    const textureKey = type === 'cupcake'
      ? ASSET_KEYS.cupcake
      : type === 'flower'
        ? ASSET_KEYS.flower
        : type === 'grapes'
          ? ASSET_KEYS.grapes
      : type === 'star'
        ? ASSET_KEYS.star
        : type === 'heart'
          ? ASSET_KEYS.heart
          : type === 'strawberry'
            ? ASSET_KEYS.strawberry
            : undefined
    const useTexture = !!textureKey && USE_ASSETS && this.textures.exists(textureKey)
    const sourceImage = useTexture
      ? (this.textures.get(textureKey as string).getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined)
      : undefined
    const width = sourceImage?.width ?? 20
    const height = sourceImage?.height ?? 20
    const size = Math.max(width, height)

    return { textureKey, useTexture, width, height, size }
  }

  private getPickupPosition(type: string, zone: ItemZone, visual: { width: number; height: number; size: number }, placed: Phaser.Geom.Rectangle[], maxX?: number): { x: number; y: number } | null {
    let x = 0
    let y = 0
    const padding = 8
    const zoneMinX = zone.x - zone.width / 2
    const zoneMaxX = zone.x + zone.width / 2
    const clampedMaxX = maxX !== undefined ? Math.min(zoneMaxX, maxX) : zoneMaxX
    const safeMinX = Math.min(zoneMinX, clampedMaxX)
    const safeMaxX = Math.max(zoneMinX, clampedMaxX)
    const attempts = 40

    if (type === 'cupcake') {
      let placedCupcake = false
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        x = Phaser.Math.Between(Math.floor(safeMinX), Math.floor(safeMaxX))
        y = this.getCupcakeY(x, zone, visual.height)
        if (!Number.isNaN(y)) {
          const rect = this.getPickupRect(x, y, visual)
          if (this.isOverlappingPickups(rect, placed)) {
            continue
          }
          placedCupcake = true
          break
        }
      }

      if (!placedCupcake) {
        return null
      }
    } else {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        x = Phaser.Math.Between(Math.floor(safeMinX), Math.floor(safeMaxX))
        y = Phaser.Math.Between(zone.y - zone.height / 2, zone.y + zone.height / 2)
        const rect = this.getPickupRect(x, y, visual)
        if (!this.isOverlappingPlatforms(x, y, visual.size, padding) && !this.isOverlappingPickups(rect, placed)) {
          return { x, y }
        }
      }

      return null
    }

    return { x, y }
  }

  private getPickupRect(x: number, y: number, visual: { width: number; height: number; size: number }) {
    const width = visual.width || visual.size
    const height = visual.height || visual.size
    return new Phaser.Geom.Rectangle(x - width / 2, y - height / 2, width, height)
  }

  private isOverlappingPickups(rect: Phaser.Geom.Rectangle, placed: Phaser.Geom.Rectangle[]) {
    const minCenterDistance = 64
    const rectCenterX = rect.x + rect.width / 2
    const rectCenterY = rect.y + rect.height / 2
    return placed.some((existing) => {
      const existingCenterX = existing.x + existing.width / 2
      const existingCenterY = existing.y + existing.height / 2
      const dx = rectCenterX - existingCenterX
      const dy = rectCenterY - existingCenterY
      return Math.sqrt(dx * dx + dy * dy) < minCenterDistance
    })
  }

  private getCupcakeY(x: number, zone: ItemZone, height: number) {
    const surfaceY = this.getSurfaceTopForX(x, zone)
    if (surfaceY !== undefined) {
      return surfaceY - height / 2
    }

    return Number.NaN
  }

  private spawnPickupAt(type: string, x: number, y: number, visual: { textureKey?: string; useTexture: boolean; width: number; height: number; size: number }, colors: Record<string, number>) {
    const color = colors[type] ?? 0xffffff
    const pickup = visual.useTexture
      ? this.add.image(x, y, visual.textureKey as string)
      : this.add.rectangle(x, y, visual.size, visual.size, color)
    this.physics.add.existing(pickup)
    const body = pickup.body as Phaser.Physics.Arcade.Body
    if (visual.useTexture) {
      body.setSize(visual.width, visual.height, true)
    }
    body.setAllowGravity(false)
    body.setImmovable(true)
    body.moves = false
    body.setVelocity(0, 0)
    pickup.setData('type', type)
    if (type === 'cupcake' && this.cupcakeGroup) {
      this.cupcakeGroup.add(pickup)
    } else if (this.pickupGroup) {
      this.pickupGroup.add(pickup)
    }
    this.pickupsRemaining += 1
  }

  private collectPickup(player: PlayerInfo, pickup: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle) {
    const type = pickup.getData('type') as string | undefined
    if (!type || type === 'cupcake') return
    pickup.destroy()
    this.addScore(player, 1)
    const color = this.getPickupColor(type)
    this.pendingAbsorbs += 1
    this.emitPickupBurst(pickup.x, pickup.y, color, () => {
      this.pendingAbsorbs = Math.max(0, this.pendingAbsorbs - 1)
      this.pickupsRemaining = Math.max(0, this.pickupsRemaining - 1)
      this.growCloud()
      this.checkRoundEnd()
    })
  }

  private addScore(player: PlayerInfo, amount: number) {
    player.score += amount
    if (player.scoreText) {
      player.scoreText.setText(String(player.score))
    }
  }

  private getPickupColor(type: string) {
    const colors: Record<string, number> = {
      cupcake: 0xffc857,
      heart: 0xff6b9b,
      star: 0xffd166,
      flower: 0x7ae582,
      grapes: 0x9d4edd,
      strawberry: 0xff6b6b,
    }

    return colors[type] ?? 0xffffff
  }

  private emitPickupBurst(x: number, y: number, color: number, onComplete?: () => void) {
    if (!this.textures.exists('pickup-spark')) return
    const count = 16
    let finished = 0
    for (let i = 0; i < count; i += 1) {
      const spark = this.add.image(x, y, 'pickup-spark')
      spark.setTint(color)
      spark.setBlendMode(Phaser.BlendModes.ADD)
      spark.setAlpha(1)
      spark.setScale(Phaser.Math.FloatBetween(1.2, 1.8))
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const distance = Phaser.Math.Between(18, 40)
      const burstX = x + Math.cos(angle) * distance
      const burstY = y + Math.sin(angle) * distance
      this.tweens.add({
        targets: spark,
        x: burstX,
        y: burstY,
        duration: 200,
        onComplete: () => {
          const targetX = this.cloudSprite?.x ?? x
          const targetY = this.cloudSprite?.y ?? y
          this.tweens.add({
            targets: spark,
            x: targetX,
            y: targetY,
            duration: 450,
            ease: 'Sine.in',
            onComplete: () => {
              spark.destroy()
              finished += 1
              if (finished >= count) {
                onComplete?.()
              }
            },
          })
        },
      })
    }
  }

  private growCloud() {
    if (!this.cloudSprite) return
    const targetScale = Math.min(1.4, this.cloudSprite.scaleX + 0.03)
    this.tweens.add({
      targets: this.cloudSprite,
      scale: targetScale,
      duration: 180,
      ease: 'Sine.out',
    })

    const colors = [0xff3b3b, 0xffc857, 0x7ae582, 0x5cc8ff, 0xb96bff]
    let index = 0
    this.time.addEvent({
      delay: 70,
      repeat: colors.length - 1,
      callback: () => {
        this.cloudSprite?.setTint(colors[index % colors.length])
        index += 1
        if (index >= colors.length) {
          this.cloudSprite?.clearTint()
        }
      },
    })
  }

  private tryEatCupcake(player: PlayerInfo) {
    if (!this.cupcakeGroup) return
    const collider = player.bodySprite ?? player.sprite
    let target: Phaser.GameObjects.GameObject | null = null
    this.physics.overlap(collider, this.cupcakeGroup, (_playerObj, cupcakeObj) => {
      if (!target) {
        target = cupcakeObj as Phaser.GameObjects.GameObject
      }
    })

    if (!target) return
    this.consumeCupcake(player, target)
  }

  private consumeCupcake(player: PlayerInfo, cupcake: Phaser.GameObjects.GameObject) {
    const sprite = player.sprite instanceof Phaser.GameObjects.Sprite ? player.sprite : null
    if (!sprite || player.isEating) return

    cupcake.destroy()
    this.addScore(player, 1)
    player.isEating = true
    player.body.setVelocityX(0)
    const anims = getUnicornAnimSet(player.variant)
    if (this.anims.exists(anims.eatStart)) {
      sprite.play(anims.eatStart, true)
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, (anim: Phaser.Animations.Animation) => {
        if (anim.key !== anims.eatStart) return
        if (this.anims.exists(anims.eatEnd)) {
          sprite.play(anims.eatEnd, true)
          sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, (endAnim: Phaser.Animations.Animation) => {
            if (endAnim.key !== anims.eatEnd) return
            player.isEating = false
            this.activatePowerUp(player)
            this.pickupsRemaining = Math.max(0, this.pickupsRemaining - 1)
            this.checkRoundEnd()
          })
        } else {
          player.isEating = false
          this.activatePowerUp(player)
          this.pickupsRemaining = Math.max(0, this.pickupsRemaining - 1)
          this.checkRoundEnd()
        }
      })
    } else {
      player.isEating = false
      this.activatePowerUp(player)
      this.pickupsRemaining = Math.max(0, this.pickupsRemaining - 1)
      this.checkRoundEnd()
    }
  }

  private activatePowerUp(player: PlayerInfo) {
    player.speedMultiplier = 1.5
    player.jumpMultiplier = 1.5
    player.powerUpUntil = this.time.now + 6000

    const sprite = player.sprite
    if (sprite instanceof Phaser.GameObjects.Sprite) {
      const colors = [0xff3b3b, 0xffc857, 0x7ae582, 0x5cc8ff, 0xb96bff]
      let index = 0
      player.rainbowEvent?.remove(false)
      player.rainbowEvent = this.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {
          sprite.setTint(colors[index % colors.length])
          index += 1
        },
      })
    }
  }

  private clearPowerUp(player: PlayerInfo) {
    player.speedMultiplier = 1
    player.jumpMultiplier = 1
    player.powerUpUntil = 0
    player.rainbowEvent?.remove(false)
    player.rainbowEvent = undefined
    if (player.sprite instanceof Phaser.GameObjects.Sprite) {
      player.sprite.clearTint()
    }
  }

  private getSurfaceTopForX(x: number, zone: ItemZone) {
    const zoneTop = zone.y - zone.height / 2 - 10
    const zoneBottom = zone.y + zone.height / 2 + 10
    const solids: Phaser.GameObjects.Rectangle[] = [...this.platforms]

    let bestY: number | undefined
    let bestDistance = Number.POSITIVE_INFINITY

    solids.forEach((platform) => {
      const bounds = platform.getBounds()
      if (x >= bounds.x && x <= bounds.x + bounds.width) {
        const top = bounds.y
        if (top >= zoneTop && top <= zoneBottom) {
          const distance = Math.abs(top - zone.y)
          if (distance < bestDistance) {
            bestDistance = distance
            bestY = top
          }
        }
      }
    })

    return bestY
  }

  private isOverlappingPlatforms(x: number, y: number, size: number, padding: number) {
    const half = size / 2
    const pickupRect = new Phaser.Geom.Rectangle(x - half, y - half, size, size)
    const solids: Phaser.GameObjects.Rectangle[] = [...this.platforms]

    return solids.some((platform) => {
      const bounds = platform.getBounds()
      const padded = new Phaser.Geom.Rectangle(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      )
      return Phaser.Geom.Rectangle.Overlaps(pickupRect, padded)
    })
  }

  update() {
    const baseSpeed = 200
    const baseJumpSpeed = 420
    const deltaSeconds = Math.max(0.001, this.game.loop.delta / 1000)

    this.movingPlatforms.forEach((entry) => {
      const body = entry.platform.body as Phaser.Physics.Arcade.Body
      const velocityX = (entry.platform.x - entry.prevX) / deltaSeconds
      const velocityY = (entry.platform.y - entry.prevY) / deltaSeconds
      body.setVelocity(velocityX, velocityY)
      body.updateFromGameObject()
      entry.prevX = entry.platform.x
      entry.prevY = entry.platform.y
    })


    this.players.forEach((player, index) => {
      if (player.powerUpUntil > 0 && this.time.now >= player.powerUpUntil) {
        this.clearPowerUp(player)
      }
      const left = index === 1 ? player.cursors?.left?.isDown : player.keys?.left.isDown
      const right = index === 1 ? player.cursors?.right?.isDown : player.keys?.right.isDown
      const jump = index === 1 ? player.cursors?.up?.isDown : player.keys?.jump.isDown
      const eatKey = index === 1 ? player.cursors?.down : player.keys?.eat
      const eatPressed = eatKey ? Phaser.Input.Keyboard.JustDown(eatKey) : false
      const isGrounded = player.body.blocked.down
      const justJumped = !!jump && isGrounded

      if (eatPressed && !player.isEating) {
        this.tryEatCupcake(player)
      }

      const speed = baseSpeed * player.speedMultiplier
      const jumpSpeed = baseJumpSpeed * player.jumpMultiplier

      if (!player.isEating) {
        if (left) {
          player.body.setVelocityX(-speed)
        } else if (right) {
          player.body.setVelocityX(speed)
        } else {
          player.body.setVelocityX(0)
        }

        if (justJumped) {
          player.body.setVelocityY(-jumpSpeed)
        }
      } else {
        player.body.setVelocityX(0)
      }

      if (player.sprite instanceof Phaser.GameObjects.Sprite) {
        if (left) {
          player.sprite.setFlipX(true)
        } else if (right) {
          player.sprite.setFlipX(false)
        }

        const justLanded = isGrounded && !player.wasGrounded
        const anims = getUnicornAnimSet(player.variant)
        const currentKey = player.sprite.anims.currentAnim?.key

        if (player.isEating) {
          // Keep current eat animation.
        } else if (!isGrounded || justJumped) {
          if ((player.wasGrounded || justJumped) && this.anims.exists(anims.jumpStart)) {
            player.sprite.play(anims.jumpStart, true)
          } else if (currentKey === anims.jumpStart && !player.sprite.anims.isPlaying) {
            player.sprite.setFrame(getVariantFrameKey(UNICORN_FRAMES.jump, 3, player.variant))
          }
        } else if (justLanded) {
          if (this.anims.exists(anims.jumpLand)) {
            player.sprite.play(anims.jumpLand, true)
          }
        } else if (currentKey === anims.jumpLand && player.sprite.anims.isPlaying) {
          // Let the landing frames finish before switching to idle/walk.
        } else if (left || right) {
          if (this.anims.exists(anims.walk)) {
            player.sprite.play(anims.walk, true)
          }
        } else if (this.anims.exists(anims.idle)) {
          player.sprite.play(anims.idle, true)
        }
      }

      if (player.bodySprite && player.sprite instanceof Phaser.GameObjects.Sprite) {
        const offset = isGrounded && (left || right) ? player.walkOffsetY : 0
        player.sprite.setPosition(player.bodySprite.x, player.bodySprite.y + offset)
      }

      const maxFallSpeed = 400
      if (player.body.velocity.y > maxFallSpeed) {
        player.body.setVelocityY(maxFallSpeed)
      }

      const wrapWidth = this.scale.width
      const wrapHeight = this.scale.height
      if (player.bodySprite) {
        if (player.bodySprite.x < 0) player.bodySprite.x += wrapWidth
        if (player.bodySprite.x > wrapWidth) player.bodySprite.x -= wrapWidth
        if (player.bodySprite.y > wrapHeight) player.bodySprite.y = 0
      }
      if (player.sprite instanceof Phaser.GameObjects.Sprite) {
        if (player.sprite.x < 0) player.sprite.x += wrapWidth
        if (player.sprite.x > wrapWidth) player.sprite.x -= wrapWidth
        if (player.sprite.y > wrapHeight) player.sprite.y = 0
      }

      player.wasGrounded = isGrounded
    })
  }
}
