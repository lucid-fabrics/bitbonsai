import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';

export interface CarouselImage {
  src: string;
  alt: string;
  label?: string;
}

@Component({
  selector: 'bb-image-carousel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-carousel.component.html',
  styleUrls: ['./image-carousel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageCarouselComponent implements AfterViewInit {
  @Input() images: CarouselImage[] = [];
  @Input() initialIndex = 0;
  @Input() showThumbnails = true;
  @Input() fullscreen = false;
  @Output() imageClick = new EventEmitter<number>();
  @Output() close = new EventEmitter<void>();

  @ViewChildren('thumbnail') thumbnails!: QueryList<ElementRef>;

  protected currentIndex = 0;
  protected zoomLevel = 1;
  protected readonly minZoom = 0.5;
  protected readonly maxZoom = 3;
  protected readonly zoomStep = 0.25;

  ngOnInit(): void {
    this.currentIndex = this.initialIndex;
  }

  ngAfterViewInit(): void {
    // Scroll to initial thumbnail after view is ready
    setTimeout(() => this.scrollThumbnailIntoView(this.currentIndex), 100);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (!this.fullscreen) return;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.previous();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        break;
      case 'Escape':
        event.preventDefault();
        this.closeCarousel();
        break;
    }
  }

  @HostListener('wheel', ['$event'])
  handleWheel(event: WheelEvent): void {
    if (!this.fullscreen) return;

    // Check if mouse is over the main image
    const target = event.target as HTMLElement;
    if (target.classList.contains('carousel-image') || target.closest('.carousel-viewport')) {
      event.preventDefault();

      if (event.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    }
  }

  protected previous(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
    } else {
      this.currentIndex = this.images.length - 1;
    }
    this.resetZoom();
    this.scrollThumbnailIntoView(this.currentIndex);
  }

  protected next(): void {
    if (this.currentIndex < this.images.length - 1) {
      this.currentIndex++;
    } else {
      this.currentIndex = 0;
    }
    this.resetZoom();
    this.scrollThumbnailIntoView(this.currentIndex);
  }

  protected goToIndex(index: number): void {
    this.currentIndex = index;
    this.scrollThumbnailIntoView(index);
  }

  private scrollThumbnailIntoView(index: number): void {
    if (!this.thumbnails) return;

    const thumbnailArray = this.thumbnails.toArray();
    if (thumbnailArray[index]) {
      thumbnailArray[index].nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }

  protected onImageClick(): void {
    if (!this.fullscreen) {
      this.imageClick.emit(this.currentIndex);
    }
  }

  protected closeCarousel(): void {
    if (this.fullscreen) {
      this.close.emit();
    }
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (this.fullscreen && event.target === event.currentTarget) {
      this.closeCarousel();
    }
  }

  protected getPreviousImage(): CarouselImage {
    const prevIndex = this.currentIndex > 0 ? this.currentIndex - 1 : this.images.length - 1;
    return this.images[prevIndex];
  }

  protected getNextImage(): CarouselImage {
    const nextIndex = this.currentIndex < this.images.length - 1 ? this.currentIndex + 1 : 0;
    return this.images[nextIndex];
  }

  protected zoomIn(): void {
    if (this.zoomLevel < this.maxZoom) {
      this.zoomLevel = Math.min(this.zoomLevel + this.zoomStep, this.maxZoom);
    }
  }

  protected zoomOut(): void {
    if (this.zoomLevel > this.minZoom) {
      this.zoomLevel = Math.max(this.zoomLevel - this.zoomStep, this.minZoom);
    }
  }

  protected resetZoom(): void {
    this.zoomLevel = 1;
  }

  protected getImageTransform(): string {
    return `scale(${this.zoomLevel})`;
  }
}
