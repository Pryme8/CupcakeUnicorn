# Babylon.js FBX Importer: Implementation Plan

Status: proposal, 2026-09-12
Target: `@babylonjs/core` 9.x, ES module, TypeScript, zero runtime dependencies
Goal: a scene-loader plugin that reads every FBX file the Autodesk FBX SDK can read, and maps every feature FBX carries onto the closest Babylon concept, preserving the rest as metadata.

---

## 0. Ground truth before we start

**What "all FBX features" really means.** FBX is a proprietary, undocumented container. There is no spec. The de-facto read-side reference is Autodesk's closed-source SDK, and the only open implementation with credible parity is ufbx (C, MIT/Unlicense, fuzzed, used by Blender 5.0's new importer). The feature list below is derived from the FBX SDK object model and ufbx's coverage. Anything not on the list is, by definition, not a feature that any importer supports.

**Nothing in the Babylon ecosystem is close.** The three community loaders (Benjythebee, ci4anish, imarabinda) all descend from the Babylon.js Editor loader: meshes, skinning, and a subset of animation. None load materials or textures, none handle ASCII, pivots, geometric transforms, in-between blend shapes, animation layers, NURBS, constraints, or legacy versions. We should not fork them. Their value is a few Babylon-side mapping snippets.

**Babylon has no concept for several FBX features.** NURBS, subdivision surfaces, constraints, animation layers with blend modes, in-between morph targets, geometry caches, and character definitions have no first-class target. Each needs a defined strategy: tessellate, bake, emulate at runtime, or pass through as metadata. That list is in section 3.

**Key architectural decision: pure TypeScript vs ufbx compiled to WebAssembly.**

| | Pure TypeScript | ufbx via WASM |
|---|---|---|
| Time to full coverage | 6 to 9 months, one experienced engineer | 6 to 10 weeks |
| Fidelity | Whatever we achieve | Matches FBX SDK output |
| Bundle | Tree-shakable, ~150 KB | ~600 KB wasm plus JS glue |
| Upstreamable to `@babylonjs/loaders` | Yes (all Babylon loaders are pure TS) | Unlikely |
| Debuggability | Full | Opaque inside wasm |
| Risk | Format edge cases we never see | Emscripten toolchain, memory copies |

**Recommendation: build it in pure TypeScript, and use ufbx as the test oracle.** Every layer of our parser is validated against ufbx's output on a corpus of several hundred real-world files. This gives us SDK-level fidelity without shipping wasm, and it is the only route that could ever be merged into Babylon proper. The plan below is written for this route. If the schedule proves unacceptable, the Babylon-builder layer (section 2, layer C) is designed to accept a ufbx-wasm backend instead, so switching is a contained change.

---

## 1. Requirements

### 1.1 Functional

- Load `.fbx` files, binary and ASCII, all versions from 5.x through the current 7.7 (file version 7700), including 64-bit record headers introduced in 7.5.
- Implement `ISceneLoaderPluginAsync` and `ISceneLoaderPluginFactory`, so `ImportMeshAsync`, `AppendSceneAsync`, and `LoadAssetContainerAsync` all work with no extra ceremony.
- Correctly produce: transform hierarchy, meshes, materials, textures, cameras, lights, skeletons, skinning, morph targets, animation groups, LOD levels.
- Preserve everything Babylon cannot represent on `metadata` in a documented, stable schema.
- Never throw on malformed input in a way that leaks state; return structured warnings.

### 1.2 Non-functional

- Zero runtime dependencies. Inflate via `DecompressionStream` with a bundled fallback inflater for environments that lack it.
- Parse a 100 MB binary file in under 3 seconds on a desktop, in a worker if the host opts in.
- Memory: no more than 3x file size peak during parse.
- Deterministic output: same file, same Babylon object graph, same names and ordering.
- Tree-shakable: NURBS tessellation, subdivision, constraint solver, and ASCII parsing are separate entry points.

### 1.3 Explicit non-goals for v1

- Writing FBX.
- Streaming or partial loads. FBX has no streaming structure.
- Running FBX SDK-style Python/MEL embedded scripts.

