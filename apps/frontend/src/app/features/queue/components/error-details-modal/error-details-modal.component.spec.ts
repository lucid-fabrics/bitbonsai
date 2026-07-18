import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { ErrorDetailsModalComponent } from './error-details-modal.component';

describe('ErrorDetailsModalComponent', () => {
  let component: ErrorDetailsModalComponent;

  const backendError = [
    '[FATAL] 🔴 Source File is Corrupted',
    'The video file contains corrupted or invalid data that cannot be processed.',
    '',
    '**Technical Details:**',
    'HEVC Reference Frame Error: missing reference frames.',
    '',
    '**Recommended Actions:**',
    '  ❌ **Do Not Retry** - This file cannot be encoded in its current state',
    '  📥 Re-download the source file from the original source',
  ].join('\n');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          initialState: { settings: { advancedModeEnabled: false } },
        }),
      ],
    });
    component = TestBed.runInInjectionContext(() => new ErrorDetailsModalComponent());
  });

  describe('backend-formatted errors', () => {
    beforeEach(() => {
      component.error = backendError;
    });

    it('uses the title line (prefix stripped, emoji kept) as summary', () => {
      expect(component.getErrorSummary()).toBe('🔴 Source File is Corrupted');
    });

    it('uses the description paragraph as contextual help', () => {
      expect(component.hasContextualHelp()).toBe(true);
      expect(component.getContextualHelp()).toBe(
        'The video file contains corrupted or invalid data that cannot be processed.'
      );
    });

    it('excludes the technical details section from the help text', () => {
      expect(component.getContextualHelp()).not.toContain('HEVC Reference Frame Error');
    });

    it('parses recommendation lines as steps, stripping bold markers and keeping emoji', () => {
      expect(component.getActionableSteps()).toEqual([
        {
          icon: 'fa-angle-right',
          text: '❌ Do Not Retry - This file cannot be encoded in its current state',
        },
        {
          icon: 'fa-angle-right',
          text: '📥 Re-download the source file from the original source',
        },
      ]);
    });

    it('detects the backend format via the actions marker without a prefix', () => {
      component.error = [
        '💾 Insufficient System Resources',
        'The system ran out of disk space while encoding.',
        '',
        '**Recommended Actions:**',
        '  🗑️ Free up disk space on the system drive',
      ].join('\n');

      expect(component.getErrorSummary()).toBe('💾 Insufficient System Resources');
      expect(component.getActionableSteps()).toEqual([
        { icon: 'fa-angle-right', text: '🗑️ Free up disk space on the system drive' },
      ]);
    });
  });

  describe('legacy raw errors', () => {
    it('keeps the keyword-table summary for raw ffmpeg errors', () => {
      component.error = 'FFmpeg failed with exit code 1';

      expect(component.getErrorSummary()).toBe(
        'This video could not be converted. Your original file is untouched.'
      );
    });

    it('falls back to the generic retry step when no keyword matches', () => {
      component.error = 'something unexpected happened';

      expect(component.getActionableSteps()).toEqual([
        {
          icon: 'fa-redo',
          text: 'BitBonsai retries automatically. You can also retry anytime',
        },
      ]);
    });
  });
});
