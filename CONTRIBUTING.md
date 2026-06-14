# Contributing

Thanks for taking the time to contribute.

## Getting started

```
npm install
npm run build
```

A local broker for development and integration tests:

```
docker compose up -d
```

## Checks

Before opening a pull request, make sure these pass:

```
npm run format:check
npm run lint
npm run typecheck
npm test
```

The integration suite starts a broker with Testcontainers and needs a running Docker
daemon:

```
npm run test:integration
```

## Pull requests

- Keep changes focused; one logical change per pull request.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
  (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
- Add or update tests for behaviour you change.
- Note user-facing changes in `CHANGELOG.md` under an Unreleased section.

## Adding a tool

Tools live in `src/tools` and are registered through `defineTool`. Set `write: true`
for anything that changes broker state and `destructive: true` for anything that
removes or relocates data; destructive tools must include the shared `confirm` flag in
their input schema. Cover the new tool in both the unit and integration suites.
