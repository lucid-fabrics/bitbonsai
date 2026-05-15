import { Injectable } from '@angular/core';
import en from '../../assets/i18n/en.json';

@Injectable({
  providedIn: 'root',
})
export class I18nService {
  private flatTranslations: Record<string, string> = {};

  constructor() {
    this.flattenObject(en);
  }

  private flattenObject(obj: Record<string, unknown>, prefix = ''): void {
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.flattenObject(obj[key] as Record<string, unknown>, fullKey);
        } else {
          this.flatTranslations[fullKey] = String(obj[key]);
        }
      }
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    const value = this.flatTranslations[key];

    if (!value) {
      return key;
    }

    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  private interpolate(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key]?.toString() ?? match;
    });
  }
}
