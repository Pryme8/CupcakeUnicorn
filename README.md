# CupcakeUnicorn

A playful unicorn mini-game built with Vue 3, TypeScript, and Vite.

![Header image](docs/images/header.png)

## Origin

This project was directed by my six year old as part of her birthday celebration. Everything here was AI generated, including the code and assets.

## Open Source

This project is open source and free to use under the MIT license.

![Gameplay screenshot](docs/images/gameplay.png)

## Levels

The game rotates through eight levels forever, carrying each player's score along. Nobody ever loses; every level is about collecting as many sparkles as you can. Player 1 uses WASD and player 2 the arrow keys; `W` / `Up` is the "magic key" in every level, and tapping your side of the screen does the same thing.

1. **Cupcake Chase** - the platform level. Collect every pickup to finish the round.
2. **Pegasus Flight** - a side-scrolling flappy level. Flap and follow the trail of stars to the rainbow cloud. Two players get a split screen.
3. **Rainbow Garden Maze** - a top-down hedge maze, generated fresh each time. Pickups hide in the dead ends and the rainbow cloud in the middle is worth a bonus.
4. **Cupcake Catch** - one unicorn drops cupcakes from a cloud ledge, the other catches them below. Every catch scores for the whole team and the roles swap halfway. Solo players catch what the Rainbow Cloud drops.
5. **Tug of Rainbow** - tap your magic key fast to pull the star knot past your flag. Best of three, with a friendship bonus for everyone at the end. Solo players tug against the Rainbow Cloud.
6. **Mirror Dance** - the leader makes up a little dance on a 3x3 floor, then the follower copies it. Arrows show the steps, so it's about matching, not memory. The leader swaps every time the level comes around; solo players copy a ghost unicorn.
7. **Balloon Pop** - both unicorns get their wings back and share one sky. Fly into balloons to pop them (gold star balloons are worth three). Bumping into each other just bounces you apart.
8. **Fruit Dash** - an auto-running side level where the only control is jump. Run through fresh fruit for a point, jump over rotten fruit for a bonus. Touching rotten fruit only earns a "Yuck!" wobble and a moment of slow-down. Two players get stacked full-width lanes.

### Difficulty

Every full lap through the eight levels turns the difficulty up a notch, and the level banner says so ("Lap 2: a bit trickier!"). Platforms move more, the Pegasus path gets wilder, the maze has fewer shortcuts, cupcakes fall faster, the Rainbow Cloud tugs harder, dances get longer, balloons rise faster, and the fruit run speeds up with more rotten fruit. It stops climbing after the fifth lap so it never becomes unfair. The tier logic is `difficultyTier` in `src/game/levels.ts`.

The level order lives in `src/game/levels.ts`; shared helpers (banners, sparkles, keys, unicorn actors, scoring, level hand-off) are in `src/game/levelKit.ts`. Wings, clouds, balloons and other extra art are drawn procedurally, so no new image assets were needed.

Tip for testing: open the dev server with `?level=N` to jump straight to that level (`?level=14` is Mirror Dance on its second pass, with the other player leading).

## Development

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

## Itch.io HTML5 Build

This project is configured to meet itch.io HTML5 ZIP requirements and common pitfalls:

- Relative paths are enforced in the build via `base: './'` in Vite.
- `index.html` remains the entry file at the ZIP root.
- File names are case-sensitive on itch.io, so keep references exact.
- Avoid absolute URLs or non-HTTPS external resources.
- Keep the final ZIP under itch.io limits (<= 1,000 files, 500MB total, 200MB per file, max 240-char paths).

Recommended upload steps:

1. Run `npm run build`.
2. Zip the *contents* of `dist/` (not the folder itself) so `index.html` is at the ZIP root.
3. Upload the ZIP to itch.io as an HTML5 game.