---

## 2. Architecture

Four layers, each with its own test suite and its own oracle comparison.

```
 .fbx bytes
    │
    ▼
 A. Tokenizer / record reader        binary + ASCII  →  raw node tree (FbxNode[])
    │
    ▼
 B. Document model                   raw tree  →  typed objects, connections, resolved properties
    │
    ▼
 C. Scene resolver                   objects  →  evaluated transforms, unified geometry, material model,
    │                                              animation curves normalised to seconds and quaternions
    ▼
 D. Babylon builder                  resolved scene  →  TransformNode, Mesh, Skeleton, Material, AnimationGroup...
```

Layers A through C are Babylon-agnostic and become their own package (`fbx-core`) so they can be reused by a future exporter, a CLI converter, or a three.js port. Layer D is the plugin.

### Layer A: Record reader

- Detect format by magic. Binary: `Kaydara FBX Binary  \0` followed by version uint32. Otherwise ASCII.
- Binary records: end offset, property count, property list length, name, properties, nested records, null-record terminator. Widths switch to 64-bit at version 7500.
- Property types: `Y S C I F D L` scalars, `R` raw, `S` string, `f d l i b c` arrays with optional zlib deflate (encoding 1).
- ASCII: hand-written tokenizer. Handles `*N { a: ... }` arrays, quoted strings with embedded quotes, comments, `Properties70` vs `Properties60`, and the version 6 `Takes` block.
- Output is a plain tree with lazy array decoding, so a 100 MB file does not decode arrays nobody reads.
- Footer: validate the 16-byte footer id and padding. Detect the encrypted variant and fail with a clear error.

### Layer B: Document model

- `FBXHeaderExtension`, `GlobalSettings`, `Documents`, `Definitions` (property templates per object type), `Objects`, `Connections`, `Takes` (legacy).
- Every object gets a numeric id, class, subclass, and a property bag. Property resolution order: object's own `Properties70`, then the `PropertyTemplate` for its class, then hard-coded SDK defaults (we must ship the SDK default table because many exporters omit properties equal to the default).
- Connections: `OO` object-to-object, `OP` object-to-property (with property name), plus the rare `PO` and `PP`. Build forward and reverse adjacency.
- Version 6 and 5 files store properties and animation differently; layer B normalises them to the 7.x shape so nothing downstream cares.

### Layer C: Scene resolver

This is where FBX semantics live. It is the hardest layer and gets the most tests.

- **Transforms.** Implement the full FBX node transform formula: `T · Roff · Rp · Rpre · R · Rpost⁻¹ · Rp⁻¹ · Soff · Sp · S · Sp⁻¹`, with rotation order (six Euler orders plus spheric), `InheritType` (RrSs, RSrs, Rrs), `RotationActive`, and geometric transforms applied to geometry rather than to children.
- **Units and axes.** Read `UnitScaleFactor`, `UpAxis`, `FrontAxis`, `CoordAxis` and signs. Produce a root conversion matrix. Babylon is left-handed Y-up by default and can be right-handed; the resolver emits data in FBX's native frame and the builder applies the conversion at the root, the same way the glTF loader does.
- **Geometry unification.** FBX stores every attribute in its own layer element with its own mapping mode (`ByVertice`, `ByPolygonVertex`, `ByPolygon`, `ByEdge`, `AllSame`) and reference mode (`Direct`, `IndexToDirect`). The resolver flattens all layers to per-polygon-vertex attributes, then generates a deduplicated vertex/index buffer. N-gons are triangulated with ear clipping (concave and non-planar polygons occur in real files).
- **Animation.** Convert `KTime` (int64, 46,186,158,000 ticks per second) to seconds. Evaluate curves with the SDK's exact interpolation rules: constant (standard and next), linear, cubic with auto, TCB, user, and break tangents, weighted tangents, and velocity. Compose per-axis Euler curves with pre/post rotation into quaternion keys, with an unroll filter so flips never happen. Resolve animation layers with weight, mute, solo, additive and override blend modes, and rotation/scale accumulation modes.
- **Materials.** Normalise Lambert, Phong, and every known vendor shading model into one intermediate material description with a "classic" side and a "PBR" side, following ufbx's approach.

