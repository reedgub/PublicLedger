# PublicLedger design system

This is the locked visual language for PublicLedger. Every new page, section, and component must use it. It was modeled on the Armory Framer template (near-black canvas, Inter Display headlines, Geist Mono labels) and extended with landing-page motion.

**Rule of thumb:** before writing new UI, reuse an existing token, utility, or component from this file. Only add a new primitive when nothing here fits, then document it here in the same PR.

---

## 1. Brand

- The product name is **PublicLedger**: one word, capital P and capital L. Never write "publicledger", "Public Ledger", or "PUBLICLEDGER" in UI copy or images. Older names ("Project Lighthouse", "Receipts") must not appear.
- Logo: `components/brand/wordmark.tsx`. Use `<Wordmark />` for the lockup and `<LedgerMark />` for the icon alone. The footer shows an oversized `PublicLedger` that sizes itself with container units; don't hard-code its width.
- Voice: plain, specific, and confident. Short declarative sentences. No hype words and no exclamation marks.

## 2. Color

Tokens live in `app/globals.css` (`:root`). Use the token or its Tailwind alias; never hard-code new hex values.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#060606` | Page canvas |
| `--card` | `#0d0d0d` | Raised surfaces |
| `--secondary` | `#1a1a1a` | Secondary surfaces |
| `--foreground` | `#ffffff` | Primary text |
| `--muted-foreground` | `rgba(255,255,255,0.6)` | Body copy and secondary text |
| `--border` | `rgba(255,255,255,0.1)` | Hairlines (use `/20` for emphasis) |
| `--correct` / `--incorrect` / `--provisional` | green / red / amber | Outcome states only |

- **Dark is the default.** For a white panel, wrap the section in `.surface-light`. It flips every token, so components inside adapt automatically. Light panels sit inset from the edges (`px-3 sm:px-4`) with `rounded-[20px]`.
- Text on dark uses white at fixed alphas: 100 (headings), 80/65 (body), 45–60 (labels).
- Outcome colors are reserved for verdicts and status badges. Don't use them as decoration.

## 3. Typography

| Role | How |
| --- | --- |
| Hero headline | `.display-1` (Inter, display optical size, 400 weight, −0.03em, up to 100px) |
| Section heading | `.display-2` (up to 48px), usually through `<SplitReveal>` |
| Card title | 22–34px Inter 400, `tracking-[-0.03em]` |
| Body | `.lede`, or `text-[15px] leading-relaxed font-light text-white/65` |
| Label / eyebrow | `<SectionLabel>` (hatch mark + Geist Mono 13px uppercase) or `.eyebrow` (11px) |
| Numbers / IDs / dates | `.metric` (Geist Mono, tabular figures) |

- Headings are **always weight 400**. Never add `font-semibold` or `font-bold` to display type.
- Nav links are uppercase, 13px, with `tracking-[0.06em]`.
- Fonts load once in `app/layout.tsx`: Inter (with the `opsz` axis) and Geist Mono. Don't add other font families.

## 4. Layout and shape

- Container: `.container-page` (max width 1200px, gutters of 16/24/40px).
- Section rhythm: `pt-32 sm:pt-44` between major homepage sections. Inner pages use `py-12 sm:py-20`.
- Section intro pattern: `<SectionLabel>` → `display-2` heading → optional `.lede` on the right (two-column grid on `lg`).
- Radii: cards and panels `rounded-[20px]`, buttons and inputs `rounded-[14px]`, chips `rounded-[10px]`, badges `rounded-full`.
- Lists of records are rounded bordered containers with `divide-y divide-border`, not bare rules.
- Texture: `.grid-field` (faint square grid) for data panels and empty states. Glass chrome uses `.glass`.
- It must work at a 390px width, with no horizontal scroll.

## 5. Components (reuse these)

| Need | Component |
| --- | --- |
| Primary/secondary CTA | `<PixelButton variant="light" \| "dark" \| "ghost">` (`components/brand/pixel-button.tsx`) |
| Section label | `<SectionLabel>` |
| Section header with index | `<SectionHeading index label title aside>` |
| Empty state | `<EmptyState>` |
| Expert avatar | `<ExpertAvatar>` (stored X image or monogram tile, no third-party avatar services) |
| Status | `<StatusBadge>` |
| Provenance (archive capture) | `<CaptureBadge>` — neutral badge (never an outcome color) on predictions captured from the archive after publication |
| Prediction rows | `<PredictionList>` |
| Market context | `<MarketCard>` (always labeled informational) |

## 6. Motion

All motion components are in `components/motion/`, built on the `motion` library. `MotionProvider` (in the layout) applies `reducedMotion="user"`, and every CSS animation has a `prefers-reduced-motion` fallback. Any new animation must keep both.

| Effect | Component | Use for |
| --- | --- | --- |
| Blur-rise on enter | `<Reveal delay y>` | Default for any block entering view; stagger siblings by 0.06–0.1s |
| Masked word reveal | `<SplitReveal text as immediate>` | Section and hero headings |
| Scroll-lit paragraph | `<ScrollWords>` | One statement per page, max |
| Count-up number | `<CountUp value>` | Real stats only; the server renders the true value |
| Hero depth | `<HeroParallax>` + `<HeroField>` + `<CursorSpotlight>` | Homepage hero only |
| Panel grow-in | `<ScaleIn>` | Light `.surface-light` panels |
| Cursor spotlight + tilt | `<SpotlightCard>` | Feature/principle cards |
| Magnetic pull | `<Magnetic>` | Primary CTAs only |
| Marquee | `<Marquee items reverse speed>` | Real roster or category names only |
| Pinned story | `<RecordStory>` | One pinned sequence per page, at most ~280vh |
| Beams | `<BeamGrid>` | Stat grids |
| Footer letters | `<RisingLetters>` | Footer wordmark |
| Reading progress | `<ScrollProgress>` | Header (already mounted) |

Motion rules:
- Easing is `[0.16, 1, 0.3, 1]` or `[0.2, 0.7, 0.2, 1]`. Durations run 0.9–1.1s for reveals and 0.3–0.5s for hover.
- **Never hijack scrolling.** No smooth-scroll libraries (Lenis was removed because it fought native scrolling). Pinned sections must keep advancing visibly and show a scroll cue.
- Hover-only effects (spotlight, tilt, magnetic) must ignore touch pointers.
- Animate `transform`, `opacity`, and `filter` only. Never animate layout properties on scroll.

## 7. Integrity rules for design

The product rules in `CLAUDE.md` override any design choice:
- Illustrative or demo content must be visibly labeled as an illustration ("Not a real prediction"). It must never quote, name, or score a real person.
- Numbers on screen come from the database. Don't pad, round up, or invent figures for visual effect.
- Market prices are labeled informational and never styled as an expert's prediction.

## 8. Checklist for new UI

- [ ] Uses tokens and components from this file. No new hex colors or font families.
- [ ] Headings at weight 400; labels in Geist Mono uppercase.
- [ ] Wrapped in `<Reveal>` / `<SplitReveal>` where it enters the viewport.
- [ ] Works at 390px and 1440px, with no horizontal overflow.
- [ ] Respects reduced motion; no touch-only breakage.
- [ ] Name written as "PublicLedger".
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.
