# 🚀 MediaInsight Angular Guidelines

> **Last Updated:** September 30, 2025
> **Project:** MediaInsight - Media Library Codec Analytics Dashboard

## Core Principles
- Strict typing everywhere (`noImplicitAny`, no `any` in code)
- Standalone components only (no NgModules)
- Use NgRx for state management with +state folders
- Separate **Models** for API transport from **BOs (Business Objects)** for business logic
- Keep components presentation-only; push logic to effects, services and BOs
- Modern Angular syntax only: `@if`, `@for`, `@switch`

---

## 🏗️ MediaInsight Architecture

### 📁 Project Structure
```
src/app/
├── core/
│   ├── services/           # Core services (MediaStatsService)
│   ├── models/             # API models (.model.ts)
│   ├── business-objects/   # Business objects (.bo.ts)
│   └── clients/            # HTTP clients (MediaStatsClient)
├── features/
│   ├── dashboard/
│   │   ├── +state/         # NgRx state (actions, effects, reducers, selectors)
│   │   ├── components/     # Dashboard components
│   │   └── dashboard.component.ts
│   ├── folder-stats/
│   │   ├── +state/         # NgRx state for folder stats
│   │   └── folder-stats.component.ts
│   └── settings/
│       ├── +state/         # NgRx state for settings
│       └── settings.component.ts
├── shared/
│   ├── components/         # Reusable components
│   └── pipes/              # Shared pipes
└── assets/
    └── i18n/
        └── en.json         # Translations
```

### 🔄 Effect → Service → Client → BO Architecture

MediaInsight uses NgRx for state management following the same pattern as Defender:

#### Effects Layer
Effects MUST only handle NgRx side effects and delegate business logic to services:

```typescript
@Injectable()
export class MediaStatsEffects {
  private readonly actions$ = inject(Actions);
  private readonly mediaStatsService = inject(MediaStatsService);

  loadMediaStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MediaStatsActions.loadMediaStats),
      switchMap(() =>
        this.mediaStatsService.getMediaStats().pipe(
          map((stats) => MediaStatsActions.loadMediaStatsSuccess({ stats })),
          catchError((error) => of(MediaStatsActions.loadMediaStatsFailure({ error: error.message })))
        )
      )
    )
  );

  triggerScan$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MediaStatsActions.triggerScan),
      switchMap(() =>
        this.mediaStatsService.triggerScan().pipe(
          map(() => MediaStatsActions.triggerScanSuccess()),
          catchError((error) => of(MediaStatsActions.triggerScanFailure({ error: error.message })))
        )
      )
    )
  );

  // Reload stats after successful scan
  reloadAfterScan$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MediaStatsActions.triggerScanSuccess),
      map(() => MediaStatsActions.loadMediaStats())
    )
  );
}
```

#### Component Layer
Components dispatch actions and select state from the store:

```typescript
@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  private readonly store = inject(Store);

  // ✅ GOOD: Select state from store
  readonly stats$ = this.store.select(MediaStatsSelectors.selectMediaStats);
  readonly isLoading$ = this.store.select(MediaStatsSelectors.selectIsLoading);
  readonly error$ = this.store.select(MediaStatsSelectors.selectError);

  ngOnInit(): void {
    this.store.dispatch(MediaStatsActions.loadMediaStats());
  }

  triggerScan(): void {
    this.store.dispatch(MediaStatsActions.triggerScan());
  }
}
```

#### Service Layer
Services MUST:
1. Use clients for HTTP communication (never HttpClient directly)
2. Transform client responses to BOs using BO constructors
3. **NEVER perform mapping logic themselves** (use BO constructors)
4. Return typed observables with BOs

**Service Responsibilities:**
- Orchestrate business logic
- Transform client model responses to BOs via BO constructors
- **FORBIDDEN:** Direct HttpClient injection or usage
- **FORBIDDEN:** Object mapping logic in service methods

