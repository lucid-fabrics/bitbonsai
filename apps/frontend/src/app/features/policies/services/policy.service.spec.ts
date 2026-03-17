import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PolicyClient } from '../../../core/clients/policy.client';
import { PolicyBo } from '../bos/policy.bo';
import type { PolicyModel } from '../models/policy.model';
import { PolicyService } from './policy.service';

describe('PolicyService', () => {
  let service: PolicyService;
  let policyClient: jest.Mocked<PolicyClient>;

  const mockPolicyModel: PolicyModel = {
    id: '1',
    name: 'Test Policy',
    targetCodec: 'HEVC',
    crf: 23,
    preset: 'medium',
    libraryId: 'lib1',
    enabled: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  beforeEach(() => {
    const policyClientSpy = {
      getPolicies: jest.fn(),
      getPolicy: jest.fn(),
      createPolicy: jest.fn(),
      updatePolicy: jest.fn(),
      deletePolicy: jest.fn(),
    } as jest.Mocked<PolicyClient>;

    TestBed.configureTestingModule({
      providers: [PolicyService, { provide: PolicyClient, useValue: policyClientSpy }],
    });

    service = TestBed.inject(PolicyService);
    policyClient = TestBed.inject(PolicyClient) as jest.Mocked<PolicyClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getPolicies', () => {
    it('should return an array of PolicyBo instances', (done) => {
      const mockPolicies = [mockPolicyModel];
      policyClient.getPolicies.mockReturnValue(of(mockPolicies));

      service.getPolicies().subscribe((policies) => {
        expect(policies.length).toBe(1);
        expect(policies[0]).toBeInstanceOf(PolicyBo);
        expect(policies[0].id).toBe('1');
        expect(policies[0].name).toBe('Test Policy');
        done();
      });

      expect(policyClient.getPolicies).toHaveBeenCalled();
    });

    it('should handle empty array', (done) => {
      policyClient.getPolicies.mockReturnValue(of([]));

      service.getPolicies().subscribe((policies) => {
        expect(policies.length).toBe(0);
        done();
      });
    });

    it('should handle errors', (done) => {
      const error = new Error('Failed to fetch policies');
      policyClient.getPolicies.mockReturnValue(throwError(() => error));

      service.getPolicies().subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });

  describe('getPolicy', () => {
    it('should return a single PolicyBo instance', (done) => {
      policyClient.getPolicy.mockReturnValue(of(mockPolicyModel));

      service.getPolicy('1').subscribe((policy) => {
        expect(policy).toBeInstanceOf(PolicyBo);
        expect(policy.id).toBe('1');
        expect(policy.name).toBe('Test Policy');
        done();
      });

      expect(policyClient.getPolicy).toHaveBeenCalledWith('1');
    });

    it('should handle 404 errors', (done) => {
      const error = new Error('Policy not found');
      policyClient.getPolicy.mockReturnValue(throwError(() => error));

      service.getPolicy('999').subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });

  describe('createPolicy', () => {
    it('should create and return a PolicyBo instance', (done) => {
      const createData = {
        name: 'New Policy',
        targetCodec: 'HEVC' as const,
        crf: 23,
        preset: 'medium' as const,
        libraryId: 'lib1',
      };

      policyClient.createPolicy.mockReturnValue(of(mockPolicyModel));

      service.createPolicy(createData).subscribe((policy) => {
        expect(policy).toBeInstanceOf(PolicyBo);
        expect(policy.name).toBe('Test Policy');
        done();
      });

      expect(policyClient.createPolicy).toHaveBeenCalledWith(createData);
    });

    it('should handle validation errors', (done) => {
      const createData = {
        name: '',
        targetCodec: 'HEVC' as const,
        crf: 23,
        preset: 'medium' as const,
        libraryId: 'lib1',
      };
      const error = new Error('Validation failed');
      policyClient.createPolicy.mockReturnValue(throwError(() => error));

      service.createPolicy(createData).subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });

  describe('updatePolicy', () => {
    it('should update and return a PolicyBo instance', (done) => {
      const updateData = { name: 'Updated Policy' };
      const updatedModel = { ...mockPolicyModel, name: 'Updated Policy' };

      policyClient.updatePolicy.mockReturnValue(of(updatedModel));

      service.updatePolicy('1', updateData).subscribe((policy) => {
        expect(policy).toBeInstanceOf(PolicyBo);
        expect(policy.name).toBe('Updated Policy');
        done();
      });

      expect(policyClient.updatePolicy).toHaveBeenCalledWith('1', updateData);
    });
  });

  describe('deletePolicy', () => {
    it('should delete a policy', (done) => {
      policyClient.deletePolicy.mockReturnValue(of(void 0));

      service.deletePolicy('1').subscribe(() => {
        done();
      });

      expect(policyClient.deletePolicy).toHaveBeenCalledWith('1');
    });

    it('should handle delete errors', (done) => {
      const error = new Error('Cannot delete policy with active jobs');
      policyClient.deletePolicy.mockReturnValue(throwError(() => error));

      service.deletePolicy('1').subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
