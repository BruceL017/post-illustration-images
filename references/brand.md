# Brand Plugin

Brand Plugin is default-off, user-overridable, and pluggable. Resolve its state from an explicit user override first, then `style_spec.brandPolicy.defaultEnabled`, then compatibility default `false` when the policy is absent. Brand Plugin does not define canvas size, color palette, safe area, logo coordinates, or platform layout.

The selected Style Spec is always the authority for brand placement and size.

## Enablement

- Every Visual Builder style MUST define `brandPolicy: { defaultEnabled: false, userOverrideAllowed: true }`.
- Existing styles without `brandPolicy` resolve to `{ defaultEnabled: false, userOverrideAllowed: true }`.
- An explicit user request to enable or disable brand elements wins when `userOverrideAllowed` is true.
- If the user gives no brand instruction, use `brandPolicy.defaultEnabled`.
- Every production Style Spec must define an enabled top-right `brandSlot` and matching `brandReservedArea`.
- If a selected production Style Spec has no enabled top-right `brandSlot`, do not invent a placement or use that absence as a brand policy. Stop as `BLOCKER: required production brand slot unavailable` or update the Style Spec first.
- Style Reference watermark presence, absence, or position never changes production enablement or placement.

## Brand Asset

No brand asset is bundled or enabled by default. The root-level `brand-overlay.config.json` is the configuration authority:

```json
{
  "schema_version": 1,
  "asset": null
}
```

To configure an asset, replace `null` with an object containing a skill-relative SVG `path` and its lowercase SHA-256 digest:

```json
{
  "schema_version": 1,
  "asset": {
    "path": "assets/brand/example-logo.svg",
    "sha256": "<64 lowercase hexadecimal characters>"
  }
}
```

The configured path must resolve to a readable regular SVG file inside the skill root. Symbolic links, paths outside the skill root, hash drift, missing files, and unsafe SVG content are blockers when branding is explicitly enabled. Standalone overlay calls may supply `--brand-svg <path>` instead of `--brand-config <path>`; they must not supply both.

## Non-Responsibilities

Brand Plugin must not decide or override:

- Canvas size or aspect ratio.
- Platform color palette.
- Background, paper, typography, or layout system.
- Safe-area geometry.
- Logo position or rendered size.
- Page badges, pagination marks, or other fixed style components.

## Generation Rule

The image model must never draw or simulate the brand, including when the user disables Brand Plugin. Always add this constraint to image-generation prompts:

```text
Do not draw any logo, brand name, watermark, brand sticker, or page-number badge.
```

When Brand Plugin resolves enabled, additionally require the selected Style Spec's top-right brand slot to remain naturally clear for the configured SVG overlay. When it resolves disabled, the slot and reserved area are inactive: omit the reservation and overlay instructions, but keep the generic no-logo/no-watermark constraint.

## Overlay Rule

When branding is explicitly enabled, resolve one configured brand asset and overlay it using the selected Style Spec's top-right `brandSlot` before delivery. Map that design-space slot proportionally onto the source raster; the overlay canvas and output must remain exactly the source width and height. Do not recolor or restyle the asset. If the slot is too large, too small, or poorly placed, fix the Style Spec, not this Brand Plugin.

The deterministic overlay must reject a Style Spec when its brand slot is disabled, not anchored at top-right, outside the matching reserved area or canvas, outside the top-right quadrant, or when `keepBrandReservedAreaClear` is not `true`.

`scripts/apply-brand-overlay.mjs` loads vendored `@resvg/resvg-wasm@2.6.2` from `vendor/resvg-wasm/` under Node.js 22+. It requires no runtime `npm install`, native SVG renderer, network access, or API key. It is an overlay-only tool and must preserve source dimensions.

If the asset is not configured or does not pass validation, stop as `BLOCKER: required brand asset unavailable` only when branding is explicitly enabled. If Node.js 22+ or the vendored renderer is unavailable, stop as `BLOCKER: required brand overlay unavailable` only when branding resolves enabled. When branding resolves disabled, deliver the accepted model raster directly and do not run the finalizer.