### Layer D: Babylon builder

- Walks the resolved scene and instantiates Babylon objects into an `AssetContainer`, then either adds them to the scene or returns the container.
- Mesh instancing: one FBX geometry connected to N models becomes one `Geometry` shared by N meshes, or `InstancedMesh` when materials match, controlled by an option.
- Name filtering for `importMeshAsync(meshesNames)`.
- Progress events at parse, resolve, and build milestones.
- Never touches the scene until build succeeds, so a failed load leaves no partial objects.

---

## 3. Feature matrix

Every row is a work item with an acceptance test. "Target" is the Babylon object. "Metadata" means preserved under `node.metadata.fbx` because Babylon has no equivalent.

### 3.1 File and document

| FBX feature | Target | Notes |
|---|---|---|
| Binary 7.0 to 7.7 | parse | 32-bit and 64-bit record headers |
| Binary 6.x | parse | Different property and animation layout |
| Binary 5.x | parse | Rare, but the SDK reads them; ufbx does from 3000 |
| ASCII 6.x and 7.x | parse | `canDirectLoad` on text data |
| zlib-compressed arrays | parse | `DecompressionStream`, fallback inflater |
| Encrypted files | error | Detect, refuse with a clear message |
| Embedded media (`Video.Content`) | `Texture` from blob | Also `.fbm` sidecar folders |
| `Definitions` property templates | resolver | Required for default values |
| `GlobalSettings` | root transform, `scene.metadata` | Units, axes, time mode, ambient colour, default camera |
| `SceneInfo`, `DocumentInfo`, thumbnails | metadata | Author, tool, creation time |
| Multiple `Documents` | first document | Warn if more than one |
| User-defined properties on any object | metadata | Typed: bool, int, enum, double, vector, colour, string, datetime, object ref |

### 3.2 Nodes and hierarchy

| FBX feature | Target | Notes |
|---|---|---|
| `Model` hierarchy | `TransformNode` / `AbstractMesh` | Names deduplicated with a stable suffix |
| Local T, R, S with rotation order | node transform | All six orders plus spheric XYZ |
| Pre-rotation, post-rotation | baked into rotation quaternion | Also affects animation composition |
| Rotation and scaling pivots and offsets | baked | Optionally kept as extra `TransformNode` levels for editing round-trips |
| Geometric T, R, S | applied to vertex data | Very common from 3ds Max |
| `InheritType` RrSs, RSrs, Rrs | resolver | Rrs cannot be expressed by a single hierarchy; handled by baking world transforms with a warning |
| Visibility, visibility inheritance | `isVisible`, `setEnabled` | Animated visibility becomes an `Animation` on `visibility` |
| `Null`, `Root`, `Marker`, `CameraSwitcher` | `TransformNode` | Type recorded in metadata |
| `LodGroup` | `mesh.addLODLevel` | Thresholds in FBX distance units, converted; `LODBox` mode noted |
| Display layers, selection sets | metadata | Plus `mesh.layerMask` option |

### 3.3 Geometry

| FBX feature | Target | Notes |
|---|---|---|
| Vertices, `PolygonVertexIndex` n-gons | `VertexData` | Triangulation, negative index end markers |
| Normals, binormals, tangents | vertex buffers | Generate when missing; option to always regenerate |
| Multiple UV sets, named | `uv` through `uv6` | Set name to slot mapping recorded for texture binding |
| Vertex colours (RGBA) | `color` | Multiple colour layers: first to `color`, rest to metadata or extra buffers |
| Material layer, per-polygon | `SubMesh` + `MultiMaterial` | Split by material id; single material uses no `MultiMaterial` |
| Smoothing groups, edge and vertex creases, holes, polygon groups | metadata, used by normal generation | Creases feed the subdivision evaluator |
| Edges | metadata | Available for wireframe or line rendering |
| Mesh instancing | shared `Geometry` or `InstancedMesh` | |
| Blend shapes and channels | `MorphTargetManager` | Positions, normals, tangents |
| In-between blend shape targets | multiple `MorphTarget` with piecewise weight animation | Babylon only interpolates linearly; documented emulation |
| NURBS curves, surfaces, trim surfaces, patches | tessellated `Mesh` or `LinesMesh` | Separate entry point; control-point data kept in metadata |
| `Line` | `LinesMesh` | |
| Subdivision surfaces | optional Catmull-Clark evaluator | Off by default; `PreviewDivisionLevels` respected when on |
| Geometry caches (`.pc2`, `.mc`, `.mcx`) | vertex animation | Implemented as per-frame morph targets or a custom `VertexAnimationBaker` path; behind an option |

