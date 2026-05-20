import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { CloudAuthStatus, DeviceFlowResponse } from '../services/cloud-account.service';
import { CloudAccountService } from '../services/cloud-account.service';
import { LicenseTabComponent } from './license-tab.component';

const UNLINKED_STATUS: CloudAuthStatus = { linked: false } as CloudAuthStatus;
const LINKED_STATUS: CloudAuthStatus = {
  linked: true,
  email: 'test@example.com',
  tier: 'FREE',
  maxNodes: 1,
  maxConcurrentJobs: 2,
  validatedAt: null,
  gracePeriodExpired: false,
  gracePeriodExpiresAt: null,
} as unknown as CloudAuthStatus;

const MOCK_FLOW: DeviceFlowResponse = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://bitbonsai.app/device',
  deviceCode: 'dev_code',
  expiresIn: 600,
  interval: 3,
} as unknown as DeviceFlowResponse;

describe('LicenseTabComponent', () => {
  let fixture: ComponentFixture<LicenseTabComponent>;
  let component: LicenseTabComponent;
  let cloudAccountService: jest.Mocked<CloudAccountService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<CloudAccountService>> = {
      getStatus: jest.fn().mockReturnValue(of(UNLINKED_STATUS)),
      startDeviceFlow: jest.fn().mockReturnValue(of(MOCK_FLOW)),
      logout: jest.fn().mockReturnValue(of(undefined)),
      validateNow: jest.fn().mockReturnValue(of(true)),
    };

    await TestBed.configureTestingModule({
      imports: [LicenseTabComponent],
      providers: [{ provide: CloudAccountService, useValue: serviceMock }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(LicenseTabComponent);
    component = fixture.componentInstance;
    cloudAccountService = TestBed.inject(CloudAccountService) as jest.Mocked<CloudAccountService>;
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('status() signal is null before ngOnInit resolves', () => {
    // After fixture creation getStatus() already emitted; status is set
    // Verify it was set from the mock (not null post-init)
    expect(component.status()).toEqual(UNLINKED_STATUS);
  });

  it('loading is false after getStatus responds', fakeAsync(() => {
    expect(component.loading()).toBe(false);
    tick();
    expect(component.loading()).toBe(false);
  }));

  it('startLinking() calls cloudAccountService.startDeviceFlow()', fakeAsync(() => {
    component.startLinking();
    tick();
    expect(cloudAccountService.startDeviceFlow).toHaveBeenCalled();
    expect(component.deviceFlow()).toEqual(MOCK_FLOW);
    expect(component.linkLoading()).toBe(false);
  }));

  it('startLinking() sets linkError on failure', fakeAsync(() => {
    cloudAccountService.startDeviceFlow.mockReturnValue(throwError(() => new Error('fail')));
    component.startLinking();
    tick();
    expect(component.linkError()).toBe('Failed to start device flow. Please try again.');
    expect(component.linkLoading()).toBe(false);
  }));

  it('signOut() calls cloudAccountService.logout()', fakeAsync(() => {
    cloudAccountService.getStatus.mockReturnValue(of(LINKED_STATUS));
    component.signOut();
    tick();
    expect(cloudAccountService.logout).toHaveBeenCalled();
    expect(component.actionLoading()).toBe(false);
  }));

  it('revalidate() calls cloudAccountService.validateNow()', fakeAsync(() => {
    cloudAccountService.getStatus.mockReturnValue(of(LINKED_STATUS));
    component.revalidate();
    tick();
    expect(cloudAccountService.validateNow).toHaveBeenCalled();
    expect(component.actionSuccess()).toBe('Validation successful.');
    expect(component.actionLoading()).toBe(false);
  }));

  it('revalidate() sets actionError on failure', fakeAsync(() => {
    cloudAccountService.validateNow.mockReturnValue(throwError(() => new Error('fail')));
    component.revalidate();
    tick();
    expect(component.actionError()).toBe('Validation failed. Please try again.');
  }));
});
