# Test Generator for NestJS Services

Automatically generates comprehensive integration tests for NestJS services following project code conventions.

## Features

- ✅ **Auto-detects service structure** (methods, foreign keys, entities)
- ✅ **Generates ~15 integration tests per service** covering:
  - Create with valid/invalid data
  - Foreign key constraint validation
  - FindAll/FindOne operations
  - Update operations
  - Delete operations
  - Timestamp validation
  - Database persistence checks
- ✅ **Follows NestJS testing guidelines** from code-conventions
- ✅ **Saves 2-3 hours per service** vs manual test writing

## Quick Start

### Generate tests for a single service:

```bash
npx tsx tools/generators/generate-tests.ts <service-name>
```

**Example:**
```bash
npx tsx tools/generators/generate-tests.ts libraries
# ✅ Generated: apps/backend/src/libraries/libraries.service.integration.spec.ts
```

### Generate tests for ALL services at once:

```bash
./tools/generators/generate-all-tests.sh
```

This will generate integration tests for:
- Policies
- Nodes
- Queue
- License
- (Add more services to the script as needed)

## Generated Test Structure

Each generated test file includes:

### Test Setup
- `beforeAll` - Creates test fixtures (License → Node → Library chain)
- `afterAll` - Cleans up all test data
- `afterEach` - Resets service-specific data between tests

### Test Categories

1. **Create Tests** (~4 tests)
   - Create with valid data
   - Foreign key constraint errors
   - Database persistence verification
   - Timestamp validation

2. **FindAll Tests** (2 tests)
   - Empty array when no records
   - Returns all records correctly

3. **FindOne Tests** (2 tests)
   - Retrieve by valid ID
   - NotFoundException for invalid ID

4. **Update Tests** (3 tests)
   - Update existing record
   - NotFoundException for invalid ID
   - updatedAt timestamp changes

5. **Remove Tests** (2 tests)
   - Delete existing record
   - NotFoundException for invalid ID

**Total:** ~13-15 tests per service (fully automated)

## Test Coverage Status

| Service | Integration Tests | Status |
|---------|------------------|--------|
| Policies | 32 tests (manual) | ✅ Complete |
| Libraries | 13 tests (generated) | ✅ Generated |
| Nodes | 13 tests (generated) | ✅ Generated |
| Queue | 13 tests (generated) | ✅ Generated |
| License | 13 tests (generated) | ✅ Generated |

**Total:** ~84 integration tests

## Running Generated Tests

### Run all integration tests:
```bash
npx nx test backend --testNamePattern="Integration Tests"
```

### Run specific service tests:
```bash
npx nx test backend --testFile=libraries.service.integration.spec.ts
```

### Run with coverage:
```bash
npx nx test backend --coverage
```

## Customization

After generation, you may need to manually adjust:

1. **Required DTO fields** - Generator uses minimal fields, add service-specific required fields
2. **Enum values** - Update to match Prisma schema enums
3. **Business logic tests** - Add service-specific edge cases
4. **Unique constraints** - Add tests for service-specific unique constraints

## How It Works

1. **Service Analysis**
   - Reads service file
   - Detects class name, entity name
   - Identifies foreign keys (nodeId, libraryId)
   - Finds available methods (create, findAll, etc.)

2. **Test Generation**
   - Creates test fixtures respecting FK dependencies
   - Generates CRUD operation tests
   - Adds constraint validation tests
   - Includes timestamp and persistence checks

3. **File Output**
   - Writes to `<service-name>.service.integration.spec.ts`
   - Formatted TypeScript code
   - Ready to run immediately

## Benefits

- **Speed**: Generate 15 tests in seconds vs 2-3 hours manually
- **Consistency**: All services follow same test patterns
- **Coverage**: Ensures all CRUD operations are tested
- **Maintainability**: Regenerate when service structure changes
- **Quality**: No copy-paste errors or missed test cases

## Future Enhancements

- [ ] Generate E2E tests (*.e2e.spec.ts)
- [ ] Generate unit tests (*.spec.ts) with mocks
- [ ] Auto-detect unique constraints from Prisma schema
- [ ] Support for custom service methods
- [ ] Generate test data factories
- [ ] Integration with coverage reports

## Related Documentation

- [NestJS Guidelines](/Users/wassimmehanna/git/code-conventions/nestjs-guidelines.md)
- [Testing Requirements](/Users/wassimmehanna/git/code-conventions/nestjs-guidelines.md#testing)
- [Mandatory Test Checklist](/Users/wassimmehanna/git/code-conventions/nestjs-guidelines.md#mandatory-test-checklist-for-new-services)
