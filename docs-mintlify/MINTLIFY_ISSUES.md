# Mintlify Documentation Issues

## Critical: MDX Parsing Failures

**Date:** 2026-01-11

### Issue: Large files with Accordion components fail to parse

**Symptom:**
- Page displays empty MDX fragment: `return _jsx(_Fragment, {});`
- URL returns 200 but no content renders
- Deployment succeeds but page is blank

**Root Cause:**
- Files >900 lines with multiple `<AccordionGroup>` components break Mintlify's MDX compiler
- Appears to be a size/complexity limit, not syntax error
- Smaller files with same components work fine

**Affected Files:**
- `advanced/multi-node.mdx` (901 lines) - FAILED
- `advanced/multi-node-setup.mdx` (renamed) - FAILED
- `advanced/distributed-encoding.mdx` (renamed) - FAILED

**Working File:**
- `advanced/multi-node.mdx` (291 lines, simplified) - SUCCESS

**Solution:**
1. Keep documentation pages under ~300 lines
2. Split large guides into multiple pages
3. Avoid excessive Accordion nesting (>10 Accordions may trigger issue)
4. Test locally with `mintlify dev` before pushing

### Aggressive Caching Issue

**Symptom:**
- File updates don't reflect on live site for 5-10 minutes
- Renaming files doesn't bypass cache
- Even after successful deployment, old content shows

**Workaround:**
- Wait 2-3 minutes after push
- Check deployment status at Mintlify dashboard
- If stuck, create new file with different name
- Original URLs eventually update after 10+ minutes

**Cache Bust Techniques (tested):**
- ❌ Rename file (multi-node → multi-node-setup) - cache persists
- ❌ Delete and recreate file - cache persists
- ✅ Create entirely new filename (distributed-encoding) - works
- ✅ Wait 10+ minutes - eventually updates

### File Size Limits

**Observed Limits:**
- 291 lines: ✅ Works reliably
- 901 lines: ❌ Fails to parse (with Accordions)
- Unknown exact threshold (test range: 300-600 lines)

**Recommendation:**
- Keep pages under 400 lines as safety margin
- Split comprehensive guides into:
  - Main setup page (~300 lines)
  - Troubleshooting page (separate)
  - Advanced configuration (separate)

### Debug Checklist

When a page won't display:

1. **Check file size:** `wc -l file.mdx` - if >500 lines, split it
2. **Check frontmatter:** Must have exactly 2 `---` delimiters (opening/closing)
3. **Check Accordion count:** >10 Accordions may trigger issues
4. **Check Mermaid diagrams:** Remove emojis, validate syntax
5. **Wait for cache:** 3-5 minutes minimum after push
6. **Test locally:** `mintlify dev` catches most issues
7. **Create new filename:** Last resort to bypass cache

### Mermaid Diagram Issues (RESOLVED)

**Issue:** Emojis in Mermaid diagrams cause syntax error

**Error Message:**
```
Unexpected character § (U+0035)
```

**Solution:** Remove all emojis from Mermaid node labels
- ❌ `Main[🖥️ Main Node]`
- ✅ `Main[Main Node]`

### Color Configuration

**Correct BitBonsai colors:**
```json
{
  "colors": {
    "primary": "#f9be03",
    "light": "#fcd34d",
    "dark": "#d4a003",
    "background": {
      "dark": "#1a1a1a"
    }
  }
}
```

**Issue:** Colors were incorrectly set to green (#10b981) instead of yellow
**Fix:** Updated `mint.json` - takes 2-3 minutes to deploy

---

## Best Practices

1. **Keep pages concise** - Under 400 lines
2. **Test locally first** - `mintlify dev` catches issues early
3. **Split large guides** - Multiple focused pages > one giant page
4. **Avoid over-nesting** - Limit Accordions to 5-8 per page
5. **Wait for deployment** - 2-3 minutes after push before checking
6. **No emojis in Mermaid** - Use text labels only
7. **Validate frontmatter** - Exactly 2 `---` delimiters

## Working File Archive

**Simplified multi-node guide (291 lines):**
- Git commit: `2edd30a`
- File: `docs-mintlify/advanced/multi-node-setup.mdx`
- Status: ✅ Deployed successfully
- Contains: Complete setup guide without troubleshooting Accordions

**Full multi-node guide (901 lines):**
- Backup: `docs-mintlify/advanced/distributed-encoding.mdx.broken`
- Status: ❌ Breaks Mintlify MDX parser
- Contains: Complete guide + 20+ Accordion troubleshooting sections

**To restore full version:**
1. Split into 3 pages:
   - `multi-node.mdx` (setup guide ~300 lines)
   - `multi-node-troubleshooting.mdx` (debug steps ~300 lines)
   - `multi-node-best-practices.mdx` (tips ~200 lines)
2. Update navigation in `mint.json`
3. Cross-link pages with `[Troubleshooting](/advanced/multi-node-troubleshooting)`
