# site

The EditAI landing page: <https://editai-agent.vercel.app>

One hand-written `index.html` with inline CSS and JS. No build step, no dependencies, no
framework. Open the file to work on it.

```bash
python3 -m http.server 4477 --directory site    # http://localhost:4477
```

## The hero timeline

The timeline in the hero is not a screenshot. It renders the same sample project the agent server
ships with (`apps/agent/src/project.ts`: `intro.mp4`, `b-roll.mp4`, `talking-head.mp4`, the
voiceover and its three silences) and performs a real ripple delete on it: `mapTime()` in the page
script applies the same rule the server does, so 24.0s becomes 21.1s and clips straddling a silence
get shorter rather than merely shifting.

**If the sample project changes, change `SILENCES` and `LANES` in `index.html` to match.** The page
claims those are real numbers, so they have to stay real.

## Colours

Every colour is lifted from the editor rather than invented: the well, panel and foreground greys
from `apps/web/src/styles.css`, the violet `#7c5cff` from the favicon, and the three clip colours
(`#3aa39b` video, `#e0a63b` text, `#5fae63` audio) that the timeline paints tracks with.

## Deploying

```bash
cd site
vercel deploy --prod --scope deonmenezes-projects
```

Production aliases: `editai-agent.vercel.app` (canonical), `edit-ai-video.vercel.app`,
`edit-ai-lemon.vercel.app`.
