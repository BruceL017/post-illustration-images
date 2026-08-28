---
prompt_examples:
  - prompt: Here is my WeChat article. Create a few illustrations for it.
    scene: Illustrate a WeChat article
  - prompt: Create a Xiaohongshu cover and body carousel built around a before-and-after comparison.
    scene: Create a Xiaohongshu set
  - prompt: Use weibo-signal-core to make a vertical technical explainer for this Weibo post.
    scene: Use a selected style
  - prompt: Restore the existing 01-cover without regenerating it.
    scene: Restore an existing image
  - prompt: Add one summary image using the current style.
    scene: Continue with one image
---

[中文](./README.md) | English

# Post Illustration Images

A stable content-illustration workflow for WeChat official accounts, Xiaohongshu, Zhihu, Weibo, and Toutiao. It reads the source content before selecting a registered style, building a shot list, generating one image at a time, and validating geometry and quality.

## Core capabilities

- **Content-driven planning**: analyzes the source first, then selects content anchors and expression structures; each image carries one core meaning.
- **Managed styles**: one `style_spec` controls the full set, while the registry owns platform routing, aspect ratio, colors, layout, safe areas, and fixed components.
- **One image at a time**: compiles, generates, and validates a separate prompt for every image instead of asking the model for a complete carousel.
- **Single image artifact**: accepted images go directly under `images/` with their native extensions and no duplicate copy.
- **Native pixel preservation**: accepted images are not cropped, padded, stretched, upscaled, or forced to the Style Spec's design dimensions.
- **Targeted continuation**: can restore a source, regenerate one image, or append one image without rebuilding the whole set.
- **Orchestrator contract support**: can act as the `illustration-v2` provider for `content-production-provider/v1`, with strict path, hash, and artifact allowlist enforcement in plan or generate mode.

## Registered styles

The registry currently contains eight styles across five platforms:

| Platform | `style_id` | Default ratio | Purpose |
|---|---|---:|---|
| WeChat | `wechat-doodle` | 4:3 | Warm, hand-drawn article illustrations |
| Xiaohongshu | `xhs-explainer-notebook` | 3:4 | Notebook explainers and carousels; platform default |
| Xiaohongshu | `xhs-cream-paper` | 3:4 | Cream-paper hand-drawn infographics |
| Xiaohongshu | `xhs-orange-card` | 3:4 | Warm orange torn-paper knowledge cards |
| Xiaohongshu | `xhs-vibrant-scrapbook` | 3:4 | Vibrant scrapbook explainers, processes, and checklists |
| Zhihu | `zhihu-tech` | 16:9 | Modern technical infographics |
| Weibo | `weibo-signal-core` | 3:4 | Dark red-signal technical concepts and process explainers |
| Toutiao | `toutiao-luminous-tech` | 16:9 | Luminous technical flows and mechanism explainers |

[`references/style-registry.json`](./references/style-registry.json) is authoritative. [`references/style-index.md`](./references/style-index.md) is its generated human-readable view.

## Execution modes

- **Standalone mode**: normal illustration requests run the complete workflow and write to `post-illustration-output/<content-slug>/`.
- **Orchestrated mode**: structured requests carrying provider markers must follow [`references/orchestrated-provider.md`](./references/orchestrated-provider.md). The plan pass produces only a plan and shot list; an approved generate pass creates the images. Results stay under the orchestrator's `07-visual/<platform>/` directory before control returns to the orchestrator.

The modes never fall back into each other. An invalid or conflicting provider request returns a structured `BLOCKED` result instead of silently switching to standalone output.

## Workflow

1. Resolve the platform, source content, output type, and image ceiling.
2. Preflight a runtime-native image tool or an already-configured API backend.
3. Analyze the content, select a registered platform style, and resolve the `gpt-image-2` request geometry.
4. Select content anchors, save `shot-list.md`, and compile one prompt per image.
5. Generate and validate one image at a time, using the first image as a canary before continuing.
6. Save the accepted backend artifact directly with its native extension.
7. Complete content, style, originality, geometry, and set-level QA, then write `manifest.md`.

## Output structure

A completed standalone run writes to the user's project, never into the skill directory:

```text
post-illustration-output/<content-slug>/
├── shot-list.md
├── prompts/
│   └── 01-cover.md
├── images/
│   └── 01-cover.<native-ext>
└── manifest.md
```

Accepted images are written directly under `images/` with their native extension and no redundant re-encoded copy.

Orchestrated mode writes only the request's authorized `expected_artifacts`. It uses `plan.json`, `shot-list.md`, `bundle.json`, the native `manifest.md`, prompts, and images, with SHA-256 lineage across the final draft, title selection, approved plan, and delivered artifacts.

## Requirements and boundaries

- Requires a verifiable runtime-native image tool or an API image backend already configured in the current environment.
- The bundled geometry profile applies only to a verified, available `gpt-image-2` channel and is never reused for another model.
- Pure photography, portrait retouching, product renders, photoreal campaigns, and images requiring exact long-form text are out of scope.
- A requested image count is a target or ceiling, not a quota; the workflow does not invent filler images when the content lacks enough anchors.
- A `style_reference` is used for QA only. It is never a generation input, and its topic, copy, source identity, or exact layout must not be reproduced.

## Local maintenance

The repository has no runtime npm installation step. After changing styles or contracts, run the same checks used by CI:

```bash
node --test tests/generation-geometry.test.mjs tests/style-bundle.test.mjs
node --test tests/provider-contract.test.mjs
node scripts/validate-style-bundle.mjs --installed
```

Key directories:

- `SKILL.md`: complete workflow and non-negotiable rules
- `references/styles/`: human-readable styles and machine-readable Style Specs
- `references/style-registry.json`: platform and style registry
- `references/orchestrated-provider.md`: orchestrated provider contract
- `scripts/`: style validation, geometry resolution, and provider contract tools
- `assets/style-references/`: long-lived QA reference images
