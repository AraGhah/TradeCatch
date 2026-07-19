# Third-Party Licences

This project depends on the following open-source packages. All are
permissively licensed (MIT or Apache-2.0) and compatible with commercial,
closed-source use. Versions reflect what was installed at the time of this
audit — re-run `npm ls --depth=0` to confirm current versions before relying
on this list.

## Direct runtime dependencies

| Package | Version | Licence |
| --- | --- | --- |
| next | 16.2.10 | MIT |
| react | 19.2.4 | MIT |
| react-dom | 19.2.4 | MIT |
| next-intl | 4.13.2 | MIT |
| framer-motion | 12.42.2 | MIT |
| zod | 4.4.3 | MIT |
| resend | 6.17.2 | MIT |

## Direct development dependencies (not shipped to the browser)

| Package | Version | Licence |
| --- | --- | --- |
| typescript | 5.9.3 | Apache-2.0 |
| eslint | 9.39.5 | MIT |
| eslint-config-next | 16.2.10 | MIT |
| tailwindcss | 4.3.3 | MIT |
| @tailwindcss/postcss | 4.3.3 | MIT |
| playwright | 1.61.1 | Apache-2.0 |
| @types/node, @types/react, @types/react-dom | — | MIT |

## Notes

- No package here carries a copyleft (GPL/AGPL) licence; none require this
  project's own source to be published.
- `playwright` is a devDependency used only for internal QA screenshots and
  the automated test suite (`tests/`) — it is never bundled into the
  production build.
- Fonts, icons, and illustrations used on the site are either custom-built
  (inline SVG components in `src/components/icons.tsx`) or system font
  stacks — no third-party font/icon/stock-photo licences apply today. If
  photography, stock icons, or a hosted font service are added later, list
  their licences here before launch.
- A known moderate-severity advisory (`GHSA-qx2v-qp2m-jg93`, PostCSS XSS via
  unescaped `</style>` in CSS stringification) is flagged by `npm audit`
  against a `postcss` version bundled *inside* `next`'s own build tooling,
  not a direct dependency of this project. It affects PostCSS's own CSS
  serializer at build time, not this project's runtime output, and the only
  available fix requires downgrading `next` to a pre-9.x release — not
  viable. Documented as an accepted, monitored residual risk; re-check with
  `npm audit` after each `next` upgrade.
