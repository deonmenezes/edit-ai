# EditAI

AI-powered video editor for the web.

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

## Status

Early development. The web app is a scaffold right now; the editor, timeline, and AI features are being built.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19
- Vite + Tailwind CSS v4 + shadcn/ui
- Cloudflare Workers (via Wrangler)
- Bun + Turborepo monorepo

## Getting started

```bash
bun install
bun run dev:web
```

The web app runs at http://localhost:5173.

## Layout

```
apps/
  web/   TanStack Start app (deploys to Cloudflare Workers)
```

## Scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `bun run dev`       | Run every app in dev mode             |
| `bun run dev:web`   | Run only the web app                  |
| `bun run build`     | Build every app                       |
| `bun run deploy`    | Build and deploy to Cloudflare        |

## Contributing

Issues and pull requests are welcome. Please open an issue first for anything larger than a bug fix.

## License

[MIT](LICENSE)