```typescript
@Injectable({
  providedIn: 'root'
})
export class MediaStatsService {
  private readonly mediaStatsClient = inject(MediaStatsClient);

  public getMediaStats(): Observable<MediaStatsBo> {
    return this.mediaStatsClient.getStats().pipe(
      map((responseModel) => new MediaStatsBo(responseModel))
    );
  }

  public triggerScan(): Observable<void> {
    return this.mediaStatsClient.triggerScan();
  }

  // ❌ BAD: Don't inject HttpClient in services
  // constructor(private http: HttpClient) {} // FORBIDDEN!

  // ❌ BAD: Don't do mapping in services
  // private mapToBO(response: any): MediaStatsBo { ... } // Violates SRP
}
```

#### Client Layer
All client files MUST be located in `src/app/core/clients/`:

**Client Requirements:**
- **MUST use @Injectable({ providedIn: 'root' }) decorator**
- Handle HTTP communication with NestJS API ONLY
- Use model interfaces with `.model` suffix for API responses
- Return typed observables with model interfaces
- **NEVER be used directly by components** - only by services

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { MediaStatsModel } from '../models/media-stats.model';

@Injectable({ providedIn: 'root' })
export class MediaStatsClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1'; // NestJS backend API

  getStats(): Observable<MediaStatsModel> {
    return this.http.get<MediaStatsModel>(`${this.apiUrl}/media-stats`);
  }

  triggerScan(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/media-stats/scan`, {});
  }
}
```

#### Model Interfaces (.model suffix)
API response models MUST use `.model` suffix and represent exactly what the NestJS API returns.

**Model File Organization:**
- **Each model MUST be in its own file**
- **All models MUST be located in `src/app/core/models/` folder**

```
src/app/core/
├── models/
│   ├── media-stats.model.ts
│   ├── folder-stats.model.ts
│   └── codec-stats.model.ts
```

**Example Model:**
```typescript
// src/app/core/models/media-stats.model.ts
export interface MediaStatsModel {
  total_size_gb: number;
  total_files: number;
  average_bitrate_mbps: number;
  codec_distribution: {
    hevc: number;
    h264: number;
    av1: number;
    other: number;
  };
  folders: FolderStatsModel[];
  scan_timestamp: string; // ISO date string from API
}
```

#### Business Objects (BO) - Internal Mapping
BOs MUST handle their own mapping internally in the constructor (SRP compliance):

**BO File Organization:**
- **All BOs MUST be located in `src/app/core/business-objects/` folder**
- **Use `.bo.ts` suffix for all BO files**

```typescript
// src/app/core/business-objects/media-stats.bo.ts
export class MediaStatsBo {
  totalSizeGB: number;
  totalFiles: number;
  averageBitrateMbps: number;
  codecDistribution: CodecDistribution;
  folders: FolderStatsBo[];
  scanTimestamp: Date; // Converted from string

  constructor(model: MediaStatsModel) {
    // ✅ GOOD: BO handles its own mapping internally - SRP compliance
    this.totalSizeGB = model.total_size_gb || 0;
    this.totalFiles = model.total_files || 0;
    this.averageBitrateMbps = model.average_bitrate_mbps || 0;
    this.codecDistribution = {
      hevc: model.codec_distribution?.hevc || 0,
      h264: model.codec_distribution?.h264 || 0,
      av1: model.codec_distribution?.av1 || 0,
      other: model.codec_distribution?.other || 0
    };
    this.folders = model.folders?.map(f => new FolderStatsBo(f)) || [];
    this.scanTimestamp = new Date(model.scan_timestamp);
  }

  // ✅ GOOD: BOs can have business logic methods
  get totalSizeFormatted(): string {
    return `${this.totalSizeGB.toFixed(2)} GB`;
  }

  get hevcPercentage(): number {
    return (this.codecDistribution.hevc / this.totalFiles) * 100;
  }
}

interface CodecDistribution {
  hevc: number;
  h264: number;
  av1: number;
  other: number;
}
```

#### Architecture Rules Summary
1. **Components** → Dispatch actions, select state from store
2. **Effects** → Handle side effects, call services
3. **Services** → Call clients, transform responses to BOs via constructors
4. **Clients** → Located in `core/clients/`, handle HTTP communication only
5. **Models** → Located in `core/models/`, represent raw API responses
6. **BOs** → Located in `core/business-objects/`, handle mapping and business logic
7. **State** → Always in `+state/` folders (actions, effects, reducers, selectors)

---

## 📊 State Management with NgRx

MediaInsight uses NgRx for state management with the standard +state folder structure.

### +State Folder Structure

All state management files MUST be organized in `+state` folders within each feature:

```
src/app/features/dashboard/+state/
├── dashboard.actions.ts
├── dashboard.effects.ts
├── dashboard.reducer.ts
└── dashboard.selectors.ts
```

### NgRx Actions
Use `createActionGroup` for organizing related actions:

```typescript
// dashboard/+state/dashboard.actions.ts
export const MediaStatsActions = createActionGroup({
  source: 'Media Stats',
  events: {
    'Load Media Stats': emptyProps(),
    'Load Media Stats Success': props<{ stats: MediaStatsBo }>(),
    'Load Media Stats Failure': props<{ error: string }>(),
    'Trigger Scan': emptyProps(),
    'Trigger Scan Success': emptyProps(),
    'Trigger Scan Failure': props<{ error: string }>()
  }
});
```

### NgRx Selectors
Create typed selectors for accessing state:

```typescript
// dashboard/+state/dashboard.selectors.ts
export const selectMediaStatsState = createFeatureSelector<MediaStatsState>('mediaStats');

export const MediaStatsSelectors = {
  selectMediaStats: createSelector(selectMediaStatsState, (state) => state.stats),
  selectIsLoading: createSelector(selectMediaStatsState, (state) => state.isLoading),
  selectError: createSelector(selectMediaStatsState, (state) => state.error)
};
```

---

## 🔢 Enum Usage - No Literals Allowed

**NEVER use string or number literals.** Always define and use enums for constants:

**❌ BAD: Using literals**
```typescript
if (codec === 'hevc') { }
if (status === 'scanning') { }
```

**✅ GOOD: Using enums**
```typescript
export enum CodecType {
  HEVC = 'hevc',
  H264 = 'h264',
  AV1 = 'av1',
  OTHER = 'other'
}

export enum ScanStatus {
  IDLE = 'idle',
  SCANNING = 'scanning',
  COMPLETE = 'complete',
  ERROR = 'error'
}

// ✅ GOOD: Use enums in code
if (codec === CodecType.HEVC) { }
if (status === ScanStatus.SCANNING) { }
```

**Enum Organization:**
- Place enums in `src/app/core/enums/` folder
- Use UPPER_CASE for enum keys
- Use descriptive values that match API contracts

---

## 🎯 Proper Return Types - No Anonymous Objects

**NEVER return anonymous objects.** Always define proper interfaces or classes:

**❌ BAD: Anonymous return types**
```typescript
getCodecInfo(): { name: string; count: number } {
  return { name: 'HEVC', count: 42 };
}
```

**✅ GOOD: Properly typed returns**
```typescript
export interface CodecInfo {
  name: string;
  count: number;
}

getCodecInfo(): CodecInfo {
  return { name: 'HEVC', count: 42 };
}
```

---

## 📝 Templates & Styling

### Modern Angular Control Flow
- **Use native control flow**: `@if`, `@for`, `@switch` (no legacy `*ngIf`, `*ngFor`, etc.)
- **Use the `async` pipe** for observables, never manual `.subscribe()` in templates
- **Extract repetitive markup** into directives
- **Ensure accessibility** (labels, ARIA, roles)

### Template Examples
```html
<!-- ✅ GOOD: Modern control flow -->
@if (isLoading()) {
  <div class="loading-spinner">Loading...</div>
}

@if (stats(); as statsData) {
  <div class="stats-overview">
    @for (folder of statsData.folders; track folder.name) {
      <app-folder-card [folder]="folder" />
    }
  </div>
}

@if (error()) {
  <div class="error-message">{{ error() }}</div>
}
```

### 🎨 Styling with BEM SCSS
- SCSS only, using **BEM methodology**
- Keep shared variables in `src/styles/_variables.scss`
- Avoid inline styles completely

```scss
// ✅ GOOD: BEM methodology
.dashboard {
  &__header {
    display: flex;
    justify-content: space-between;
  }

  &__stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1rem;
  }

  &__stat-card {
    padding: 1rem;
    border-radius: 8px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

    &--loading {
      opacity: 0.5;
      pointer-events: none;
    }
  }
}
```

### 🌐 Translations
**All text MUST use i18n** via translation keys in `src/assets/i18n/en.json`:

```json
{
  "dashboard": {
    "title": "Media Library Analytics",
    "totalSize": "Total Size",
    "totalFiles": "Total Files",
    "averageBitrate": "Average Bitrate",
    "codecDistribution": "Codec Distribution",
    "refreshButton": "Scan Library",
    "lastScan": "Last scanned: {{timestamp}}"
  },
  "common": {
    "loading": "Loading...",
    "error": "An error occurred",
    "retry": "Retry"
  }
}
```

---

## ⚡ Performance Guidelines
- **OnPush everywhere**: `changeDetection: ChangeDetectionStrategy.OnPush`
- **Use `trackBy` in `@for` loops**:
  ```html
  @for (folder of folders; track folder.path) {
    <app-folder-card [folder]="folder" />
  }
  ```
- **Lazy load feature routes**
- **Use computed signals** for derived state instead of methods in templates

---

## 🔒 Component Guidelines
- Always set `changeDetection: ChangeDetectionStrategy.OnPush`
- Use `input()` / `output()` functions for component API:
  ```typescript
  readonly folder = input.required<FolderStatsBo>();
  readonly folderSelected = output<string>();
  ```
- Use standalone components:
  ```typescript
  @Component({
    selector: 'app-folder-card',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush
  })
  ```
- **A FormGroup is always typed with an interface**:
  ```typescript
  interface SettingsForm {
    scanInterval: FormControl<number>;
    enableAutoScan: FormControl<boolean>;
  }

  settingsForm: FormGroup<SettingsForm>;
  ```

---

## 🎯 Change Detection Optimization

### Stable TrackBy Functions
Always use stable tracking identifiers in `@for` loops:

```typescript
// ✅ GOOD: Track by stable identifier
@for (folder of folders; track folder.path) {
  <app-folder-card [folder]="folder" />
}

// ✅ GOOD: Track by ID
@for (stat of stats; track stat.id) {
  <div>{{ stat.name }}</div>
}

// ❌ BAD: Track by index
@for (item of items; track $index) {
  <div>{{ item }}</div>
}
```

---

## 🎨 Lucid Fabrics Branding

### Color Palette
```scss
// src/styles/_variables.scss
$primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
$primary-start: #667eea;
$primary-end: #764ba2;
$success: #10b981;
$warning: #f59e0b;
$danger: #ef4444;
```

### Typography
```scss
$font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
$font-weight-bold: 700;
$font-weight-normal: 400;
```

---

## 🚫 Forbidden Patterns

**NEVER:**
- Use `any` type
- Use NgModules (standalone only)
- Use NgRx or complex state management
- Inject HttpClient in services (use clients)
- Map objects in service methods (use BO constructors)
- Use legacy Angular syntax (`*ngIf`, `*ngFor`)
- Use string/number literals (use enums)
- Return anonymous objects (define interfaces)
- Use inline styles
- Hardcode text in templates (use i18n)

---

## ✅ Best Practices Summary

1. **Architecture**: Component → Service → Client → BO
2. **State**: Use Angular Signals for reactive state
3. **Typing**: Strict types everywhere, no `any`
4. **Components**: Standalone, OnPush, modern syntax
5. **Styling**: BEM SCSS with Lucid Fabrics theme
6. **Performance**: TrackBy, lazy loading, computed signals
7. **Translations**: All text in i18n files
8. **Business Logic**: In BO classes, not services or components
