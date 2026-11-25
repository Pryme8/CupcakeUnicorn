# Pegasus Jump — timing deduced from the *Kitten Jump* trailer

The game this mode remakes is **Kitten Jump** (iPhone/iPod). The only surviving
reference is the trailer: <https://www.youtube.com/watch?v=mND9LnoQLsI>

Everything below was measured off that trailer rather than guessed, so the
constants in [`config.ts`](../src/game/skyjump/config.ts) can be traced back to
something real. If the feel is ever wrong, change the config — not the core.

## How the measurement was done

The trailer is 48.9 s, 640x480, 30 fps, and shows the game inside an iPhone
mock-up on a black background. The phone screen occupies roughly
`x 28..230, y 74..404` of the video frame (202 x 330 video px standing in for the
device's 320 x 480 screen, so **1 video px ≈ 1.45 game px vertically**).

Frames were decoded in the browser (seek, draw to a canvas, read pixels) and
analysed numerically:

* **The Pegasus/kitten** — pixels with `R − B > 45, R > 95` (orange fur against a
  blue-grey sky). Centroid tracked per frame.
* **The clouds** — a brightness threshold plus connected-component labelling.
  This matters: the sky has *two* cloud layers. The soft hazy bands are a
  **fixed wallpaper** that never scrolls (row-profile cross-correlation across the
  whole shot returns `dy = 0` with NCC 0.97). The crisp white blobs of ~250–340 px
  are the **scrolling platform sprites**. Only the big blobs carry camera motion.

The usable continuous gameplay shot runs **t = 23.8 s → 27.1 s** (3.3 s), sampled
at 1/15 s.

## What came out

| Quantity | Measured | Notes |
| --- | --- | --- |
| Bounce period | **≈ 1.0 s** | Bounces at t ≈ 24.50, 25.50, 26.37 s |
| Peak camera climb rate | 18 video px per 1/15 s = 270 video px/s | ≈ 390 game px/s |
| Net climb per bounce | ≈ 67 video px | ≈ 0.2 screen heights ≈ 97 game px |
| Mean climb rate | ≈ 70 video px/s | ≈ 100 game px/s |
| Player's on-screen height | cy oscillates 0.39 → 0.50 | camera anchors the player ≈ 42 % down |
| Horizontal traverse | 0.24 → 0.76 screen widths in 1.4 s | ≈ 0.95 screen widths/s at full tilt |
| Time to reach full tilt speed | ≈ 0.2 s | the on-screen x curve eases in and out |
| Cloud horizontal drift | ≈ 0 in this shot | matched blobs gave `dx ≈ ±0.3 px`; drift is treated as a difficulty ramp |

Deriving the arc from a symmetric 1.0 s hop:

```
apex h ≈ 110 px          (consistent with the ~97 px net climb per bounce)
g = 8h / T²  = 8 × 110 / 1.0²  ≈ 880 px/s²
v0 = g T / 2 = 880 × 1.0 / 2   ≈ 440 px/s
```

## Scaling to this project

The original screen was 320 x 480. Pegasus Jump runs at **540 x 960**.

* Vertical values are scaled by the **height** ratio `960 / 480 = 2`, which keeps
  the hang time identical (period stays 0.98 s).
* Horizontal values are scaled by the **width** ratio `540 / 320 = 1.6875`, which
  keeps the time to cross the screen identical (≈ 1.07 s).

| Constant | Original | Pegasus Jump |
| --- | --- | --- |
| Gravity | 880 px/s² | **1800 px/s²** |
| Bounce velocity | 440 px/s | **880 px/s** |
| Jump apex | 110 px | **215 px** |
| Hang time | 1.0 s | **0.98 s** |
| Max steer speed | 300 px/s | **506 px/s** |
| Climb per bounce | ~97 px | **~195 px** |

## Caveats

* The camera in the original lags the player (a smoothed follow), so the raw
  on-screen arc is asymmetric — apex at ~0.74 of the period rather than 0.5.
  The numbers above come from the *integrated camera scroll*, which cancels that
  lag out, not from the on-screen position.
* Only one clean 3.3 s shot was long enough to integrate; the night-level shots
  (t ≈ 36–43 s) were not re-measured.
* Cloud drift is the one mechanic the trailer does not show. It is implemented as
  a ramp that starts at zero, which matches the measurement *and* the described
  memory of clouds sliding off-screen later on.
