# BitBonsai Documentation

User-facing documentation built with [Mintlify](https://mintlify.com).

## Local Development

```bash
cd docs-mintlify
mintlify dev
```

Opens at `http://localhost:3000` (or next available port).

## Deploy to Mintlify Cloud

### Option 1: GitHub Integration (Recommended)

1. Push docs to GitHub:
   ```bash
   git add docs-mintlify/
   git commit -m "docs: add Mintlify documentation"
   git push
   ```

2. Connect repository at [Mintlify Dashboard](https://dashboard.mintlify.com):
   - Log in with GitHub
   - Click "Add New Project"
   - Select `bitbonsai/bitbonsai` repo
   - Set docs path: `docs-mintlify`
   - Deploy

3. Docs auto-deploy on every push to `main`

### Option 2: CLI Deploy

```bash
# Set API key (do this once)
export MINTLIFY_API_KEY="your-api-key-here"

# Deploy
cd docs-mintlify
mintlify deploy
```

## Custom Domain

After deploying, add custom domain:

1. Go to [Mintlify Dashboard](https://dashboard.mintlify.com)
2. Settings → Custom Domain
3. Add: `docs.bitbonsai.io`
4. Add CNAME record:
   ```
   docs.bitbonsai.io → bitbonsai.mintlify.app
   ```

## Structure

```
docs-mintlify/
├── mint.json              # Config
├── introduction.mdx
├── quickstart.mdx
├── installation/
│   ├── docker.mdx
│   ├── unraid.mdx
│   └── requirements.mdx
├── guides/
│   ├── first-scan.mdx
│   ├── understanding-jobs.mdx
│   └── monitoring.mdx
├── advanced/
│   ├── multi-node.mdx
│   ├── codec-selection.mdx
│   └── troubleshooting.mdx
└── faq.mdx
```

## Updating Docs

1. Edit `.mdx` files
2. Test locally: `mintlify dev`
3. Commit and push
4. Auto-deploys to production

## Content Guidelines

- **Keep it simple** - zero config philosophy
- **User-focused** - not developer docs
- **Visual** - use `<CardGroup>`, `<Tabs>`, `<Steps>`
- **No jargon** - explain in plain English
- **Test first** - verify all instructions work

## Need Help?

- [Mintlify Docs](https://mintlify.com/docs)
- [MDX Guide](https://mdxjs.com/docs/)
