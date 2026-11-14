# Contributing

Thanks for helping. Bug reports, fixes and docs improvements are all welcome. For a change to the public API, open an issue first so we can agree on the shape before you write it.

## Set up

Using the package needs Node 20.19 or later (or Bun, Deno or an edge runtime); developing it needs Node 22.12 or later.

```bash
git clone https://github.com/FlightByte-dev/flightbyte-node.git
cd flightbyte-node
npm ci
npm test
```

The tests never touch the real API and need no key.

## Before you open a pull request

```bash
npm run check    # typecheck, lint, test and build
```

CI runs the same checks on Node 22 and 24, checks the packed package with `publint` and `attw`, and runs the build on Node 20.19, Bun and Deno. A pull request needs all of it green.

- **`src/` uses web-standard APIs only:** `fetch`, `Request`, `Response`, `crypto.subtle`, `AbortSignal`, `TextEncoder`. The build cannot see Node's types and ESLint rejects `node:` imports there, so the package keeps running on Bun, Deno and the edge.
- **Everything exported has a TSDoc comment.** It shows in editors and on npm.
- **Every change has a test.** Requests go through a fake `fetch` (see `test/helpers/mock.ts`), never to the network.
- **No runtime dependencies.** Keep it that way unless an issue agrees otherwise.
- **Add a line to `CHANGELOG.md`** under a `## Unreleased` heading for anything a user would notice.

## How the code maps to the API

The types mirror the API's [OpenAPI document](https://flightbyte.dev/openapi.json), and `test/spec.test.ts` checks them against a copy of it in `spec/openapi.json`. Refresh that copy and see what changed:

```bash
npm run sync:openapi
npm test
```

- **The API adds a field:** add it to the interface in `src/models.ts`. A field the API may leave out is optional; one it may send as `null` includes `null`. The spec test fails until you do, and fails if a field has no place in the document unless it is listed, with the reason, in `UNDOCUMENTED_FIELDS`.
- **The API adds an enum value** (a phase, status, change type or event type): add it to its list in `src/models.ts`. Until then the value is still a valid string, which is why nothing breaks for users in the meantime.
- **The API adds an error code or status:** map it in `src/errors.ts` and add a case to `test/errors.test.ts`.
- **The API adds an endpoint:** add a method to the resource in `src/resources/`, a line to `CALLS` in `test/spec.test.ts`, a test in `test/resources.test.ts`, and a row to the README's API tables.

## Webhook signatures

`test/fixtures/webhook_vectors.json` holds signatures made with Node's `createHmac`, exactly as the API signs deliveries, so the Web Crypto verifier is checked against the server and not only against itself. Do not edit those files by hand. To regenerate them, for example after adding a case to the script:

```bash
node tool/webhook_vectors.mjs
```

## Commit messages

One line that says what changed and why it matters, in plain words, for example `Subscriptions can be listed by origin airport`. Add a body when the reason is not obvious from the diff.

## Releasing

Maintainers only.

1. Set `version` in `package.json` and `VERSION` in `src/version.ts`; a test fails if they differ.
2. Rename `## Unreleased` in `CHANGELOG.md` to the new version.
3. Push a tag `v<version>`, for example `v0.1.1`.

The release workflow checks that the tag, `package.json` and `src/version.ts` agree and that the changelog has the section, runs every check, publishes to npm with trusted publishing unless that version is already there, and creates the GitHub release from the version's `CHANGELOG.md` section. To rehearse a release without publishing anything, run the workflow by hand from the Actions tab.

A version on npm can never be republished, even after an unpublish. Fix a bad release with a new version.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