### 3.4 Materials and textures

| FBX feature | Target | Notes |
|---|---|---|
| `FbxSurfaceLambert` | `StandardMaterial` | Diffuse, ambient, emissive, transparency, bump |
| `FbxSurfacePhong` | `StandardMaterial` | Adds specular, shininess, reflection |
| Colour and factor pairs | multiplied | `Diffuse × DiffuseFactor` and so on |
| Autodesk Standard Surface, Arnold, OpenPBR | `PBRMaterial` | Base, metalness, roughness, specular, coat, sheen, transmission, emission |
| Maya Stingray PBS | `PBRMaterial` | Metallic/roughness workflow |
| 3ds Max Physical Material | `PBRMaterial` | |
| glTF material properties (Maya glTF exporter) | `PBRMaterial` | |
| Unknown shading models | `StandardMaterial` from Lambert-compatible props | Raw properties in metadata |
| Option: force PBR for all materials | `PBRMaterial` | Phong to PBR conversion via specular-glossiness path |
| `Texture` node | `Texture` | Wrap modes, UV translate/rotate/scale, UV set selection, alpha source, premultiplied alpha, cropping |
| `LayeredTexture` | first layer plus metadata | Blend modes cannot be expressed; option to bake layers on a canvas |
| Texture to property connections (`OP`) | material slots | Diffuse, specular, emissive, bump/normal, transparency, reflection, displacement, and PBR slots |
| Normal map vs bump map detection | `bumpTexture` with `invertNormalMapY` | Height maps flagged, not converted |
| Texture file resolution | absolute, relative, basename, `.fbm`, embedded, case-insensitive fallback | Pluggable resolver callback |
| TGA, DDS, EXR, TIFF, PSD | Babylon texture loaders where they exist | TIFF and PSD produce a warning and a placeholder |

### 3.5 Cameras and lights

| FBX feature | Target | Notes |
|---|---|---|
| Perspective camera | `FreeCamera` / `TargetCamera` | FOV from `FieldOfView`, `FocalLength` + film gate, or `FieldOfViewX/Y` per `ApertureMode`; horizontal to vertical conversion |
| Orthographic camera | `FreeCamera` with `ORTHOGRAPHIC_CAMERA` | `OrthoZoom` |
| Near, far, aspect, film offset, gate fit, roll, up vector, interest position | camera props | Interest becomes target |
| Stereo camera | two cameras | Metadata for rig |
| `CameraSwitcher` | metadata | Selected camera index |
| Point, directional, spot lights | `PointLight`, `DirectionalLight`, `SpotLight` | FBX lights aim down local -Y; a corrective rotation is inserted |
| Area lights | `RectAreaLight` | Babylon 8+ area light; shape recorded |
| Volume lights | `PointLight` plus metadata | No Babylon equivalent |
| Intensity, colour, decay type and start, near/far attenuation | light props | FBX intensity 100 equals Babylon 1.0; decay mapped to `falloffType` where possible |
| Inner and outer cone angles | `SpotLight.angle`, `innerAngle` | |
| Shadow flags, exclude lists | metadata | Shadow generators are a consumer decision |

### 3.6 Deformers and skeletons

