import { SavingsTrendBO } from './savings-trend.bo';

describe('SavingsTrendBO', () => {
  describe('constructor and mapping', () => {
    it('should create instance with date and savingsGB', () => {
      const bo = new SavingsTrendBO('2025-01-15', 125.5);

      expect(bo.date).toBe('2025-01-15');
      expect(bo.savingsGB).toBe(125.5);
    });

    it('should create from DTO using fromDto', () => {
      const dto = { date: '2025-01-15', savingsGB: 125.5 };
      const bo = SavingsTrendBO.fromDto(dto);

      expect(bo.date).toBe('2025-01-15');
      expect(bo.savingsGB).toBe(125.5);
    });
  });

  describe('formatDate', () => {
    it('should format date as "MMM D"', () => {
      const bo = new SavingsTrendBO('2025-01-15', 100);
      const formatted = bo.formatDate();

      expect(formatted).toBe('Jan 15');
    });

    it('should handle different months', () => {
      const bo = new SavingsTrendBO('2025-06-28', 100);
      const formatted = bo.formatDate();

      expect(formatted).toBe('Jun 28');
    });
  });
});
