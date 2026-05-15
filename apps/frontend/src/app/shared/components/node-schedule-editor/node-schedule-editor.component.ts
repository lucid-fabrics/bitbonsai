import { Dialog } from '@angular/cdk/dialog';
import { Component, forwardRef, Input, inject, OnInit, signal, ViewChild } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import type {
  CalendarOptions,
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import { TranslocoModule } from '@ngneat/transloco';
import { firstValueFrom } from 'rxjs';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../confirmation-dialog/confirmation-dialog.component';

/**
 * Time window interface matching backend schema
 */
export interface TimeWindow {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startHour: number; // 0-23
  endHour: number; // 0-23
  startMinute?: number; // 0-59
  endMinute?: number; // 0-59
}

/**
 * Node Schedule Editor Component
 *
 * Visual calendar interface for defining node encoding time windows.
 * Uses FullCalendar for intuitive drag-and-select time window creation.
 *
 * Features:
 * - Weekly time grid view (Sunday-Saturday)
 * - Drag to create new time windows
 * - Resize existing windows
 * - Click to delete windows
 * - Real-time validation and preview
 *
 * @implements {ControlValueAccessor} - Integrates with Angular forms via ngModel/formControl
 */
@Component({
  selector: 'app-node-schedule-editor',
  standalone: true,
  imports: [FormsModule, FontAwesomeModule, FullCalendarModule, TranslocoModule],
  templateUrl: './node-schedule-editor.component.html',
  styleUrl: './node-schedule-editor.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => NodeScheduleEditorComponent),
      multi: true,
    },
  ],
})
export class NodeScheduleEditorComponent implements OnInit, ControlValueAccessor {
  private readonly dialog = inject(Dialog);

  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

  @Input() disabled = false;

  // Internal state
  windows = signal<TimeWindow[]>([]);
  events = signal<EventInput[]>([]);

  // ControlValueAccessor callbacks
  private onChange: (value: TimeWindow[]) => void = () => {
    /* no-op */
  };
  private onTouched: () => void = () => {
    /* no-op */
  };