| FBX feature | Target | Notes |
|---|---|---|
| `LimbNode`, `Limb`, `Root` bones | `Skeleton` + `Bone` linked to `TransformNode` | One skeleton per skin root; shared skeletons when clusters overlap |
| `Skin` deformer, `Cluster` indexes and weights | `matricesIndices`, `matricesWeights` | Up to 8 influences (`matricesIndicesExtra`), normalised, option to cap at 4 |
| `Transform`, `TransformLink`, `TransformAssociateModel` | bind matrices | Correctly handles skin on a node with its own transform |
| `SkinningType` Rigid, Linear, DualQuaternion, Blend | Linear; DQ via custom shader path | DQ is a stretch item, flagged in metadata |
| `BindPose`, `RestPose` | rest matrices | Fallback when clusters lack `TransformLink` |
| Multiple skins on one mesh | merged | Warn |
| Skin on non-mesh geometry (NURBS) | applied post-tessellation | |

### 3.7 Animation

| FBX feature | Target | Notes |
|---|---|---|
| `AnimationStack` | `AnimationGroup` per stack | Local and reference time spans set `from`/`to` |
| `AnimationLayer` weight, mute, solo | merged, or one group per layer with `isAdditive` | Option: `layerMode: "merge" | "separate"` |
| Additive vs override blend, accumulation modes | resolver | Merge mode evaluates to baked keys; separate mode maps additive layers to Babylon additive groups |
| `AnimationCurveNode` on any property | `Animation` targeting that property | Transforms, visibility, morph weights, material colours, light intensity, camera FOV, user properties |
| Curve interpolation: constant, linear, cubic | `ANIMATIONTYPE` interpolation with `inTangent`/`outTangent` | Cubic auto and user tangents map to hermite; TCB, weighted, and velocity keys are resampled |
| Euler rotation curves with pre/post rotation | `rotationQuaternion` keys | Composed and unrolled; option to keep Euler on `rotation` |
| Time modes and custom frame rates | seconds, `framePerSecond` on the group | |
| Legacy `Takes` (6.x) | `AnimationGroup` | Channel-based key format |
| Option: bake all curves at N fps | uniform keys | Simplest for game runtimes |
| Option: strip constant curves | | Reduces group size significantly |

### 3.8 Constraints, characters, misc

| FBX feature | Target | Notes |
|---|---|---|
| Aim, Parent, Position, Rotation, Scale, Single-chain IK constraints | runtime `FbxConstraintSolver` observable on `onBeforeRenderObservable`, or baked into animation | Separate entry point |
| `Character` / HumanIK definitions | metadata | Enables retargeting tools later |
| `Pose` nodes | metadata plus skeleton rest pose | |
| `Implementation`, `BindingTable`, `BindingOperator` (shader networks) | metadata | Used by some CgFX and OSL workflows |
| Audio, video clips | metadata | |
| `CollectionExclusive`, `Collection` | metadata | |
| `Thumbnail` | metadata (base64) | |

---

## 4. Plugin API

```ts
import { RegisterSceneLoaderPlugin } from "@babylonjs/core/Loading/sceneLoader";
import { FBXFileLoader } from "@babylonjs/fbx-loader";   // working package name

RegisterSceneLoaderPlugin(new FBXFileLoader());

const result = await ImportMeshAsync("model.fbx", scene, {
  pluginOptions: {
    fbx: {
      targetUnit: "meter",                 // scale from file units
      coordinateSystem: "babylon",         // or "preserve"
      materials: "auto" | "standard" | "pbr",
      animation: { layerMode: "merge", bake: false, stripConstant: true },
      skinning: { maxInfluences: 8 },
      instancing: "geometry" | "instancedMesh" | "none",
      nurbs: { tessellate: true, subdivisions: 16 },
      subdivision: { evaluate: false },
      textureResolver?: (name, ctx) => Promise<string | Blob | null>,
      useWorker: false,
      onWarning?: (w: FbxWarning) => void,
    }
  }
});
```

Options are typed through module augmentation of `SceneLoaderPluginOptions`, the same mechanism the glTF loader uses. Warnings are structured `{ code, message, objectId, objectName }`, also collected on `result.metadata.fbx.warnings`.

