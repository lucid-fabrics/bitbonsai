import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectorRef } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';
import { NodesComponent } from './nodes.page';
import { NodesClient } from './services/nodes.client';

describe('NodesComponent', () => {
  let component: NodesComponent;
  let fixture: ComponentFixture<NodesComponent>;
  let nodesClient: jest.Mocked<NodesClient>;
  let _cdr: jest.Mocked<ChangeDetectorRef>;

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

    await TestBed.configureTestingModule({
      imports: [NodesComponent],
      providers: [
        { provide: NodesClient, useValue: nodesClientMock },
        { provide: ChangeDetectorRef, useValue: cdrMock },
        { provide: Dialog, useValue: dialogMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NodesComponent);
    component = fixture.componentInstance;
    nodesClient = TestBed.inject(NodesClient) as jest.Mocked<NodesClient>;
    _cdr = TestBed.inject(ChangeDetectorRef) as jest.Mocked<ChangeDetectorRef>;
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

  describe('user interactions', () => {
    it('should initiate registration when onRegisterNode is called', () => {
      component.onRegisterNode();
      expect(nodesClient.register).toHaveBeenCalled();
    });

    it('should format uptime correctly', () => {
      expect(component.formatUptime(30)).toBe('30s');
      expect(component.formatUptime(3600)).toBe('1h 0m');
      expect(component.formatUptime(86400)).toBe('1d 0h');
    });

    it('should get acceleration label', () => {
      expect(component.getAccelerationLabel(AccelerationType.NVIDIA)).toBe('NVIDIA GPU');
      expect(component.getAccelerationLabel(AccelerationType.NONE)).toBe('CPU Only');
    });
  });
});
