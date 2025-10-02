import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PolicyService } from './policy.service';
import { PolicyClient } from '../clients/policy.client';
import { PolicyBo } from '../business-objects/policy.bo';
import { PolicyModel } from '../models/policy.model';

describe('PolicyService', () => {
  let service: PolicyService;
  let policyClient: jasmine.SpyObj<PolicyClient>;

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
    const policyClientSpy = jasmine.createSpyObj('PolicyClient', [
      'getPolicies',
      'getPolicy',
      'createPolicy',
      'updatePolicy',
      'deletePolicy',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PolicyService,
        { provide: PolicyClient, useValue: policyClientSpy },
      ],
    });

    service = TestBed.inject(PolicyService);
    policyClient = TestBed.inject(PolicyClient) as jasmine.SpyObj<PolicyClient>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getPolicies', () => {
    it('should return an array of PolicyBo instances', (done) => {
      const mockPolicies = [mockPolicyModel];
      policyClient.getPolicies.and.returnValue(of(mockPolicies));

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
      policyClient.getPolicies.and.returnValue(of([]));

      service.getPolicies().subscribe((policies) => {
        expect(policies.length).toBe(0);
        done();
      });
    });

    it('should handle errors', (done) => {
      const error = new Error('Failed to fetch policies');
      policyClient.getPolicies.and.returnValue(throwError(() => error));

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
      policyClient.getPolicy.and.returnValue(of(mockPolicyModel));

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
      policyClient.getPolicy.and.returnValue(throwError(() => error));

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

      policyClient.createPolicy.and.returnValue(of(mockPolicyModel));

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
      policyClient.createPolicy.and.returnValue(throwError(() => error));

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

      policyClient.updatePolicy.and.returnValue(of(updatedModel));

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
      policyClient.deletePolicy.and.returnValue(of(void 0));

      service.deletePolicy('1').subscribe(() => {
        done();
      });

      expect(policyClient.deletePolicy).toHaveBeenCalledWith('1');
    });

    it('should handle delete errors', (done) => {
      const error = new Error('Cannot delete policy with active jobs');
      policyClient.deletePolicy.and.returnValue(throwError(() => error));

      service.deletePolicy('1').subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
