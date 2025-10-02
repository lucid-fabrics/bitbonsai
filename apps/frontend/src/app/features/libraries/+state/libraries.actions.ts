import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { CreateLibraryDto, Library, UpdateLibraryDto } from '../../../core/models/library.model';

export const LibrariesActions = createActionGroup({
  source: 'Libraries',
  events: {
    'Load Libraries': emptyProps(),
    'Load Libraries Success': props<{ libraries: Library[] }>(),
    'Load Libraries Failure': props<{ error: string }>(),

    'Create Library': props<{ library: CreateLibraryDto }>(),
    'Create Library Success': props<{ library: Library }>(),
    'Create Library Failure': props<{ error: string }>(),

    'Update Library': props<{ id: string; library: UpdateLibraryDto }>(),
    'Update Library Success': props<{ library: Library }>(),
    'Update Library Failure': props<{ error: string }>(),

    'Delete Library': props<{ id: string }>(),
    'Delete Library Success': props<{ id: string }>(),
    'Delete Library Failure': props<{ error: string }>(),

    'Scan Library': props<{ id: string }>(),
    'Scan Library Success': props<{ id: string }>(),
    'Scan Library Failure': props<{ error: string }>(),
  }
});
