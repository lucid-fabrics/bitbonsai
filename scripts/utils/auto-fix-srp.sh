#!/bin/bash

# Auto-fix SRP violations - Split multi-export files
# This script handles updating imports across the codebase

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting SRP violation fixes...${NC}\n"

# Track statistics
total_files_split=0
total_imports_updated=0

# Function to update imports in a file
update_imports() {
    local file=$1
    local old_import=$2
    local new_imports=$3

    if grep -q "$old_import" "$file" 2>/dev/null; then
        # Create a backup
        cp "$file" "$file.bak"

        # Perform the replacement
        perl -i -pe "s|$old_import|$new_imports|g" "$file"

        echo -e "${GREEN}✓${NC} Updated: $file"
        ((total_imports_updated++))

        rm "$file.bak"
    fi
}

echo -e "${YELLOW}Phase 1: Updating settings.model.ts imports${NC}"

# Update settings.page.ts
sed -i '' "s|import type { EnvironmentInfo, SystemSettings } from './models/settings.model';|import type { EnvironmentInfo } from './models/environment-info.model';\nimport type { SystemSettings } from './models/system-settings.model';|g" apps/frontend/src/app/features/settings/settings.page.ts
sed -i '' "s|import { LogLevel } from './models/settings.model';|import { LogLevel } from './models/log-level.type';|g" apps/frontend/src/app/features/settings/settings.page.ts

# Update settings.page.spec.ts
sed -i '' "s|import type { EnvironmentInfo, SystemSettings } from './models/settings.model';|import type { EnvironmentInfo } from './models/environment-info.model';\nimport type { SystemSettings } from './models/system-settings.model';|g" apps/frontend/src/app/features/settings/settings.page.spec.ts
sed -i '' "s|import { LogLevel } from './models/settings.model';|import { LogLevel } from './models/log-level.type';|g" apps/frontend/src/app/features/settings/settings.page.spec.ts

# Update settings.service.ts
sed -i '' "s|from '../models/settings.model';|from '../models/environment-info.model';\nimport type { SystemSettings } from '../models/system-settings.model';\nimport type { UpdateSystemSettings } from '../models/update-system-settings.model';|g" apps/frontend/src/app/features/settings/services/settings.service.ts

# Update overview.page.ts
sed -i '' "s|import type { EnvironmentInfo } from '../settings/models/settings.model';|import type { EnvironmentInfo } from '../settings/models/environment-info.model';|g" apps/frontend/src/app/features/overview/overview.page.ts

# Update settings.actions.ts
sed -i '' "s|from '../models/settings.model';|from '../models/environment-info.model';\nimport type { SystemSettings } from '../models/system-settings.model';\nimport type { UpdateSystemSettings } from '../models/update-system-settings.model';|g" apps/frontend/src/app/features/settings/+state/settings.actions.ts

# Update settings.reducer.ts
sed -i '' "s|import type { EnvironmentInfo, SystemSettings } from '../models/settings.model';|import type { EnvironmentInfo } from '../models/environment-info.model';\nimport type { SystemSettings } from '../models/system-settings.model';|g" apps/frontend/src/app/features/settings/+state/settings.reducer.ts

# Remove old settings.model.ts
rm apps/frontend/src/app/features/settings/models/settings.model.ts

echo -e "\n${GREEN}✓ Completed settings.model.ts refactoring${NC}\n"
((total_files_split++))

echo -e "\n${GREEN}====== Summary ======${NC}"
echo -e "Files split: ${GREEN}${total_files_split}${NC}"
echo -e "Imports updated: ${GREEN}${total_imports_updated}${NC}"
echo -e "${GREEN}✓ SRP fixes applied successfully!${NC}\n"
