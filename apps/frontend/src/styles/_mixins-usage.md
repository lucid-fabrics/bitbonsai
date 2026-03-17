# SCSS Mixins Usage Guide

This document provides examples of how to use the SCSS mixins defined in `_mixins.scss`.

## Importing Mixins

```scss
@use '../../../styles/mixins' as *;
@use '../../../styles/variables' as *;
```

## Layout Mixins

### Container Padding
```scss
.my-container {
  @include container-padding; // 32px desktop, 16px mobile
}
```

### Flex Container
```scss
.my-flex {
  @include flex-container(20px, row, center, space-between);
  // gap, direction, align, justify
}
```

### Responsive Grid
```scss
.my-grid {
  @include responsive-grid(300px, 20px);
  // min-width, gap
}
```

## Card Mixins

### Basic Card
```scss
.my-card {
  @include card-base;
}
```

### Interactive Card
```scss
.my-card {
  @include card-interactive; // Has hover effects
}
```

### Card Section
```scss
.card-header {
  @include card-section(24px); // With padding
}
```

## Button Mixins

### Primary Button
```scss
.my-btn {
  @include btn-primary;
}
```

### Secondary Button
```scss
.my-btn {
  @include btn-secondary;
}
```

### Danger Button
```scss
.delete-btn {
  @include btn-danger;
}
```

### Icon Button
```scss
.icon-btn {
  @include btn-icon(40px); // Custom size
}
```

### Large Button
```scss
.cta-btn {
  @include btn-primary;
  @include btn-large;
}
```

## Form Mixins

### Form Input
```scss
input[type='text'],
input[type='email'],
select,
textarea {
  @include form-input;
}
```

### Form Group
```scss
.form-field {
  @include form-group(20px); // margin-bottom
}
```

### Validation Messages
```scss
.error-message {
  @include validation-message(error);
}

.success-message {
  @include validation-message(success);
}

.help-text {
  @include validation-message(help);
}
```

## Modal Mixins

### Modal Backdrop
```scss
.modal-overlay {
  @include modal-backdrop;
}
```

### Modal Content
```scss
.modal {
  @include modal-content(700px); // max-width
}
```

## State Mixins

### Loading State
```scss
.loading {
  @include loading-state;
}
```

### Empty State
```scss
.empty {
  @include empty-state;
}
```

### Alert Banner
```scss
.error-banner {
  @include alert-banner(danger);
}

.success-banner {
  @include alert-banner(success);
}

.warning-banner {
  @include alert-banner(warning);
}
```

## Badge Mixins

### Custom Badge
```scss
.my-badge {
  @include badge($accent-primary, $text-dark);
}
```

### Status Badge
```scss
.status {
  @include status-badge(online);  // online, offline, error
}
```

## Typography Mixins

### Page Header
```scss
.page-header {
  @include page-header;
}
```

### Section Header
```scss
.section-header {
  @include section-header;
}
```

### Text Truncation
```scss
.truncate-single {
  @include text-truncate;
}

.truncate-multi {
  @include text-truncate-multiline(3); // 3 lines
}
```

## Animation Mixins

### Fade In
```scss
.fade-in-element {
  @include animation-fade-in(0.3s);
}
```

### Slide Down
```scss
.slide-down-element {
  @include animation-slide-down(0.4s);
}
```

### Slide Up
```scss
.slide-up-element {
  @include animation-slide-up(0.2s);
}
```

## Utility Mixins

### Custom Scrollbar
```scss
.scrollable-area {
  @include custom-scrollbar;
}
```

### List Reset
```scss
ul, ol {
  @include list-reset;
}
```

### Visually Hidden
```scss
.sr-only {
  @include visually-hidden;
}
```

### Aspect Ratio
```scss
.video-container {
  @include aspect-ratio(16, 9);
}
```

### Absolute Center
```scss
.centered {
  @include absolute-center;
}
```

## Table Mixins

### Data Table
```scss
.my-table {
  @include data-table;
}
```

## Complete Component Example

```scss
@use '../../../styles/mixins' as *;
@use '../../../styles/variables' as *;

.my-component {
  @include container-padding;
  @include full-height-container;
}

.page-header {
  @include page-header;
}

.cards-grid {
  @include responsive-grid(350px, 24px);
}

.card {
  @include card-interactive;

  .card-header {
    @include card-section(20px);
  }

  .card-body {
    @include card-section(20px);
  }

  .card-footer {
    @include flex-container(12px, row, center, flex-end);
    padding: 16px 20px;
  }
}

.btn-primary {
  @include btn-primary;
}

.btn-secondary {
  @include btn-secondary;
}

.loading-state {
  @include loading-state;
}

.error-alert {
  @include alert-banner(danger);
}

.status-badge {
  @include status-badge(online);
}

.modal-backdrop {
  @include modal-backdrop;

  .modal-content {
    @include modal-content(600px);
    @include custom-scrollbar;
  }
}

@media (max-width: 768px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}
```

## Migration Strategy

To migrate existing components to use mixins:

1. **Identify repeated patterns** in your SCSS
2. **Find matching mixin** in _mixins.scss
3. **Replace CSS rules** with mixin include
4. **Remove duplicate code**
5. **Test responsiveness**

### Example Migration

**Before:**
```scss
.my-card {
  background: $bg-secondary;
  border: 1px solid $border-primary;
  border-radius: $border-radius-md;
  transition: $transition-fast;
  cursor: pointer;

  &:hover {
    border-color: $accent-primary;
    box-shadow: $shadow-sm;
  }
}
```

**After:**
```scss
.my-card {
  @include card-interactive;
}
```

## Benefits

1. **Consistency** - All components use same styles
2. **DRY** - No code duplication
3. **Maintainability** - Update once, applies everywhere
4. **Readability** - Semantic mixin names
5. **Responsive** - Mobile-first built in
