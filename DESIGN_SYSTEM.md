# Optimum Credit Design System

## Brand

- **Product name:** Optimum Credit (Optimum Financial Group)
- **Default theme:** Dark on marketing site and client portal (`class="dark"` on `<html>`)
- **Admin panel:** Light by default; optional dark mode via sidebar toggle (`optimum-admin-color-scheme`)
- **Client portal:** Dark by default (brand); optional light mode via sidebar toggle (`optimum-portal-color-scheme`)
- **Accent:** Gold `hsl(38 41% 58%)` — primary CTAs, rings, and highlights in dark mode
- **Background:** Deep navy / near-black (`#121829` theme-color)

## Logos

Hosted at `https://disruptinglabs.com/data/optimum/assets/images/logos/`:

| Asset | Use |
|-------|-----|
| `logo_with_title_white.png` | App chrome, auth panels, emails (dark UI) |
| `logo_with_title_dark.png` | SEO / Open Graph |
| `logo_white.png` | Compact nav mark |
| `logo_dark.png` | Light-background contexts |

## Typography

- **Font:** Plus Jakarta Sans (see `client/global.css`)
- **Weights:** 400 body, 600–700 headings

## Tokens

CSS variables live in `client/global.css`. Tailwind maps them via `tailwind.config.ts`:

- `primary` — gold in dark mode, navy in light mode
- `accent` — gold highlights
- `muted` / `border` — neutral grays

## UI patterns

- Cards: `bg-card border border-border rounded-2xl`
- Primary actions: `btn-primary` (gold gradient in dark mode)
- Auth marketing panel: `#040a18` with gold-tinted grid (`AuthBrandPanel`)

## Mobile responsiveness

- **No horizontal page scroll** — `html`, `body`, and `#root` use `overflow-x: hidden`; layouts use `max-w-[100vw]`, `min-w-0`, and `.app-page`.
- **Admin / portal shells** — Main content is `overflow-x-hidden`; sidebar drawers lock `body` scroll on mobile.
- **Tables** — Wrap in `.table-scroll` (internal horizontal scroll only). `DataGrid` avoids negative margins on small screens.
- **Pipeline kanban** — Columns use `min(280px, calc(100vw - 2.5rem))` inside a scroll container.
- **Forms** — Prefer `grid-cols-1 sm:grid-cols-2`; toolbars use `.toolbar-row` or `flex-col sm:flex-row`.

## Checkout types

Packages use `checkout_type`:

- `fixed_price` — single amount at registration
- `tradeline_picker` — multi-select catalog; total = sum of selections
- `subscription` — Peace of Mind ($49.99/mo); portal-only after `completed` stage
