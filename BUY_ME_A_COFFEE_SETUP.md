# ☕ Buy Me a Coffee Setup Instructions

## Step 1: Create Buy Me a Coffee Account

1. Go to https://www.buymeacoffee.com/
2. Click **"Start my page"** or **"Sign up"**
3. Sign up with:
   - Email (wassimmehanna@gmail.com) OR
   - Google account OR
   - GitHub account (recommended for easy integration)

## Step 2: Set Up Your Profile

1. **Choose your username**: This will be your donation page URL
   - Example: `buymeacoffee.com/wmehanna` or `buymeacoffee.com/lucidfabrics`
   - Choose something memorable and professional

2. **Configure your profile**:
   - **Profile picture**: Use Lucid Fabrics logo or your photo
   - **Display name**: "Wassim Mehanna" or "Lucid Fabrics"
   - **Bio**: Write a short description
     ```
     Creator of BitBonsai - A beautiful media library analytics tool
     Building open-source tools for media enthusiasts
     ```
   - **Thank you message**: Customize what supporters see after donating

3. **Set donation amounts**:
   - Default is $5 (one coffee)
   - You can enable $3, $5, $10, or custom amounts

## Step 3: Update README.md

Once you have your username, replace in `README.md`:

**Find this line:**
```markdown
[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/YOUR_USERNAME)
```

**Replace with:**
```markdown
[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/YOUR_ACTUAL_USERNAME)
```

**For example:**
```markdown
[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/wmehanna)
```

## Step 4: Optional - Add to GitHub Sponsors

GitHub has a built-in "Sponsor" button feature:

1. Go to your GitHub profile settings
2. Navigate to **"Sponsorships"**
3. Add your Buy Me a Coffee link
4. Create `.github/FUNDING.yml` in your repo:

```yaml
# .github/FUNDING.yml
custom: ['https://buymeacoffee.com/YOUR_USERNAME']
```

This adds a "Sponsor" button to your GitHub repo!

## Step 5: Alternative Button Styles

If you want a different button style, Buy Me a Coffee provides several options:

**Simple Text Link:**
```markdown
[☕ Buy me a coffee](https://buymeacoffee.com/YOUR_USERNAME)
```

**Badge Style:**
```markdown
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-orange?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/YOUR_USERNAME)
```

**Widget Style (HTML):**
```html
<a href="https://www.buymeacoffee.com/YOUR_USERNAME" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" >
</a>
```

## Step 6: Promote Your Link

Once set up, share your Buy Me a Coffee link:
- In your GitHub profile README
- On Twitter/X when announcing releases
- In your Docker Hub repository description
- In Unraid Community Apps template

## Benefits of Buy Me a Coffee

✅ **Free to use** - No monthly fees
✅ **Low fees** - Only 5% platform fee (vs Patreon's 8-12%)
✅ **One-time donations** - No forced subscriptions
✅ **Easy integration** - Works with GitHub, Twitter, etc.
✅ **Fast payouts** - Weekly or monthly to your bank/PayPal

## Example Successful Profiles

Check these for inspiration:
- https://buymeacoffee.com/sindresorhus (Creator of Awesome lists)
- https://buymeacoffee.com/kozakdenys (Creator of qBittorrent themes)

## Current Status

**Status**: ⏳ Waiting for your Buy Me a Coffee username

**To Complete Setup:**
1. Create account at https://www.buymeacoffee.com/
2. Choose your username
3. Update `README.md` with your actual username
4. Commit and push changes

---

**Made with ❤️ by Lucid Fabrics**
