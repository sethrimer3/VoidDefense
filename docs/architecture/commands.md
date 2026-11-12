# Test and Tool Commands

Per-feature test commands and verification scripts for Void Defense.

## Automated Test Suite

Runs all Node unit and integration tests directly without compilation:

```sh
npm test
# Equivalent to:
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/*.test.ts
```

### Focused Unit Tests

Run individual tests or pattern matches using the pinned random seed harness:

```sh
# Core Void Defense simulation, towers, physics, resistance operations, tech wallet, saves
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/void-defense.test.ts

# Cosmic enemy contours, living interior wisps, Queen Bee and Bee Swarm noise outlines
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/void-visuals.test.ts

# Portal noise regression (smooth cubic value noise with ridged multifractals)
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/portal-noise.test.ts

# Subterranean ledge strata generation and Void clipping
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/void-ledge.test.ts

# 3D oblique building elevation, sprite cache, and roof picking
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/void-depth.test.ts

# Sole-game bootstrap, legacy settings migration, and save isolation
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/bootstrap.test.ts

# Display and gameplay settings encoding/decoding
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/settings.test.ts

# Callsign and banner profile persistence
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/profile.test.ts

# Deterministic random streams
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/random-streams.test.ts

# Magic circle geometry and Voronoi tessellations
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/magic-circle.test.ts

# Alembic pixel font integrity
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/pixel-font.test.ts

# Sound asset catalog validation
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/sound-files.test.ts

# Golden motes in tech DAG upgrade graph
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/tree-motes.test.ts

# Script bootstrap safety guard
node --experimental-transform-types --import ./tests/pin-random.ts --test tests/boot-guard.test.ts
```

## Browser Verification Scripts

Requires `npm run dev` running on `http://127.0.0.1:5173/` (or specify `TEST_URL`). Supports `PLAYWRIGHT_CHANNEL` (e.g. `chrome`, `msedge`) and `PLAYWRIGHT_EXECUTABLE`.

```sh
# Verify 1:1 simulation cell to raster pixel rendering and camera input across viewports
npm run test:pixels
# node tests/void-pixels.mjs

# Verify native-cell art, non-antialiased primitive rendering, and integer zoom
npm run test:crisp
# node tests/void-crisp.mjs

# Verify exposed subterranean strata, dark ledge underside, and simulation isolation
npm run test:ledge
# node tests/void-ledge.mjs

# Verify living Void interior wisps, nebula contours, Queen Bee & swarm noise outlines
npm run test:visuals
# node tests/void-visuals.mjs

# Verify 3D oblique building depth, ringed building occlusion, and elevation modes
npm run test:depth
# node tests/void-depth.mjs

# Verify full browser gameplay flow, HUD, towers, strikes, pause/speed controls, and QA benchmark
npm run test:defense
# node tests/void-defense.mjs
```

## Typography

Rebuild the custom Alembic pixel font TrueType files from source glyph pixel rows:

```sh
npm run font
# node --experimental-transform-types scripts/pixel-font/build.ts
```
