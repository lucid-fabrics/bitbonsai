import { Pipe, PipeTransform } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';

@Pipe({
  name: 'i18n',
  standalone: true,
})
export class I18nPipe implements PipeTransform {
  constructor(private i18n: I18nService) {}

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
