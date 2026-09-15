# Darkflib

An initial React, Vite, TypeScript, and Tailwind implementation of the cyberpunk personal-page mockup. The original generated mockup is at `public/images/design-reference.png`; separate generated artwork is used for the hero and project cards so page text and controls remain accessible HTML.

```sh
npm install
npm run dev
npm run build
```

The service-worker panel is the first functional milestone from the linked design conversation. It registers `/service-worker.js`, observes lifecycle changes, checks whether the worker controls the current page, and displays a bounded 200-entry in-memory event log. The worker has no `fetch` listener and does not inject faults yet.

The three projects and tech-stack items reflect the visual mockup and are concept content. Project dialogs say so explicitly. Contact details and real project links still need confirmed destinations before publication.
