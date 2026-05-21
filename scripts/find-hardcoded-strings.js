#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const FRONTEND_SRC = path.join(ROOT_DIR, 'apps/frontend/src');
const _I18N_FILE = path.join(ROOT_DIR, 'apps/frontend/src/assets/i18n/en.json');

const _HARDCODED_PATTERNS = [
  /'([A-Z][a-z]+(?:\s+[a-z]+){0,5}])'/g,
  /"([A-Z][a-z]+(?:\s+[a-z]+){0,5})"/g,
];

function scanDirectory(dir, results = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      scanDirectory(fullPath, results);
    } else if (file.endsWith('.ts') || file.endsWith('.html')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const relativePath = path.relative(FRONTEND_SRC, fullPath);

      let match;
      const pattern = /(['"])([A-Z][a-zA-Z\s]{3,})\1/g;
      while ((match = pattern.exec(content)) !== null) {
        const str = match[2];
        if (str.length > 3 && !str.includes('{{') && !str.includes('}}')) {
          results.push({
            file: relativePath,
            line: content.substring(0, match.index).split('\n').length,
            text: str,
          });
        }
      }
    }
  }

  return results;
}

function main() {
  console.log('Scanning for hardcoded strings...\n');

  const results = scanDirectory(FRONTEND_SRC);

  const uniqueStrings = [...new Set(results.map((r) => r.text))].sort();

  console.log(`Found ${results.length} hardcoded strings (${uniqueStrings.length} unique)\n`);
  console.log('Unique strings that should be i18n:');
  console.log('='.repeat(60));

  uniqueStrings.slice(0, 50).forEach((str, i) => {
    console.log(`${i + 1}. "${str}"`);
  });

  if (uniqueStrings.length > 50) {
    console.log(`\n... and ${uniqueStrings.length - 50} more`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('\nSuggested i18n keys (add to en.json):');

  uniqueStrings.forEach((str) => {
    const key = str.toLowerCase().replace(/\s+/g, '.');
    console.log(`  "${key}": "${str}",`);
  });
}

main();
