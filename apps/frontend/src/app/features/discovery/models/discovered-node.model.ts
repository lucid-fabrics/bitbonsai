// Re-export from core to maintain backwards compatibility with existing consumers.
// The canonical definition lives in core/models/discovery.model.ts.
export type {
  CPUInfo,
  DiscoveredNode,
  GPUInfo,
  HardwareCapabilities,
  MemoryInfo,
} from '../../../core/models/discovery.model';
export { AccelerationType, DiscoveryStatus, GPUVendor } from '../../../core/models/discovery.model';
