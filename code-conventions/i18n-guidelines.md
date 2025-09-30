# 🌐 Internationalization (i18n) Guidelines

## Translation File Location
- **Portal-Web i18n**: `projects/portal-web/src/assets/src/i18n/en.json`

---

## Template Usage:
```html
<!-- ✅ GOOD: Proper i18n usage -->
<button>{{ 'checkIn.refreshShares' | translate }}</button>
<h1>{{ 'checkIn.title' | translate }}</h1>

<!-- ❌ BAD: Hardcoded text -->
<p>Monitor and manage your file shares</p>

<!-- ❌ BAD: Wrong case convention -->
<h1>{{ 'CHECK_IN.TITLE' | translate }}</h1>
```

---

## Translation Guidelines
- **Consistent Casing**: Always use camelCase for keys, proper case for values
- **Descriptive Keys**: Use clear, self-documenting key names
- **Context Clarity**: Include enough context in key names to understand usage

---

## Example Translation Structure
```json
{
  "checkIn": {
    "title": "Check In",
    "description": "Monitor and manage your file shares connectivity and access",
    "refreshShares": "Refresh Shares",
    "loading": "Loading file shares...",
    "noShares": "No File Shares Available",
    "noSharesDescription": "No file shares have been configured yet",
    "checkConnectivity": "Check Connectivity",
    "viewFiles": "View Files"
  },
  "fileTreeModal": {
    "title": "File Share Browser",
    "machineFiles": "Machine File Name",
    "fileDetails": "File Details"
  }
}
```

---

## Critical i18n Rules
1. **Never hardcode text** in templates or components
2. **Use camelCase** for all translation keys
3. **Group related translations** under common parent keys
4. **Provide context** in key names to avoid ambiguity
5. **Keep values human-readable** and properly capitalized
