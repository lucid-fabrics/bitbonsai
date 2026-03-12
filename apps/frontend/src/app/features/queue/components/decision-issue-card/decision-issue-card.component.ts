import { Component, EventEmitter, input, Output } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { TranslocoModule } from '@ngneat/transloco';
import {
  HealthCheckIssue,
  HealthCheckIssueSeverity,
  HealthCheckSuggestedAction,
} from '../../models/health-check-issue.model';

@Component({
  selector: 'app-decision-issue-card',
  standalone: true,
  imports: [FontAwesomeModule, TranslocoModule],
  templateUrl: './decision-issue-card.component.html',
  styleUrls: ['./decision-issue-card.component.scss'],
})
export class DecisionIssueCardComponent {
  issue = input.required<HealthCheckIssue>();

  @Output() actionSelected = new EventEmitter<{
    issue: HealthCheckIssue;
    action: HealthCheckSuggestedAction;
  }>();

  protected readonly HealthCheckIssueSeverity = HealthCheckIssueSeverity;
  protected showTechnicalDetails = false;

  protected getSeverityClass(severity: HealthCheckIssueSeverity): string {
    switch (severity) {
      case HealthCheckIssueSeverity.BLOCKER:
        return 'severity-blocker';
      case HealthCheckIssueSeverity.WARNING:
        return 'severity-warning';
      case HealthCheckIssueSeverity.INFO:
        return 'severity-info';
      default:
        return '';
    }
  }

  protected getSeverityIcon(severity: HealthCheckIssueSeverity): string {
    switch (severity) {
      case HealthCheckIssueSeverity.BLOCKER:
        return 'circle-exclamation';
      case HealthCheckIssueSeverity.WARNING:
        return 'exclamation-triangle';
      case HealthCheckIssueSeverity.INFO:
        return 'info-circle';
      default:
        return 'circle-exclamation';
    }
  }

  protected getSeverityLabel(severity: HealthCheckIssueSeverity): string {
    switch (severity) {
      case HealthCheckIssueSeverity.BLOCKER:
        return 'Blocker';
      case HealthCheckIssueSeverity.WARNING:
        return 'Warning';
      case HealthCheckIssueSeverity.INFO:
        return 'Info';
      default:
        return 'Unknown';
    }
  }

  protected toggleTechnicalDetails(): void {
    this.showTechnicalDetails = !this.showTechnicalDetails;
  }

  protected onActionClick(action: HealthCheckSuggestedAction): void {
    this.actionSelected.emit({
      issue: this.issue(),
      action,
    });
  }
}
