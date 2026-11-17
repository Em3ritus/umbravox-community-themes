# UMBRAVOX themes

Themes people have shared for [UMBRAVOX](https://github.com/Em3ritus/umbravox), a passive, receive-only wardriver.
The gallery is at <https://em3ritus.github.io/umbravox-themes/>.

A theme changes how the device looks: colours, a centre picture, an optional radar clip and optional alert sounds.
It is data only. It cannot run code, and it cannot make the device transmit.

## Use a theme

Open the gallery, pick a theme and press **Open in designer**. The designer loads it so you can change it, download
it, or install it on your SD card or over USB.

## Share a theme

1. Make the theme in the [designer](https://em3ritus.github.io/umbravox/designer/) and press **Share...**.
2. The designer saves the theme as a zip and opens the submission form here. You need a GitHub account.
3. Drag the zip into the form, tick both boxes and submit.

Automatic checks reply on your submission within a few minutes. If the theme is accepted by the checks, a maintainer
reviews it; it appears in the gallery once approved. Read the [content rules](CONTENT-RULES.md) first.

## How it works

| Path | What it is |
| --- | --- |
| `themes/<folder>/` | An approved theme: the pack files as the designer wrote them, plus `meta.json` (who submitted it and when). |
| `previews/<folder>/` | `cyd.png` and `waveshare.png`, drawn by the device's own drawing code. |
| `site/` | The gallery page. |
| `scripts/` | Reading a submission, unpacking its zip under strict limits, building the gallery's `index.json`. |
| `.github/workflows/` | The checks on a submission, and publishing the site. |
| `FIRMWARE_PIN` | The UMBRAVOX release the theme loader and the drawing code are taken from. |

Tests: `npm test` (Node 22, no dependencies).

## Remove a theme

Delete `themes/<folder>/` and `previews/<folder>/` and push. The site is rebuilt without it.
