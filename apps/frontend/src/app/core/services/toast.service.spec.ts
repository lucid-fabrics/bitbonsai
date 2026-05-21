import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;
  let container: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ToastService] });
    service = TestBed.inject(ToastService);
    // Ensure clean DOM state before each test
    document.querySelector('.toast-container')?.remove();
    jest.useFakeTimers();
  });

  afterEach(() => {
    document.querySelector('.toast-container')?.remove();
    jest.useRealTimers();
  });

  function getToasts(): NodeListOf<Element> {
    return document.querySelectorAll('.toast');
  }

  describe('success()', () => {
    it('creates a toast with class toast-success', () => {
      service.success('Saved!');
      expect(document.querySelector('.toast-success')).not.toBeNull();
    });

    it('sets the message text', () => {
      service.success('Operation complete');
      const toast = document.querySelector('.toast-success');
      expect(toast?.textContent).toContain('Operation complete');
    });

    it('auto-removes after 2000ms', () => {
      service.success('Gone soon');
      expect(getToasts().length).toBe(1);
      jest.advanceTimersByTime(2000 + 300 + 50); // duration + fade + buffer
      expect(getToasts().length).toBe(0);
    });
  });

  describe('info()', () => {
    it('creates a toast with class toast-info', () => {
      service.info('Loading...');
      expect(document.querySelector('.toast-info')).not.toBeNull();
    });

    it('auto-removes after 2000ms', () => {
      service.info('Info message');
      jest.advanceTimersByTime(2350);
      expect(getToasts().length).toBe(0);
    });
  });

  describe('warning()', () => {
    it('creates a toast with class toast-warning', () => {
      service.warning('Caution!');
      expect(document.querySelector('.toast-warning')).not.toBeNull();
    });

    it('auto-removes after 3000ms', () => {
      service.warning('Watch out');
      jest.advanceTimersByTime(3000 + 300 + 50);
      expect(getToasts().length).toBe(0);
    });
  });

  describe('error()', () => {
    it('creates a toast with class toast-error', () => {
      service.error('Something broke');
      expect(document.querySelector('.toast-error')).not.toBeNull();
    });

    it('auto-removes after 3000ms', () => {
      service.error('Error!');
      jest.advanceTimersByTime(3350);
      expect(getToasts().length).toBe(0);
    });
  });

  describe('custom duration', () => {
    it('respects a custom duration override', () => {
      service.success('Quick', 500);
      jest.advanceTimersByTime(500 + 300 + 50);
      expect(getToasts().length).toBe(0);
    });
  });

  describe('container behaviour', () => {
    it('creates a single .toast-container in the DOM', () => {
      service.success('A');
      service.info('B');
      expect(document.querySelectorAll('.toast-container').length).toBe(1);
    });

    it('reuses an existing container', () => {
      const existing = document.createElement('div');
      existing.className = 'toast-container';
      document.body.appendChild(existing);

      service.success('Reuse test');
      expect(document.querySelectorAll('.toast-container').length).toBe(1);
    });
  });

  describe('close button', () => {
    it('adds a close button to each toast', () => {
      service.success('With close');
      expect(document.querySelector('.toast-close')).not.toBeNull();
    });

    it('removes the toast when close button is clicked', () => {
      service.success('Click to close');
      const closeBtn = document.querySelector('.toast-close') as HTMLButtonElement;
      closeBtn.click();
      jest.advanceTimersByTime(350); // fade animation
      expect(getToasts().length).toBe(0);
    });
  });
});
