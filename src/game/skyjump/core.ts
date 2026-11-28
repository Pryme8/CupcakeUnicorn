/**
 * Pegasus Jump - the simulation.
 *
 * Pure TypeScript: no Phaser, no DOM, no timers. The renderer reads this state
 * and draws it; nothing in here knows that a screen exists. That keeps the game
 * rules testable and lets the feel be tuned from config.ts alone.
 *
 * Coordinates are **y-up**: `y` is altitude in world px above the launch cloud,
 * `x` runs 0..VIEW.width across the play column. Only the renderer flips to
 * screen space.
 */

import {
  BUTTERFLY,
  CAMERA,
  CLOUD,
  CUPCAKE,
  FLOAT,
  MOVEMENT,
  PLAYER,
  SCORE,
  VIEW,
  ZONES,
  ZONE_FROM_PX,
  metresAtPx,
  zoneIndexAtPx,
  type PickupKind,
  type PlatformKind,
  type Zone,
} from './config'

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

export type Rng = () => number

/** mulberry32 - small, fast, and seedable so a run can be replayed exactly. */
export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const range = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Cloud = {
  id: number
  x: number
  y: number
  /** Which of the three sprites this is (0 small .. 2 large). */
  size: number
  halfWidth: number
  /** px/s; 0 for one that holds station. */
  driftVx: number
  /** Set the first time the player bounces off it, for the renderer's squash. */
  bounced: boolean
  /** What it looks like, and what it is: a cloud in the sky, a saucer in space. */
  kind: PlatformKind
  /** Sideways shove on bounce, in px/s. Only a saucer has one. */
  tow: number
}

export type Butterfly = {
  id: number
  /** Live position, recomputed each frame from the sway. */
  x: number
  y: number
  /** The point it flutters around. */
  homeX: number
  homeY: number
  swayPhase: number
  swaySpeed: number
  bobPhase: number
  /** Index into the renderer's palette. */
  colour: number
  caught: boolean
  /** Butterfly in the air, star in space, feather in heaven. */
  kind: PickupKind
}

export type Cupcake = {
  id: number
  x: number
  /** Live position: it bobs around `homeY`. */
  y: number
  homeY: number
  bobPhase: number
  eaten: boolean
}

export type Player = {
  x: number
  y: number
  vx: number
  vy: number
  /** -1 facing left, 1 facing right. Held through a coast so it does not flicker. */
  facing: 1 | -1
}

export type Phase = 'playing' | 'dead'

export type GameEvent =
  /**
   * `underside: true` means it was clipped on the way up, not landed on.
   * `vanished: true` means the cloud was spent and has left the simulation.
   */
  | { type: 'bounce'; source: 'cloud'; x: number; y: number; id: number; underside: boolean; vanished: boolean }
  | {
      type: 'bounce'
      source: 'butterfly'
      x: number
      y: number
      id: number
      boost: number
      chain: number
      kind: PickupKind
    }
  /** Crossed into a zone for the first time this run. */
  | { type: 'zone'; index: number; id: string; name: string; blurb: string }
  | { type: 'super'; x: number; y: number; id: number }
  | { type: 'death'; x: number; y: number }

export type Input = {
  /**
   * -1 to 1. Keys give the full -1 or 1; a pointer gives the fraction in
   * between, which caps the top speed proportionally so you can ease onto a
   * cloud instead of always running flat out.
   */
  steer: number
}

