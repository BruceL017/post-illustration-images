# QA Checklist

Run QA after each image and before delivery.

## Backend And Artifact QA

- `BackendContext` records one verified runtime-native or configured API backend.
- Credential access and model availability preflight passed without exposing secret values.
- The resolved model is currently image-capable; a stored default alone is not accepted as proof. Any difference between model preference and resolved model is recorded with its reason.
- `GenerationGeometry` comes from the verified model profile, and its request size satisfies that profile before submission.
- The image artifact belongs to the current prompt/request, not a stale cache or earlier run.
- The source file is a readable raster image and its actual format, dimensions, and aspect ratio are recorded. Delivery keeps the native extension unless a verified publishing-path exporter is required.
- Any source within the Style Spec ratio tolerance and at or above a configured minimum short edge passes as `pass-native`; requested, source, and delivery dimensions are recorded, and delivery dimensions equal source dimensions.
- Output outside ratio tolerance or below the minimum edge fails QA and is never resized, cropped, padded, rotated, stretched, or upscaled. It is retried with the canonical request size, then blocked after the three-candidate limit without a size question.
- A `hard-limit-export` runs only for a known publishing path through a verified same-dimension exporter; the exporter and final format/bytes are recorded, or delivery stops with its precise blocker.
- The request process exited and no child process started by the request remains active.
- Saved prompts, manifests, logs, and delivery notes contain no credentials or secret fragments.

## Content QA

- Platform and selected Style Spec match the request.
- Image expresses one core meaning.
- Shot list anchor is visible in the image.
- Content expression structure is clear within one second.
- Visual metaphor is concrete and relevant.
- Main actor or object participates in the key action.
- Short labels are readable and not overlong.
- No invented facts, exaggerated claims, or unrelated examples.
- Layout is neither empty nor crowded.
- Image does not drift into a forbidden style from the selected Style Spec.

## Style Spec QA

- Target ratio, orientation, and design-coordinate layout follow the selected Style Spec; delivery pixels remain native.
- Fixed palette follows the selected Style Spec closely enough for the platform template.
- The selected style has one Style Reference image, and the generated image matches its baseline visual system.
- Style Reference comparison ignores semantic content and checks only palette, texture, spacing, typography feel, icon/illustration style, composition language, and fixed-component treatment.
- Content stays inside the proportional mapping of the Style Spec's design-space content safe area onto the native raster.
- Active fixed component reserved areas stay clear.
- Page-number badges are absent unless the selected Style Spec explicitly enables them.
- Template-level components do not move randomly between images.
- Active fixed component slots are not visibly marked by placeholder frames, reserve boxes, guide outlines, empty labels, or stickers.

## Originality QA

- The image contains no third-party logo, watermark, signature, or model mark.
- The image does not copy source identity, proprietary characters, or exact source assets.
- Placeholder frames, reserve boxes, guide outlines, and empty labels are absent unless the selected Style Spec explicitly enables them.
- For a Style Bundle calibration image, `identity_leakage: true` records that this check passed.

## Set-Level QA

- One Style Spec is used across the whole set.
- Images vary by structure/metaphor, not by random style shifts.
- Sequence has a clear reading order through filenames and manifest records, not through model-drawn page badges.
- No two images repeat the same core meaning.
- Filename order matches the sequence.
- `manifest.md` records platform, publishing path or `null`, selected Style Spec, verified backend/model, source/delivery artifact formats and bytes, requested/source/delivery dimensions, optional hard-limit exporter, geometry attempts, native-output status, post-generation actions, QA statuses, and residual risks.

## Fallback Rules

| Failure | Fix |
|---|---|
| Text is wrong or unreadable | Reduce labels; regenerate with shorter text. |
| Too many ideas in one image | Split anchor or delete secondary idea. |
| Style drift | Compare with the Style Reference, ignore its semantic content, then reinsert selected Style Spec constraints and negative constraints. |
| Weak metaphor | Rewrite as physical action plus concrete object. |
| Looks like PPT | Reduce grid density, title bars, and rigid arrows; emphasize scene/object. |
| Identity leakage, third-party logo, watermark, or signature appears | Regenerate with stronger originality constraints. |
| Model drew a placeholder frame, reserve box, or guide outline | Regenerate with explicit "no placeholder frame/no reserve box/no visible guide" constraints. |
| Page-number badge appears | Regenerate with page badge forbidden. |
| Output ratio falls outside tolerance or misses the minimum edge | Retry the same canonical request size with stronger geometry wording; never ask the user to choose a size. |
| Layout is empty | Add one content card, conclusion bar, icon group, or action detail. |
| Layout is crowded | Remove secondary labels and reduce visual elements. |

Do not retry blindly. Each regeneration must name the failure being corrected.

If the user requires existing content to remain unchanged, avoid full-image regeneration for a local artifact. Restore the original image and remove only the artifact using same-image texture.
