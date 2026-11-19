---
name: "পাঠশালা (Pathshala)"
description: "A Bengali-first exam preparation interface with paired lavender and charcoal themes."
colors:
  light-primary: "#7C3AED"
  light-primary-hover: "#6D28D9"
  light-primary-active: "#5B21B6"
  light-primary-soft: "#EDE3FC"
  light-primary-muted: "#DDD0F5"
  light-accent: "#9333EA"
  light-accent-soft: "#F0E4FF"
  light-background: "#F0EAFB"
  light-background-secondary: "#EAE1F8"
  light-background-tertiary: "#E4D8F5"
  light-surface: "#FFFFFF"
  light-surface-secondary: "#F8F5FD"
  light-surface-hover: "#F2EAFB"
  light-surface-active: "#EADCFB"
  light-text-primary: "#241638"
  light-text-secondary: "#514467"
  light-text-muted: "#6F647D"
  light-border: "#E3D9F0"
  light-border-strong: "#D1C1E8"
  light-border-accent: "#C9B1ED"
  dark-primary: "#A855F7"
  dark-secondary: "#9333EA"
  dark-deep: "#6D28D9"
  dark-soft: "#C084FC"
  dark-background: "#1B1C24"
  dark-background-secondary: "#20212B"
  dark-surface: "#242430"
  dark-surface-elevated: "#252532"
  dark-surface-hover: "#2B2A39"
  dark-surface-active: "#342744"
  dark-text-primary: "#F5F3FA"
  dark-text-secondary: "#C4BFCE"
  dark-text-muted: "#AAA4B5"
  dark-border: "rgba(255,255,255,.075)"
  dark-border-accent: "rgba(168,85,247,.24)"
typography:
  display:
    fontFamily: "Hind Shiliguri, Noto Sans Bengali, SolaimanLipi, system-ui, sans-serif"
    fontSize: "clamp(2.05rem, 4.6vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1.12
  headline:
    fontFamily: "Hind Shiliguri, Noto Sans Bengali, SolaimanLipi, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 2.6vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Hind Shiliguri, Noto Sans Bengali, SolaimanLipi, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Hind Shiliguri, Noto Sans Bengali, SolaimanLipi, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Hind Shiliguri, Noto Sans Bengali, SolaimanLipi, system-ui, sans-serif"
    fontSize: ".75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.light-primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
  button-primary-hover:
    backgroundColor: "{colors.light-primary-hover}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.light-text-primary}"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-text-primary}"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-text-primary}"
    rounded: "{rounded.lg}"
  chip-selected:
    backgroundColor: "{colors.light-primary-soft}"
    textColor: "{colors.light-primary-active}"
    rounded: "{rounded.sm}"
---

# Design System: পাঠশালা (Pathshala)

## Overview

**Creative North Star: “Soft Lavender × Royal Aubergine”**

The interface pairs a softly layered lavender light theme with its established
Charcoal + Purple dark theme. Shared semantic roles keep controls, feedback, and
content familiar when the user changes mode. The light palette gives pages a lilac
cast and uses white surfaces; dark mode retains its restrained charcoal foundation
and purple atmosphere.

The theme choice persists, and the matching browser theme color and logo follow the
active mode. The user-provided muted text candidate was darkened to meet contrast on
the light background. Existing app behavior and content remain the source of truth.

**Key Characteristics:**
- Layered lavender backgrounds and white surfaces in light mode.
- Established charcoal surfaces and purple action states in dark mode.
- Bengali-first typography, clear semantic answer states, and shared interactions.
- Theme-aware browser color and logo selection.

## Colors

Light mode uses lavender neutrals with aubergine action colors. Dark mode retains its
Charcoal + Purple identity and established guidance. The frontmatter tokens are
canonical for the palette.

### Primary
- **Royal Aubergine** (`{colors.light-primary}`): Main light-mode actions and selected controls.
- **Aubergine Hover** (`{colors.light-primary-hover}`) and **Aubergine Active** (`{colors.light-primary-active}`): Progressively stronger interaction states.
- **Purple Accent** (`{colors.light-accent}`): Accent identity used by shared component aliases.
- **Dark Purple** (`{colors.dark-primary}`): Dark-mode primary; secondary and deep component aliases remain `{colors.dark-secondary}` and `{colors.dark-deep}`, with soft purple `{colors.dark-soft}`.

### Neutral
- **Lavender Canvas** (`{colors.light-background}`, `{colors.light-background-secondary}`, `{colors.light-background-tertiary}`): Page backgrounds and secondary surfaces.
- **Paper Surfaces** (`{colors.light-surface}`, `{colors.light-surface-secondary}`): Cards and grouped content.
- **Lavender Interaction Surfaces** (`{colors.light-surface-hover}`, `{colors.light-surface-active}`): Hover and active feedback.
- **Ink** (`{colors.light-text-primary}`, `{colors.light-text-secondary}`, `{colors.light-text-muted}`): Primary, supporting, and muted copy. Muted text uses `#6F647D`, chosen over proposed `#80748F` for 4.71:1 contrast on the light canvas.
- **Lavender Rules** (`{colors.light-border}`, `{colors.light-border-strong}`, `{colors.light-border-accent}`): Dividers, control outlines, and accent outlines.
- **Charcoal Canvas and Surfaces** (`{colors.dark-background}`, `{colors.dark-background-secondary}`, `{colors.dark-surface}`, `{colors.dark-surface-elevated}`): Dark page, secondary background, surface, and elevated surface respectively.
- **Dark Text and Rules** (`{colors.dark-text-primary}`, `{colors.dark-text-secondary}`, `{colors.dark-text-muted}`, `{colors.dark-border}`, `{colors.dark-border-accent}`): Preserve dark-mode hierarchy and border treatments.
- Green, amber, and red remain success, warning, and error semantics; red also identifies the MCQ flag/report action.

