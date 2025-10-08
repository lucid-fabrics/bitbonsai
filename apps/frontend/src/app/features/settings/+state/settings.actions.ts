import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { EnvironmentInfo } from '../models/environment-info.model';
import type { ActivateLicense, License } from '../models/license.model';
import type { SystemSettings } from '../models/system-settings.model';
import type { UpdateSystemSettings } from '../models/update-system-settings.model';

export const SettingsActions = createActionGroup({
  source: 'Settings',
  events: {
    'Load License': emptyProps(),
    'Load License Success': props<{ license: License }>(),
    'Load License Failure': props<{ error: string }>(),

    'Activate License': props<{ request: ActivateLicense }>(),
    'Activate License Success': props<{ license: License }>(),
    'Activate License Failure': props<{ error: string }>(),

    'Load Environment Info': emptyProps(),
    'Load Environment Info Success': props<{ info: EnvironmentInfo }>(),
    'Load Environment Info Failure': props<{ error: string }>(),

    'Load System Settings': emptyProps(),
    'Load System Settings Success': props<{ settings: SystemSettings }>(),
    'Load System Settings Failure': props<{ error: string }>(),

    'Update System Settings': props<{ updates: UpdateSystemSettings }>(),
    'Update System Settings Success': props<{ settings: SystemSettings }>(),
    'Update System Settings Failure': props<{ error: string }>(),

    'Backup Database': emptyProps(),
    'Backup Database Success': props<{ backupPath: string; timestamp: string }>(),
    'Backup Database Failure': props<{ error: string }>(),

    'Reset To Defaults': emptyProps(),
    'Reset To Defaults Success': props<{ message: string }>(),
    'Reset To Defaults Failure': props<{ error: string }>(),

    'Regenerate API Key': emptyProps(),
    'Regenerate API Key Success': props<{ apiKey: string }>(),
    'Regenerate API Key Failure': props<{ error: string }>(),
  },
});
