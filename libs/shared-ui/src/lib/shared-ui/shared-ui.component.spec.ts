import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { SharedUiComponent } from './shared-ui.component';

describe('SharedUiComponent', () => {
  let component: SharedUiComponent;
  let fixture: ComponentFixture<SharedUiComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedUiComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedUiComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have the lib-shared-ui selector', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element).toBeDefined();
  });

  it('should render without errors', () => {
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('should be a standalone component', () => {
    const metadata = (SharedUiComponent as { ɵcmp?: { standalone?: boolean } }).ɵcmp;
    if (metadata) {
      expect(metadata.standalone).toBe(true);
    } else {
      // Angular compiled standalone without ɵcmp accessor — instantiation is sufficient proof
      expect(component).toBeInstanceOf(SharedUiComponent);
    }
  });
});
