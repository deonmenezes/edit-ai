# Contributing to EditAI

Thanks for your interest in EditAI. Contributions of all kinds are welcome: bug reports, feature ideas, docs, and code.

## Before you start

- For anything larger than a small bug fix, open an issue first so we can agree on the approach.
- Check existing issues to avoid duplicates.
- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need [Bun](https://bun.sh) 1.3 or newer.

```bash
git clone https://github.com/deonmenezes/edit-ai.git
cd edit-ai
bun install
bun run dev:web
```

The web app runs at http://localhost:5173.

## Project layout

```
apps/
  web/   TanStack Start app (React 19, Vite, Tailwind v4, shadcn/ui), deploys to Cloudflare Workers
```

## Making changes

1. Fork the repo and create a branch from `main`.
2. Make your change. Keep commits focused; one logical change per commit.
3. Make sure `bun run build` passes.
4. Add or update tests in `apps/web` where it makes sense (`bun run test`).
5. Open a pull request using the template and link the related issue.

## Commit messages

Use short, imperative subjects, for example `feat(web): add timeline zoom` or `fix(web): clamp playhead to clip bounds`. A `type(scope): summary` prefix is preferred but not enforced.

## Reporting security issues

Please do not open public issues for security problems. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE).
