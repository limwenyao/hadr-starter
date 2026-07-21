# Calendar Art 🗓️

Turn any **emoji, word, or image** into pixel art rendered as a week of fake
meetings inside a Google-Calendar-style week view. Each day is a column, each
15-minute slot is a pixel; empty slots become a green sea of fake meetings
("Sync", "Standup", "1:1", "Lunch"…) and your image is painted on top with
Google Calendar's 11 event colors.

## Run it

It's a single self-contained HTML file — no build, no server, no keys.

```
open calendar-art/index.html          # macOS
xdg-open calendar-art/index.html      # Linux
```

Or just double-click the file. Everything (image → grid → palette mapping →
DOM) happens client-side in the browser.

## Use it

- **Emoji** — type any emoji (🐠 🍕 🦆 ❤️). Full color on any device with a color
  emoji font.
- **Text** — type a word; it's rendered as blocky Blueberry-blue letters.
- **Image** — drop in a small PNG/JPG; it's downsampled to the 42×40 grid and
  each pixel snapped to the nearest calendar color.
- **Zoom** — slider changes pixel size.
- **Zoom out** — hides event titles so the picture reads (like the wide shots in
  the reference clip).
- **Reshuffle titles** — re-randomizes the fake meeting names.

### Shareable presets (URL hash)

- `index.html#text=HELLO`
- `index.html#emoji=🐟`
- `index.html#text=BUSY&compact` — text mode, zoomed out

## How it works

1. The source (emoji/text/image) is drawn to an offscreen `<canvas>` and
   downscaled to a `42 × 40` grid (7 days × 6 sub-columns wide, 8 AM–6 PM in
   15-min rows tall).
2. Each cell is mapped to the nearest Google Calendar event color; transparent
   pixels become the green "empty schedule" background.
3. Vertically-adjacent same-color cells merge into one taller event block (so
   it looks like real events of varying length), each given a fake meeting
   title. A seeded PRNG keeps a given image packing the same way every time.

## Getting it into *real* Google Calendar

This renders a look-alike. To push the same events into an actual Google
Calendar you'd need the Calendar API (`events.insert` with `colorId` 1–11) — the
per-event colors can't be set via plain `.ics` import. Ask and that script can
be added.
