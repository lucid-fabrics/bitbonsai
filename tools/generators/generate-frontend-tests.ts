#!/usr/bin/env ts-node

/**
 * Frontend Test Generator for BitBonsai
 *
 * Generates unit tests for:
 * - Services
 * - Business Objects
 * - NgRx Effects
 * - Components
 */

import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_SRC = path.join(__dirname, '../../apps/frontend/src/app');

// Template for Service Tests
const generateServiceTest = (serviceName: string, className: string): string => {
  const clientName = serviceName.replace('Service', 'Client');
  const clientClassName = className.replace('Service', 'Client');
  const boName = serviceName.replace('Service', 'Bo');
  const boClassName = className.replace('Service', 'Bo');
  const _modelName = serviceName.replace('Service', 'Model');

  return `import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ${className} } from './${serviceName}';
import { ${clientClassName} } from '../clients/${clientName}';
import { ${boClassName} } from '../business-objects/${boName}';

describe('${className}', () => {
  let service: ${className};
  let client: jasmine.SpyObj<${clientClassName}>;

  beforeEach(() => {
    const clientSpy = jasmine.createSpyObj('${clientClassName}', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ${className},
        { provide: ${clientClassName}, useValue: clientSpy },
      ],
    });

    service = TestBed.inject(${className});
    client = TestBed.inject(${clientClassName}) as jasmine.SpyObj<${clientClassName}>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('data retrieval', () => {
    it('should transform client responses to BOs', (done) => {
      const mockData = { id: '1', name: 'Test' };
      client.getAll.and.returnValue(of([mockData]));

      service.getAll().subscribe((result) => {
        expect(result[0]).toBeInstanceOf(${boClassName});
        expect(client.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors from client', (done) => {
      const error = new Error('Client error');
      client.getAll.and.returnValue(throwError(() => error));

      service.getAll().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });

  // TODO: Add more specific tests based on service methods
});
`;
};

// Template for Business Object Tests
const generateBoTest = (boName: string, className: string): string => {
  const _modelName = boName.replace('.bo', '');

  return `import { ${className} } from './${boName}';

describe('${className}', () => {
  describe('constructor and mapping', () => {
    it('should create instance from model', () => {
      const mockModel = {
        id: '1',
        name: 'Test',
        createdAt: new Date('2025-01-01'),
      };

      const bo = new ${className}(mockModel);

      expect(bo.id).toBe('1');
      expect(bo.name).toBe('Test');
      expect(bo.createdAt).toEqual(new Date('2025-01-01'));
    });

    it('should handle missing optional fields', () => {
      const mockModel = {
        id: '1',
        name: 'Test',
      };

      const bo = new ${className}(mockModel as any);

      expect(bo.id).toBe('1');
      expect(bo.name).toBe('Test');
    });

    it('should handle null/undefined values gracefully', () => {
      const mockModel = {
        id: '1',
        name: null,
      };

      expect(() => new ${className}(mockModel as any)).not.toThrow();
    });
  });

  describe('business logic methods', () => {
    it('should provide formatted data', () => {
      const mockModel = {
        id: '1',
        name: 'Test',
        createdAt: new Date('2025-01-01'),
      };

      const bo = new ${className}(mockModel);

      // TODO: Add tests for formatted properties and business logic methods
      expect(bo).toBeDefined();
    });
  });
});
`;
};

