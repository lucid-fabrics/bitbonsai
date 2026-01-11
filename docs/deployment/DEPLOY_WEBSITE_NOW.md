# URGENT: Deploy bitbonsai.app Website

**Status:** Site is DOWN (HTTP 502)
**Build:** Ready in `dist/apps/website/browser/` (664KB)
**Cause:** No origin server configured in Cloudflare

---

## Quick Fix (5 minutes)

### Option 1: Cloudflare Pages Dashboard (FASTEST)

1. **Login:** https://dash.cloudflare.com
2. **Create Pages Project:**
   - Workers & Pages → Create → Pages → Upload assets
   - Project name: `bitbonsai-website`
   - Drag & drop: `/Users/wassimmehanna/git/bitbonsai/dist/apps/website/browser/`
   - Click **Deploy**

3. **Add Custom Domain:**
   - After deployment → Custom domains → Add domain
   - Enter: `bitbonsai.app`
   - Save (Cloudflare auto-configures DNS)

4. **Verify:**
   ```bash
   curl -I https://bitbonsai.app/
   # Should return: HTTP/2 200
   ```

**Done! Site should be live in 2-3 minutes.**

---

### Option 2: Wrangler CLI (if installed)

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
cd ~/git/bitbonsai
wrangler pages deploy dist/apps/website/browser \
  --project-name=bitbonsai-website \
  --branch=main
```

After first deployment, add custom domain in dashboard:
- https://dash.cloudflare.com → Pages → bitbonsai-website → Custom domains
- Add: `bitbonsai.app`

---

### Option 3: Netlify (Alternative)

**If Cloudflare doesn't work:**

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
cd ~/git/bitbonsai
netlify deploy --prod --dir=dist/apps/website/browser
```

Then configure custom domain in Netlify dashboard:
- Set domain to: `bitbonsai.app`
- Update Cloudflare DNS to point to Netlify (they'll provide IP/CNAME)

---

## Verification Steps

```bash
# 1. Check HTTP status
curl -I https://bitbonsai.app/

# 2. Check DNS
dig bitbonsai.app +short

# 3. Test in browser
open https://bitbonsai.app/
```

**Expected:**
- HTTP status: 200 OK
- Page loads with BitBonsai branding
- No Cloudflare error page

---

## Auto-Deploy Setup (Prevent Future Outages)

After manual deployment, set up GitHub Actions:

### 1. Get Cloudflare Credentials

**Account ID:**
- Dashboard → Account → Copy Account ID

**API Token:**
- Dashboard → My Profile → API Tokens → Create Token
- Template: "Edit Cloudflare Workers"
- Permissions: `Account.Cloudflare Pages:Edit`
- Copy token

### 2. Add to GitHub Secrets

Go to: https://github.com/YOUR_USERNAME/bitbonsai/settings/secrets/actions

Add:
- `CLOUDFLARE_API_TOKEN` = (token from step 1)
- `CLOUDFLARE_ACCOUNT_ID` = (account ID from step 1)

### 3. Commit Workflow

```bash
cd ~/git/bitbonsai
git add .github/workflows/deploy-website.yml
git add .nvmrc
git add deploy-website.sh
git add WEBSITE_DEPLOYMENT.md
git add DEPLOY_WEBSITE_NOW.md
git commit -m "ci: add website auto-deploy to fix recurring 502 errors"
git push origin main
```

**Result:** Every push to `main` that changes `apps/website/` auto-deploys to Cloudflare Pages.

---

## What Was Wrong

| Issue | Impact | Fix |
|-------|--------|-----|
| No origin server | Cloudflare can't serve requests (502) | Deployed to Cloudflare Pages |
| No CI/CD pipeline | Manual deployments required | Added GitHub Actions workflow |
| No documentation | Unclear how to deploy | Created WEBSITE_DEPLOYMENT.md |
| Domain confusion | Docs say `bitbonsai.io` but domain is `.app` | Clarified in README |

---

## Files Created

| File | Purpose |
|------|---------|
| `.github/workflows/deploy-website.yml` | Auto-deploy on push |
| `deploy-website.sh` | Manual deployment script |
| `WEBSITE_DEPLOYMENT.md` | Comprehensive deployment guide |
| `DEPLOY_WEBSITE_NOW.md` | This urgent fix guide |
| `.nvmrc` | Node version lock (20) |

---

## Next Steps After Deploy

1. **Test site:** https://bitbonsai.app/
2. **Commit fix:** Push workflow files to GitHub
3. **Monitor:** Add uptime monitoring (UptimeRobot, Checkly)
4. **Document:** Update main README with deployment info

---

## Emergency Contact

If site goes down again after deployment:

**Check Cloudflare Pages:**
- Dashboard: https://dash.cloudflare.com → Pages
- Status: Should show recent deployment
- Logs: Check build/deployment logs

**Redeploy:**
```bash
cd ~/git/bitbonsai
./deploy-website.sh
```

**Rollback:**
- Cloudflare dashboard → Pages → bitbonsai-website → Deployments
- Click previous deployment → "Rollback to this deployment"
