# Lorelight

Lorelight is an immersive reading-library project: a calm place to discover and
read public-domain books, with a thoughtful AI reading companion planned for a
later milestone.

## Getting started

```sh
npm install
npm run dev
```

The current catalog uses the [Gutendex API](https://gutendex.com/) to discover
English-language books from Project Gutenberg. Book text and cover images are
served by Project Gutenberg. Availability and regional public-domain status can
vary; each book links back to its source. A same-origin server proxy keeps
catalog and book-text requests out of the browser and avoids cross-origin
request failures.

## Scripts

- `npm run dev` — start the local development server
- `npm run typecheck` — check TypeScript
- `npm run build` — type-check and create a production build
- `npm run preview` — preview the production build locally
- `npm start` — serve the production build and book-data proxy on port 4173

For production, run `npm run build` before `npm start`. The server expects the
generated `dist` directory and supports the `PORT` environment variable.

## Project direction

The first milestone focuses on discovery, a personal saved shelf, and a
customizable reading surface. AI features will be designed around cited,
book-grounded answers and introduced after the reading foundation is in place.
