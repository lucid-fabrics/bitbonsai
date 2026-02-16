import type { Node } from '@prisma/client';
import {
  formatTimeWindow,
  getScheduleDescription,
  isNodeInAllowedWindow,
  TimeWindow,
} from '../schedule-checker';

describe('schedule-checker', () => {
  describe('isNodeInAllowedWindow', () => {
    /**
     * Basic behavior tests
     */
    describe('basic behavior', () => {
      it('should return true when schedule is disabled', () => {
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: false,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }] as any,
        };

        const result = isNodeInAllowedWindow(node);

        expect(result).toBe(true);
      });

      it('should return true when scheduleWindows is null', () => {
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: null,
        };

        const result = isNodeInAllowedWindow(node);

        expect(result).toBe(true);
      });

      it('should return true when scheduleWindows is empty array', () => {
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [],
        };

        const result = isNodeInAllowedWindow(node);

        expect(result).toBe(true);
      });

      it('should return true when scheduleWindows is empty JSON string', () => {
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: '[]' as any,
        };

        const result = isNodeInAllowedWindow(node);

        expect(result).toBe(true);
      });
    });

    /**
     * Normal (non-midnight-crossing) window tests
     */
    describe('normal windows (non-midnight-crossing)', () => {
      it('should return true when current time is within a single window', () => {
        // Monday 10:00
        const mockDate = new Date('2024-01-01T10:00:00'); // Monday
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should return false when current time is outside window', () => {
        // Monday 08:00 (before window starts at 09:00)
        const mockDate = new Date('2024-01-01T08:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should return false when current time is after window ends', () => {
        // Monday 18:00 (after window ends at 17:00)
        const mockDate = new Date('2024-01-01T18:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should return true at exact start time of window', () => {
        // Monday 09:00 (exactly at window start)
        const mockDate = new Date('2024-01-01T09:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should return false one second after window ends', () => {
        // Monday 17:00:00 is the end boundary, should be false (exclusive)
        const mockDate = new Date('2024-01-01T17:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should return false when current day does not match window day', () => {
        // Tuesday 10:00, but window is only for Monday
        const mockDate = new Date('2024-01-02T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });
    });

    /**
     * Midnight-crossing window tests
     */
    describe('midnight-crossing windows', () => {
      it('should handle window crossing midnight (e.g., 23:00-07:00)', () => {
        // Monday 23:30, window is Mon 23:00 - Tue 07:00
        const mockDate = new Date('2024-01-01T23:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should not match next day in midnight-crossing window', () => {
        // Tuesday 10:00, window is only Mon 23:00 - Tue 07:00
        // Tuesday matches dayOfWeek: 2, but window is for dayOfWeek: 1
        const mockDate = new Date('2024-01-02T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should handle early morning times in midnight-crossing window', () => {
        // Monday 06:00, window is Mon 23:00 - Mon 07:00
        const mockDate = new Date('2024-01-01T06:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should exclude time between end and start of midnight-crossing window', () => {
        // Monday 10:00, window is Mon 23:00 - Mon 07:00
        // Current time is between 07:00 (exclusive) and 23:00 (exclusive)
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should return false at exact end time of midnight-crossing window', () => {
        // Monday 07:00 (exactly at window end), should be false (exclusive)
        const mockDate = new Date('2024-01-01T07:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should return true at exact start time of midnight-crossing window', () => {
        // Monday 23:00 (exactly at window start)
        const mockDate = new Date('2024-01-01T23:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 7 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });
    });

    /**
     * Minute precision tests
     */
    describe('minute precision', () => {
      it('should handle startMinute precision', () => {
        // Monday 09:30
        const mockDate = new Date('2024-01-01T09:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, startMinute: 30, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should exclude time before startMinute', () => {
        // Monday 09:29 (one minute before 09:30)
        const mockDate = new Date('2024-01-01T09:29:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, startMinute: 30, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should handle endMinute precision', () => {
        // Monday 16:45
        const mockDate = new Date('2024-01-01T16:45:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17, endMinute: 30 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should exclude time after endMinute', () => {
        // Monday 17:30 (after 17:30 end)
        const mockDate = new Date('2024-01-01T17:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17, endMinute: 30 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should handle both startMinute and endMinute precision', () => {
        // Monday 14:45
        const mockDate = new Date('2024-01-01T14:45:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            {
              dayOfWeek: 1,
              startHour: 9,
              startMinute: 15,
              endHour: 17,
              endMinute: 45,
            },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should return false at exact endMinute boundary (exclusive)', () => {
        // Monday 17:30 (exactly at end)
        const mockDate = new Date('2024-01-01T17:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17, endMinute: 30 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should return true at exact startMinute boundary (inclusive)', () => {
        // Monday 09:15 (exactly at start)
        const mockDate = new Date('2024-01-01T09:15:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, startMinute: 15, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle midnight-crossing with minute precision', () => {
        // Monday 23:45
        const mockDate = new Date('2024-01-01T23:45:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            {
              dayOfWeek: 1,
              startHour: 23,
              startMinute: 30,
              endHour: 7,
              endMinute: 15,
            },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should exclude time before midnight-crossing startMinute', () => {
        // Monday 23:29
        const mockDate = new Date('2024-01-01T23:29:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            {
              dayOfWeek: 1,
              startHour: 23,
              startMinute: 30,
              endHour: 7,
              endMinute: 15,
            },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });
    });

    /**
     * Multiple windows tests
     */
    describe('multiple windows', () => {
      it('should return true if any window matches', () => {
        // Monday 10:00
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 6, endHour: 9 }, // Mon 06:00-09:00
            { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Mon 09:00-17:00
            { dayOfWeek: 1, startHour: 20, endHour: 23 }, // Mon 20:00-23:00
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should return false if no window matches', () => {
        // Monday 18:00
        const mockDate = new Date('2024-01-01T18:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 6, endHour: 9 },
            { dayOfWeek: 1, startHour: 9, endHour: 17 },
            { dayOfWeek: 1, startHour: 20, endHour: 23 },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should check all windows across different days', () => {
        // Tuesday 10:00
        const mockDate = new Date('2024-01-02T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Monday
            { dayOfWeek: 2, startHour: 9, endHour: 17 }, // Tuesday
            { dayOfWeek: 3, startHour: 9, endHour: 17 }, // Wednesday
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should return true on second window if first does not match', () => {
        // Monday 10:00
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 2, startHour: 9, endHour: 17 }, // Tuesday (not today)
            { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Monday (today)
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle multiple windows with mixed midnight-crossing', () => {
        // Monday 23:30
        const mockDate = new Date('2024-01-01T23:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Normal window
            { dayOfWeek: 1, startHour: 23, endHour: 7 }, // Midnight-crossing window
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });
    });

    /**
     * All days of week tests
     */
    describe('all days of week', () => {
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      const dayDates = [
        new Date('2023-12-31T10:00:00'), // Sunday
        new Date('2024-01-01T10:00:00'), // Monday
        new Date('2024-01-02T10:00:00'), // Tuesday
        new Date('2024-01-03T10:00:00'), // Wednesday
        new Date('2024-01-04T10:00:00'), // Thursday
        new Date('2024-01-05T10:00:00'), // Friday
        new Date('2024-01-06T10:00:00'), // Saturday
      ];

      dayDates.forEach((date, dayOfWeek) => {
        it(`should work correctly for ${dayNames[dayOfWeek]} (day ${dayOfWeek})`, () => {
          const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
            scheduleEnabled: true,
            scheduleWindows: [{ dayOfWeek, startHour: 9, endHour: 17 }],
          };

          const result = isNodeInAllowedWindow(node, date);

          expect(result).toBe(true);
        });

        it(`should exclude ${dayNames[dayOfWeek]} if day does not match`, () => {
          const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
            scheduleEnabled: true,
            scheduleWindows: [{ dayOfWeek: (dayOfWeek + 1) % 7, startHour: 9, endHour: 17 }],
          };

          const result = isNodeInAllowedWindow(node, date);

          expect(result).toBe(false);
        });
      });

      it('should handle all 7 days in single schedule', () => {
        const mockDate = new Date('2024-01-03T10:00:00'); // Wednesday
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 0, startHour: 9, endHour: 17 },
            { dayOfWeek: 1, startHour: 9, endHour: 17 },
            { dayOfWeek: 2, startHour: 9, endHour: 17 },
            { dayOfWeek: 3, startHour: 9, endHour: 17 }, // Wednesday
            { dayOfWeek: 4, startHour: 9, endHour: 17 },
            { dayOfWeek: 5, startHour: 9, endHour: 17 },
            { dayOfWeek: 6, startHour: 9, endHour: 17 },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });
    });

    /**
     * JSON parsing tests
     */
    describe('JSON parsing', () => {
      it('should handle windows as JSON string', () => {
        // Monday 10:00
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: JSON.stringify([{ dayOfWeek: 1, startHour: 9, endHour: 17 }]) as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle windows as array (pre-parsed)', () => {
        // Monday 10:00
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }] as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle invalid JSON gracefully (fail-open)', () => {
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: 'invalid json {[' as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true); // Should fail open to 24/7
      });

      it('should handle malformed JSON array (fail-open)', () => {
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: '[{invalid}]' as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true); // Should fail open to 24/7
      });

      it('should handle JSON parse error gracefully (defaults to 24/7)', () => {
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: 'invalid json' as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);
        expect(result).toBe(true); // Should default to 24/7
      });

      it('should handle JSON with extra properties gracefully', () => {
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: JSON.stringify([
            {
              dayOfWeek: 1,
              startHour: 9,
              endHour: 17,
              extraProperty: 'ignored',
            },
          ]) as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle empty string as scheduleWindows', () => {
        const mockDate = new Date('2024-01-01T10:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: '' as any,
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        // Empty string should fail JSON parse and return true
        expect(result).toBe(true);
      });
    });

    /**
     * Edge cases and boundary tests
     */
    describe('edge cases and boundaries', () => {
      it('should handle hour boundary exactly', () => {
        // Monday 09:00 - exactly at start hour
        const mockDate = new Date('2024-01-01T09:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle 24-hour window (00:00-23:59)', () => {
        // Monday 12:00
        const mockDate = new Date('2024-01-01T12:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 0, endHour: 24 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should exclude window with start == end (zero-duration)', () => {
        // Monday 09:00
        const mockDate = new Date('2024-01-01T09:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 9 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should handle minute precision at hour boundary', () => {
        // Monday 09:00
        const mockDate = new Date('2024-01-01T09:00:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            {
              dayOfWeek: 1,
              startHour: 9,
              startMinute: 0,
              endHour: 17,
              endMinute: 0,
            },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle maximum valid hour values', () => {
        // Monday 23:30
        const mockDate = new Date('2024-01-01T23:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 23, endHour: 24 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle minimum valid values', () => {
        // Monday 00:01
        const mockDate = new Date('2024-01-01T00:01:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 0, startMinute: 0, endHour: 2 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should match against currentDate parameter', () => {
        const mockDate = new Date('2024-01-01T10:00:00'); // Monday
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should use current date if none provided', () => {
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            {
              dayOfWeek: new Date().getDay(),
              startHour: 0,
              endHour: 24,
            },
          ],
        };

        const result = isNodeInAllowedWindow(node);

        expect(result).toBe(true);
      });
    });

    /**
     * Real-world scenario tests
     */
    describe('real-world scenarios', () => {
      it('should handle work hours (Mon-Fri 09:00-17:00)', () => {
        // Friday 14:30
        const mockDate = new Date('2024-01-05T14:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 9, endHour: 17 }, // Monday
            { dayOfWeek: 2, startHour: 9, endHour: 17 }, // Tuesday
            { dayOfWeek: 3, startHour: 9, endHour: 17 }, // Wednesday
            { dayOfWeek: 4, startHour: 9, endHour: 17 }, // Thursday
            { dayOfWeek: 5, startHour: 9, endHour: 17 }, // Friday
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should exclude weekend', () => {
        // Saturday 14:30
        const mockDate = new Date('2024-01-06T14:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 9, endHour: 17 },
            { dayOfWeek: 2, startHour: 9, endHour: 17 },
            { dayOfWeek: 3, startHour: 9, endHour: 17 },
            { dayOfWeek: 4, startHour: 9, endHour: 17 },
            { dayOfWeek: 5, startHour: 9, endHour: 17 },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(false);
      });

      it('should handle off-peak hours (night shift)', () => {
        // Monday 02:30
        const mockDate = new Date('2024-01-01T02:30:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            { dayOfWeek: 1, startHour: 22, endHour: 6 },
            { dayOfWeek: 2, startHour: 22, endHour: 6 },
            { dayOfWeek: 3, startHour: 22, endHour: 6 },
            { dayOfWeek: 4, startHour: 22, endHour: 6 },
            { dayOfWeek: 5, startHour: 22, endHour: 6 },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });

      it('should handle specific window (e.g., lunch hour maintenance)', () => {
        // Monday 12:15
        const mockDate = new Date('2024-01-01T12:15:00');
        const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
          scheduleEnabled: true,
          scheduleWindows: [
            {
              dayOfWeek: 1,
              startHour: 12,
              startMinute: 0,
              endHour: 13,
              endMinute: 0,
            },
          ],
        };

        const result = isNodeInAllowedWindow(node, mockDate);

        expect(result).toBe(true);
      });
    });
  });

  describe('getScheduleDescription', () => {
    it('should return 24/7 message when schedule is disabled', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: false,
        scheduleWindows: null,
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Available 24/7 (schedule disabled)');
    });

    it('should return 24/7 message when scheduleWindows is null', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: null,
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Available 24/7 (no windows defined)');
    });

    it('should return 24/7 message when scheduleWindows is empty array', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: [],
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Available 24/7 (empty windows)');
    });

    it('should return schedule enabled message with single window', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Schedule enabled with 1 time window');
    });

    it('should return schedule enabled message with multiple windows', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: [
          { dayOfWeek: 1, startHour: 9, endHour: 17 },
          { dayOfWeek: 2, startHour: 9, endHour: 17 },
          { dayOfWeek: 3, startHour: 9, endHour: 17 },
        ],
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Schedule enabled with 3 time windows');
    });

    it('should handle JSON string windows', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: JSON.stringify([
          { dayOfWeek: 1, startHour: 9, endHour: 17 },
          { dayOfWeek: 2, startHour: 9, endHour: 17 },
        ]) as any,
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Schedule enabled with 2 time windows');
    });

    it('should return 24/7 message on invalid JSON', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: 'invalid json' as any,
      };

      const result = getScheduleDescription(node);

      expect(result).toBe('Available 24/7 (invalid schedule)');
    });

    it('should return 24/7 message on empty string', () => {
      const node: Pick<Node, 'scheduleEnabled' | 'scheduleWindows'> = {
        scheduleEnabled: true,
        scheduleWindows: '' as any,
      };

      const result = getScheduleDescription(node);

      // Empty string is falsy, so !node.scheduleWindows returns true
      expect(result).toBe('Available 24/7 (no windows defined)');
    });
  });

  describe('formatTimeWindow', () => {
    it('should format time window with day name and times', () => {
      const window: TimeWindow = {
        dayOfWeek: 1,
        startHour: 9,
        endHour: 17,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Monday 09:00 - 17:00');
    });

    it('should format all days of week correctly', () => {
      const expectedDays = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];

      expectedDays.forEach((dayName, dayOfWeek) => {
        const window: TimeWindow = {
          dayOfWeek,
          startHour: 9,
          endHour: 17,
        };

        const result = formatTimeWindow(window);

        expect(result).toContain(dayName);
      });
    });

    it('should pad single-digit hours with zero', () => {
      const window: TimeWindow = {
        dayOfWeek: 1,
        startHour: 5,
        endHour: 9,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Monday 05:00 - 09:00');
    });

    it('should pad single-digit minutes with zero', () => {
      const window: TimeWindow = {
        dayOfWeek: 1,
        startHour: 9,
        startMinute: 5,
        endHour: 17,
        endMinute: 7,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Monday 09:05 - 17:07');
    });

    it('should default minutes to 00 when not provided', () => {
      const window: TimeWindow = {
        dayOfWeek: 1,
        startHour: 9,
        endHour: 17,
      };

      const result = formatTimeWindow(window);

      expect(result).toContain('09:00');
      expect(result).toContain('17:00');
    });

    it('should handle midnight-crossing windows', () => {
      const window: TimeWindow = {
        dayOfWeek: 1,
        startHour: 23,
        endHour: 7,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Monday 23:00 - 07:00');
    });

    it('should handle single-minute precision', () => {
      const window: TimeWindow = {
        dayOfWeek: 5,
        startHour: 12,
        startMinute: 30,
        endHour: 13,
        endMinute: 45,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Friday 12:30 - 13:45');
    });

    it('should handle late-night windows', () => {
      const window: TimeWindow = {
        dayOfWeek: 6,
        startHour: 22,
        startMinute: 15,
        endHour: 23,
        endMinute: 59,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Saturday 22:15 - 23:59');
    });

    it('should handle early-morning windows', () => {
      const window: TimeWindow = {
        dayOfWeek: 0,
        startHour: 0,
        startMinute: 0,
        endHour: 6,
        endMinute: 0,
      };

      const result = formatTimeWindow(window);

      expect(result).toBe('Sunday 00:00 - 06:00');
    });

    it('should return Unknown for invalid day numbers', () => {
      const window: TimeWindow = {
        dayOfWeek: 99,
        startHour: 9,
        endHour: 17,
      };

      const result = formatTimeWindow(window);

      expect(result).toContain('Unknown');
    });

    it('should return Unknown for negative day numbers', () => {
      const window: TimeWindow = {
        dayOfWeek: -1,
        startHour: 9,
        endHour: 17,
      };

      const result = formatTimeWindow(window);

      expect(result).toContain('Unknown');
    });
  });
});