## Typography

**Display Font:** Hind Shiliguri (with Noto Sans Bengali, SolaimanLipi, and system fallbacks)
**Body Font:** Hind Shiliguri (with Noto Sans Bengali, SolaimanLipi, and system fallbacks)
**Label/Mono Font:** No distinct label or mono family is defined.

**Character:** The Bengali-first sans family supports the compact controls and
readable question and explanation copy. Numerals use Bengali locale formatting.

### Hierarchy
- **Display** (700, `clamp(2.05rem, 4.6vw, 3.25rem)`, 1.12): Dashboard hero heading.
- **Headline** (700, `clamp(1.5rem, 2.6vw, 2rem)`, 1.2): Shared first-level headings.
- **Title** (700, `1.25rem`, 1.3): Section headings.
- **Body** (400, `1rem`, 1.65): General interface and content copy.
- **Label** (500, `.75rem`): Compact metadata; form labels use `.8125rem` and 600 weight.

Inputs remain at least 16px to avoid mobile browser zoom.

## Layout

The dashboard hero uses a two-column layout and stacks on narrow screens. Mobile
navigation retains horizontal scrolling. The visual review screenshots recorded in
`.impeccable/review/` cover 360px, 390px, 768px, 1024px, 1280px, and 1440px; at 360px,
the dashboard and stats remain within the viewport. Breakpoint tokens and additional
review detail live in the sidecar.

## Elevation & Depth

The system combines tonal surface changes, borders, and soft shadows. Light shadows
use a purple cast; dark mode retains its existing shadows. Glass is restricted to
floating chrome such as navigation, exam toolbar, dialogs, and toasts; text-heavy
cards use solid surfaces.

### Shadow Vocabulary
- **Light card**: `0 2px 8px rgba(83, 45, 135, .06)` for quiet card lift.
- **Light elevated**: `0 8px 24px rgba(83, 45, 135, .09)` for raised content.
- **Light overlay**: `0 16px 40px rgba(83, 45, 135, .12)` for deeper elevation.
- **Dark card**: `0 8px 26px rgba(7, 6, 13, .24)` and **dark elevated**: `0 18px 44px rgba(7, 6, 13, .38)` remain unchanged.

## Shapes

Cards use gently rounded corners (18px), controls use medium rounding (14px), and
compact controls use the 10px radius. Borders distinguish surfaces with low visual
weight. The Pathshala book mark keeps its shape in both modes.

## Components

### Buttons
- **Shape:** Compact rounded controls (10px); primary button uses the existing purple action treatment.
- **Primary:** Purple action color with white text; the current button treatment uses a purple gradient.
- **Hover / Focus:** Short transitions; purple focus ring and active states.
- **Secondary / Ghost / Destructive:** Shared outlined, low-emphasis, and destructive variants.

### Chips
- **Style:** Rounded filter and selection controls use the active theme's surface, ink, and purple tokens.
- **State:** Selected options receive a soft purple fill and accent border.

### Cards / Containers
- **Corner Style:** Large rounded corners (18px).
- **Background:** Solid white or near-white in light mode; charcoal surfaces in dark mode.
- **Shadow Strategy:** Use the theme's card elevation; glass remains limited to floating chrome.
- **Border:** Delicate theme border.
- **Internal Padding:** Common card padding is 20px.

### Inputs / Fields
- **Style:** Theme surface and ink, outlined control, 10px radius.
- **Focus:** Purple border/focus treatment; fields retain a 16px minimum text size.

### Navigation and Exam States
- `.topbar`, `.mobile-nav`, `.nav-btn`, and `.icon-btn` provide compact navigation, purple active indication, mobile horizontal scroll, and theme toggle. The red flag control remains beside the theme control.
- `.hero` and `.hero-demo` retain the interactive answerable MCQ preview; `.stats-strip`, `.action-row`, and `.subject-row` provide dashboard metrics and practice choices.
- `.q-prompt`, `.question-option`, `.palette-btn`, `.question-nav`, `.timer`, and `.exam-toolbar` cover question states, navigation, timer, and progress.
- `.flagged-item`, `.flagged-tools`, and `.question-flag` provide the searchable editable flagged-question queue; latest reports appear first and the queue stays in its separate database.
- `.modal`, `.modal-card`, `.toast`, and `.site-footer` provide shared dialogs, feedback, and footer treatment.
- `static/icons/logo-aubergine.svg` is selected only in light mode; dark mode continues to use `static/icons/logo.svg`.

The theme toggle persists the user's choice; first visit defaults to dark. Theme-color
metadata follows the selected mode. Correct and incorrect answer outcomes retain
green/red semantics. Existing routes, authentication, API integrations, exam state,
question data, offline PWA behavior, and flagged database schema are unchanged.

## Do's and Don'ts

### Do
- Pair semantic color with a glyph or word.
- Keep question text and answer states high contrast against the dark preview surface.
- Use solid surfaces for text-heavy cards; reserve glass for floating chrome.

### Don't
- Avoid pulsing decoration and gradient text.
- Do not use glass on text-heavy content cards.
- Do not replace the established dark palette while refreshing the light theme.
