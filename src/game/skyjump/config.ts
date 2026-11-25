/**
 * Pegasus Jump — every tunable number in one place.
 *
 * The movement values are not invented: they are measured off the original
 * *Kitten Jump* trailer and rescaled from its 320x480 screen to this game's
 * 540x960 one. See docs/skyjump-timing.md for how each figure was obtained.
 *
 * Design space is 540 x 960. The core simulation uses **y-up world
 * coordinates** (y = altitude in px above the starting cloud); the renderer is
 * the only place that flips to screen space.
 */

export const VIEW = {
  width: 540,
  height: 960,
}

/** Vertical scale from the original 480-tall screen; horizontal from its 320. */
const V = VIEW.height / 480 // 2
const H = VIEW.width / 320 // 1.6875

export const MOVEMENT = {
  /** 880 px/s^2 measured -> 1800 here. Gives a 0.98 s hop, as in the trailer. */
  gravity: 880 * V,
  /** 440 px/s measured. Apex lands 215 px above the bounce point. */
  bounceVelocity: 440 * V,
  /** Terminal velocity, ~1.3x the bounce, so a long drop stays readable. */
  maxFallSpeed: 1150,
  /**
   * Steering. The trailer measures 300 * H (506 px/s) with a 0.2 s ramp, but
   * that ramp feels sluggish on a keyboard, where you expect the turn to happen
   * on the keypress. Top speed is nudged up and the ramp cut hard; the measured
   * values are kept here so the trade is visible and easy to undo.
   */
  measuredSteerSpeed: 300 * H,
  maxSteerSpeed: 360 * H,
  /** Reaches full steer speed in ~0.06 s rather than the measured 0.2 s. */
  steerAccel: (360 * H) / 0.06,
  /** Coasts to a stop in ~0.09 s when nothing is held. */
  steerDrag: (360 * H) / 0.09,
  /**
   * Turning against your own momentum accelerates harder, so a direction change
   * bites immediately instead of first bleeding off the old speed.
   */
  reverseBoost: 2.6,
  /** Leaving one edge brings you back in at the other (classic, and forgiving). */
  wrapHorizontally: true,
}

/**
 * Chain float. Chaining cloud undersides buys height fast, and the cost used to
 * be brutal: miss one and you dropped from the top of a long climb at full
 * gravity with nothing under you — in limbo. Float is the refund. Every link in
 * a chain banks a little hang time, and while that time is running the top of
 * each hop is softer and you do not pick up speed as fast on the way down, so a
 * missed line is a chance to steer rather than an instant plummet.
 *
 * It only ever touches the fall. An unchained hop still rises and lands on the
 * trailer's measured 0.98 s, so the baseline timing is untouched.
 */
export const FLOAT = {
  /** Gravity multiplier at the very top of a hop on a full chain. 1 = no float. */
  apexGravity: 0.3,
  /** Fall speed, px/s, by which the float has faded back to normal gravity. */
  apexWindow: 520,
  /**
   * Terminal velocity is held to this fraction of the usual on a full chain.
   * This is the number that matters: 0.48 is ~550 px/s, barely faster than the
   * camera's own 500 px/s descent, so while the bank lasts the bottom of the
   * screen closes on you slowly instead of swallowing you.
   */
  fallFraction: 0.48,
  /** Hang time banked per link. A cloud bounce is one link, a butterfly half. */
  secondsPerLink: 0.35,
  /** Cap on banked time. */
  maxSeconds: 1.4,
  /**
   * The float runs at full strength for as long as there is time in the bank
   * and only eases off over this last stretch of it. Scaling strength with the
   * whole bank instead was the first attempt and it was useless: the float had
   * half faded before you had finished looking for somewhere to land.
   */
  releaseSeconds: 0.35,
}

export const PLAYER = {
  /** Collision box, in world px. Deliberately generous — this is a kids' remake. */
  halfWidth: 34,
  halfHeight: 26,
  /** Where the player's feet sit relative to its centre. */
  feetOffset: 26,
  startX: VIEW.width / 2,
  startY: 0,
}

export const CAMERA = {
  /** The trailer keeps the player ~42 % down the screen. */
  anchor: 0.42,
  /** Exponential follow; higher snaps harder. Softer on the way down. */
  followUp: 9,
  followDown: 4.5,
  /**
   * The view does drop with you (the trailer shows the backdrop scrolling both
   * ways), but it is capped well below terminal velocity. Without this the
   * camera keeps pace with any fall and the bottom of the screen can never
   * catch you — you get about 1.2 s of falling to find a cloud, then you are out.
   */
  maxDownSpeed: 500,
  /** How far below the camera's bottom edge the player may fall before dying. */
  deathMargin: 40,
}

