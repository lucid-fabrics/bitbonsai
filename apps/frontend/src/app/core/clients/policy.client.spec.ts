import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  CreatePolicyRequest,
  PolicyModel,
  PresetInfoModel,
  UpdatePolicyRequest,
} from '../../features/policies/models/policy.model';
import { PolicyClient } from './policy.client';

describe('PolicyClient', () => {
  let client: PolicyClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PolicyClient],
    });
    client = TestBed.inject(PolicyClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(client).toBeTruthy();
  });

  describe('getPolicies', () => {
    it('should fetch all policies', () => {
      const mockPolicies: PolicyModel[] = [
        {
          id: '1',
          name: 'HD Policy',
          description: 'High definition encoding',
          preset: 'hd',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          name: '4K Policy',
          description: 'Ultra HD encoding',
          preset: '4k',
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      client.getPolicies().subscribe((data) => {
        expect(data).toEqual(mockPolicies);
        expect(data.length).toBe(2);
        expect(data[0].name).toBe('HD Policy');
        expect(data[1].name).toBe('4K Policy');
      });

      const req = httpMock.expectOne('/api/v1/policies');
      expect(req.request.method).toBe('GET');
      req.flush(mockPolicies);
    });

    it('should handle errors when fetching policies', () => {
      client.getPolicies().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getPolicy', () => {
    it('should fetch a specific policy by ID', () => {
      const mockPolicy: PolicyModel = {
        id: '1',
        name: 'HD Policy',
        description: 'High definition encoding',
        preset: 'hd',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      client.getPolicy('1').subscribe((data) => {
        expect(data).toEqual(mockPolicy);
        expect(data.id).toBe('1');
        expect(data.name).toBe('HD Policy');
      });

      const req = httpMock.expectOne('/api/v1/policies/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockPolicy);
    });

    it('should handle 404 when policy not found', () => {
      client.getPolicy('999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies/999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getPresets', () => {
    it('should fetch all available presets', () => {
      const mockPresets: PresetInfoModel[] = [
        {
          id: 'hd',
          name: 'HD',
          description: 'High definition preset for 1080p content',
          targetResolution: '1920x1080',
          targetBitrate: 5000000,
        },
        {
          id: '4k',
          name: '4K',
          description: 'Ultra HD preset for 4K content',
          targetResolution: '3840x2160',
          targetBitrate: 20000000,
        },
      ];

      client.getPresets().subscribe((data) => {
        expect(data).toEqual(mockPresets);
        expect(data.length).toBe(2);
        expect(data[0].id).toBe('hd');
        expect(data[1].id).toBe('4k');
      });

      const req = httpMock.expectOne('/api/v1/policies/presets');
      expect(req.request.method).toBe('GET');
      req.flush(mockPresets);
    });

    it('should handle errors when fetching presets', () => {
      client.getPresets().subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(500);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies/presets');
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('createPolicy', () => {
    it('should create a new policy', () => {
      const createRequest: CreatePolicyRequest = {
        name: 'SD Policy',
        description: 'Standard definition encoding',
        preset: 'sd',
      };

      const mockResponse: PolicyModel = {
        id: '3',
        ...createRequest,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      };

      client.createPolicy(createRequest).subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.id).toBe('3');
        expect(data.name).toBe('SD Policy');
      });

      const req = httpMock.expectOne('/api/v1/policies');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createRequest);
      req.flush(mockResponse);
    });

    it('should handle validation errors when creating policy', () => {
      const invalidRequest: CreatePolicyRequest = {
        name: '',
        description: '',
        preset: '',
      };

      client.createPolicy(invalidRequest).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(400);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies');
      req.flush('Validation Error', { status: 400, statusText: 'Bad Request' });
    });

    it('should handle duplicate policy name error', () => {
      const createRequest: CreatePolicyRequest = {
        name: 'HD Policy',
        description: 'Duplicate',
        preset: 'hd',
      };

      client.createPolicy(createRequest).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(409);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies');
      req.flush('Policy already exists', { status: 409, statusText: 'Conflict' });
    });
  });

  describe('updatePolicy', () => {
    it('should update an existing policy', () => {
      const updateRequest: UpdatePolicyRequest = {
        name: 'HD Policy Updated',
        description: 'Updated description',
      };

      const mockResponse: PolicyModel = {
        id: '1',
        name: 'HD Policy Updated',
        description: 'Updated description',
        preset: 'hd',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-04T00:00:00Z',
      };

      client.updatePolicy('1', updateRequest).subscribe((data) => {
        expect(data).toEqual(mockResponse);
        expect(data.name).toBe('HD Policy Updated');
        expect(data.updatedAt).toBe('2024-01-04T00:00:00Z');
      });

      const req = httpMock.expectOne('/api/v1/policies/1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(updateRequest);
      req.flush(mockResponse);
    });

    it('should handle errors when updating policy', () => {
      const updateRequest: UpdatePolicyRequest = {
        name: 'New Name',
      };

      client.updatePolicy('999', updateRequest).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies/999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });

    it('should handle validation errors when updating policy', () => {
      const updateRequest: UpdatePolicyRequest = {
        preset: 'invalid-preset',
      };

      client.updatePolicy('1', updateRequest).subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(400);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies/1');
      req.flush('Invalid preset', { status: 400, statusText: 'Bad Request' });
    });
  });

  describe('deletePolicy', () => {
    it('should delete a policy', () => {
      client.deletePolicy('1').subscribe((response) => {
        expect(response).toBeUndefined();
      });

      const req = httpMock.expectOne('/api/v1/policies/1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('should handle errors when deleting policy', () => {
      client.deletePolicy('999').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies/999');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });

    it('should handle conflict when deleting policy in use', () => {
      client.deletePolicy('1').subscribe({
        next: () => fail('should have failed'),
        error: (error) => {
          expect(error.status).toBe(409);
        },
      });

      const req = httpMock.expectOne('/api/v1/policies/1');
      req.flush('Policy is in use by libraries', { status: 409, statusText: 'Conflict' });
    });
  });
});