Additional exports from `fbx-core`: `parseFbx(bytes)`, `resolveFbx(doc)`, `inspectFbx(bytes)` for a tree dump, and a CLI `fbx-inspect` for debugging user reports.

---

## 5. Testing strategy

This is the half of the project that determines whether "all features" is a claim or a fact.

### 5.1 Corpus

- ufbx's test data directory: several hundred files from Maya, 3ds Max, Blender, MotionBuilder, Unity, Unreal, Marvelous Designer, Mixamo, in binary and ASCII across versions 5000 to 7700. Public, redistributable.
- three.js and Blender test files.
- A curated "weird" set: 3ds Max geometric transforms, Maya pivots and pre-rotation, Rrs inherit type, Z-up files, files with multiple UV sets and colour layers, in-between blend shapes, weighted tangents, TCB keys, constraints, NURBS trims, embedded textures, 64-bit headers, concave n-gons.
- Synthetic files generated by a small writer used only in tests, to cover combinations no DCC produces.

### 5.2 Oracle testing against ufbx

- A Node script uses ufbx's Python bindings (`pip install ufbx`) to dump each corpus file to JSON: node world matrices, unified vertex data checksums, material property values, evaluated animation samples at fixed times, skin weights, blend shape offsets.
- Tests parse the same file with `fbx-core` and compare with tolerances (1e-5 for matrices, 1e-4 for vertex positions after unit conversion).
- Any divergence is a bug in our parser until proven otherwise. This is the single most important test suite.

### 5.3 Babylon-level tests

- `NullEngine` structural tests: object counts, names, hierarchy, bone counts, animation group ranges, submesh splits.
- Headless WebGL screenshots via Playwright for a subset of 40 files, compared against golden images with a perceptual threshold. Catches winding, normals, UV flips, texture binding, and light direction errors that structural tests miss.
- Snapshot tests of `metadata.fbx` schemas so accidental changes are visible in review.

### 5.4 Robustness

- Property-based fuzzing with `fast-check`: truncated files, corrupted lengths, cycles in connections, huge counts, invalid UTF-8, mismatched array lengths. Every input must produce either a scene or a typed error within a bounded time.
- Memory tests on a 500 MB synthetic file.
- Benchmark suite recorded per commit.

---

## 6. Phases and milestones

Each phase ends with its oracle comparison green for the features it claims. Estimates assume one experienced engineer full-time.

| Phase | Scope | Exit criterion | Estimate |
|---|---|---|---|
| 0. Foundation | Repo, monorepo layout (`fbx-core`, `babylon-fbx-loader`, `tests`), vitest, tsup, corpus download script, ufbx oracle dumper, CI | Oracle dumps exist for the full corpus | 1 week |
| 1. Record reader | Binary all versions, ASCII, inflate, footer, lazy arrays, `fbx-inspect` CLI | Raw tree matches ufbx's raw dump for 100% of corpus | 3 weeks |
| 2. Document model | Objects, templates, defaults table, connections, 6.x/5.x normalisation | Property resolution matches oracle for every object | 2 weeks |
| 3. Transforms and hierarchy | Full transform formula, inherit types, units, axes, Babylon `TransformNode` builder, plugin skeleton with `ImportMeshAsync` working | World matrices match oracle within 1e-5; first playground demo | 3 weeks |
| 4. Meshes | Layer unification, triangulation, multi-material, instancing, normals and tangents, vertex colours, UV sets, geometric transforms | Vertex data matches oracle; screenshot tests for 20 files | 4 weeks |
| 5. Materials and textures | Lambert, Phong, vendor PBR models, textures, layered textures, embedded media, resolver callback | Material values match oracle; textured screenshot tests | 4 weeks |
| 6. Cameras and lights | All camera projection modes, all light types, corrective rotations | Screenshot tests with lit scenes and camera views | 1 week |
| 7. Skinning and skeletons | Clusters, bind poses, skeleton construction, 8 influences, association models | Skin weights and bind matrices match oracle; Mixamo characters pose correctly | 3 weeks |
| 8. Blend shapes | Channels, in-between emulation, normals and tangents deltas | Offsets match oracle | 1 week |
| 9. Animation | Curve evaluation with all tangent modes, Euler composition and unroll, layers, stacks, property animations, legacy takes, bake option | Sampled values match oracle at 1e-4 across corpus; screenshot tests at three time points | 5 weeks |
| 10. Advanced geometry | NURBS tessellation, lines, subdivision evaluator, LOD groups, geometry caches | Tessellated NURBS match ufbx's tessellation; LOD switching verified | 4 weeks |
| 11. Constraints and passthrough | Constraint solver, characters, poses, display layers, sets, shader bindings, metadata schema freeze | Constraint results match oracle evaluation | 2 weeks |
| 12. Hardening | Fuzzing, worker mode, memory, benchmarks, error taxonomy, docs, playground samples, npm publish, Babylon forum announcement and upstream proposal | Fuzz suite clean for 24 hours; docs complete | 3 weeks |

