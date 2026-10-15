# Repository Instructions

- **Focus on Project Source Files**: Inspect and edit repository files directly (`src/app/...`, `src/styles.scss`). Avoid reading compiled vendor/library distribution files in `node_modules` (e.g., Angular Material bundles like `node_modules/@angular/material/...`).
- **Targeted Inspections**: Avoid repetitive read loops. Make surgical changes directly once the relevant project file location is identified.
- **Testing**: Run builds (`npm run build`) and TypeScript checks (`npx tsc --noEmit -p tsconfig.spec.json`). Do not run browser/Playwright tests unless explicitly instructed.