export const CLOUD = {
  /**
   * Vertical gap between clouds. A plain cloud bounce apexes 216 px up, so the
   * whole band stays under that with margin: every next cloud is reachable
   * without a butterfly. The measured climb was ~195 px per bounce, which sits
   * at the top of this range.
   */
  minGap: 125,
  maxGap: 190,
  /**
   * Gaps widen a little with height, but never past the apex — difficulty
   * comes from narrower, drifting clouds, not from impossible jumps.
   */
  gapGrowthPerMetre: 0.02,
  gapGrowthCap: 20,

  /**
   * How far sideways the next cloud may sit. From a standing bounce you cover
   * ~200 px before the apex, so rows are kept inside that: there is always a
   * way up, even if it is a tight one.
   */
  maxSideStep: 215,

  /**
   * How deep a cloud is. The top is the ledge you land on when falling; the
   * underside, `thickness` below it, re-launches you instantly when you clip
   * it on the way **up**. That is the flow of the original: you chain bounces
   * off cloud bottoms while rising instead of waiting to fall onto a top.
   */
  thickness: 30,

  /**
   * Widths are not free: there are three pixel-art clouds (40, 55 and 75 px
   * half-width, from CLOUD_HALF_WIDTHS in pixelArt.ts) and a row picks one of
   * them, so no sprite is ever stretched off its pixel grid.
   *
   * Climbing shifts the odds toward the small one rather than shrinking it.
   */
  smallBiasPerMetre: 0.0022,
  maxSmallBias: 0.55,
  /**
   * Half-widths of the three sprites, in world px. These mirror the 16/22/30
   * art-pixel clouds in pixelArt.ts at PIXEL = 5; change them together.
   */
  sizes: [40, 55, 75],

  /**
   * Drift. The trailer shows no drift in the shot that could be measured, but
   * the clouds are remembered as sliding off-screen, so it ramps in with
   * altitude. A drifting cloud is removed once it is fully off the edge — none
   * are parked out of view.
   */
  driftStartMetre: 12,
  driftRampMetres: 90,
  driftMaxSpeed: 95,
  /** Fraction of clouds that drift at all, once drift has ramped in. */
  driftChance: 0.55,

  /** Clouds this far below the camera are recycled. */
  cullBelow: 160,

  /**
   * One-use clouds. Off by default: a cloud stays put and can be landed on
   * again, which is how it plays now. On, a cloud puffs out as soon as you
   * bounce off it (top or underside), so the ladder burns away behind you and
   * a missed line cannot be retried.
   *
   * Toggle it live with the V key, or open the game with ?vanish=1, so the two
   * can be compared back to back rather than argued about.
   */
  vanishOnBounce: false,
}

export const BUTTERFLY = {
  /** Chance a cloud row also gets a butterfly floating above it. */
  spawnChance: 0.55,
  /** How far above its cloud row a butterfly sits. */
  minRise: 55,
  maxRise: 120,
  /** And how far to the side of it, so a butterfly is never a detour you cannot make. */
  maxSideStep: 130,
  /** Butterflies flutter side to side rather than travelling. */
  swayAmplitude: 55,
  minSwayPeriod: 2.1,
  maxSwayPeriod: 3.6,
  /** Slow bob so they never read as static. */
  bobAmplitude: 14,
  bobPeriod: 1.7,

  halfWidth: 26,
  halfHeight: 24,

  /**
   * "Hit a butterfly and you gain some speed and jump up again." Each butterfly
   * in a chain adds this much to the bounce, up to `maxBoost`; the chain decays
   * back to nothing if you go `boostDecaySeconds` without catching one.
   */
  boostPerCatch: 0.07,
  maxBoost: 0.45,
  boostDecaySeconds: 3.2,
  /** Butterflies bounce you even on the way up; clouds only catch you falling. */
  bounceWhileRising: true,
}

export const CUPCAKE = {
  /** Rare: a cupcake should feel like a find, not a rung on the ladder. */
  spawnChance: 0.11,
  /** Floats above its cloud row, like a butterfly but higher and wider out. */
  minRise: 70,
  maxRise: 150,
  maxSideStep: 180,
  bobAmplitude: 10,
  bobPeriod: 2.4,

  halfWidth: 30,
  halfHeight: 30,

  /**
   * Super Jump. 2.1x the bounce apexes ~950 px, about a full screen, and hangs
   * for a little over two seconds.
   */
  jumpMultiplier: 2.1,
  /** How long the renderer draws the rainbow trail for. */
  superSeconds: 2.1,
  score: 25,
}

export const SCORE = {
  /** World px per point of altitude shown in the HUD. */
  pxPerMetre: 24,
  /** Points for each butterfly caught, on top of altitude. */
  perButterfly: 5,
}

export const STORAGE_KEY = 'pegasus-jump.best'
