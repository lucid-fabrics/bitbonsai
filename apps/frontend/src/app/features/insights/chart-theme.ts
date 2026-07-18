import { Chart } from 'chart.js';

/** Single source of truth for chart colors (BitBonsai dark + gold theme). */
export const CHART_COLORS = {
  gold: '#f9be03',
  green: '#4ade80',
  blue: '#38bdf8',
  purple: '#c084fc',
  red: '#ff6b6b',
  bg: '#1a1a1a',
  border: '#2d2d2d',
  grid: '#333333',
  text: '#e0e0e0',
  textMuted: '#888',
} as const;

/** Categorical palette for multi-series charts (codec distribution, etc). */
export const CHART_PALETTE = [
  CHART_COLORS.gold,
  CHART_COLORS.green,
  CHART_COLORS.blue,
  CHART_COLORS.purple,
  CHART_COLORS.red,
];

/** Apply global Chart.js defaults once so every chart matches the app theme. */
export function applyChartDefaults(): void {
  Chart.defaults.color = CHART_COLORS.textMuted;
  Chart.defaults.borderColor = CHART_COLORS.grid;
  Chart.defaults.font.family =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.plugins.tooltip.backgroundColor = CHART_COLORS.bg;
  Chart.defaults.plugins.tooltip.titleColor = CHART_COLORS.gold;
  Chart.defaults.plugins.tooltip.bodyColor = CHART_COLORS.text;
  Chart.defaults.plugins.tooltip.borderColor = CHART_COLORS.border;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}