Total: about 36 weeks. Phases 4 and 5, and 7 through 9, can overlap across two engineers, bringing wall-clock time to roughly 24 weeks.

A usable importer for typical game assets (static meshes, materials, skinned characters, baked animation) exists at the end of phase 9, around week 26. The ufbx-wasm alternative reaches the same point in about 8 weeks, if that matters more than upstreamability.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| FBX is undocumented; edge cases exist only in real files | Wrong output on user files | Large corpus, oracle testing, `fbx-inspect` so users can attach dumps to bug reports |
| Rrs inherit type and animated pivots cannot be represented by a plain hierarchy | Animation looks wrong for some Maya rigs | Bake world transforms for those nodes, warn, and expose a "preserve pivots as extra nodes" mode |
| In-between blend shapes are not linear | Facial rigs distort | Piecewise weight emulation, documented; test with a Maya face rig |
| Weighted and TCB tangents have no exact Babylon equivalent | Subtle motion differences | Resample to dense hermite keys when non-representable; option to bake |
| Vendor material models keep appearing | New files look wrong | Property-name-driven mapping table that is easy to extend; unknown properties always land in metadata |
| Coordinate conversion mistakes are easy and silent | Mirrored or flipped scenes | Screenshot tests with asymmetric reference models from Y-up and Z-up sources, in both handedness modes |
| Large files and memory | Browser tab crashes | Lazy array decoding, transferable buffers in worker mode, memory tests |
| Legacy 5.x files are nearly extinct and hard to source | Untested code | Treat as best-effort, gated behind explicit tests from ufbx's corpus only |
| Scope creep from "all features" | Never ships | The feature matrix is the contract. Anything not on it is a new row with its own test, not an undocumented extra |

---

## 8. Repository layout

```
fbx/
  packages/
    fbx-core/            parser, document, resolver, tessellation, constraint solver (no Babylon import)
    babylon-fbx-loader/  plugin, builders, options, metadata schema
    fbx-inspect/         CLI
  tests/
    corpus/              downloaded by script, git-ignored
    oracle/              ufbx JSON dumps, generated
    unit/                per-layer tests
    visual/              Playwright screenshot tests and goldens
  playground/            Vite app for manual loading and comparison side-by-side with ufbx viewer
  docs/
```

This lives in its own repository. The CupcakeUnicorn game is a Phaser project and does not use Babylon, so the importer should not be nested here beyond this planning document.

---

## 9. Immediate next steps

1. Decide pure TypeScript vs ufbx-wasm. This plan recommends pure TypeScript with ufbx as oracle.
2. Create the repository and phase 0 tooling.
3. Download the ufbx corpus and generate the first oracle dumps, so phase 1 starts with tests already written.
4. Build the record reader and the inspect CLI; verify against every file in the corpus.

Sources consulted: Babylon.js scene loader type definitions for `@babylonjs/core` 9.x, the ufbx README and Blender's ufbx importer write-up, the Blender Foundation binary FBX specification, and the existing community Babylon FBX loaders.
