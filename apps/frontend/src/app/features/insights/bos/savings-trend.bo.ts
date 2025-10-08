/**
 * Business object for storage savings trend data
 */
export class SavingsTrendBO {
  constructor(
    public readonly date: string,
    public readonly savingsGB: number
  ) {}

  static fromDto(dto: { date: string; savingsGB: number }): SavingsTrendBO {
    return new SavingsTrendBO(dto.date, dto.savingsGB);
  }

  formatDate(): string {
    const date = new Date(`${this.date}T00:00:00Z`);
    const month = date.toLocaleString('default', { month: 'short', timeZone: 'UTC' });
    const day = date.getUTCDate();
    return `${month} ${day}`;
  }
}
