import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { PathSelectorComponent } from '@bitbonsai/shared-ui';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  type CreateStorageShareRequest,
  StorageProtocol,
  type StorageShare,
  StorageShareStatus,
  StorageSharesClient,
} from '../../../../core/clients/storage-shares.client';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../../../shared/components/confirmation-dialog/confirmation-dialog.component';
import type { Node } from '../../models/node.model';

/**
 * DEEP AUDIT P2-1: Type-safe error message extraction helper
 * Replaces catch (error: any) pattern with proper unknown error handling
 */
function extractErrorMessage(error: unknown, defaultMessage: string): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const innerError = (error as { error?: { message?: string } }).error;
    if (innerError && typeof innerError === 'object' && 'message' in innerError) {
      return innerError.message || defaultMessage;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return defaultMessage;
}

export interface StorageSharesModalData {
  node: Node;
}

@Component({
  selector: 'bb-storage-shares-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FontAwesomeModule, PathSelectorComponent],
  templateUrl: './storage-shares.modal.html',
  styleUrls: ['./storage-shares.modal.scss'],
})
export class StorageSharesModal implements OnInit, OnDestroy {
  private readonly dialogRef = inject(DialogRef<StorageSharesModal>);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly storageClient = inject(StorageSharesClient);
  readonly data: StorageSharesModalData = inject(DIALOG_DATA);

  readonly pathWrapper = viewChild<ElementRef>('pathWrapper');

  get node(): Node {
    return this.data.node;
  }

  shares = signal<StorageShare[]>([]);
  availableShares = signal<StorageShare[]>([]);
  loading = signal(true);
  creating = signal(false);
  testing = signal(false);
  showCreateForm = signal(false);
  showFolderBrowser = signal(false);
  error = signal<string | null>(null);
  autoDetectMessage = signal<string | null>(null);
  apiUrl = environment.apiUrl;

  createForm!: FormGroup;

  readonly StorageProtocol = StorageProtocol;
  readonly StorageShareStatus = StorageShareStatus;

  private clickListener?: (event: MouseEvent) => void;

  ngOnInit() {
    this.initializeForm();
    this.loadShares();
    this.setupClickOutsideListener();
    this.autoFillServerAddress();
  }

  ngOnDestroy() {
    if (this.clickListener) {
      document.removeEventListener('click', this.clickListener, true);
    }
  }

  private setupClickOutsideListener(): void {
    this.clickListener = (event: MouseEvent) => {
      const wrapper = this.pathWrapper()?.nativeElement;
      if (
        wrapper &&
        event.target &&
        !wrapper.contains(event.target as globalThis.Node) &&
        this.showFolderBrowser()
      ) {
        this.showFolderBrowser.set(false);
      }
    };
    document.addEventListener('click', this.clickListener, true);
  }

  onWrapperClick(event: Event): void {
    event.stopPropagation();
  }

  private autoFillServerAddress() {
    // Auto-fill server address with main node's IP if this is a LINKED node
    if (this.node.role === 'LINKED') {
      // Get main node from environment or configuration
      // For now, extract from current backend URL
      const apiUrl = environment.apiUrl;
      const match = apiUrl.match(/\/\/([^:/]+)/);
      if (match) {
        this.createForm.patchValue({ serverAddress: match[1] });
      }
    }
  }

