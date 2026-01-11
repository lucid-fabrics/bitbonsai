# Mintlify Documentation Deployment

## What Was Added

Created comprehensive developer documentation for Mintlify:

| File | Description |
|------|-------------|
| `development/website.mdx` | Website (marketing site) documentation |
| `development/license-api.mdx` | License API documentation |
| `mint.json` | Added "Development" navigation group |

---

## Local Preview

Test documentation locally before deploying:

```bash
cd docs-mintlify
mintlify dev
```

Opens at `http://localhost:3000`

**Preview URLs:**
- http://localhost:3000/development/website
- http://localhost:3000/development/license-api

---

## Deploy to Production

Documentation auto-deploys to **https://bitbonsai.app/docs** on push to `main`.

<Steps>
  <Step title="Commit Changes">
    ```bash
    git add docs-mintlify/
    git commit -m "docs: add website and license-api developer docs"
    ```
  </Step>

  <Step title="Push to GitHub">
    ```bash
    git push origin main
    ```
  </Step>

  <Step title="Auto-Deploy">
    Mintlify GitHub integration automatically deploys within 2-3 minutes.

    Monitor at: https://dashboard.mintlify.com
  </Step>

  <Step title="Verify Live Docs">
    - https://bitbonsai.app/docs/development/website
    - https://bitbonsai.app/docs/development/license-api
  </Step>
</Steps>

---

## What's Documented

### Website (`/development/website`)

**Sections:**
- Overview (tech stack, ports)
- Architecture (file structure)
- License-API integration (pricing endpoint)
- Development setup
- Build & deployment (Netlify, Vercel, etc.)
- Pages (home, pricing, features)
- Styling (Tailwind CSS)
- Assets (favicons, images)
- SEO (meta tags, robots.txt)
- Testing (unit, E2E)
- Troubleshooting

**Key Features:**
- Interactive cards, tabs, accordions
- Code examples with syntax highlighting
- Step-by-step guides
- Platform comparison tables

### License-API (`/development/license-api`)

**Sections:**
- Overview (tech stack, responsibilities)
- Architecture (file structure)
- API endpoints (public + admin)
- Ed25519 keypair security (critical backup procedures)
- Development setup
- License key format
- Stripe integration (webhooks, subscription flow)
- Security features
- Troubleshooting

**Key Features:**
- API endpoint documentation with cURL examples
- Security warnings for keypair backup
- Step-by-step setup guides
- Mermaid diagrams (subscription flow)
- Recovery procedures

---

## Navigation Structure

```
docs-mintlify/
├── Getting Started
│   ├── introduction.mdx
│   └── quickstart.mdx
├── Installation
│   ├── docker.mdx
│   ├── unraid.mdx
│   └── requirements.mdx
├── User Guide
│   ├── first-scan.mdx
│   ├── understanding-jobs.mdx
│   └── monitoring.mdx
├── Advanced
│   ├── multi-node.mdx
│   ├── codec-selection.mdx
│   └── troubleshooting.mdx
├── Development (NEW)
│   ├── website.mdx (NEW)
│   └── license-api.mdx (NEW)
└── Support
    └── faq.mdx
```

---

## Content Differences

### `/docs` (GitHub) vs `/docs-mintlify` (Website)

| Location | Audience | Format | Purpose |
|----------|----------|--------|---------|
| `docs/` | Developers | Markdown | Project documentation, architecture |
| `apps/website/README.md` | Developers | Markdown | Website app development guide |
| `apps/license-api/README.md` | Developers | Markdown | License-API development guide |
| `docs-mintlify/` | Users + Developers | MDX | Public-facing docs at bitbonsai.app/docs |

**Key Distinction:**
- GitHub docs (`/docs`, `apps/*/README.md`) = **developer reference**
- Mintlify docs (`/docs-mintlify`) = **user-facing + developer guides**

---

## Next Steps

After deploying, consider adding:

1. **Backend documentation** (`development/backend.mdx`)
   - Main transcoding backend
   - Encoding processor architecture
   - TRUE RESUME system
   - Auto-heal implementation

2. **Frontend documentation** (`development/frontend.mdx`)
   - Angular app architecture
   - NgRx state management
   - WebSocket real-time updates

3. **API Reference** (`api-reference/`)
   - OpenAPI/Swagger specs
   - Auto-generated from NestJS controllers

4. **Contributing Guide** (`contributing.mdx`)
   - Development workflow
   - Code conventions
   - Pull request process

---

## Troubleshooting

### Mintlify CLI Not Found

```bash
npm install -g mintlify
```

### Build Errors

```bash
# Check MDX syntax
cd docs-mintlify
mintlify dev
```

Look for:
- Unclosed tags (`<Card>` without `</Card>`)
- Invalid frontmatter YAML
- Broken internal links

### Navigation Not Showing

Verify `mint.json` navigation structure:
```json
{
  "group": "Development",
  "pages": ["development/website", "development/license-api"]
}
```

**Important:** Page paths in `mint.json` must match file paths (without `.mdx` extension).

---

## Maintenance

**When to update Mintlify docs:**
- API endpoint changes → Update `development/license-api.mdx`
- Website deployment changes → Update `development/website.mdx`
- New environment variables → Add to setup sections
- Architecture changes → Update diagrams

**Keep in sync:**
- GitHub README files (`apps/*/README.md`) for developer reference
- Mintlify MDX files for user-facing documentation