// Template for Effects Tests
const generateEffectsTest = (
  effectsName: string,
  className: string,
  featureName: string
): string => {
  const serviceName = `${featureName.charAt(0).toUpperCase() + featureName.slice(1)}Service`;
  const actionsName = effectsName.replace('.effects', '');

  return `import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { ${className} } from './${effectsName}';
import * as ${actionsName}Actions from './${actionsName}.actions';
import { ${serviceName} } from '../../../core/services/${featureName}.service';

describe('${className}', () => {
  let actions$: Observable<Action>;
  let effects: ${className};
  let service: jasmine.SpyObj<${serviceName}>;

  beforeEach(() => {
    const serviceSpy = jasmine.createSpyObj('${serviceName}', [
      'getAll',
      'getById',
      'create',
      'update',
      'delete',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ${className},
        provideMockActions(() => actions$),
        { provide: ${serviceName}, useValue: serviceSpy },
      ],
    });

    effects = TestBed.inject(${className});
    service = TestBed.inject(${serviceName}) as jasmine.SpyObj<${serviceName}>;
  });

  it('should be created', () => {
    expect(effects).toBeTruthy();
  });

  describe('load data effect', () => {
    it('should return loadSuccess action on success', (done) => {
      const mockData = [{ id: '1', name: 'Test' }] as any;
      service.getAll.and.returnValue(of(mockData));

      actions$ = of(${actionsName}Actions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(${actionsName}Actions.loadSuccess.type);
        expect(service.getAll).toHaveBeenCalled();
        done();
      });
    });

    it('should return loadFailure action on error', (done) => {
      const error = new Error('Load failed');
      service.getAll.and.returnValue(throwError(() => error));

      actions$ = of(${actionsName}Actions.load());

      effects.load$.subscribe((action) => {
        expect(action.type).toBe(${actionsName}Actions.loadFailure.type);
        done();
      });
    });
  });

  // TODO: Add tests for other effects (create, update, delete)
});
`;
};

// Template for Component Tests
const generateComponentTest = (componentName: string, className: string): string => {
  return `import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ${className} } from './${componentName}';

describe('${className}', () => {
  let component: ${className};
  let fixture: ComponentFixture<${className}>;
  let store: MockStore;

  const initialState = {
    // TODO: Add initial state based on feature
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [${className}],
      providers: [
        provideMockStore({ initialState }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(${className});
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('component initialization', () => {
    it('should dispatch load action on init', () => {
      const dispatchSpy = spyOn(store, 'dispatch');
      component.ngOnInit();
      expect(dispatchSpy).toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('should render component template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled).toBeDefined();
      // TODO: Add specific template assertions
    });
  });

  describe('user interactions', () => {
    it('should handle user actions', () => {
      // TODO: Add user interaction tests (button clicks, form submissions, etc.)
      expect(component).toBeDefined();
    });
  });

  // TODO: Add tests for computed signals, methods, and business logic
});
`;
};

// Helper to extract class name from file content
const extractClassName = (filePath: string): string => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/export\s+class\s+(\w+)/);
  return match ? match[1] : '';
};

// Generate tests for services
const generateServiceTests = (): number => {
  const servicesDir = path.join(FRONTEND_SRC, 'core/services');
  const serviceFiles = fs
    .readdirSync(servicesDir)
    .filter((f) => f.endsWith('.service.ts') && !f.endsWith('.spec.ts'));

  let generated = 0;
  serviceFiles.forEach((file) => {
    const serviceName = file.replace('.ts', '');
    const filePath = path.join(servicesDir, file);
    const className =
      extractClassName(filePath) ||
      `${serviceName
        .split('.')[0]
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('')}Service`;

    const testContent = generateServiceTest(serviceName, className);
    const testPath = path.join(servicesDir, `${serviceName}.spec.ts`);

    if (!fs.existsSync(testPath)) {
      fs.writeFileSync(testPath, testContent);
      console.log(`✅ Generated: ${testPath}`);
      generated++;
    } else {
      console.log(`⏭️  Skipped (exists): ${testPath}`);
    }
  });

  return generated;
};

// Generate tests for Business Objects
const generateBoTests = (): number => {
  const bosDir = path.join(FRONTEND_SRC, 'core/business-objects');
  const boFiles = fs
    .readdirSync(bosDir)
    .filter((f) => f.endsWith('.bo.ts') && !f.endsWith('.spec.ts'));

  let generated = 0;
  boFiles.forEach((file) => {
    const boName = file.replace('.ts', '');
    const filePath = path.join(bosDir, file);
    const className =
      extractClassName(filePath) ||
      `${boName
        .split('.')[0]
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('')}Bo`;

    const testContent = generateBoTest(boName, className);
    const testPath = path.join(bosDir, `${boName}.spec.ts`);

    if (!fs.existsSync(testPath)) {
      fs.writeFileSync(testPath, testContent);
      console.log(`✅ Generated: ${testPath}`);
      generated++;
    } else {
      console.log(`⏭️  Skipped (exists): ${testPath}`);
    }
  });

  return generated;
};

