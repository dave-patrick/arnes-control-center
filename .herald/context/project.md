# arnes-control-center: project context

## Overview
Software project in arnes-control-center. See existing project documentation for its purpose.

## Existing guidance
- Inspect the project documentation and source before making changes.

## Stack evidence
- Determine the stack from the source and build files; do not assume one.

## Conventions
- Preserve existing project instructions, configuration, credentials, and application data.
- Use Graft for code context when available, following the global and project Graft guidance.
- Keep this context accurate as project architecture and conventions are established.
- Herald compiler output replaces vendor files. Preserve and merge existing guidance before compiling.

- app/ is the cleaned local Node workspace; site/ is the public static landing/help site. Never commit private settings or change the running original workspace. See documentation/ARCHITECTURE.md.

- The app publisher is Atomic 22 Industries. Keep publisher.json, package metadata and first-party app/site credits consistent; preserve existing licence and third-party attribution.

- Public landing pages use dark app-specific compositions with real approved brand assets; shared Atomic 22 navigation links to the blue Notes directory. Publish only site/ via GitHub Pages. Never serve or publish private workspace data.
