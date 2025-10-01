import type { FaIconLibrary } from '@fortawesome/angular-fontawesome';
// Regular icons
import { faChartLine as farChartLine } from '@fortawesome/pro-regular-svg-icons';
// Solid icons
import {
  faBolt,
  faChartLine,
  faCheckCircle,
  faDatabase,
  faExclamationCircle,
  faFileVideo,
  faFilm,
  faFolder,
  faList,
  faSync,
  faTimes,
} from '@fortawesome/pro-solid-svg-icons';

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
    faDatabase
  );

  // Add regular icons
  library.addIcons(farChartLine);
}
