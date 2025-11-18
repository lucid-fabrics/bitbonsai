import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  ContainerType,
  EnvironmentInfo,
  StorageMethod,
  StorageRecommendation,
} from '../../../features/nodes/models/storage-recommendation.model';

interface WizardStep {
  id: string;
  title: string;
  completed: boolean;
}

export interface StorageSetupWizardData {
  sourceNodeId: string;
  sourceNodeName: string;
  targetNodeId: string;
  targetNodeName: string;
  recommendation: StorageRecommendation;
  targetEnvironment?: EnvironmentInfo;
}

@Component({
  selector: 'app-storage-setup-wizard',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './storage-setup-wizard.modal.html',
  styleUrls: ['./storage-setup-wizard.modal.scss'],
})
export class StorageSetupWizardModal implements OnInit {
  // Data from dialog
  sourceNodeId: string;
  sourceNodeName: string;
  targetNodeId: string;
  targetNodeName: string;
  recommendation: StorageRecommendation;
  targetEnvironment?: EnvironmentInfo;

  // Wizard state
  currentStep = 0;
  steps: WizardStep[] = [];

  // Enums for template
  StorageMethod = StorageMethod;
  ContainerType = ContainerType;

  constructor(
    @Inject(DIALOG_DATA) data: StorageSetupWizardData,
    private dialogRef: DialogRef<{ configured: boolean }>
  ) {
    // Initialize from dialog data
    this.sourceNodeId = data.sourceNodeId;
    this.sourceNodeName = data.sourceNodeName;
    this.targetNodeId = data.targetNodeId;
    this.targetNodeName = data.targetNodeName;
    this.recommendation = data.recommendation;
    this.targetEnvironment = data.targetEnvironment;
  }

  ngOnInit(): void {
    this.initializeSteps();
  }

  private initializeSteps(): void {
    const method = this.recommendation?.recommended;

    if (method === StorageMethod.NFS) {
      this.steps = [
        {
          id: 'environment',
          title: 'Environment Check',
          completed: false,
        },
        {
          id: 'nfs-config',
          title: 'NFS Configuration',
          completed: false,
        },
        {
          id: 'mount-shares',
          title: 'Mount Shares',
          completed: false,
        },
        {
          id: 'verify',
          title: 'Verify & Test',
          completed: false,
        },
      ];
    } else if (method === StorageMethod.RSYNC) {
      this.steps = [
        {
          id: 'environment',
          title: 'Environment Check',
          completed: false,
        },
        {
          id: 'rsync-config',
          title: 'rsync Configuration',
          completed: false,
        },
        {
          id: 'verify',
          title: 'Verify & Test',
          completed: false,
        },
      ];
    } else {
      this.steps = [
        {
          id: 'choose-method',
          title: 'Choose Method',
          completed: false,
        },
        {
          id: 'configure',
          title: 'Configure',
          completed: false,
        },
        {
          id: 'verify',
          title: 'Verify & Test',
          completed: false,
        },
      ];
    }
  }

  get currentStepData(): WizardStep {
    return this.steps[this.currentStep];
  }

  get isFirstStep(): boolean {
    return this.currentStep === 0;
  }

  get isLastStep(): boolean {
    return this.currentStep === this.steps.length - 1;
  }

  get progressPercentage(): number {
    return ((this.currentStep + 1) / this.steps.length) * 100;
  }

  nextStep(): void {
    if (this.currentStep < this.steps.length - 1) {
      this.steps[this.currentStep].completed = true;
      this.currentStep++;
    }
  }

  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  complete(): void {
    this.dialogRef.close({ configured: true });
  }

  // Helper methods for template
  get isLXCContainer(): boolean {
    return this.targetEnvironment?.containerType === ContainerType.LXC;
  }

  get isPrivileged(): boolean {
    return this.targetEnvironment?.isPrivileged || false;
  }

  get canMountNFS(): boolean {
    return this.targetEnvironment?.canMountNFS || false;
  }

  get needsPrivilegedMode(): boolean {
    return (
      this.isLXCContainer &&
      !this.isPrivileged &&
      this.recommendation?.recommended === StorageMethod.NFS
    );
  }
}
