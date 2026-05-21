import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { NodesClient } from '../../../core/clients/nodes.client';
import { OverviewClient } from '../../../core/clients/overview.client';
import type { Node } from '../../nodes/models/node.model';
import type { EnvironmentInfo } from '../../settings/models/environment-info.model';
import { SettingsService } from '../../settings/services/settings.service';
import type { OverviewModel } from '../models/overview.model';

@Injectable({
  providedIn: 'root',
})
export class OverviewService {
  private readonly overviewClient = inject(OverviewClient);
  private readonly nodesClient = inject(NodesClient);
  private readonly settingsService = inject(SettingsService);

  getOverview(): Observable<OverviewModel> {
    return this.overviewClient.getOverview();
  }

  getNodes(): Observable<Node[]> {
    return this.nodesClient.getNodes();
  }

  getEnvironmentInfo(): Observable<EnvironmentInfo> {
    return this.settingsService.getEnvironmentInfo();
  }
}
