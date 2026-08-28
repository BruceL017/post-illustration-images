# Product Design: Post Illustration Images

## Purpose

`post-illustration-images` turns Chinese post content into stable AI-generated illustration assets for WeChat official account articles, Xiaohongshu notes, Zhihu posts, Weibo feed posts, and Toutiao posts.

The product goal is a repeatable image workflow:

```text
intake
-> generation backend preflight
-> content analysis
-> expression need
-> suite-level Style Spec
-> model-specific generation geometry
-> anchors
-> shot list
-> per-image structure and metaphor
-> first-image canary
-> remaining images one at a time
-> QA
-> saved assets
```

## Design Decisions

1. Style details live outside `SKILL.md`.
   - Full style prompts are stored in `references/styles/`.
   - `references/style-registry.json` is the machine-readable routing authority; `references/style-index.md` is its generated human-readable view.
   - `SKILL.md` only routes and enforces the process.

2. The suite-level Style Spec is selected before shot-list execution.
   - The style decides platform appearance, default image count, ratio, color values, typography, layout, safe areas, fixed components, and visual DNA.
   - Explicit user style/count instructions can override the default.

3. Style Reference images are QA baselines, not generation inputs.
   - Long-lived reference images live in `assets/style-references/`.
   - Each routed style has exactly one reference image.
   - Reference images are used for style drift review and prompt correction only. Their semantic content is ignored.
   - Canvas size, geometry, fixed components, and palette values come from the Style Spec.

4. Shot list is mandatory.
   - It is the stabilizing artifact between content understanding and image generation.
   - It prevents overstuffed images and repeated ideas.

5. Content expression structure and visual metaphor are separate.
   - Structure organizes information relationships.
   - Metaphor turns abstract content into a concrete scene.

6. Generation backend resolution is explicit and preflighted.
   - Valid backend kinds are a runtime-native image tool and an already-configured API image backend.
   - A configured API backend is execution infrastructure, not another image-generation skill.
   - Backend labels may describe an API dialect rather than the service operator, so endpoint and model availability come from active configuration and live metadata checks.
   - Missing shell variables do not prove that application-managed credentials are absent.
   - `references/generation-backends.md` owns backend resolution, secret safety, dynamic model checks, first-image canary behavior, output geometry, retry separation, and failure codes.
   - `scripts/resolve-generation-geometry.mjs` validates request geometry before generation.

7. Each accepted raster has one canonical image artifact.
   - Images live under `images/` or an attempt directory such as `images/v002/`.
   - Native pixel dimensions are preserved when ratio and minimum-edge checks pass.
   - Format or byte adaptation is allowed only for a verified publishing path and must preserve dimensions.

## Skill Folder Structure

```text
post-illustration-images/
  SKILL.md
  agents/
    openai.yaml
  assets/
    style-references/
      <style-id>.png
  scripts/
    generate-style-index.mjs
    install-style-bundle.mjs
    provider-contract.mjs
    resolve-generation-geometry.mjs
    validate-style-bundle.mjs
  references/
    content-structures.md
    generation-backends.md
    gpt-image-2-geometry.spec.json
    orchestrated-provider.md
    product-design.md
    prompt-compiler.md
    qa-checklist.md
    style-bundle-contract.md
    style-index.md
    style-registry.json
    styles/
      <style-id>.md
      <style-id>.spec.json
```

## Default Output Contract

Generated images are saved in the user's current project, not inside the skill folder:

```text
post-illustration-output/<content-slug>/
  shot-list.md
  prompts/
    01-topic.md
    02-topic.md
  images/
    01-topic.<native-or-required-export-ext>
    02-topic.<native-or-required-export-ext>
  manifest.md
```

`manifest.md` records:

- File, platform, known publishing path or `null`, Style Spec, and Style Reference
- Verified generation backend, resolved model, credential/model preflight, and cleanup status without secret values
- Geometry profile, requested/source/delivery dimensions, formats, bytes, and native-output status
- Shot-list and prompt paths, sequence, core meaning, structure, and metaphor
- Content, style, set, size, and residual-risk conclusions
- Ordered post-generation actions and a same-dimension hard-limit exporter when one was required

## Extension Rules

To add a visual style:

1. Build an approved v2 `StyleCandidateBundle` outside this skill.
2. Run `node scripts/validate-style-bundle.mjs --bundle <candidate-dir>`.
3. Run `node scripts/install-style-bundle.mjs --bundle <candidate-dir>` only after explicit human approval.
4. The installer copies the style Markdown, machine spec, provenance, and selected reference image, updates `style-registry.json`, regenerates `style-index.md`, and refuses duplicate IDs.
5. Never hand-edit the generated style index or copy source reference images into the skill.

To improve quality:

1. Add recurring visual failures to `references/qa-checklist.md`.
2. Add reusable structures to `references/content-structures.md`.
3. Add backend integration failures to `references/generation-backends.md`; do not mix them into visual QA retries.
4. Avoid writing one-off user preferences as universal rules.

## Acceptance Criteria

The skill is working when a fresh agent can:

- Infer or ask for platform.
- Resolve one verified generation backend before production.
- Read source content before choosing a suite-level Style Spec.
- Resolve one QA-only Style Reference.
- Produce and save a shot list before generation.
- Compile and save one prompt per image.
- Generate and inspect image 1 as a canary before continuing.
- Resolve legal request dimensions automatically for every built-in style.
- Preserve accepted native pixels and reject wrong-ratio output without geometric normalization.
- Keep the image set visually consistent.
- Save one canonical artifact per image under `images/`.
- Save outputs with a manifest and explain QA or fallback decisions.