  private initializeForm() {
    this.createForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(1)]],
      protocol: [StorageProtocol.NFS, Validators.required],
      serverAddress: ['', Validators.required],
      sharePath: ['', Validators.required],
      mountPoint: [{ value: '', disabled: true }], // Auto-generated, read-only
      readOnly: [true],
      autoMount: [true],
      addToFstab: [true],

      // SMB-specific fields
      smbUsername: [''],
      smbPassword: [''],
      smbDomain: [''],
      smbVersion: ['3.0'],
    });

    // Watch protocol changes to show/hide SMB fields
    this.createForm.get('protocol')?.valueChanges.subscribe((protocol) => {
      if (protocol === StorageProtocol.SMB) {
        this.createForm.get('smbUsername')?.setValidators(Validators.required);
      } else {
        this.createForm.get('smbUsername')?.clearValidators();
      }
      this.createForm.get('smbUsername')?.updateValueAndValidity();
    });

    // Auto-generate mount point from share path
    this.createForm.get('sharePath')?.valueChanges.subscribe((sharePath) => {
      if (sharePath) {
        const mountPoint = this.generateMountPoint(sharePath);
        this.createForm.patchValue({ mountPoint }, { emitEvent: false });
      }
    });
  }

  private generateMountPoint(sharePath: string): string {
    // Extract the last segment of the share path
    const segments = sharePath.split('/').filter((s) => s);
    const lastSegment = segments[segments.length - 1] || 'shared';

    // Generate mount point: /mnt/shared/{lastSegment}
    return `/mnt/shared/${lastSegment}`;
  }

  onPathFocus() {
    this.showFolderBrowser.set(true);
  }

  onFolderSelected(path: string) {
    this.createForm.patchValue({ sharePath: path });
    this.showFolderBrowser.set(false);
  }

  closeFolderBrowser() {
    this.showFolderBrowser.set(false);
  }

  async loadShares() {
    try {
      this.loading.set(true);
      this.error.set(null);

      const shares = await this.storageClient.getSharesByNode(this.node.id).toPromise();
      this.shares.set(shares || []);
    } catch (error: unknown) {
      this.error.set(extractErrorMessage(error, 'Failed to load storage shares'));
    } finally {
      this.loading.set(false);
    }
  }

  async autoDetect() {
    try {
      this.loading.set(true);
      this.error.set(null);
      this.autoDetectMessage.set(null);

      const result = await this.storageClient.autoDetectAndMount(this.node.id).toPromise();

      if (!result || result.detected === 0) {
        this.autoDetectMessage.set(
          `No storage shares were automatically detected from the main node. ` +
            `This could mean:\n\n` +
            `• The main node doesn't have any NFS/SMB exports configured\n` +
            `• Network connectivity issues between nodes\n` +
            `• Firewall blocking NFS (port 2049) or SMB (ports 139, 445)\n\n` +
            `You can add a share manually using the "Add Share Manually" button above.`
        );
      } else {
        const messages = [
          `✅ Successfully detected ${result.detected} share(s) from the main node`,
          `✅ Created ${result.created} share configuration(s)`,
          `✅ Mounted ${result.mounted} share(s)`,
        ];

        if (result.errors.length > 0) {
          messages.push(`\n⚠️ Errors:\n${result.errors.join('\n')}`);
        }

        this.autoDetectMessage.set(messages.join('\n'));
        await this.loadShares(); // Reload to show newly created shares
      }
    } catch (error: unknown) {
      this.error.set(extractErrorMessage(error, 'Failed to auto-detect shares'));
      this.autoDetectMessage.set(
        `Auto-detection failed. You can still add shares manually. ` +
          `Make sure the main node is accessible and has NFS/SMB exports enabled.`
      );
    } finally {
      this.loading.set(false);
    }
  }

  async autoExportDockerVolumes() {
    this.loading.set(true);
    this.error.set(null);
    this.autoDetectMessage.set(null);

    try {
      const result = await this.storageClient.autoExportDockerVolumes().toPromise();

      if (result?.success) {
        this.autoDetectMessage.set(
          `✓ ${result.message}\n\n` +
            `Docker volumes have been detected and automatically exported as NFS shares. ` +
            `Refreshing the list to show the new auto-managed shares...`
        );

        // Reload shares to show the newly created auto-managed shares
        setTimeout(() => {
          this.loadShares();
        }, 1500);
      }
    } catch (error: unknown) {
      this.error.set(
        extractErrorMessage(
          error,
          'Failed to auto-export Docker volumes. Make sure you are running on the main node in a Docker container.'
        )
      );
      this.autoDetectMessage.set(
        `Auto-export failed. This feature requires:\n` +
          `• Running as the MAIN node\n` +
          `• Running inside a Docker container\n` +
          `• Docker socket access (/var/run/docker.sock)\n\n` +
          `You can still add shares manually using the "Add Share Manually" button.`
      );
    } finally {
      this.loading.set(false);
    }
  }

  async mountShare(share: StorageShare) {
    try {
      share.status = StorageShareStatus.TESTING;

      const result = await this.storageClient.mountShare(share.id).toPromise();

      if (result?.success) {
        await this.loadShares(); // Reload to get updated status
      } else {
        this.error.set(result?.error || result?.message || 'Mount failed');
        share.status = StorageShareStatus.ERROR;
      }
    } catch (error: unknown) {
      this.error.set(extractErrorMessage(error, 'Failed to mount share'));
      share.status = StorageShareStatus.ERROR;
    }
  }

  async unmountShare(share: StorageShare) {
    try {
      share.status = StorageShareStatus.TESTING;

      const result = await this.storageClient.unmountShare(share.id).toPromise();

      if (result?.success) {
        await this.loadShares(); // Reload to get updated status
      } else {
        this.error.set(result?.error || result?.message || 'Unmount failed');
      }
    } catch (error: unknown) {
      this.error.set(extractErrorMessage(error, 'Failed to unmount share'));
    }
  }

  async deleteShare(share: StorageShare) {
    const dialogData: ConfirmationDialogData = {
      title: 'Delete Storage Share?',
      itemName: share.name,
      itemType: 'storage share',
      willHappen: [
        'Remove the share configuration from this node',
        'Unmount the share if currently mounted',
      ],
      wontHappen: ['Delete any files on the remote server', 'Affect other nodes using this share'],
      irreversible: true,
      confirmButtonText: 'Delete Share',
      cancelButtonText: 'Keep Share',
    };

    const confirmDialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    const confirmed = await firstValueFrom(confirmDialogRef.closed);
    if (confirmed !== true) {
      return;
    }

    try {
      await this.storageClient.deleteShare(share.id).toPromise();
      await this.loadShares();
    } catch (error: unknown) {
      this.error.set(extractErrorMessage(error, 'Failed to delete share'));
    }
  }

  async createShare() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    // Test connectivity before creating
    const serverAddress = this.createForm.get('serverAddress')?.value;
    const protocol = this.createForm.get('protocol')?.value;

    try {
      this.creating.set(true);
      this.error.set(null);

      // Test connectivity first
      const connectivityTest = await this.storageClient
        .testConnectivity(serverAddress, protocol)
        .toPromise();

      if (!connectivityTest?.isReachable) {
        this.error.set(
          `Cannot reach server ${serverAddress}. Please check:\n` +
            `• Server is online and accessible\n` +
            `• Network connectivity\n` +
            `• Firewall settings`
        );
        this.creating.set(false);
        return;
      }

      const protocolSupported =
        protocol === StorageProtocol.NFS
          ? connectivityTest.supportsNFS
          : connectivityTest.supportsSMB;
      if (!protocolSupported) {
        this.error.set(
          `Server ${serverAddress} does not support ${protocol}. Try the other protocol.`
        );
        this.creating.set(false);
        return;
      }

      // Get the actual mount point value (disabled fields don't submit by default)
      const formValue = {
        ...this.createForm.getRawValue(), // Use getRawValue() to include disabled fields
      };

      const request: CreateStorageShareRequest = {
        ...formValue,
        nodeId: this.node.id,
      };

      await this.storageClient.createShare(request).toPromise();

      this.showCreateForm.set(false);
      this.createForm.reset({
        protocol: StorageProtocol.NFS,
        readOnly: true,
        autoMount: true,
        addToFstab: true,
        smbVersion: '3.0',
      });
      this.autoFillServerAddress();

      await this.loadShares();
    } catch (error: unknown) {
      this.error.set(extractErrorMessage(error, 'Failed to create share'));
    } finally {
      this.creating.set(false);
    }
  }

  toggleCreateForm() {
    this.showCreateForm.set(!this.showCreateForm());
    if (!this.showCreateForm()) {
      this.createForm.reset({
        protocol: StorageProtocol.NFS,
        readOnly: true,
        autoMount: true,
        addToFstab: true,
        smbVersion: '3.0',
      });
      this.autoFillServerAddress();
    } else {
      this.autoFillServerAddress();
    }
  }

  getStatusIcon(status: StorageShareStatus): string {
    switch (status) {
      case StorageShareStatus.MOUNTED:
        return 'check-circle';
      case StorageShareStatus.ERROR:
        return 'exclamation-circle';
      case StorageShareStatus.TESTING:
        return 'spinner';
      case StorageShareStatus.AVAILABLE:
        return 'circle';
      default:
        return 'circle';
    }
  }

  getStatusClass(status: StorageShareStatus): string {
    switch (status) {
      case StorageShareStatus.MOUNTED:
        return 'share-card--mounted';
      case StorageShareStatus.ERROR:
        return 'share-card--error';
      case StorageShareStatus.TESTING:
        return 'share-card--testing';
      case StorageShareStatus.AVAILABLE:
        return 'share-card--available';
      default:
        return '';
    }
  }

  formatBytes(bytes?: bigint): string {
    if (!bytes) return 'N/A';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Number(bytes);
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  onClose() {
    this.dialogRef.close();
  }
}
