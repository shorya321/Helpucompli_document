# HelpUcompli Document — Design Authority

This document governs every UI decision in the product. Follow it exactly. Do not improvise.

**Style**: Minimalism & Swiss Style + Executive Dashboard
**Principle**: Every pixel communicates competence, not creativity.

---

## 1. Design Philosophy

HelpUcompli Document is a HIPAA-compliant enterprise tool used by healthcare compliance professionals in well-lit office environments. Design must project **trust**, **clarity**, and **professionalism**.

- Clean grid-based layouts with generous whitespace
- Zero decorative elements — every element has a function
- Flat surfaces, minimal shadows, sharp hierarchy
- Light mode only (Phase 1) — healthcare environments are brightly lit
- Dense but scannable — enterprise users manage hundreds of documents
- Instant navigation — no page transitions, no loading animations beyond skeleton states

---

## 2. Color System

### Brand Colors (HSL for shadcn/ui)

```css
:root {
  /* --- Brand --- */
  --primary: 221 83% 53%;           /* Blue #2563EB — all action elements */
  --primary-foreground: 0 0% 100%;  /* White text on blue */

  --accent: 327 82% 52%;            /* Pink #E91E8C — decorative accent ONLY */
  --accent-foreground: 0 0% 100%;   /* White text on pink */

  /* --- Surfaces --- */
  --background: 210 40% 98%;        /* #F8FAFC — page background */
  --foreground: 217 33% 17%;        /* #1E293B — primary text */

  --card: 0 0% 100%;                /* #FFFFFF — card surfaces */
  --card-foreground: 217 33% 17%;   /* #1E293B */

  --popover: 0 0% 100%;
  --popover-foreground: 217 33% 17%;

  /* --- UI Chrome --- */
  --secondary: 210 40% 96%;         /* #F1F5F9 — secondary buttons, hover states */
  --secondary-foreground: 217 33% 17%;

  --muted: 210 40% 96%;             /* #F1F5F9 — disabled, placeholder backgrounds */
  --muted-foreground: 215 16% 47%;  /* #64748B — secondary text */

  --border: 214 32% 91%;            /* #E2E8F0 — borders, dividers */
  --input: 214 32% 91%;             /* #E2E8F0 — input borders */
  --ring: 221 83% 53%;              /* Blue — focus ring */

  /* --- Feedback --- */
  --destructive: 0 84% 60%;         /* #EF4444 — errors, delete actions */
  --destructive-foreground: 0 0% 100%;

  /* --- Status --- */
  --status-success: 142 71% 45%;    /* #22C55E */
  --status-warning: 38 92% 50%;     /* #F59E0B */
  --status-error: 0 84% 60%;        /* #EF4444 */
  --status-info: 221 83% 53%;       /* #2563EB */

  /* --- Role Badges --- */
  --role-super-admin-bg: 327 82% 95%;  /* Pink-50 tint */
  --role-super-admin-text: 327 82% 35%;
  --role-admin-bg: 221 83% 95%;        /* Blue-50 tint */
  --role-admin-text: 221 83% 35%;
  --role-viewer-bg: 210 40% 96%;       /* Slate-100 */
  --role-viewer-text: 215 16% 47%;

  /* --- Chart --- */
  --chart-1: 221 83% 53%;    /* Blue */
  --chart-2: 142 71% 45%;    /* Green */
  --chart-3: 38 92% 50%;     /* Amber */
  --chart-4: 327 82% 52%;    /* Pink */
  --chart-5: 262 83% 58%;    /* Purple */

  --radius: 0.5rem;
}
```

### Pink Usage Policy

