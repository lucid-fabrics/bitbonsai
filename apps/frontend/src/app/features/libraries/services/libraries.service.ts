import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { LibrariesClient } from '../../../core/clients/libraries.client';
import type {
  BulkJobCreationResult,
  CreateAllJobsDto,
  CreateJobsFromScanDto,
  CreateJobsFromScanResult,
  CreateLibraryDto,
  Library,
  LibraryFiles,
  ScanPreview,
  UpdateLibraryDto,
} from '../models/library.model';

@Injectable({
  providedIn: 'root',
})
export class LibrariesService {
  private readonly librariesClient = inject(LibrariesClient);

  getLibraries(): Observable<Library[]> {
    return this.librariesClient.getLibraries();
  }

  getLibrary(id: string): Observable<Library> {
    return this.librariesClient.getLibrary(id);
  }

  createLibrary(library: CreateLibraryDto): Observable<Library> {
    return this.librariesClient.createLibrary(library);
  }

  updateLibrary(id: string, updates: UpdateLibraryDto): Observable<Library> {
    return this.librariesClient.updateLibrary(id, updates);
  }

  deleteLibrary(id: string): Observable<void> {
    return this.librariesClient.deleteLibrary(id);
  }

  scanLibrary(id: string): Observable<Library> {
    return this.librariesClient.scanLibrary(id);
  }

  getScanPreview(id: string): Observable<ScanPreview> {
    return this.librariesClient.getScanPreview(id);
  }

  getAllReadyFiles(): Observable<ScanPreview[]> {
    return this.librariesClient.getAllReadyFiles();
  }

  createJobsFromScan(id: string, dto: CreateJobsFromScanDto): Observable<CreateJobsFromScanResult> {
    return this.librariesClient.createJobsFromScan(id, dto);
  }

  createAllJobs(id: string, dto: CreateAllJobsDto): Observable<BulkJobCreationResult> {
    return this.librariesClient.createAllJobs(id, dto);
  }

  getLibraryFiles(id: string): Observable<LibraryFiles> {
    return this.librariesClient.getLibraryFiles(id);
  }
}
