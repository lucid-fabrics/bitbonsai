# Website Deployment Setup

## Issue

`bitbonsai.app` returns HTTP 502 because no origin server is configured.

## Root Cause

- Cloudflare DNS configured but no hosting platform connected
- No CI/CD pipeline for automatic deployment
- Website code exists but never deployed

## Permanent Fix: Cloudflare Pages

### Why Cloudflare Pages?

| Feature | Benefit |
|---------|---------|
| Free tier | Unlimited requests |
| Auto-deploy | Push to GitHub → auto-build → auto-deploy |
| Cloudflare integration | Native DNS/SSL/CDN support |
| Zero config | Works with existing Cloudflare setup |

---

## Setup Steps

### 1. Create Cloudflare Pages Project

**Manual Setup (Web UI):**

1. Go to https://dash.cloudflare.com
2. Select your account
3. Go to **Workers & Pages** → **Create application** → **Pages**
4. Connect to GitHub repository: `bitbonsai`
5. Configure build:
   - **Project name:** `bitbonsai-website`
   - **Production branch:** `main`
   - **Build command:** `npx nx build website --configuration=production`
   - **Build output directory:** `dist/apps/website/browser`
   - **Root directory:** (leave empty)
6. Click **Save and Deploy**

### 2. Configure Custom Domain

After first deployment:

1. Go to **Pages project** → **Custom domains**
2. Click **Set up a custom domain**
3. Enter: `bitbonsai.app`
4. Cloudflare auto-configures DNS (since it's already your nameserver)
5. SSL certificate provisioned automatically

### 3. Add GitHub Secrets (for CI/CD)

**Get Cloudflare credentials:**

1. **Account ID:**
   - Dashboard → Account → Copy Account ID

2. **API Token:**
   - Dashboard → **My Profile** → **API Tokens** → **Create Token**
   - Use template: "Edit Cloudflare Workers"
   - Permissions: `Account.Cloudflare Pages:Edit`
   - Copy token

**Add to GitHub:**

1. Go to https://github.com/YOUR_USERNAME/bitbonsai/settings/secrets/actions
2. Add secrets:
   - `CLOUDFLARE_API_TOKEN` = (token from above)
   - `CLOUDFLARE_ACCOUNT_ID` = (account ID from above)

### 4. Deploy

**Option A - Automatic (recommended):**
```bash
git add .github/workflows/deploy-website.yml
git commit -m "ci: add website auto-deploy to Cloudflare Pages"
git push origin main
```

**Option B - Manual trigger:**
- GitHub → Actions → "Deploy Website to Cloudflare Pages" → Run workflow

### 5. Verify

```bash
curl -I https://bitbonsai.app/
# Should return: HTTP/2 200
```

---

## Alternative: Netlify (Backup Option)

If Cloudflare Pages unavailable:

### Quick Deploy
```bash
# Build
nx build website --configuration=production

# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist/apps/website/browser
```

### GitHub Actions (Netlify)
```yaml
- uses: nwtgck/actions-netlify@v3
  with:
    publish-dir: './dist/apps/website/browser'
    production-branch: main
  env:
    NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
    NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

---

## Troubleshooting

### 502 Still Occurs

**Check Cloudflare Pages deployment:**
```bash
curl -I https://bitbonsai-website.pages.dev/
```

If that works but `bitbonsai.app` doesn't:
1. Check custom domain configuration in Pages project
2. Verify DNS: `dig bitbonsai.app` should point to Cloudflare
3. Check SSL certificate status in Cloudflare dashboard

### Build Fails

**Common issues:**
- Node version: Use Node 20 (`.nvmrc` file recommended)
- Dependencies: Run `npm ci --legacy-peer-deps`
- Build path: Must be `dist/apps/website/browser` (not `dist/apps/website`)

### Custom Domain Not Working

**DNS propagation:**
```bash
dig bitbonsai.app +short
# Should return Cloudflare IPs like 172.64.80.1
```

If wrong IPs:
1. Cloudflare dashboard → DNS → Check A/CNAME records
2. Pages project → Custom domains → Re-add domain

---

## Monitoring

### Deployment Status

**Cloudflare Pages:**
- Dashboard: https://dash.cloudflare.com → Pages → bitbonsai-website
- Deployments: View build logs, preview URLs

**GitHub Actions:**
- Repository → Actions → Deploy Website workflow
- Green checkmark = successful deployment

### Uptime Monitoring

**Add to monitoring tool:**
- URL: https://bitbonsai.app/
- Expected: HTTP 200
- Alert if: HTTP 502 or timeout

**Free options:**
- UptimeRobot (https://uptimerobot.com)
- Checkly (https://checklyhq.com)
- Cloudflare Analytics (built-in)

---

## Prevention Checklist

- [x] GitHub Actions workflow created
- [ ] Cloudflare Pages project configured
- [ ] Custom domain `bitbonsai.app` added to Pages
- [ ] GitHub secrets configured (API token, Account ID)
- [ ] First deployment successful
- [ ] Custom domain resolves correctly
- [ ] Uptime monitoring enabled
- [ ] Team notified of new deployment process

---

## Related Files

| File | Purpose |
|------|---------|
| `.github/workflows/deploy-website.yml` | CI/CD pipeline (auto-deploy) |
| `apps/website/project.json` | Nx build configuration |
| `apps/website/Dockerfile` | Container build (not used for Pages) |
| `WEBSITE_DEPLOYMENT.md` | This guide |

---

## Contact

If recurring 502 errors persist after setup:
1. Check Cloudflare Pages deployment logs
2. Verify GitHub Actions ran successfully
3. Check custom domain configuration
4. Review DNS settings in Cloudflare dashboard

**Emergency manual deploy:**
```bash
cd ~/git/bitbonsai
nx build website --configuration=production
npx wrangler pages deploy dist/apps/website/browser --project-name=bitbonsai-website
```
(Requires Wrangler CLI: `npm install -g wrangler`)