Pink (#E91E8C) fails WCAG AA on white (~4.18:1, needs 4.5:1). Use it ONLY for:
- Logo and brand mark
- Active sidebar nav indicator (left border or dot)
- Chart accent color (4th in sequence)
- Badge background for `superadmin` role (tinted, not solid)

Pink is NEVER used on: buttons, link text, form elements, backgrounds, or any interactive element.

---

## 3. Typography Scale

Font: **Inter** (already configured via `next/font/google`). Single-font system — hierarchy through weight and size.

| Level | Size | Weight | Line Height | Use |
|-------|------|--------|-------------|-----|
| Display | 36px / 2.25rem | 700 | 1.2 | Page titles (Dashboard, Documents) |
| H1 | 30px / 1.875rem | 700 | 1.3 | Section headers |
| H2 | 24px / 1.5rem | 600 | 1.3 | Card group titles |
| H3 | 20px / 1.25rem | 600 | 1.4 | Card titles, modal titles |
| H4 | 16px / 1rem | 600 | 1.4 | Subsection headers |
| Body | 14px / 0.875rem | 400 | 1.5 | Default text |
| Body Small | 13px / 0.8125rem | 400 | 1.5 | Table cells, secondary info |
| Caption | 12px / 0.75rem | 500 | 1.4 | Labels, timestamps, badges |
| Overline | 11px / 0.6875rem | 600 | 1.4 | Uppercase category labels |

### Rules

- Body text minimum: **14px**. Table cell minimum: **13px**. Absolute minimum: **11px** (overline only).
- KPI metric values: **30px / 700** (same as H1 but used for numbers).
- Monospace for IDs, file sizes, dates in tables: `font-mono text-[13px]`.
- Truncate long filenames with `truncate` class, show full name in tooltip.

---

## 4. Spacing & Layout

### Spacing Scale (4px base)

| Token | Value | Use |
|-------|-------|-----|
| `space-1` | 4px | Icon-to-text gap |
| `space-2` | 8px | Inline element gap, badge padding |
| `space-3` | 12px | Card internal padding (compact), input padding |
| `space-4` | 16px | Card internal padding (standard), section gap |
| `space-5` | 20px | Between cards in a grid |
| `space-6` | 24px | Content area padding, major section gap |
| `space-8` | 32px | Page section separation |

### Page Layout Anatomy

```
+--[ Sidebar (w-64) ]--+--[ Main Content ]------------------+
|                       |  +--[ Topbar (h-16) ]----------+  |
|  Logo                 |  |  Breadcrumbs    User + Role  |  |
|  ─────                |  +------------------------------+  |
|  Nav Items            |                                    |
|  (icon + label)       |  +--[ Content (px-6 py-6) ]----+  |
|                       |  |  Page title + actions        |  |
|                       |  |  KPI cards grid              |  |
|                       |  |  Tables / content            |  |
|                       |  +------------------------------+  |
+-----------------------+------------------------------------+
```

- **Sidebar**: `w-64` (256px) fixed. Collapses to `Sheet` on mobile (`< md` breakpoint).
- **Topbar**: `h-16` (64px). Contains breadcrumbs (left), user avatar + role badge + logout (right).
- **Content area**: `px-6 py-6` padding. Max content width: none (full width within main).
- **Page title row**: Title (Display size) left, action buttons right. Margin bottom: `mb-6`.

### Responsive Grid

| Breakpoint | KPI Cards | Document Grid | Form Width |
|------------|-----------|---------------|------------|
| `< md` | 1 column | 1 column | Full width |
| `md` | 2 columns | 2 columns | `max-w-xl` |
| `lg` | 3 columns | 3 columns | `max-w-2xl` |
| `xl` | 4 columns | 3 columns | `max-w-2xl` |

---

## 5. Component Guidelines

### Buttons

| Variant | Classes | Use |
|---------|---------|-----|
| Primary | `bg-primary text-primary-foreground` | Main actions: Save, Upload, Create |
| Secondary | `bg-secondary text-secondary-foreground` | Cancel, Back, secondary actions |
| Destructive | `bg-destructive text-destructive-foreground` | Delete, Remove |
| Outline | `border border-input bg-background` | Tertiary actions, filters |
| Ghost | `hover:bg-secondary` | Icon-only buttons, table row actions |

- Height: `h-10` (40px) standard, `h-9` (36px) compact (table actions), `h-8` (32px) small (badges).
- Icon + text buttons: icon left, 8px gap (`gap-2`).
- Pink is NEVER used on buttons.
- Loading state: spinner icon replaces left icon, text stays, button disabled.

### Cards

```
+--[ border-l-4 border-status ]--+
|  icon  Label (caption)          |
|        Value (h1/30px/700)      |
|        Trend ↑ 12% (caption)   |
+---------------------------------+
```

- Background: `bg-card` (white). Border: `border border-border`. Radius: `rounded-lg`.
- Shadow: `shadow-sm` maximum. No `shadow-md` or higher anywhere.
- KPI cards: `border-l-4` with status color (blue for neutral, green for positive, red for negative).
- Padding: `p-4` standard, `p-6` for content cards with complex content.

### Tables (TanStack Table)

- Header: `bg-muted/50 text-muted-foreground text-xs font-medium uppercase tracking-wider`.
- Rows: `border-b border-border`. Hover: `hover:bg-muted/50`.
- No zebra striping. No colored rows. Clean and flat.
- Sticky headers for scrollable tables.
- Cell padding: `px-4 py-3`.
- Actions column: right-aligned, ghost icon buttons with dropdown menu.
- Empty state: centered message within table body area.

### Forms

- Input height: `h-10`. Border: `border-input`. Focus: `ring-2 ring-ring ring-offset-2`.
- Labels: `text-sm font-medium` above input, `mb-1.5` gap.
- Required fields: red asterisk `*` after label text.
- Error messages: `text-destructive text-sm mt-1` below input.
- Form sections: separated by `Separator` component with `my-6`.
- Submit button: right-aligned, primary variant. Cancel: secondary variant, left of submit.

### Modals (Dialog)

- Sizes: `max-w-sm` (confirm), `max-w-lg` (forms), `max-w-2xl` (complex).
- Overlay: `bg-black/50`.
- Title: H3 size (20px/600).
- Footer: right-aligned buttons, gap-2. Cancel left, primary right.
- Close: X button top-right, always present.

### Badges

| Context | Background | Text |
|---------|------------|------|
| `superadmin` | `hsl(var(--role-super-admin-bg))` | `hsl(var(--role-super-admin-text))` |
| `admin` | `hsl(var(--role-admin-bg))` | `hsl(var(--role-admin-text))` |
| `viewer` | `hsl(var(--role-viewer-bg))` | `hsl(var(--role-viewer-text))` |
| Success | Green-50 bg | Green-700 text |
| Warning | Amber-50 bg | Amber-700 text |
| Error | Red-50 bg | Red-700 text |
| Neutral | Slate-100 bg | Slate-600 text |

- Size: `text-xs font-medium px-2 py-0.5 rounded-md`.
- No borders on badges. Background tint + dark text pattern only.

### Toasts

- Position: bottom-right.
- Left border: `border-l-4` with status color.
- Duration: 5 seconds standard. Errors: persistent until dismissed.
- Max 3 visible. Newest on top.
- Content: title (font-medium) + optional description (text-sm text-muted-foreground).

### Sidebar Navigation

- Nav items: `flex items-center gap-3 px-3 py-2 rounded-md text-sm`.
- Default: `text-muted-foreground hover:bg-muted hover:text-foreground`.
- Active: `bg-primary/10 text-primary font-medium` with `border-l-2 border-accent` (pink indicator).
- Icon size: 20px. Label: 14px.
- Section dividers: `Separator` with optional uppercase overline label.

### Dropdowns

- Trigger: ghost button or outline button with `ChevronDown` icon.
- Items: `text-sm py-2`. Destructive items: `text-destructive`.
- Divider between action groups.

---

## 6. Dashboard Patterns

### KPI Stat Card

```tsx
<Card className="border-l-4 border-l-blue-500">
  <CardContent className="p-4">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          Total Documents
        </p>
        <p className="text-3xl font-bold mt-1">1,247</p>
        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
          <TrendingUp className="h-3 w-3" /> 12% from last week
        </p>
      </div>
      <FileText className="h-8 w-8 text-muted-foreground/50" />
    </div>
  </CardContent>
</Card>
```

#### Required KPI Cards

| Card | Icon | Border Color | Trend Basis |
|------|------|-------------|-------------|
| Total Documents | `FileText` | `border-l-blue-500` | vs previous week |
| Total Buckets | `FolderOpen` | `border-l-blue-500` | static (no trend) |
| Recent Uploads | `Upload` | `border-l-green-500` | vs previous 7 days |
| Recent Links | `Link2` | `border-l-amber-500` | vs previous 7 days |
| Active Users | `Users` | `border-l-green-500` | vs previous week |

Layout: responsive grid (see Section 4). All cards use the same component with props for icon, label, value, trend, and border color.

### Quick Actions

Row of buttons below KPI cards. Layout: `flex flex-wrap gap-3`.

| Button | Variant | Icon | Visible To |
|--------|---------|------|-----------|
| Upload Document | Primary | `Upload` | All roles |
| Create Bucket | Outline | `FolderPlus` | `superadmin` only |
| Generate Link | Outline | `Link2` | `superadmin`, `admin` |
| View Audit Log | Ghost | `Shield` | All roles |

Conditionally render buttons based on user role. Do not show disabled buttons for unauthorized actions — hide them entirely.

### Activity Feed

- Vertical list, no connecting lines.
- Each entry: avatar/icon (left) + user name, action badge, target name, timestamp (right).
- Timestamp: relative ("2 hours ago") with absolute tooltip.
- Max 20 items, "View all" link at bottom navigates to audit log.

### Empty States

- Centered vertically and horizontally within content area.
- Icon: 48px, `text-muted-foreground/30`.
- Heading: H3 (20px/600).
- Description: Body (14px/400), `text-muted-foreground`, max-w-md.
- CTA button: primary variant, below description with `mt-4`.

### Loading Skeletons

- Match exact layout of loaded content.
- Use `bg-muted animate-pulse rounded-md`.
- Skeleton height matches text line height. Card skeleton matches card height.
- Show skeletons for 0-2 seconds typical. If data takes longer, show skeleton + "Loading..." text below.

---

## 7. Icons

Library: **Lucide React** (`lucide-react`)

| Size | Pixels | Class | Use |
|------|--------|-------|-----|
| Inline | 16px | `h-4 w-4` | Button icons, badge icons, inline text |
| Navigation | 20px | `h-5 w-5` | Sidebar nav items, topbar actions |
| Section | 24px | `h-6 w-6` | Section headers, empty state icons |
| Feature | 48px | `h-12 w-12` | Empty states, onboarding |

### Rules

- Always outline style. Never filled/solid.
- Always include `aria-hidden="true"` when paired with text.
- Icon-only buttons must have `aria-label`.
- Consistent mapping:

| Context | Icon |
|---------|------|
| Documents | `FileText` |
| Buckets | `FolderOpen` |
| Upload | `Upload` |
| Download | `Download` |
| Delete | `Trash2` |
| Edit | `Pencil` |
| Users | `Users` |
| Audit | `Shield` |
| Policies | `ScrollText` |
| Links | `Link2` |
| Settings | `Settings` |
| Search | `Search` |
| Filter | `SlidersHorizontal` |
| More actions | `MoreHorizontal` |
| Close | `X` |
| Success | `CheckCircle2` |
| Warning | `AlertTriangle` |
| Error | `XCircle` |
| Info | `Info` |

---

## 8. Motion

| Element | Duration | Easing | Property |
|---------|----------|--------|----------|
| Button hover | 150ms | `ease-in-out` | background-color, border-color |
| Modal open/close | 200ms | `ease-out` / `ease-in` | opacity, scale |
| Toast enter/exit | 300ms | `ease-out` | opacity, translateY |
| Dropdown open | 150ms | `ease-out` | opacity, scale |
| Sidebar collapse | 200ms | `ease-in-out` | width |

### Rules

- No page transitions between routes. Routes change instantly.
- No spring/bounce/elastic animations. Linear or ease only.
- No parallax. No scroll-triggered animations. No hover animations on cards.
- `prefers-reduced-motion: reduce` — disable all non-essential animations. Keep opacity transitions only.
- Loading spinners: `animate-spin` on Lucide `Loader2` icon.

---

## 9. Accessibility

### WCAG AA Requirements

- Text contrast: 4.5:1 minimum (normal text), 3:1 minimum (large text 18px+).
- Blue (#2563EB) on white: **5.17:1** — passes AA and AAA (large text).
- Pink (#E91E8C) on white: **~4.18:1** — fails AA. Do not use as text on white.
- Dark (#1E293B) on white: **14.63:1** — passes AA and AAA.

### Focus States

- All interactive elements: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- Ring color: blue (matches `--ring`).
- Never remove focus outlines. Never use `outline-none` without `focus-visible:ring`.

### Screen Readers

- Icon-only buttons: `aria-label="Delete document"` (describe the action, not the icon).
- Status badges: `role="status"` on dynamic counts.
- Toast notifications: `role="alert"` for errors, `role="status"` for success.
- Modal focus trap: focus locks to modal content when open, returns to trigger on close.
- Tables: proper `<th scope="col">` headers.

### Touch Targets

- Minimum interactive size: 44x44px (CSS) on touch devices.
- Clickable table rows: entire row is click target, not just the text.
- Spacing between interactive elements: minimum 8px.

### Color Independence

- Never convey meaning by color alone. Always pair with icon, text, or pattern.
- Status badges: color + text label ("Active", "Expired").
- Trend indicators: color + icon (green + `TrendingUp`, red + `TrendingDown`).

---

## 10. Anti-Patterns

These make a product look like a template. Do not use them.

1. **No gradient backgrounds** on buttons, cards, or headers.
2. **No colored page backgrounds** — always `bg-background` (#F8FAFC).
3. **No card shadows larger than `shadow-sm`**.
4. **No rounded-full on cards or containers** — `rounded-lg` max.
5. **No emoji in the UI** — use Lucide icons.
6. **No custom scrollbars**.
7. **No hero sections or marketing copy** inside the app.
8. **No decorative illustrations or mascots**.
9. **No loading bars across the top** — use inline skeletons.
10. **No colored sidebar backgrounds** — sidebar is white with `border-r`.
11. **No icon backgrounds** (colored circles behind icons) in navigation.
12. **No animated counters** that tick up to their value.
13. **No multi-color borders** or rainbow effects.
14. **No sticky footers** inside the dashboard — content scrolls freely.
15. **No "Welcome back, [name]"** greetings — the topbar shows the user info, that is sufficient.