export const NO_INPUT: Input = { steer: 0 }

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export class SkyJumpCore {
  readonly width = VIEW.width
  readonly height = VIEW.height

  player: Player = { x: PLAYER.startX, y: PLAYER.startY, vx: 0, vy: 0, facing: 1 }
  clouds: Cloud[] = []
  butterflies: Butterfly[] = []
  cupcakes: Cupcake[] = []

  /** World y at the centre of the view. */
  cameraY = 0
  phase: Phase = 'playing'

  /** Highest altitude reached, in world px. Drives the score. */
  peakY = 0
  butterfliesCaught = 0
  cupcakesEaten = 0
  /** Pickups caught this run, split by kind, for the collection. */
  caught: Record<PickupKind, number> = { butterfly: 0, star: 0, feather: 0 }
  /** Highest zone index entered this run. Only ever goes up. */
  deepestZone = 0
  /**
   * True once a run has been dropped into a zone rather than climbed to it.
   * Heaven is twelve hours up and almost nobody will ever see it the honest
   * way, so there has to be a way to go and look — but a run that skipped the
   * climb cannot be allowed to set a record or fill the collection.
   */
  touring = false
  /** Current butterfly chain: each catch adds to the bounce, idling resets it. */
  chain = 0
  /** Counts down after a cupcake; the view draws the rainbow trail while it runs. */
  superTimer = 0
  /**
   * Banked hang time, in seconds. Topped up by every link in a chain and spent
   * by simply existing; while it is running the fall is softened. See FLOAT.
   */
  floatTimer = 0
  elapsed = 0

  /**
   * One-use clouds. Lives on the instance rather than being read from config
   * each time so it can be flipped mid-run for a side-by-side comparison.
   */
  vanishOnBounce = CLOUD.vanishOnBounce

  /** Drained by the renderer every frame; the core never keeps them. */
  readonly events: GameEvent[] = []

  private rng: Rng = makeRng(1)
  private nextId = 1
  /** Altitude of the highest cloud row generated so far. */
  private spawnY = 0
  /** x of that row, so the next one can be placed within jumping reach of it. */
  private lastRowX = VIEW.width / 2
  private sinceCatch = Infinity

  constructor(seed = Date.now()) {
    this.reset(seed)
  }

  // -- score -----------------------------------------------------------------

  /**
   * Altitude on the HUD. Not peakY / pxPerMetre any more: each zone counts a
   * pixel of climb at its own rate, so the number leaves the thousands behind
   * somewhere in the atmosphere and never comes back. See ZONES.
   */
  get metres() {
    return Math.floor(metresAtPx(this.peakY))
  }

  /** The zone the player is in now. */
  get zoneIndex() {
    return zoneIndexAtPx(this.player.y)
  }

  get zone(): Zone {
    return ZONES[this.zoneIndex] as Zone
  }

  /**
   * The old flat altitude in sky-metres, which is what the difficulty ramp,
   * the gap growth and the small-cloud bias are tuned against. Those were
   * measured when a metre meant one thing; feeding them an altitude that
   * reaches a trillion would peg every one of them on the first zone border.
   */
  private get ramp() {
    return this.peakY / SCORE.pxPerMetre
  }

  get score() {
    return this.metres + this.butterfliesCaught * SCORE.perButterfly + this.cupcakesEaten * CUPCAKE.score
  }

  /** True while a Super Jump is still in the air. */
  get superJumping() {
    return this.superTimer > 0
  }

  /**
   * 0..1 strength of the chain float — full while there is time in the bank,
   * easing out over its last FLOAT.releaseSeconds. Drives the softer apex and
   * the lower fall cap, and the view fades the glide trail with it.
   */
  get floatFraction() {
    return Math.min(1, this.floatTimer / FLOAT.releaseSeconds)
  }

  /** 0..1 ramp used to scale difficulty with height. */
  private get difficulty() {
    return Math.min(1, Math.max(0, (this.ramp - CLOUD.driftStartMetre) / CLOUD.driftRampMetres))
  }

  // -- lifecycle -------------------------------------------------------------

  reset(seed = Date.now()) {
    this.rng = makeRng(seed)
    this.nextId = 1
    this.clouds = []
    this.butterflies = []
    this.cupcakes = []
    this.events.length = 0
    this.phase = 'playing'
    this.peakY = 0
    this.butterfliesCaught = 0
    this.cupcakesEaten = 0
    this.caught = { butterfly: 0, star: 0, feather: 0 }
    this.deepestZone = 0
    this.touring = false
    this.chain = 0
    this.superTimer = 0
    this.floatTimer = 0
    this.sinceCatch = Infinity
    this.elapsed = 0

    // The launch pad is three large clouds abutting into one long ledge, so the
    // first bounce cannot drop you down the side before the run has started.
    // Three real sprites rather than one stretched one keeps the pixels square.
    const padSize = CLOUD.sizes.length - 1
    const padHalf = CLOUD.sizes[padSize] as number
    for (const dx of [-padHalf * 2, 0, padHalf * 2]) {
      this.clouds.push({
        id: this.nextId++,
        x: VIEW.width / 2 + dx,
        y: 0,
        kind: 'cloud',
        tow: 0,
        size: padSize,
        halfWidth: padHalf,
        driftVx: 0,
        bounced: false,
      })
    }
    this.spawnY = 0
    this.lastRowX = VIEW.width / 2

    this.player = {
      x: PLAYER.startX,
      y: PLAYER.startY + PLAYER.feetOffset,
      vx: 0,
      vy: MOVEMENT.bounceVelocity,
      facing: 1,
    }
    this.cameraY = this.player.y + VIEW.height * (CAMERA.anchor - 0.5)
    this.fillAbove()
  }

  /**
   * Drops the run at the foot of a zone, world and all, and marks it a tour.
   * Nothing a tour does is written to the high score or the collection.
   */
  jumpToZone(index: number) {
    const i = Math.max(0, Math.min(ZONES.length - 1, Math.floor(index)))
    // Clear of the line, not on it: starting exactly on a border means the
    // first dip of the first hop falls back into the zone below, and the sky
    // and the platforms you were brought here to see flip back with it.
    const y = (ZONE_FROM_PX[i] as number) + (i > 0 ? 600 : 0)
    this.touring = true
    this.phase = 'playing'
    this.clouds = []
    this.butterflies = []
    this.cupcakes = []
    this.player.x = PLAYER.startX
    this.player.y = y
    this.player.vx = 0
    this.player.vy = MOVEMENT.bounceVelocity
    this.peakY = y
    this.cameraY = y + VIEW.height * (CAMERA.anchor - 0.5)
    this.spawnY = y
    this.lastRowX = PLAYER.startX
    this.floatTimer = 0
    this.chain = 0
    // One below, so arriving still gets the zone's banner.
    this.deepestZone = Math.max(0, i - 1)
    this.fillAbove()
  }

  // -- simulation ------------------------------------------------------------

  update(dt: number, input: Input = NO_INPUT) {
    if (this.phase !== 'playing') return
    // Clamp the step so a stalled tab cannot teleport the player through a cloud.
    const step = Math.min(dt, 1 / 30)
    this.elapsed += step

    this.steer(step, input.steer)
    const prevY = this.player.y
    this.fall(step)
    this.driftClouds(step)
    this.flutterButterflies(step)
    this.bobCupcakes(step)
    this.collide(prevY)
    this.decayChain(step)
    if (this.superTimer > 0) this.superTimer = Math.max(0, this.superTimer - step)
    this.moveCamera(step)
    this.fillAbove()
    this.cull()
    this.checkDeath()

    if (this.player.y > this.peakY) this.peakY = this.player.y
    this.checkZone()
  }

  /** Announces a zone the first time this run reaches it. */
  private checkZone() {
    const i = zoneIndexAtPx(this.peakY)
    if (i <= this.deepestZone) return
    this.deepestZone = i
    const zone = ZONES[i] as Zone
    this.events.push({ type: 'zone', index: i, id: zone.id, name: zone.name, blurb: zone.blurb })
  }

  private steer(dt: number, input: number) {
    const p = this.player
    const steer = Math.max(-1, Math.min(1, input))
    if (steer !== 0) {
      // Turning into your own momentum accelerates harder, so the change of
      // direction is felt on the keypress rather than after a slide.
      const against = steer * p.vx < 0
      p.vx += steer * MOVEMENT.steerAccel * (against ? MOVEMENT.reverseBoost : 1) * dt
      const cap = MOVEMENT.maxSteerSpeed * Math.abs(steer)
      p.vx = Math.max(-cap, Math.min(cap, p.vx))
      p.facing = steer > 0 ? 1 : -1
    } else if (p.vx !== 0) {
      const drop = MOVEMENT.steerDrag * dt
      p.vx = Math.abs(p.vx) <= drop ? 0 : p.vx - Math.sign(p.vx) * drop
    }

    p.x += p.vx * dt
    if (MOVEMENT.wrapHorizontally) {
      if (p.x < 0) p.x += VIEW.width
      else if (p.x > VIEW.width) p.x -= VIEW.width
    } else {
      const lo = PLAYER.halfWidth
      const hi = VIEW.width - PLAYER.halfWidth
      if (p.x < lo) {
        p.x = lo
        p.vx = 0
      } else if (p.x > hi) {
        p.x = hi
        p.vx = 0
      }
    }
  }

  private fall(dt: number) {
    const p = this.player
    // Banked float is spent going down, never on the way up: a chain's hang
    // time is there for the fall that ends it.
    if (p.vy <= 0 && this.floatTimer > 0) this.floatTimer = Math.max(0, this.floatTimer - dt)
    p.vy -= this.gravityNow() * dt
    const cap = MOVEMENT.maxFallSpeed * (1 - (1 - FLOAT.fallFraction) * this.floatFraction)
    if (p.vy < -cap) p.vy = -cap
    p.y += p.vy * dt
  }

  /**
   * Gravity for this step. The rise is always the measured value — only the top
   * of the hop and the drop are softened, and only by however much chain float
   * is banked. With nothing banked this returns MOVEMENT.gravity exactly.
   */
  private gravityNow() {
    const p = this.player
    // Each zone has its own pull. It changes how a jump feels, not how fast
    // you climb: apex is v^2/2g and the period 2v/g, so the rate stays v/4.
    const g = MOVEMENT.gravity * this.zone.gravity
    if (p.vy > 0) return g
    const f = this.floatFraction
    if (f === 0) return g
    // Strongest at the apex, gone by the time you are falling at apexWindow.
    const taper = 1 - Math.min(1, -p.vy / FLOAT.apexWindow)
    return g * (1 - (1 - FLOAT.apexGravity) * f * taper)
  }

  /**
   * A saucer throws you sideways. It adds to your own motion rather than
   * replacing it, and only up to a bit over normal steering speed: setting vx
   * outright took the run out of your hands, and space killed five bot runs in
   * six against two in every other zone.
   */
  private applyTow(tow: number) {
    const max = MOVEMENT.maxSteerSpeed * 1.3
    this.player.vx = Math.max(-max, Math.min(max, this.player.vx + tow))
  }

  /** Banks hang time for a link in a chain. */
  private bankFloat(links: number) {
    this.floatTimer = Math.min(FLOAT.maxSeconds, this.floatTimer + FLOAT.secondsPerLink * links)
  }

  private driftClouds(dt: number) {
    for (const cloud of this.clouds) {
      if (cloud.driftVx === 0) continue
      cloud.x += cloud.driftVx * dt
    }
  }

  private flutterButterflies(dt: number) {
    for (const b of this.butterflies) {
      if (b.caught) continue
      b.swayPhase += b.swaySpeed * dt
      b.bobPhase += ((Math.PI * 2) / BUTTERFLY.bobPeriod) * dt
      b.x = b.homeX + Math.sin(b.swayPhase) * BUTTERFLY.swayAmplitude
      b.y = b.homeY + Math.sin(b.bobPhase) * BUTTERFLY.bobAmplitude
    }
  }

  private bobCupcakes(dt: number) {
    for (const c of this.cupcakes) {
      if (c.eaten) continue
      c.bobPhase += ((Math.PI * 2) / CUPCAKE.bobPeriod) * dt
      c.y = c.homeY + Math.sin(c.bobPhase) * CUPCAKE.bobAmplitude
    }
  }

  /**
   * Pickups first (they win a tie, and they are the better bounce), then
   * clouds. Everything is swept against the player's movement this frame so a
   * fast fall cannot tunnel straight through.
   */
  private collide(prevY: number) {
    const p = this.player
    const low = Math.min(prevY, p.y) - PLAYER.halfHeight
    const high = Math.max(prevY, p.y) + PLAYER.halfHeight
    const overlaps = (y: number, halfHeight: number) => high >= y - halfHeight && low <= y + halfHeight

    for (const c of this.cupcakes) {
      if (c.eaten) continue
      if (Math.abs(p.x - c.x) > CUPCAKE.halfWidth + PLAYER.halfWidth * 0.7) continue
      if (!overlaps(c.y, CUPCAKE.halfHeight)) continue
      this.eatCupcake(c)
      return
    }

    for (const b of this.butterflies) {
      if (b.caught) continue
      if (!BUTTERFLY.bounceWhileRising && p.vy > 0) break
      if (Math.abs(p.x - b.x) > BUTTERFLY.halfWidth + PLAYER.halfWidth * 0.7) continue
      if (!overlaps(b.y, BUTTERFLY.halfHeight)) continue
      this.catchButterfly(b)
      return
    }

    if (p.vy > 0) this.collideCloudUndersides(prevY)
    else this.collideCloudTops(prevY)
  }

  /**
   * Falling: the top of a cloud is a ledge that catches you and bounces you.
   */
  private collideCloudTops(prevY: number) {
    const p = this.player
    const feet = p.y - PLAYER.feetOffset
    const prevFeet = prevY - PLAYER.feetOffset
    for (const cloud of this.clouds) {
      if (prevFeet < cloud.y || feet > cloud.y) continue
      if (Math.abs(p.x - cloud.x) > cloud.halfWidth + PLAYER.halfWidth * 0.5) continue
      cloud.bounced = true
      p.y = cloud.y + PLAYER.feetOffset
      p.vy = MOVEMENT.bounceVelocity
      if (cloud.tow !== 0) this.applyTow(cloud.tow)
      this.spend(cloud, cloud.y, false)
      return
    }
  }

  /**
   * Rising: clipping a cloud's **underside** re-launches you on the spot and
   * you carry straight on up through it. This is the flow of the original —
   * you chain bounces off cloud bottoms rather than waiting out the fall onto
   * a top. A boosted ascent is never slowed down, only topped back up.
   */
  private collideCloudUndersides(prevY: number) {
    const p = this.player
    const head = p.y + PLAYER.halfHeight
    const prevHead = prevY + PLAYER.halfHeight
    for (const cloud of this.clouds) {
      const underside = cloud.y - CLOUD.thickness
      if (prevHead > underside || head < underside) continue
      if (Math.abs(p.x - cloud.x) > cloud.halfWidth + PLAYER.halfWidth * 0.5) continue
      cloud.bounced = true
      p.vy = Math.max(p.vy, MOVEMENT.bounceVelocity)
      if (cloud.tow !== 0) this.applyTow(cloud.tow)
      this.spend(cloud, underside, true)
      return
    }
  }

  /** Reports the bounce and, with one-use clouds on, retires the cloud. */
  private spend(cloud: Cloud, y: number, underside: boolean) {
    this.bankFloat(1)
    const vanished = this.vanishOnBounce
    if (vanished) this.clouds = this.clouds.filter((c) => c !== cloud)
    this.events.push({ type: 'bounce', source: 'cloud', x: cloud.x, y, id: cloud.id, underside, vanished })
  }

  private eatCupcake(c: Cupcake) {
    c.eaten = true
    this.cupcakesEaten += 1
    this.superTimer = CUPCAKE.superSeconds
    this.player.vy = MOVEMENT.bounceVelocity * CUPCAKE.jumpMultiplier
    this.events.push({ type: 'super', x: c.x, y: c.y, id: c.id })
  }

  private catchButterfly(b: Butterfly) {
    b.caught = true
    this.butterfliesCaught += 1
    this.caught[b.kind] += 1
    this.chain += 1
    this.sinceCatch = 0
    this.bankFloat(0.5)
    const boost = Math.min(BUTTERFLY.maxBoost, this.chain * BUTTERFLY.boostPerCatch)
    this.player.vy = MOVEMENT.bounceVelocity * (1 + boost)
    this.events.push({
      type: 'bounce',
      source: 'butterfly',
      x: b.x,
      y: b.y,
      id: b.id,
      boost,
      chain: this.chain,
      kind: b.kind,
    })
  }

  private decayChain(dt: number) {
    if (this.chain === 0) return
    this.sinceCatch += dt
    if (this.sinceCatch >= BUTTERFLY.boostDecaySeconds) this.chain = 0
  }

  private moveCamera(dt: number) {
    const target = this.player.y + VIEW.height * (CAMERA.anchor - 0.5)
    if (target > this.cameraY) {
      this.cameraY += (target - this.cameraY) * (1 - Math.exp(-CAMERA.followUp * dt))
      return
    }
    // Going down the view is both smoothed and speed-capped, so a real fall
    // outruns it and the bottom of the screen eventually catches you.
    const want = (this.cameraY - target) * (1 - Math.exp(-CAMERA.followDown * dt))
    this.cameraY -= Math.min(want, CAMERA.maxDownSpeed * dt)
  }

  private checkDeath() {
    const bottom = this.cameraY - VIEW.height / 2
    if (this.player.y + PLAYER.halfHeight < bottom - CAMERA.deathMargin) {
      this.phase = 'dead'
      this.events.push({ type: 'death', x: this.player.x, y: this.player.y })
    }
  }

  // -- world generation ------------------------------------------------------

  /** Keeps a screen and a half of clouds stocked above the camera. */
  private fillAbove() {
    const ceiling = this.cameraY + VIEW.height * 1.5
    let guard = 0
    while (this.spawnY < ceiling && guard < 200) {
      guard += 1
      const gapGrowth = Math.min(CLOUD.gapGrowthCap, this.ramp * CLOUD.gapGrowthPerMetre)
      // Rows spread out in a floatier zone by exactly as much as the apex
      // grows, so a lower-gravity zone is different, not easier.
      const zone = ZONES[zoneIndexAtPx(this.spawnY)] as Zone
      this.spawnY += (range(this.rng, CLOUD.minGap, CLOUD.maxGap) + gapGrowth) * zone.gapScale
      this.spawnRow(this.spawnY, this.difficulty, zone)
    }
  }

  private spawnRow(y: number, difficulty: number, zone: Zone) {
    // Pick one of the three sprite sizes, leaning smaller the higher you are.
    const smallBias = Math.min(CLOUD.maxSmallBias, this.ramp * CLOUD.smallBiasPerMetre)
    const size =
      this.rng() < smallBias ? 0 : Math.min(CLOUD.sizes.length - 1, Math.floor(this.rng() * CLOUD.sizes.length))
    const halfWidth = CLOUD.sizes[size] as number
    const kind = this.pickPlatform(zone)

    let driftVx = 0
    if (difficulty > 0 && this.rng() < CLOUD.driftChance * zone.driftScale) {
      // Drift speed goes with gravity, because what matters is how far a
      // platform slides during one hop, not per second. A hop lasts 2v/g, so
      // in half gravity it lasts twice as long; leaving the speed alone there
      // moved every platform 2.8x further out from under you and killed five
      // bot runs in six in space against two in every other zone.
      const speed = CLOUD.driftMaxSpeed * zone.driftScale * zone.gravity * difficulty * range(this.rng, 0.4, 1)
      driftVx = this.rng() < 0.5 ? -speed : speed
    }
    // A saucer throws you the way it is already going, so it reads as a tow
    // rather than a random shove.
    const tow = kind === 'saucer' ? Math.sign(driftVx || 1) * zone.tow : 0

    // Step sideways from the row below rather than landing anywhere, so the
    // next cloud is always inside one bounce's horizontal reach.
    const x = this.placeInReach(this.lastRowX, CLOUD.maxSideStep, halfWidth)
    this.lastRowX = x
    this.clouds.push({ id: this.nextId++, x, y, size, halfWidth, driftVx, bounced: false, kind, tow })

    if (this.rng() < BUTTERFLY.spawnChance) {
      const homeY = y + range(this.rng, BUTTERFLY.minRise, BUTTERFLY.maxRise)
      const homeX = this.placeInReach(x, BUTTERFLY.maxSideStep, BUTTERFLY.swayAmplitude + BUTTERFLY.halfWidth)
      this.butterflies.push({
        id: this.nextId++,
        x: homeX,
        y: homeY,
        homeX,
        homeY,
        swayPhase: this.rng() * Math.PI * 2,
        swaySpeed: (Math.PI * 2) / range(this.rng, BUTTERFLY.minSwayPeriod, BUTTERFLY.maxSwayPeriod),
        bobPhase: this.rng() * Math.PI * 2,
        colour: Math.floor(this.rng() * 5),
        caught: false,
        kind: zone.pickup,
      })
    }

    if (this.rng() < CUPCAKE.spawnChance) {
      const homeY = y + range(this.rng, CUPCAKE.minRise, CUPCAKE.maxRise)
      this.cupcakes.push({
        id: this.nextId++,
        x: this.placeInReach(x, CUPCAKE.maxSideStep, CUPCAKE.halfWidth + 10),
        y: homeY,
        homeY,
        bobPhase: this.rng() * Math.PI * 2,
        eaten: false,
      })
    }
  }

  /**
   * Picks an x within `reach` of `from`. Candidates past an edge **reflect**
   * back inward rather than wrapping: reflection can only shorten the step, so
   * the next row is always reachable without crossing a screen edge. Wrapping
   * stays something the player may use, never something the level requires.
   * `margin` is the half-width that must stay inside the edges.
   */
  /** One of the zone's platforms, by weight. */
  private pickPlatform(zone: Zone): PlatformKind {
    let total = 0
    for (const p of zone.platforms) total += p.weight
    let roll = this.rng() * total
    for (const p of zone.platforms) {
      roll -= p.weight
      if (roll <= 0) return p.kind
    }
    return (zone.platforms[0] as { kind: PlatformKind }).kind
  }

  private placeInReach(from: number, reach: number, margin: number) {
    // Intersect "within reach of the row below" with "fully on screen" and
    // pick inside that. Reflecting or clamping instead can quietly push a row
    // further than one bounce covers when the two rows are different widths.
    const lo = Math.max(margin, from - reach)
    const hi = Math.min(VIEW.width - margin, from + reach)
    if (lo > hi) return Math.max(margin, Math.min(VIEW.width - margin, from))
    return range(this.rng, lo, hi)
  }

  /**
   * Nothing is parked out of sight: clouds that have drifted fully past an edge
   * are gone for good, and anything below the view is recycled.
   */
  private cull() {
    const floor = this.cameraY - VIEW.height / 2 - CLOUD.cullBelow
    const kept: Cloud[] = []
    for (const cloud of this.clouds) {
      if (cloud.y <= floor) continue
      const goneLeft = cloud.x + cloud.halfWidth <= 0
      const goneRight = cloud.x - cloud.halfWidth >= VIEW.width
      if (!goneLeft && !goneRight) {
        kept.push(cloud)
        continue
      }
      // That cloud is gone for good — but a fresh one slides in from the far
      // side at the same height, so a drifting row cannot leave a dead gap.
      kept.push({
        id: this.nextId++,
        x: goneLeft ? VIEW.width + cloud.halfWidth : -cloud.halfWidth,
        y: cloud.y,
        kind: cloud.kind,
        tow: cloud.tow,
        size: cloud.size,
        halfWidth: cloud.halfWidth,
        driftVx: cloud.driftVx,
        bounced: false,
      })
    }
    this.clouds = kept
    this.butterflies = this.butterflies.filter((b) => !b.caught && b.y > floor)
    this.cupcakes = this.cupcakes.filter((c) => !c.eaten && c.y > floor)
  }

  // -- renderer helpers ------------------------------------------------------

  /** World y -> screen y (screen y grows downward). */
  toScreenY(worldY: number) {
    return VIEW.height / 2 - (worldY - this.cameraY)
  }

  drainEvents(): GameEvent[] {
    const out = this.events.slice()
    this.events.length = 0
    return out
  }
}
