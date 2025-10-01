import { FaIconLibrary } from '@fortawesome/angular-fontawesome';

// Solid icons
import {
  faChartLine,
  faSync,
  faFilm,
  faFolder,
  faFileVideo,
  faExclamationCircle,
  faCheckCircle,
  faBolt,
  faTimes,
  faList,
  faDatabase,
} from '@fortawesome/pro-solid-svg-icons';

// Regular icons
import {
  faChartLine as farChartLine,
} from '@fortawesome/pro-regular-svg-icons';

export function configureFontAwesome(library: FaIconLibrary): void {
  // Add solid icons
  library.addIcons(
    faChartLine,
    faSync,
    faFilm,
    faFolder,
    faFileVideo,
    faExclamationCircle,
    faCheckCircle,
    faBolt,
    faTimes,
    faList,
    faDatabase,
  );

  // Add regular icons
  library.addIcons(
    farChartLine,
  );
}
