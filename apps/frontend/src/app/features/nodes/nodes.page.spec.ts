import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { of } from 'rxjs';
import { NodesClient } from '../../core/clients/nodes.client';
import { EnvironmentDetectionService } from '../../core/services/environment-detection.service';
import { NodeBo } from './bos/node.bo';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';
import { NodesComponent } from './nodes.page';

describe('NodesComponent', () => {
  let component: NodesComponent;
  let fixture: ComponentFixture<NodesComponent>;
  let nodesClient: jest.Mocked<NodesClient>;

  const mockNodes = [
    {
      id: '1',
      name: 'Node 1',
      status: NodeStatus.ONLINE,
      role: NodeRole.WORKER,
      acceleration: AccelerationType.NVIDIA,
      lastHeartbeat: new Date().toISOString(),
      uptimeSeconds: 3600,
    },
  ];

  beforeEach(async () => {
    const nodesClientMock = {
      getNodes: jest.fn().mockReturnValue(of(mockNodes)),
      getPendingRequests: jest.fn().mockReturnValue(of([])),
      getNodeScores: jest.fn().mockReturnValue(of([])),
      register: jest.fn().mockReturnValue(of({ command: 'test command' })),
      pair: jest.fn().mockReturnValue(of({ success: true, node: mockNodes[0] })),
      deleteNode: jest.fn().mockReturnValue(of(void 0)),
    } as unknown as jest.Mocked<NodesClient>;

    const cdrMock = {
      markForCheck: jest.fn(),
      detectChanges: jest.fn(),
    } as unknown as jest.Mocked<ChangeDetectorRef>;

    const dialogMock = {
      open: jest.fn().mockReturnValue({
        closed: of(true),
      }),
    };

    const environmentServiceMock = {
      getStorageRecommendation: jest.fn().mockReturnValue(of({})),
      detectEnvironment: jest.fn().mockReturnValue(of({})),
    };

    await TestBed.configureTestingModule({
      imports: [NodesComponent, TranslocoTestingModule.forRoot({})],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: NodesClient, useValue: nodesClientMock },
        { provide: ChangeDetectorRef, useValue: cdrMock },
        { provide: Dialog, useValue: dialogMock },
        { provide: EnvironmentDetectionService, useValue: environmentServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NodesComponent);
    component = fixture.componentInstance;
    nodesClient = TestBed.inject(NodesClient) as jest.Mocked<NodesClient>;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('component initialization', () => {
    it('should load nodes on init', () => {
      component.ngOnInit();
      expect(nodesClient.getNodes).toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('should render component template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled).toBeDefined();
    });
  });

  describe('computed properties', () => {
    it('should calculate total nodes', () => {
      component.nodes = mockNodes;
      expect(component.totalNodes).toBe(1);
    });

    it('should calculate online nodes', () => {
      component.nodes = mockNodes;
      expect(component.onlineNodes).toBe(1);
    });

    it('should calculate offline nodes', () => {
      component.nodes = [];
      expect(component.offlineNodes).toBe(0);
    });
  });

  describe('NodeBo utilities', () => {
    it('should format uptime correctly', () => {
      expect(NodeBo.formatUptime(30)).toBe('30s');
      expect(NodeBo.formatUptime(3600)).toBe('1h 0m');
      expect(NodeBo.formatUptime(86400)).toBe('1d 0h');
    });

    it('should get acceleration label', () => {
      expect(NodeBo.getAccelerationLabel(AccelerationType.NVIDIA)).toBe('NVIDIA GPU');
      expect(NodeBo.getAccelerationLabel(AccelerationType.CPU)).toBe('CPU Only');
    });
  });

  describe('user interactions', () => {
    it('should open dialog when onRegisterNode is called', () => {
      const dialog = TestBed.inject(Dialog);
      component.onRegisterNode();
      expect(dialog.open).toHaveBeenCalled();
    });
  });
});
