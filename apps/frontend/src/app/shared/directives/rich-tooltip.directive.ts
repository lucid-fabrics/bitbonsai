import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  inject,
  type OnDestroy,
  Renderer2,
} from '@angular/core';
import { arrow, computePosition, flip, offset, type Placement, shift } from '@floating-ui/dom';

/**
 * Rich tooltip directive for self-documenting UI
 *
 * Usage:
 * <button
 *   bbTooltip
 *   tooltipTitle="What it does"
 *   tooltipContent="Detailed explanation here"
 *   tooltipWhen="When to use this"
 *   [tooltipPlacement]="'top'"
 *   [tooltipDelay]="500">
 *   Button Text
 * </button>
 */
@Directive({
  selector: '[bbTooltip]',
  standalone: true,
})
export class RichTooltipDirective implements OnDestroy {
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);

  @Input() tooltipTitle = '';
  @Input() tooltipContent = '';
  @Input() tooltipWhen = '';
  @Input() tooltipPlacement: Placement = 'top';
  @Input() tooltipDelay = 500;
  @Input() tooltipHideDelay = 100;

  private tooltipElement: HTMLElement | null = null;
  private arrowElement: HTMLElement | null = null;
  private showTimeout: ReturnType<typeof setTimeout> | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  @HostListener('mouseenter')
  onMouseEnter(): void {
    this.clearTimeouts();
    this.showTimeout = setTimeout(() => {
      this.show();
    }, this.tooltipDelay);
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.clearTimeouts();
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, this.tooltipHideDelay);
  }

  @HostListener('click')
  onClick(): void {
    // Hide tooltip immediately on click
    this.clearTimeouts();
    this.hide();
  }

  private clearTimeouts(): void {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private async show(): Promise<void> {
    if (this.tooltipElement) {
      return; // Already showing
    }

    // Create tooltip container
    this.tooltipElement = this.renderer.createElement('div');
    this.renderer.addClass(this.tooltipElement, 'bb-tooltip');
    this.renderer.setAttribute(this.tooltipElement, 'role', 'tooltip');

    // Create arrow
    this.arrowElement = this.renderer.createElement('div');
    this.renderer.addClass(this.arrowElement, 'bb-tooltip-arrow');
    this.renderer.appendChild(this.tooltipElement, this.arrowElement);

    // Create content
    const content = this.renderer.createElement('div');
    this.renderer.addClass(content, 'bb-tooltip-content');

    if (this.tooltipTitle) {
      const title = this.renderer.createElement('strong');
      this.renderer.addClass(title, 'bb-tooltip-title');
      const titleText = this.renderer.createText(this.tooltipTitle);
      this.renderer.appendChild(title, titleText);
      this.renderer.appendChild(content, title);
    }

    if (this.tooltipContent) {
      const description = this.renderer.createElement('p');
      this.renderer.addClass(description, 'bb-tooltip-description');
      const descText = this.renderer.createText(this.tooltipContent);
      this.renderer.appendChild(description, descText);
      this.renderer.appendChild(content, description);
    }

    if (this.tooltipWhen) {
      const whenSection = this.renderer.createElement('div');
      this.renderer.addClass(whenSection, 'bb-tooltip-section');

      const whenTitle = this.renderer.createElement('strong');
      this.renderer.addClass(whenTitle, 'bb-tooltip-subtitle');
      const whenTitleText = this.renderer.createText('When to use:');
      this.renderer.appendChild(whenTitle, whenTitleText);
      this.renderer.appendChild(whenSection, whenTitle);

      const whenText = this.renderer.createElement('p');
      const whenContent = this.renderer.createText(this.tooltipWhen);
      this.renderer.appendChild(whenText, whenContent);
      this.renderer.appendChild(whenSection, whenText);

      this.renderer.appendChild(content, whenSection);
    }

    this.renderer.appendChild(this.tooltipElement, content);

    // Add to body
    this.renderer.appendChild(document.body, this.tooltipElement);

    // Position tooltip using Floating UI
    await this.updatePosition();

    // Fade in
    requestAnimationFrame(() => {
      if (this.tooltipElement) {
        this.renderer.addClass(this.tooltipElement, 'bb-tooltip-visible');
      }
    });
  }

  private async updatePosition(): Promise<void> {
    if (!this.tooltipElement || !this.arrowElement) {
      return;
    }

    const { x, y, placement, middlewareData } = await computePosition(
      this.el.nativeElement,
      this.tooltipElement,
      {
        placement: this.tooltipPlacement,
        middleware: [
          offset(8),
          flip(),
          shift({ padding: 8 }),
          arrow({ element: this.arrowElement }),
        ],
      }
    );

    // Position tooltip
    Object.assign(this.tooltipElement.style, {
      left: `${x}px`,
      top: `${y}px`,
    });

    // Position arrow
    if (middlewareData.arrow) {
      const { x: arrowX, y: arrowY } = middlewareData.arrow;

      const staticSide = {
        top: 'bottom',
        right: 'left',
        bottom: 'top',
        left: 'right',
      }[placement.split('-')[0]];

      if (staticSide) {
        Object.assign(this.arrowElement.style, {
          left: arrowX != null ? `${arrowX}px` : '',
          top: arrowY != null ? `${arrowY}px` : '',
          right: '',
          bottom: '',
          [staticSide]: '-4px',
        });
      }
    }
  }

  private hide(): void {
    if (this.tooltipElement) {
      this.renderer.removeClass(this.tooltipElement, 'bb-tooltip-visible');
      setTimeout(() => {
        if (this.tooltipElement) {
          this.renderer.removeChild(document.body, this.tooltipElement);
          this.tooltipElement = null;
          this.arrowElement = null;
        }
      }, 200); // Match CSS transition duration
    }
  }

  ngOnDestroy(): void {
    this.clearTimeouts();
    this.hide();
  }
}
