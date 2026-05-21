import { Dialog } from '@angular/cdk/dialog';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faCalendarCheck, faLightbulb, faTrashAlt } from '@fortawesome/pro-solid-svg-icons';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { NodeScheduleEditorComponent, type TimeWindow } from './node-schedule-editor.component';

const MOCK_WINDOW: TimeWindow = { dayOfWeek: 1, startHour: 9, endHour: 17 };

describe('NodeScheduleEditorComponent', () => {
  let fixture: ComponentFixture<NodeScheduleEditorComponent>;
  let component: NodeScheduleEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NodeScheduleEditorComponent, TranslocoTestingModule.forRoot({})],
      providers: [{ provide: Dialog, useValue: { open: jest.fn() } }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    // Register icons so FaIconComponent doesn't throw
    const library = TestBed.inject(FaIconLibrary);
    library.addIcons(faCalendarCheck, faTrashAlt, faLightbulb);

    fixture = TestBed.createComponent(NodeScheduleEditorComponent);
    component = fixture.componentInstance;

    // Stub calendarComponent so updateEvents() doesn't throw
    (component as any).calendarComponent = {
      getApi: jest.fn().mockReturnValue({
        unselect: jest.fn(),
        removeAllEvents: jest.fn(),
        addEventSource: jest.fn(),
      }),
    };

    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  describe('writeValue', () => {
    it('sets the windows signal when given an array', () => {
      component.writeValue([MOCK_WINDOW]);
      expect(component.windows()).toEqual([MOCK_WINDOW]);
    });

    it('sets empty array when called with null', () => {
      component.writeValue([MOCK_WINDOW]);
      component.writeValue(null);
      expect(component.windows()).toEqual([]);
    });
  });

  describe('registerOnChange', () => {
    it('stores the callback', () => {
      const fn = jest.fn();
      component.registerOnChange(fn);
      component.writeValue([MOCK_WINDOW]);
      expect(component.windows()).toEqual([MOCK_WINDOW]);
    });
  });

  describe('registerOnTouched', () => {
    it('stores the callback without throwing', () => {
      const fn = jest.fn();
      expect(() => component.registerOnTouched(fn)).not.toThrow();
    });
  });

  describe('setDisabledState', () => {
    it('sets disabled = true', () => {
      component.setDisabledState(true);
      expect(component.disabled).toBe(true);
    });

    it('sets disabled = false', () => {
      component.setDisabledState(true);
      component.setDisabledState(false);
      expect(component.disabled).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('returns no-windows message when empty', () => {
      component.writeValue([]);
      expect(component.getSummary()).toBe('No time windows defined (available 24/7)');
    });

    it('returns singular form for 1 window', () => {
      component.writeValue([MOCK_WINDOW]);
      expect(component.getSummary()).toBe('1 time window defined');
    });

    it('returns plural form for N > 1 windows', () => {
      component.writeValue([MOCK_WINDOW, MOCK_WINDOW, MOCK_WINDOW]);
      expect(component.getSummary()).toBe('3 time windows defined');
    });
  });
});
