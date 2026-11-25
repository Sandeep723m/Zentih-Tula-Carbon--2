# Tula Carbon brand and product design system

Version 1.0 · Updated from the supplied brand guidelines

This is the product implementation reference. The approved master logo artwork remains authoritative; do not reconstruct the wordmark with a UI font. The brand should feel precise, credible, intelligent, progressive, and approachable. Its product promise is carbon data that supports clear business decisions.

## Color

Use semantic roles in components. Brand primitives are for identity, illustration, and intentional highlights; avoid putting the full logo palette into a single UI view. Pair status color with a text label or icon, and check contrast against WCAG 2.2 AA.

| Role | Value |
| --- | --- |
| Main dashboard / white surface | `#FCFCFD` / `#FFFFFF` |
| Sidebar surface | `#F8F6FA` |
| Active sidebar / hover surface | `#F3EBFF` |
| Selected table row / table header | `#F8F3FF` / `#F7F5FA` |
| Primary text / secondary text | `#201829` / `#62586D` |
| Border | `#E8E4EE` |
| Primary action / hover / focus | `#5E00B3` / `#4C008F` / `#6A00FF` |
| Brand orange accent | `#FF8A00` |
| Success / error / warning / info / neutral | `#12B76A` / `#F04438` / `#F79009` / `#2E90FA` / `#8E8EA0` |

Brand primitives: Peach Orange `#FFB27A`, Orange `#FF8A00`, Deep Orange `#FF5A00`, Lavender `#D6B4FF`, Violet `#9C58FF`, Deep Violet `#6A00FF`. Secondary colors: Warm Sand `#FFF4E6`, Sunshine `#FFE39A`, Coral `#FFB3B3`, Lilac `#EBD9FF`, Cool Gray `#9CA3AF`, Slate Purple `#7253B3`. Tints: Peach `#FFF0E5`, Orange `#FFE7CC`, Apricot `#FFF2D9`, Lavender `#F6EDFF`, Violet `#F0E6FF`, Ultra `#FAF7FF`.

CSS custom properties live in `frontend/src/styles/base/variables.css`; existing components use compatibility aliases that resolve to the semantic tokens.

## Typography

IBM Plex Sans is the product typeface. Use IBM Plex Serif selectively for editorial report content, not dense controls or tables. Use IBM Plex Mono for record IDs, calculation codes, and technical values. Inter remains a system fallback. Use sentence case and tabular numerals for quantities, emissions, and percentages.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Display XL | 52 / 58 px | 500 |
| Display | 40 / 46 px | 500 |
| H1 | 32 / 38 px | 600 |
| H2 | 24 / 30 px | 600 |
| H3 | 20 / 26 px | 600 |
| Body large | 16 / 24 px | 400 |
| Body | 14 / 20 px | 400 |
| UI and table | 13 / 18 px | 400–500 |
| Label | 12 / 16 px | 500 |
| Caption | 11 / 16 px | 400 |

Font packages are loaded from `frontend/src/main.tsx` and `frontend/src/styles/index.css`.

## Layout and surfaces

Use a 4 px base spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px. Use 12 columns on desktop, 8 on tablet, and 4 on mobile; standard desktop content padding is 24–32 px. Keep a 1 px border for separation and use shadows sparingly for menus, popovers, and floating toolbars.

| Surface | Radius |
| --- | --- |
| Controls and tags | 6 px |
| Inputs and compact cards | 8 px |
| Data cards and modules | 12 px |
| Hero and marketing surfaces | 16 px |

Elevation uses subtle neutral shadows: level 1 `0 1px 2px` at 6%, level 2 `0 4px 12px` at 8%, and level 3 `0 8px 24px` at 12%. Icons use a 20 px grid with 16 px and 24 px variants; use simple, rounded functional line icons with a consistent 2 px stroke.

### Sidebar navigation

Use a 232 px desktop sidebar (`224–240 px` range), `#F8F6FA` background, IBM Plex Sans navigation at 13 px / 500, and 11 px / 500 section labels. Items are 42 px high with an 8 px radius, 12 px icon gap, 12 px horizontal padding, and 19 px icons. Hover and active use `#F3EBFF`; active also has a narrow `#FF8A00` leading indicator and violet icon/text. The 68 px collapsed mode keeps icon-only links accessible by name and provides a visible expand control; menu search expands the sidebar before focusing. Keep keyboard focus visible, active links within the scroll view, and group controls distinct from links. Motion uses 120–150 ms for hover, 120–160 ms for selection, and 200–250 ms for expandable content; respect reduced-motion preferences. The application navigation remains carbon-accounting focused.

## Product components and data tables

Components should document default, hover, focus, disabled, loading, and error states as applicable. Core coverage includes buttons, inputs, navigation, tabs, breadcrumbs, pagination, status badges, alerts, toasts, charts, evidence previews, dialogs, drawers, and workflow actions.

The activity ledger uses compact 56 px rows, fine lavender grid dividers, 13 px IBM Plex Sans, and right-aligned tabular quantities. Use `#F7F5FA` for the table header. Keep workflow status separate from data-quality findings. Select rows with a violet checkbox and a pale lavender row (`#F8F3FF`) plus a violet leading indicator. Show the selected count and permission-aware actions in a floating toolbar; do not cover rows or pagination. Keep the record ID clickable and provide an accessible details action. The footer includes count, page size, and violet active pagination.

## Charts and accessibility

Use violet and orange as restrained series accents alongside neutrals and semantic colors. Include a legend, units, reporting period, source information, and accessible text alternative. Never rely on color alone; identify missing values and calculation assumptions clearly.

Target WCAG 2.2 AA contrast. Preserve keyboard access, visible focus, screen-reader labels, meaningful status text, and responsive reflow. Keep the six-dot symbol artwork and its order/proportions consistent in approved brand uses.
