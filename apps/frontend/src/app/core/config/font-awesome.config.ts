import type { FaIconLibrary } from '@fortawesome/angular-fontawesome';
// Regular icons
import { faChartLine as farChartLine } from '@fortawesome/pro-regular-svg-icons';
// Solid icons
import {
  faBolt,
  faChartBar,
  faChartLine,
  faCheckCircle,
  faDatabase,
  faExclamationCircle,
  faFileVideo,
  faFilm,
  faFolder,
  faFolderOpen,
  faGear,
  faList,
  faListCheck,
  faServer,
  faSliders,
  faSync,
  faTimes,
} from '@fortawesome/pro-solid-svg-icons';

export function configureFontAwesome(library: FaIconLibrary): void {
  // Add solid icons
  library.addIcons(
    faChartLine,
    faChartBar,
    faListCheck,
    faFolderOpen,
    faSliders,
    faServer,
    faGear,
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
