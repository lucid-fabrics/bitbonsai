# 🧪 Testing Requirements & Guidelines

> **⚠️ CRITICAL REQUIREMENT**: Before adding any new feature or fixing existing functionality in Angular or NestJS code, you MUST first read the existing tests in the `__tests__` folder (for NestJS) or `.spec.ts` files (for Angular) to understand the current test patterns, fixtures, and mocking strategies. Then add or update the corresponding tests to match your changes.

---

## 🎯 Testing Requirements for New Features
When implementing new functionality, you MUST update the following test files:

### Portal-Web Testing Requirements
- **Effects Tests**: Update `[feature].effects.spec.ts` for any new NgRx effects
- **Service Tests**: Update `[service].service.spec.ts` for any new service methods
- **Component Tests**: Update `[component].component.spec.ts` for new components or component methods
- **BO Tests**: Create/update tests for new Business Objects and their mapping logic
- **Integration Tests**: Add E2E tests for complete user workflows

### Portal-API Testing Requirements
- **Controller Tests**: Update tests in `projects/portal-api/src/app/**/__tests__/` for any new endpoints
- **Service Tests**: Update service test files for new business logic methods
- **Repository Tests**: Update repository tests for new data access methods
- **DTO Tests**: Test new DTOs with validation rules and transformations
- **Integration Tests**: Add tests for complete API workflows

---

## 📋 Testing File Patterns
```
Portal-Web Tests:
- projects/portal-web/src/app/[feature]/+state/[feature].effects.spec.ts
- projects/portal-web/src/app/[feature]/_services/[service].service.spec.ts
- projects/portal-web/src/app/[feature]/[component]/[component].component.spec.ts

Portal-API Tests:
- projects/portal-api/src/app/[module]/__tests__/[controller].controller.spec.ts
- projects/portal-api/src/app/[module]/__tests__/[service].service.spec.ts
- projects/portal-api/src/app/[module]/__tests__/[repository].repository.spec.ts
```

---

## ⚠️ Critical Testing Rules
1. **Never ship features without tests** - All new functionality requires corresponding test updates
2. **Test the architecture layers** - Effects, Services, Clients, BOs, Controllers, Repositories
3. **Mock dependencies properly** - Use proper mocking for external dependencies
4. **Test error scenarios** - Include error handling and edge cases in tests
5. **Maintain test coverage** - Ensure new code maintains or improves test coverage metrics
6. **Update fixtures** - When data structures change, update all test fixtures and mocks

---

## 🏢 Company-Scoped Test Fixtures
All test fixtures MUST include required `companyId` fields:

```typescript
const mockUser: User = {
  companyId: '550e8400-e29b-41d4-a716-446655440000',
  // ...other fields
};

const mockRole: Role = {
  companyId: '550e8400-e29b-41d4-a716-446655440000',
  // ...other fields
};
```

---

## 🔧 Testing Technologies
- **Unit tests**: Components, services, repositories, and factories
- **Integration tests**: Real Prisma in ephemeral DB (e.g., Testcontainers)
- **E2E tests**: Controllers with supertest
- **Use minimal boilerplate** testing utilities
- **Enforce formatting and linting** in CI/CD

---

## 📊 Testing Best Practices

### Angular Testing
- Test component behavior, not implementation details
- Mock external dependencies (services, HTTP calls)
- Test reactive forms and signal updates
- Verify proper error handling and loading states

### NestJS Testing
- Test business logic in services independently
- Mock repository layer in service tests
- Use real database for integration tests
- Test validation pipes and guards
- Verify proper error mapping and responses
