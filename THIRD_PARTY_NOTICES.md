# Open-source software and external data

The original application code is licensed under MIT; see LICENSE. No proprietary UI kit, paid component library, remote font, or image asset is required. Dependencies retain their own licenses and notices in their packages. Preserve those notices when redistributing binaries or dependencies.

## Installed dependency license declarations

Audited from the installed package metadata on October 25, 2026. `pnpm-lock.yaml` records the exact resolved versions. Platform-specific packages can differ on other operating systems.

| Package(s) | License |
| --- | --- |
| Next.js, React, React DOM, @next/env, @next/swc, styled-jsx, client-only | MIT |
| tsx, esbuild, @esbuild/win32-x64 | MIT |
| TypeScript, @swc/helpers, detect-libc, sharp | Apache-2.0 |
| @img/sharp-win32-x64 (bundled native image libraries) | Apache-2.0 AND LGPL-3.0-or-later |
| @img/colour, @types/node, @types/react, @types/react-dom, csstype, nanoid, postcss, react scheduler, undici-types | MIT |
| picocolors, semver | ISC |
| source-map-js | BSD-3-Clause |
| tslib | 0BSD |
| caniuse-lite browser compatibility data | CC-BY-4.0 |

Next.js distributes additional bundled components with their own notices; retain its package license files. The native Sharp package includes LGPL libraries, so distribution must preserve the corresponding notices and applicable LGPL requirements. Open-source licensing does not mean every dependency is MIT.

## Provider reference material

- The Odds API (primary odds provider): https://the-odds-api.com/liveapi/guides/v4/. Account keys from https://dash.the-odds-api.com/api are used only with https://api.the-odds-api.com/v4. Its external service/data terms are separate from the app license; no SDK dependency is required.
- API-Sports official documentation: https://api-sports.io/documentation
- Public ESPN API reference: https://github.com/pseudo-r/Public-ESPN-API (MIT reference project; unofficial endpoints).
- Odds API reference: https://github.com/odds-api/odds-api (Apache-2.0 reference project). The service is https://odds-api.net; integration uses https://api.odds-api.net/v1 with the X-API-Key header.

The adapters are original code written against provider response formats; the external repositories are not vendored. The provider API schemas, services, odds, statistics, names, and returned content are governed separately by their providers. The app's MIT license does not relicense external data. No provider key is included.
