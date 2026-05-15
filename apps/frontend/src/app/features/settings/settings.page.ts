import { Component, computed, inject, type OnInit, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';
import { Store } from '@ngrx/store';
import { environment } from '../../../environments/environment';
import { SettingsActions } from './+state/settings.actions';
import { SettingsSelectors } from './+state/settings.selectors';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslocoModule],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class SettingsComponent implements OnInit {
  private readonly store = inject(Store);

  // Advanced mode from store (persisted setting)
  private readonly advancedMode = toSignal(
    this.store.select(SettingsSelectors.selectAdvancedMode),
    { initialValue: false }
  );

  // Debug tab visible in development OR when advanced mode enabled in production
  readonly showDebugTab = computed(() => !environment.production || this.advancedMode());

  ngOnInit(): void {
    // Load advanced mode setting from API
    this.store.dispatch(SettingsActions.loadAdvancedMode());
  }
}