  calendarOptions = signal<CalendarOptions>({
    plugins: [timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    headerToolbar: {
      left: 'title',
      center: '',
      right: 'today',
    },
    allDaySlot: false, // Hide all-day slot
    slotMinTime: '00:00:00',
    slotMaxTime: '24:00:00',
    slotDuration: '01:00:00', // 1-hour slots
    snapDuration: '00:15:00', // Snap to 15-minute intervals
    height: 'auto',
    expandRows: true,
    selectable: true,
    selectMirror: true,
    editable: true,
    eventResizableFromStart: true, // Allow resizing from start
    eventDurationEditable: true, // Allow resizing from end
    eventStartEditable: true, // Allow dragging
    eventClick: this.handleEventClick.bind(this),
    select: this.handleDateSelect.bind(this),
    eventResize: this.handleEventResize.bind(this),
    eventDrop: this.handleEventDrop.bind(this),
    events: [], // Will be updated from signal
  });

  ngOnInit(): void {
    // Initialize events from windows
    this.updateEvents();
  }

  /**
   * Handle date selection (drag to create new window)
   * DEEP AUDIT P2-1: Fix any type with proper FullCalendar types
   */
  handleDateSelect(selectInfo: DateSelectArg): void {
    if (this.disabled) return;

    const start = selectInfo.start;
    const end = selectInfo.end;

    // Create new time window
    const window: TimeWindow = {
      dayOfWeek: start.getDay(),
      startHour: start.getHours(),
      startMinute: start.getMinutes(),
      endHour: end.getHours(),
      endMinute: end.getMinutes(),
    };

    // Add to windows array
    const currentWindows = this.windows();
    this.windows.set([...currentWindows, window]);
    this.updateEvents();
    this.emitChange();

    // Clear selection
    const calendarApi = this.calendarComponent.getApi();
    calendarApi.unselect();
  }

  /**
   * Handle event click (delete window)
   * DEEP AUDIT P2-1: Fix any type with proper FullCalendar types
   */
  async handleEventClick(clickInfo: EventClickArg): Promise<void> {
    if (this.disabled) return;

    const dialogData: ConfirmationDialogData = {
      title: 'Delete Time Window?',
      itemName: 'this time window',
      itemType: 'schedule entry',
      willHappen: ['Remove this encoding time slot'],
      wontHappen: ['Affect other time windows', 'Change node status'],
      irreversible: false,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Keep',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    const confirmed = await firstValueFrom(dialogRef.closed);
    if (confirmed === true) {
      const eventId = clickInfo.event.id;
      const windowIndex = parseInt(eventId, 10);

      // Remove from windows array
      const currentWindows = this.windows();
      const updatedWindows = currentWindows.filter((_, index) => index !== windowIndex);
      this.windows.set(updatedWindows);
      this.updateEvents();
      this.emitChange();
    }
  }

  /**
   * Handle event resize (change window duration)
   * DEEP AUDIT P2-1: Fix any type with proper FullCalendar types
   */
  handleEventResize(resizeInfo: EventResizeDoneArg): void {
    if (this.disabled) {
      resizeInfo.revert();
      return;
    }

    const eventId = resizeInfo.event.id;
    const windowIndex = parseInt(eventId, 10);
    const start = resizeInfo.event.start!;
    const end = resizeInfo.event.end!;

    // Update window
    const currentWindows = this.windows();
    const updatedWindow: TimeWindow = {
      dayOfWeek: start.getDay(),
      startHour: start.getHours(),
      startMinute: start.getMinutes(),
      endHour: end.getHours(),
      endMinute: end.getMinutes(),
    };

    currentWindows[windowIndex] = updatedWindow;
    this.windows.set([...currentWindows]);
    this.emitChange();
  }

  /**
   * Handle event drop (move window to different day/time)
   * DEEP AUDIT P2-1: Fix any type with proper FullCalendar types
   */
  handleEventDrop(dropInfo: EventDropArg): void {
    if (this.disabled) {
      dropInfo.revert();
      return;
    }

    const eventId = dropInfo.event.id;
    const windowIndex = parseInt(eventId, 10);
    const start = dropInfo.event.start!;
    const end = dropInfo.event.end!;

    // Update window
    const currentWindows = this.windows();
    const updatedWindow: TimeWindow = {
      dayOfWeek: start.getDay(),
      startHour: start.getHours(),
      startMinute: start.getMinutes(),
      endHour: end.getHours(),
      endMinute: end.getMinutes(),
    };

    currentWindows[windowIndex] = updatedWindow;
    this.windows.set([...currentWindows]);
    this.emitChange();
  }

  /**
   * Convert TimeWindow array to FullCalendar events
   */
  private updateEvents(): void {
    const events: EventInput[] = this.windows().map((window, index) => {
      // Convert to FullCalendar event format
      const startTime = `${String(window.startHour).padStart(2, '0')}:${String(window.startMinute ?? 0).padStart(2, '0')}`;
      const endTime = `${String(window.endHour).padStart(2, '0')}:${String(window.endMinute ?? 0).padStart(2, '0')}`;

      return {
        id: String(index),
        daysOfWeek: [window.dayOfWeek], // Recurring weekly
        startTime,
        endTime,
        display: 'block',
        backgroundColor: 'rgba(249, 190, 3, 0.25)', // Gold accent with transparency
        borderColor: '#f9be03', // Gold accent
        textColor: '#ffffff',
        editable: !this.disabled,
      };
    });

    this.events.set(events);

    // Update calendar
    if (this.calendarComponent) {
      const calendarApi = this.calendarComponent.getApi();
      calendarApi.removeAllEvents();
      calendarApi.addEventSource(events);
    }
  }

  /**
   * Emit change to parent form
   */
  private emitChange(): void {
    this.onChange(this.windows());
    this.onTouched();
  }

  // ControlValueAccessor implementation
  writeValue(value: TimeWindow[] | null): void {
    this.windows.set(value ?? []);
    this.updateEvents();
  }

  registerOnChange(fn: (value: TimeWindow[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.updateEvents(); // Refresh events to apply disabled state
  }

  /**
   * Clear all windows
   */
  async clearAll(): Promise<void> {
    if (this.disabled) return;

    const windowCount = this.windows().length;
    const dialogData: ConfirmationDialogData = {
      title: 'Clear All Time Windows?',
      itemName: `${windowCount} time window${windowCount === 1 ? '' : 's'}`,
      itemType: 'schedule entries',
      willHappen: [
        'Remove all encoding time slots',
        'Node will be available 24/7 (no restrictions)',
      ],
      wontHappen: ["Change the node's active status", 'Affect encoding jobs in progress'],
      irreversible: false,
      confirmButtonText: 'Clear All',
      cancelButtonText: 'Keep Windows',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    const confirmed = await firstValueFrom(dialogRef.closed);
    if (confirmed === true) {
      this.windows.set([]);
      this.updateEvents();
      this.emitChange();
    }
  }

  /**
   * Get summary text for display
   */
  getSummary(): string {
    const count = this.windows().length;
    if (count === 0) {
      return 'No time windows defined (available 24/7)';
    }
    return `${count} time window${count === 1 ? '' : 's'} defined`;
  }
}
