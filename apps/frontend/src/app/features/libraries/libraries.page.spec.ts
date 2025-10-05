import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { NodesActions } from '../nodes/+state/nodes.actions';
import { LibrariesActions } from './+state/libraries.actions';
import { LibrariesComponent } from './libraries.page';
import type { CreateLibraryDto, Library, UpdateLibraryDto } from './models/library.model';

describe('LibrariesComponent', () => {
  let component: LibrariesComponent;
  let fixture: ComponentFixture<LibrariesComponent>;
  let store: MockStore;
  let dialog: jest.Mocked<Dialog>;
  let httpMock: HttpTestingController;

  const mockLibrary: Library = {
    id: '1',
    name: 'Test Library',
    path: '/path/to/library',
    watchEnabled: true,
    policyId: 'policy-1',
  } as Library;

  const mockDialog = {
    open: jest.fn(),
  };

  const initialState = {};

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LibrariesComponent],
      providers: [
        provideMockStore({ initialState }),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Dialog, useValue: mockDialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LibrariesComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
    dialog = TestBed.inject(Dialog) as jest.Mocked<Dialog>;
    httpMock = TestBed.inject(HttpTestingController);

    jest.clearAllMocks();
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should dispatch load actions on init', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      fixture.detectChanges();

      expect(dispatchSpy).toHaveBeenCalledWith(LibrariesActions.loadLibraries());
      expect(dispatchSpy).toHaveBeenCalledWith(NodesActions.loadNodes());
    });

    it('should initialize signals', () => {
      expect(component.showForm()).toBe(false);
      expect(component.selectedLibrary()).toBeUndefined();
      expect(component.scanningLibraryId()).toBeNull();
    });
  });

  describe('onAddLibrary', () => {
    it('should open form in create mode', () => {
      component.onAddLibrary();

      expect(component.selectedLibrary()).toBeUndefined();
      expect(component.showForm()).toBe(true);
    });
  });

  describe('onEditLibrary', () => {
    it('should open form in edit mode with library', () => {
      component.onEditLibrary(mockLibrary);

      expect(component.selectedLibrary()).toEqual(mockLibrary);
      expect(component.showForm()).toBe(true);
    });
  });

  describe('onFormSubmit', () => {
    it('should create library when no library selected', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const createData: CreateLibraryDto = {
        name: 'New Library',
        path: '/path',
        policyId: 'policy-1',
      };

      component.selectedLibrary.set(undefined);
      component.onFormSubmit(createData);

      expect(dispatchSpy).toHaveBeenCalledWith(
        LibrariesActions.createLibrary({ library: createData })
      );
      expect(component.showForm()).toBe(false);
      expect(component.selectedLibrary()).toBeUndefined();
    });

    it('should update library when library selected', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const updateData: UpdateLibraryDto = {
        name: 'Updated Library',
      };

      component.selectedLibrary.set(mockLibrary);
      component.onFormSubmit(updateData);

      expect(dispatchSpy).toHaveBeenCalledWith(
        LibrariesActions.updateLibrary({
          id: '1',
          library: updateData,
        })
      );
      expect(component.showForm()).toBe(false);
      expect(component.selectedLibrary()).toBeUndefined();
    });
  });

  describe('onFormCancel', () => {
    it('should close form and reset state', () => {
      component.showForm.set(true);
      component.selectedLibrary.set(mockLibrary);

      component.onFormCancel();

      expect(component.showForm()).toBe(false);
      expect(component.selectedLibrary()).toBeUndefined();
    });
  });

  describe('onDeleteLibrary', () => {
    it('should open confirmation dialog', () => {
      const mockDialogRef = {
        closed: of(false),
      } as DialogRef<boolean>;
      mockDialog.open.mockReturnValue(mockDialogRef);

      component.onDeleteLibrary(mockLibrary);

      expect(mockDialog.open).toHaveBeenCalledWith(
        ConfirmationDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Delete Library?',
            itemName: 'Test Library',
            irreversible: true,
          }),
        })
      );
    });

    it('should dispatch delete when confirmed', () => {
      const mockDialogRef = {
        closed: of(true),
      } as DialogRef<boolean>;
      mockDialog.open.mockReturnValue(mockDialogRef);
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.onDeleteLibrary(mockLibrary);

      expect(dispatchSpy).toHaveBeenCalledWith(LibrariesActions.deleteLibrary({ id: '1' }));
    });

    it('should not dispatch delete when cancelled', () => {
      const mockDialogRef = {
        closed: of(false),
      } as DialogRef<boolean>;
      mockDialog.open.mockReturnValue(mockDialogRef);
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.onDeleteLibrary(mockLibrary);

      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: expect.stringContaining('delete') })
      );
    });
  });

  describe('onScanLibrary', () => {
    it('should dispatch scan action and set scanning state', () => {
      jest.useFakeTimers();
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.onScanLibrary(mockLibrary);

      expect(dispatchSpy).toHaveBeenCalledWith(LibrariesActions.scanLibrary({ id: '1' }));
      expect(component.scanningLibraryId()).toBe('1');

      jest.advanceTimersByTime(1000);
      expect(component.scanningLibraryId()).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('onToggleWatch', () => {
    it('should dispatch update with toggled watch state', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      component.onToggleWatch(mockLibrary);

      expect(dispatchSpy).toHaveBeenCalledWith(
        LibrariesActions.updateLibrary({
          id: '1',
          library: { watchEnabled: false },
        })
      );
    });

    it('should enable watch if currently disabled', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const disabledLibrary = { ...mockLibrary, watchEnabled: false };

      component.onToggleWatch(disabledLibrary);

      expect(dispatchSpy).toHaveBeenCalledWith(
        LibrariesActions.updateLibrary({
          id: '1',
          library: { watchEnabled: true },
        })
      );
    });
  });

  describe('isScanning', () => {
    it('should return true for scanning library', () => {
      component.scanningLibraryId.set('1');
      expect(component.isScanning('1')).toBe(true);
    });

    it('should return false for non-scanning library', () => {
      component.scanningLibraryId.set('1');
      expect(component.isScanning('2')).toBe(false);
    });

    it('should return false when no library scanning', () => {
      component.scanningLibraryId.set(null);
      expect(component.isScanning('1')).toBe(false);
    });
  });
});
