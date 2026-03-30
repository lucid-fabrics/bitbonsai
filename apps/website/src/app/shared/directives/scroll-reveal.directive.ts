import { Directive, ElementRef, Input, inject, OnDestroy, OnInit } from '@angular/core';

@Directive({
  selector: '[appScrollReveal]',
  standalone: true,
})
export class ScrollRevealDirective implements OnInit, OnDestroy {
  @Input() delay = 0;
  @Input() animation: 'fade-in-up' | 'fade-in' | 'slide-in-left' | 'slide-in-right' = 'fade-in-up';

  private observer: IntersectionObserver | null = null;
  private el = inject(ElementRef);

  ngOnInit() {
    // Skip animations on mobile for performance
    if (window.innerWidth < 768) {
      this.el.nativeElement.style.opacity = '1';
      return;
    }

    // Set initial state
    this.el.nativeElement.style.opacity = '0';
    this.el.nativeElement.style.transition = `opacity 0.6s ease ${this.delay}ms, transform 0.6s ease ${this.delay}ms`;

    // Create intersection observer
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.reveal();
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px',
      }
    );

    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private reveal() {
    const element = this.el.nativeElement;

    // Add animation class
    element.classList.add('scroll-reveal', `scroll-reveal--${this.animation}`);

    // Set final state
    element.style.opacity = '1';
    element.style.transform = 'translateY(0)';

    // Disconnect observer after revealing (one-time animation)
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}
