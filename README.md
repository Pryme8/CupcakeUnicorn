# CupcakeUnicorn

A playful unicorn mini-game built with Vue 3, TypeScript, and Vite.

![Header image](docs/images/header.png)

## Origin

This project was directed by my six year old as part of her birthday celebration. Everything here was AI generated, including the code and assets.

## Open Source

This project is open source and free to use under the MIT license.

![Gameplay screenshot](docs/images/gameplay.png)

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
