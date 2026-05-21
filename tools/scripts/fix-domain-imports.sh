#!/bin/bash

# Fix imports for policies feature
find apps/frontend/src/app/features/policies -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/models/policy.model'|from '../models/policy.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/business-objects/policy.bo'|from '../bos/policy.bo'|g" {} + \
  -exec sed -i '' "s|from '.*core/clients/policy.client'|from '../services/policy.client'|g" {} + \
  -exec sed -i '' "s|from '.*core/services/policy.service'|from '../services/policy.service'|g" {} +

# Fix imports for libraries feature
find apps/frontend/src/app/features/libraries -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/models/library.model'|from '../models/library.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/clients/libraries.client'|from '../services/libraries.client'|g" {} +

# Fix imports for queue feature
find apps/frontend/src/app/features/queue -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/models/queue.model'|from '../models/queue.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/clients/queue.client'|from '../services/queue.client'|g" {} +

# Fix imports for insights feature
find apps/frontend/src/app/features/insights -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/business-objects/insights.bo'|from '../bos/insights.bo'|g" {} + \
  -exec sed -i '' "s|from '.*core/clients/insights.client'|from '../services/insights.client'|g" {} + \
  -exec sed -i '' "s|from '.*core/services/insights.service'|from '../services/insights.service'|g" {} +

# Fix imports for overview feature
find apps/frontend/src/app/features/overview -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/models/overview.model'|from '../models/overview.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/clients/overview.client'|from '../services/overview.client'|g" {} +

# Fix imports for settings feature
find apps/frontend/src/app/features/settings -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/models/settings.model'|from '../models/settings.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/models/license.model'|from '../models/license.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/services/settings.service'|from '../services/settings.service'|g" {} + \
  -exec sed -i '' "s|from '.*core/services/license.service'|from '../services/license.service'|g" {} +

# Fix imports for dashboard feature
find apps/frontend/src/app/features/dashboard -type f -name "*.ts" \
  -exec sed -i '' "s|from '.*core/models/file-info.model'|from '../models/file-info.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/models/folder-stats.model'|from '../models/folder-stats.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/models/media-stats.model'|from '../models/media-stats.model'|g" {} + \
  -exec sed -i '' "s|from '.*core/business-objects/file-info.bo'|from '../bos/file-info.bo'|g" {} + \
  -exec sed -i '' "s|from '.*core/business-objects/folder-stats.bo'|from '../bos/folder-stats.bo'|g" {} + \
  -exec sed -i '' "s|from '.*core/business-objects/media-stats.bo'|from '../bos/media-stats.bo'|g" {} + \
  -exec sed -i '' "s|from '.*core/clients/media-stats.client'|from '../services/media-stats.client'|g" {} + \
  -exec sed -i '' "s|from '.*core/services/media-stats.service'|from '../services/media-stats.service'|g" {} +

echo "✅ All domain imports updated"