// Generate tests for Effects
const generateEffectsTests = (): number => {
  const featuresDir = path.join(FRONTEND_SRC, 'features');
  const features = fs
    .readdirSync(featuresDir)
    .filter((f) => fs.statSync(path.join(featuresDir, f)).isDirectory());

  let generated = 0;
  features.forEach((feature) => {
    const stateDir = path.join(featuresDir, feature, '+state');
    if (!fs.existsSync(stateDir)) return;

    const effectsFiles = fs
      .readdirSync(stateDir)
      .filter((f) => f.endsWith('.effects.ts') && !f.endsWith('.spec.ts'));

    effectsFiles.forEach((file) => {
      const effectsName = file.replace('.ts', '');
      const filePath = path.join(stateDir, file);
      const className =
        extractClassName(filePath) ||
        `${feature.charAt(0).toUpperCase() + feature.slice(1)}Effects`;

      const testContent = generateEffectsTest(effectsName, className, feature);
      const testPath = path.join(stateDir, `${effectsName}.spec.ts`);

      if (!fs.existsSync(testPath)) {
        fs.writeFileSync(testPath, testContent);
        console.log(`✅ Generated: ${testPath}`);
        generated++;
      } else {
        console.log(`⏭️  Skipped (exists): ${testPath}`);
      }
    });
  });

  return generated;
};

// Generate tests for Components
const generateComponentTests = (): number => {
  const featuresDir = path.join(FRONTEND_SRC, 'features');
  const features = fs
    .readdirSync(featuresDir)
    .filter((f) => fs.statSync(path.join(featuresDir, f)).isDirectory());

  let generated = 0;
  features.forEach((feature) => {
    const featureDir = path.join(featuresDir, feature);
    const componentFiles = fs
      .readdirSync(featureDir)
      .filter((f) => f.endsWith('.component.ts') && !f.endsWith('.spec.ts'));

    componentFiles.forEach((file) => {
      const componentName = file.replace('.ts', '');
      const filePath = path.join(featureDir, file);
      const className =
        extractClassName(filePath) ||
        `${feature.charAt(0).toUpperCase() + feature.slice(1)}Component`;

      const testContent = generateComponentTest(componentName, className);
      const testPath = path.join(featureDir, `${componentName}.spec.ts`);

      if (!fs.existsSync(testPath)) {
        fs.writeFileSync(testPath, testContent);
        console.log(`✅ Generated: ${testPath}`);
        generated++;
      } else {
        console.log(`⏭️  Skipped (exists): ${testPath}`);
      }
    });
  });

  return generated;
};

// Main execution
console.log('🚀 BitBonsai Frontend Test Generator\n');
console.log('Generating unit tests following testing-guidelines.md...\n');

console.log('📝 Generating Service Tests...');
const servicesGenerated = generateServiceTests();

console.log('\n📝 Generating Business Object Tests...');
const bosGenerated = generateBoTests();

console.log('\n📝 Generating Effects Tests...');
const effectsGenerated = generateEffectsTests();

console.log('\n📝 Generating Component Tests...');
const componentsGenerated = generateComponentTests();

console.log(`\n${'='.repeat(60)}`);
console.log('✨ Test Generation Complete!');
console.log('='.repeat(60));
console.log(`Services:    ${servicesGenerated} files generated`);
console.log(`BOs:         ${bosGenerated} files generated`);
console.log(`Effects:     ${effectsGenerated} files generated`);
console.log(`Components:  ${componentsGenerated} files generated`);
console.log(
  `Total:       ${servicesGenerated + bosGenerated + effectsGenerated + componentsGenerated} test files`
);
console.log('\n💡 Next steps:');
console.log('1. Review generated tests and customize assertions');
console.log('2. Add specific test cases for each component/service');
console.log('3. Run tests: npm test');
console.log('4. Check coverage: npm run test:coverage');
