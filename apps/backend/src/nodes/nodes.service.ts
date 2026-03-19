import { version as APP_VERSION } from '@bitbonsai/version';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type AccelerationType, type Node, NodeRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as os from 'os';
import { LicenseRepository } from '../common/repositories/license.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { DataAccessService } from '../core/services/data-access.service';
import type { HeartbeatDto } from './dto/heartbeat.dto';
import type { NodeRegistrationResponseDto } from './dto/node-registration-response.dto';
import type { NodeStatsDto } from './dto/node-stats.dto';
import type { OptimalConfigDto } from './dto/optimal-config.dto';
import type { RegisterNodeDto } from './dto/register-node.dto';
import type { UpdateNodeDto } from './dto/update-node.dto';
import { StorageShareService } from './services/storage-share.service';
import { SystemInfoService } from './services/system-info.service';
import {
  calculateOptimalWorkers,
  getRecommendationSummary,
} from './utils/optimal-worker-calculator';

/**
 * NodesService
 *
 * Handles node registration, pairing, heartbeat tracking, and statistics.
 * Implements multi-node architecture with license validation and pairing mechanism.
 */
@Injectable()
export class NodesService implements OnModuleInit {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private readonly nodeRepository: NodeRepository,
    private readonly licenseRepository: LicenseRepository,
    private readonly dataAccessService: DataAccessService,
    private readonly systemInfoService: SystemInfoService,
    private readonly storageShareService: StorageShareService
  ) {}

  /**
   * Initialize node on module startup
   */
  async onModuleInit() {
    this.logger.log('🔧 Initializing nodes service...');
    this.logger.log('💓 Auto-heartbeat started (every 30s)');

    // Send initial heartbeat immediately
    this.sendAutoHeartbeat();
  }

  /**
   * Auto-heartbeat for current node (works for both MAIN and LINKED)
   * Uses @Interval decorator for resilience to hot reloads
   * Sends heartbeat every 30 seconds to keep status updated
   *
   * - MAIN nodes: Updates local database
   * - LINKED nodes: Sends heartbeat to MAIN node via API
   */
  @Interval(30000)
  private async sendAutoHeartbeat(): Promise<void> {
    try {
      // Get the current node from local database (MAIN or LINKED)
      const currentNode = await this.nodeRepository.findFirstNode();

      if (!currentNode) {
        this.logger.warn('⚠️  No node found in local database - skipping heartbeat');
        return;
      }

      // Send heartbeat based on node role
      if (currentNode.role === NodeRole.MAIN) {
        // MAIN node: Update local database
        await this.heartbeat(currentNode.id);
        this.logger.debug(`💓 [MAIN] Heartbeat sent for ${currentNode.name}`);
      } else {
        // LINKED node: Send heartbeat to MAIN node via API
        await this.dataAccessService.sendHeartbeat(currentNode.id);
        this.logger.debug(`💓 [LINKED] Heartbeat sent for ${currentNode.name} to MAIN API`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`❌ Failed to send auto-heartbeat: ${errorMessage}`);
      if (errorStack) {
        this.logger.error(errorStack);
      }
    }
  }

  /**
   * Register a new node with license validation
   *
   * Process:
   * 1. Validate license key and check if active
   * 2. Verify node limit hasn't been reached
   * 3. Assign role (MAIN for first node, LINKED for additional)
   * 4. Generate unique API key for node authentication
   * 5. Generate 6-digit pairing token (expires in 10 minutes)
   * 6. Create node record in database
   *
   * @param data Registration data (name, licenseKey, version, acceleration)
   * @returns Node with apiKey and pairingToken (only shown once)
   * @throws BadRequestException if license is invalid or inactive
   * @throws ConflictException if maximum nodes reached for license
   */
  async registerNode(data: RegisterNodeDto): Promise<NodeRegistrationResponseDto> {
    // If no license key provided, use main node's license (for child node registration from main)
    let licenseKey = data.licenseKey;
    if (!licenseKey) {
      const mainNode = await this.nodeRepository.findFirstWithLicense({ role: NodeRole.MAIN });

      if (!mainNode) {
        throw new BadRequestException(
          'No main node found. License key is required for first node registration.'
        );
      }

      licenseKey = mainNode.license.key;
      this.logger.debug(`Using main node's license (${licenseKey}) for child node registration`);
    }

    // Validate license
    const license = await this.licenseRepository.findByKeyWithInclude<{
      id: string;
      status: string;
      maxNodes: number;
      _count: { nodes: number };
    }>(licenseKey, { _count: { select: { nodes: true } } });

    if (!license || license.status !== 'ACTIVE') {
      throw new BadRequestException('Invalid or inactive license key');
    }

    if (license._count.nodes >= license.maxNodes) {
      throw new ConflictException(`Maximum nodes (${license.maxNodes}) reached for this license`);
    }

    // Generate pairing token (6-digit code, expires in 10 minutes)
    const pairingToken = this.generatePairingToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Determine role
    const role = license._count.nodes === 0 ? NodeRole.MAIN : NodeRole.LINKED;

    // CRITICAL: Validate no duplicate MAIN nodes (data integrity check)
    if (role === NodeRole.MAIN) {
      // Double-check that no MAIN node exists (prevents race conditions and data corruption)
      const existingMainNode = await this.nodeRepository.findFirstWithLicense({
        role: NodeRole.MAIN,
        licenseId: license.id,
      });

      if (existingMainNode) {
        this.logger.error(
          `❌ Attempted to create duplicate MAIN node! Existing MAIN: ${existingMainNode.name} (${existingMainNode.id})`
        );
        throw new ConflictException(
          'A MAIN node already exists for this license. Only one MAIN node is allowed per license.'
        );
      }
    }

    // Provide intelligent defaults for optional fields
    const nodeName =
      data.name || `${role === NodeRole.MAIN ? 'Main' : 'Linked'} Node ${license._count.nodes + 1}`;
    const nodeVersion = data.version || APP_VERSION; // Read from package.json
    const nodeAcceleration = data.acceleration || 'CPU'; // Default to CPU (every node has a CPU)

    // Create node
    const node = await this.nodeRepository.createNode({
      name: nodeName,
      role,
      status: 'ONLINE',
      version: nodeVersion,
      acceleration: nodeAcceleration,
      apiKey: this.generateApiKey(),
      pairingToken,
      pairingExpiresAt,
      lastHeartbeat: new Date(),
      licenseId: license.id,
    });

    return {
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      version: node.version,
      acceleration: node.acceleration,
      apiKey: node.apiKey,
      pairingToken: node.pairingToken || '',
      pairingExpiresAt: node.pairingExpiresAt || new Date(),
      createdAt: node.createdAt,
    };
  }

  /**
   * Complete node pairing using 6-digit token
   *
   * Process:
   * 1. Find node with matching pairing token
   * 2. Verify token hasn't expired (10 minute window)
   * 3. Clear pairing token and expiration (pairing complete)
   * 4. Return node details
   *
   * @param pairingToken 6-digit pairing code
   * @returns Paired node details
   * @throws NotFoundException if token is invalid or expired
   */
  async pairNode(pairingToken: string): Promise<Node> {
    const node = await this.nodeRepository.findFirst<Node | null>({
      where: {
        pairingToken,
        pairingExpiresAt: {
          gte: new Date(), // Token must not be expired
        },
      },
    });

    if (!node) {
      throw new NotFoundException('Invalid or expired pairing token');
    }

    // Clear pairing token (pairing complete)
    const pairedNode = await this.nodeRepository.updateData(node.id, {
      pairingToken: null,
      pairingExpiresAt: null,
    });

    // CRITICAL FIX: Auto-detect and mount storage shares for LINKED nodes
    // This was missing - child nodes were paired but never got storage access!
    if (pairedNode.role === 'LINKED') {
      this.logger.log(
        `🗂️  Pairing complete - auto-mounting storage shares for ${pairedNode.name}...`
      );

      // Run auto-mount asynchronously (don't block pairing response)
      this.storageShareService
        .autoDetectAndMount(pairedNode.id)
        .then((result) => {
          this.logger.log(
            `✅ Storage auto-mount complete for ${pairedNode.name}: ${result.detected} detected, ${result.created} created, ${result.mounted} mounted`
          );
          if (result.errors.length > 0) {
            this.logger.warn(`⚠️  Mount errors: ${result.errors.join(', ')}`);
          }
        })
        .catch((error) => {
          this.logger.error(
            `❌ Failed to auto-mount storage shares for ${pairedNode.name}:`,
            error instanceof Error ? error.stack : error
          );
        });
    }

    return pairedNode;
  }

  /**
   * Generate a new pairing token for an existing node
   *
   * Use case: If original pairing token expired, generate a new one
   *
   * @param nodeId Node identifier
   * @returns Updated node with new pairing token
   * @throws NotFoundException if node doesn't exist
   */
  async generatePairingTokenForNode(nodeId: string): Promise<NodeRegistrationResponseDto> {
    const node = await this.nodeRepository.findById(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    const pairingToken = this.generatePairingToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const updated = await this.nodeRepository.updateData(nodeId, {
      pairingToken,
      pairingExpiresAt,
    });

    return {
      id: updated.id,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      version: updated.version,
      acceleration: updated.acceleration,
      apiKey: updated.apiKey,
      pairingToken: updated.pairingToken || '',
      pairingExpiresAt: updated.pairingExpiresAt || new Date(),
      createdAt: updated.createdAt,
    };
  }

  /**
   * Record node heartbeat and update statistics
   *
   * Process:
   * 1. Update lastHeartbeat timestamp
   * 2. Increment uptimeSeconds (assumes 60s heartbeat interval)
   * 3. Update status if provided
   * 4. Update CPU/memory usage if provided
   * 5. Update IP address if provided in payload (for LINKED nodes) or auto-detect (for MAIN node)
   *
   * @param nodeId Node identifier
   * @param data Optional status, metrics, and IP address
   * @returns Updated node
   * @throws NotFoundException if node doesn't exist
   */
  async heartbeat(nodeId: string, data?: HeartbeatDto): Promise<Node> {
    const node = await this.nodeRepository.findById(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    // Determine which IP address to use:
    // - If IP provided in payload (from LINKED node), use it (fixes IP overwriting bug)
    // - Otherwise, auto-detect local IP (for MAIN node heartbeats)
    let ipAddressToUpdate: string | undefined;

    if (data?.ipAddress) {
      // LINKED node sent its IP address - use it directly
      ipAddressToUpdate = data.ipAddress;
      this.logger.debug(`📍 Using IP from heartbeat payload for ${node.name}: ${data.ipAddress}`);
    } else if (node.role === NodeRole.MAIN) {
      // MAIN node heartbeat - auto-detect IP
      const systemInfo = await this.systemInfoService.collectSystemInfo();
      ipAddressToUpdate = systemInfo.ipAddress;
      this.logger.debug(`📍 Auto-detected IP for MAIN node ${node.name}: ${systemInfo.ipAddress}`);
    }

    // Log IP address update if it changed
    if (ipAddressToUpdate && node.ipAddress !== ipAddressToUpdate) {
      this.logger.log(
        `📍 Updating IP address for ${node.name}: ${node.ipAddress || 'none'} → ${ipAddressToUpdate}`
      );
    }

    return this.nodeRepository.updateData(nodeId, {
      status: data?.status || 'ONLINE',
      lastHeartbeat: new Date(),
      uptimeSeconds: { increment: 60 }, // Assuming 60s heartbeat interval
      ...(ipAddressToUpdate && { ipAddress: ipAddressToUpdate }), // Only update if we have a valid IP
    });
  }

  /**
   * Get node with comprehensive statistics
   *
   * Includes:
   * - Node details
   * - Associated license information
   * - List of managed libraries
   * - Count of active encoding jobs (QUEUED, ENCODING, VERIFYING)
   *
   * @param nodeId Node identifier
   * @returns Node with statistics
   * @throws NotFoundException if node doesn't exist
   */
  async getNodeStats(nodeId: string): Promise<NodeStatsDto> {
    const node = await this.nodeRepository.findWithStats(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    // Calculate uptime dynamically based on createdAt timestamp
    const now = new Date();
    const uptimeSeconds = Math.floor((now.getTime() - node.createdAt.getTime()) / 1000);

    return {
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      version: node.version,
      acceleration: node.acceleration,
      lastHeartbeat: node.lastHeartbeat,
      uptimeSeconds,
      createdAt: node.createdAt,
      license: node.license ?? undefined,
      libraries: node.libraries,
      activeJobCount: node._count.jobs,
    };
  }

  /**
   * Get recommended optimal configuration for a node
   *
   * Analyzes node hardware and returns recommended maxWorkers setting
   * based on CPU cores and hardware acceleration type.
   *
   * @param nodeId Node identifier
   * @returns Optimal configuration recommendations
   * @throws NotFoundException if node doesn't exist
   */
  async getRecommendedConfig(nodeId: string): Promise<OptimalConfigDto> {
    const node = await this.nodeRepository.findWithSelect<{
      id: string;
      maxWorkers: number;
      acceleration: AccelerationType;
    }>(nodeId, { id: true, maxWorkers: true, acceleration: true });

    if (!node) {
      throw new NotFoundException(`Node with ID ${nodeId} not found`);
    }

    // Get hardware specs (CPU cores) from system
    const cpuCores = os.cpus().length;
    const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));

    // Calculate optimal configuration
    const optimalConfig = calculateOptimalWorkers(cpuCores, node.acceleration, ramGb);

    // Generate summary comparing current vs recommended
    const summary = getRecommendationSummary(node.maxWorkers, optimalConfig);

    return {
      recommendedMaxWorkers: optimalConfig.recommendedMaxWorkers,
      currentMaxWorkers: node.maxWorkers,
      cpuCoresPerJob: optimalConfig.cpuCoresPerJob,
      estimatedLoadAverage: optimalConfig.estimatedLoadAverage,
      reasoning: optimalConfig.reasoning,
      summary,
      totalCpuCores: cpuCores,
      acceleration: node.acceleration,
    };
  }

  /**
   * Get all nodes with basic information
   *
   * PERF: Optimized to select only needed fields and include license info
   * @returns List of all nodes with license information
   */
  async findAll(): Promise<Node[]> {
    const nodes = await this.nodeRepository.findAllWithLicense();

    // Calculate uptime dynamically based on createdAt timestamp
    const now = new Date();
    return nodes.map((node) => ({
      ...node,
      uptimeSeconds: Math.floor((now.getTime() - node.createdAt.getTime()) / 1000),
    }));
  }

  /**
   * Get a specific node by ID
   *
   * @param id Node identifier
   * @returns Node details
   * @throws NotFoundException if node doesn't exist
   */
  async findOne(id: string): Promise<Node> {
    const node = await this.nodeRepository.findById(id);

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    return node;
  }

  /**
   * Find a node by API key (for authentication)
   *
   * @param apiKey API key to search for
   * @returns Node details or null if not found
   */
  async findByApiKey(apiKey: string): Promise<Node | null> {
    return this.nodeRepository.findByApiKey(apiKey);
  }

  /**
   * Get the current node's information
   *
   * Determines which node this instance is by using multiple strategies:
   * 1. NODE_ID environment variable (explicit configuration)
   * 2. IP address matching (detects correct node automatically)
   * 3. Fallback to role-based detection (MAIN first, then LINKED)
   *
   * This method is critical for multi-node setups where a single database
   * contains multiple node records but each instance needs to identify itself.
   *
   * @returns Current node information
   * @throws NotFoundException if no nodes exist or NODE_ID is invalid
   */
  async getCurrentNode(): Promise<Node> {
    const nodeId = process.env.NODE_ID;

    // Collect system info once for all strategies
    const systemInfo = await this.systemInfoService.collectSystemInfo();
    const currentIpAddress = systemInfo.ipAddress;

    // Helper to auto-update node IP if it differs from detected IP
    // This ensures database always has current IP, preventing future mismatches
    const autoUpdateIpIfNeeded = async (node: Node): Promise<Node> => {
      if (
        currentIpAddress &&
        node.ipAddress !== currentIpAddress &&
        currentIpAddress !== '127.0.0.1'
      ) {
        this.logger.warn(
          `🔄 AUTO-IP-UPDATE: Node "${node.name}" IP changed from ${node.ipAddress} to ${currentIpAddress}`
        );
        return this.nodeRepository.updateData(node.id, { ipAddress: currentIpAddress });
      }
      return node;
    };

    // Strategy 1: If NODE_ID is explicitly set, use it (highest priority)
    if (nodeId) {
      const node = await this.nodeRepository.findById(nodeId);

      if (!node) {
        throw new NotFoundException(`Node with ID ${nodeId} (from NODE_ID env) not found`);
      }

      return autoUpdateIpIfNeeded(node);
    }

    // Strategy 2: Try to match by IP address (auto-detection)

    if (currentIpAddress) {
      // Try to find nodes matching this IP address
      const nodesByIp = await this.nodeRepository.findManyByIp(currentIpAddress);

      if (nodesByIp.length > 0) {
        // Prefer MAIN node over LINKED node (fixes duplicate node bug)
        const mainNode = nodesByIp.find((n) => n.role === 'MAIN');
        const selectedNode = mainNode || nodesByIp[0]; // Use MAIN if exists, otherwise first node

        // Warn if multiple nodes with same IP exist
        if (nodesByIp.length > 1) {
          this.logger.warn(
            `⚠️  Multiple nodes detected with IP ${currentIpAddress} (${nodesByIp.length} total)`
          );
          this.logger.warn(
            `   Using ${selectedNode.role} node: ${selectedNode.name} (${selectedNode.id})`
          );
          this.logger.warn(
            `   Duplicates: ${nodesByIp
              .filter((n) => n.id !== selectedNode.id)
              .map((n) => `${n.name} (${n.role})`)
              .join(', ')}`
          );
        }

        this.logger.debug(
          `✅ Detected current node by IP address: ${selectedNode.name} (${selectedNode.role}) at ${currentIpAddress}`
        );
        return selectedNode; // IP already matches, no update needed
      }
    }

    // Strategy 3: Fallback to role-based detection
    // IMPORTANT: When using role-based fallback, auto-update the IP so future restarts use Strategy 2

    // Check for MAIN node
    const mainNodes = await this.nodeRepository.findManyByRole(NodeRole.MAIN, {
      orderBy: { createdAt: 'asc' },
    });

    // Warn if multiple MAIN nodes exist (data inconsistency)
    if (mainNodes.length > 1) {
      this.logger.warn(
        `⚠️  Multiple MAIN nodes detected (${mainNodes.length})! This is a data inconsistency.`
      );
      this.logger.warn(
        `   Using newest MAIN node: ${mainNodes[mainNodes.length - 1].name} (${mainNodes[mainNodes.length - 1].id})`
      );
      this.logger.warn(
        `   Consider cleaning up old MAIN nodes: ${mainNodes
          .slice(0, -1)
          .map((n) => n.id)
          .join(', ')}`
      );
      // Return the NEWEST main node (most likely to be correct) and auto-update its IP
      return autoUpdateIpIfNeeded(mainNodes[mainNodes.length - 1]);
    }

    if (mainNodes.length === 1) {
      return autoUpdateIpIfNeeded(mainNodes[0]);
    }

    // No MAIN node found - check if this is a child-only instance (has LINKED node but no MAIN)
    const linkedNode = await this.nodeRepository.findFirstByRole(NodeRole.LINKED, {
      orderBy: { createdAt: 'desc' },
    });

    if (linkedNode) {
      return autoUpdateIpIfNeeded(linkedNode);
    }

    throw new NotFoundException('No nodes found. Please complete setup first.');
  }

  /**
   * Update node configuration
   *
   * @param id Node identifier
   * @param data Update data
   * @returns Updated node with warning if maxWorkers is too high
   * @throws NotFoundException if node doesn't exist
   * @throws BadRequestException if maxWorkers will cause resource starvation
   */
  async update(id: string, data: UpdateNodeDto): Promise<Node> {
    const node = await this.nodeRepository.findById(id);

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    // If updating maxWorkers, validate against recommended settings
    if (data.maxWorkers !== undefined) {
      const cpuCores = os.cpus().length;
      const optimalConfig = calculateOptimalWorkers(cpuCores, node.acceleration);

      // Warn if significantly higher than recommended (2x threshold)
      if (data.maxWorkers > optimalConfig.recommendedMaxWorkers * 2) {
        throw new BadRequestException(
          `⚠️ Setting ${data.maxWorkers} workers is too high for your ${cpuCores}-core system! ` +
            `Recommended maximum: ${optimalConfig.recommendedMaxWorkers} workers (${optimalConfig.cpuCoresPerJob} cores per job). ` +
            `Setting too many workers will cause job failures due to resource starvation. ` +
            `Estimated load: ${data.maxWorkers * optimalConfig.cpuCoresPerJob} (your system has ${cpuCores} cores).`
        );
      }

      // Log warning if higher than recommended but not critically high
      if (data.maxWorkers > optimalConfig.recommendedMaxWorkers) {
        this.logger.warn(
          `Node ${id}: maxWorkers (${data.maxWorkers}) is higher than recommended (${optimalConfig.recommendedMaxWorkers}). ` +
            `This may cause resource contention and job failures.`
        );
      }
    }

    return this.nodeRepository.updateData(id, {
      ...(data.name && { name: data.name }),
      ...(data.maxWorkers !== undefined && { maxWorkers: data.maxWorkers }),
      ...(data.cpuLimit !== undefined && { cpuLimit: data.cpuLimit }),
      ...(data.publicUrl !== undefined && { publicUrl: data.publicUrl }),
      ...(data.mainNodeUrl !== undefined && { mainNodeUrl: data.mainNodeUrl }),
      ...(data.hasSharedStorage !== undefined && { hasSharedStorage: data.hasSharedStorage }),
      ...(data.networkLocation !== undefined && { networkLocation: data.networkLocation }),
      ...(data.loadThresholdMultiplier !== undefined && {
        loadThresholdMultiplier: data.loadThresholdMultiplier,
      }),
      ...(data.ipAddress && { ipAddress: data.ipAddress }),
    });
  }

  /**
   * Remove a node from the system
   *
   * For LINKED (child) nodes, this will:
   * 1. Notify the child node to reset itself (if reachable)
   * 2. Delete the node from main node's database
   *
   * RACE CONDITION FIX: Uses try-catch with timeout on fetch to prevent
   * blocking deletion if child node is unreachable. Uses AbortController
   * for 5-second timeout to prevent hanging network requests.
   *
   * Warning: This will cascade delete all associated libraries and jobs
   *
   * @param id Node identifier
   * @throws NotFoundException if node doesn't exist
   */
  async remove(id: string): Promise<void> {
    const node = await this.nodeRepository.findWithSelect<{
      id: string;
      name: string;
      role: string;
      publicUrl: string | null;
      mainNodeUrl: string | null;
      apiKey: string;
    }>(id, { id: true, name: true, role: true, publicUrl: true, mainNodeUrl: true, apiKey: true });

    if (!node) {
      throw new NotFoundException(`Node with ID ${id} not found`);
    }

    // If this is a LINKED (child) node, try to notify it to reset itself
    if (node.role === NodeRole.LINKED) {
      const childUrl = node.publicUrl || node.mainNodeUrl;
      if (childUrl) {
        try {
          this.logger.log(
            `🔔 Notifying child node ${node.name} (${childUrl}) to reset after unlink from main node`
          );

          // RACE CONDITION FIX: Add timeout to prevent hanging
          // Use AbortController for timeout (5 second limit)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          try {
            // Call the child node's unregister-self endpoint to make it reset
            const response = await fetch(`${childUrl}/api/v1/nodes/unregister-self`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${node.apiKey}`, // Use stored API key for auth
              },
              signal: controller.signal, // Add abort signal for timeout
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              this.logger.log(
                `✅ Child node ${node.name} successfully notified to reset (will redirect to setup)`
              );
            } else {
              this.logger.warn(
                `⚠️ Child node ${node.name} returned status ${response.status} - may need manual reset`
              );
            }
          } catch (fetchError: unknown) {
            clearTimeout(timeoutId);
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
              this.logger.warn(
                `⚠️ Timeout notifying child node ${node.name} (>5s) - proceeding with deletion`
              );
            } else {
              // FIX: Don't re-throw errors - child may be self-unregistering (circular call)
              // Just log a warning and continue with deletion
              const errorMessage =
                fetchError instanceof Error ? fetchError.message : 'Unknown error';
              this.logger.warn(
                `⚠️ Failed to notify child node ${node.name}: ${errorMessage} - proceeding with deletion`
              );
            }
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `⚠️ Failed to notify child node ${node.name} to reset: ${errorMessage} - child may need manual reset`
          );
          // Continue with deletion even if notification fails
        }
      } else {
        this.logger.warn(
          `⚠️ Child node ${node.name} has no URL configured - cannot notify to reset`
        );
      }
    }

    // Delete the node from main node's database
    // This will cascade delete all associated libraries and jobs
    await this.nodeRepository.deleteById(id);

    this.logger.log(`🗑️ Node ${node.name} (${id}) deleted from main node's database`);
  }

  /**
   * Unregister current node from main node
   *
   * This is called when a LINKED node wants to reset its configuration.
   * It will:
   * 1. Clear local pairing configuration
   * 2. Reset node to unconfigured state
   *
   * Note: The main node will detect the child is offline via heartbeat monitoring.
   *
   * @returns Success status and message
   * @throws BadRequestException if called on a MAIN node
   * @throws NotFoundException if current node not found
   */
  async unregisterSelf(): Promise<{ success: boolean; message: string }> {
    const currentNode = await this.getCurrentNode();

    // Only LINKED nodes can unregister
    if (currentNode.role === NodeRole.MAIN) {
      throw new BadRequestException('MAIN nodes cannot unregister');
    }

    this.logger.log(`🔄 Unregistering node: ${currentNode.name} (${currentNode.id})`);

    // Notify main node to remove this child node from its database
    if (currentNode.mainNodeUrl) {
      try {
        this.logger.log(
          `📡 Notifying main node at ${currentNode.mainNodeUrl} to remove this child node`
        );
        const response = await fetch(`${currentNode.mainNodeUrl}/api/v1/nodes/${currentNode.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          this.logger.log(`✅ Main node successfully removed child node ${currentNode.id}`);
        } else {
          this.logger.warn(
            `⚠️ Main node returned status ${response.status} when removing child node`
          );
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`❌ Failed to notify main node: ${errorMessage}`);
        // Continue with local unregistration even if main node notification fails
      }
    } else {
      this.logger.warn(`⚠️ No mainNodeUrl found - cannot notify main node of unregistration`);
    }

    // Clear local configuration and reset to unconfigured state
    await this.nodeRepository.updateData(currentNode.id, {
      role: NodeRole.MAIN, // Reset to MAIN (will be determined on next setup)
      pairingToken: null,
      pairingExpiresAt: null,
      mainNodeUrl: null, // Clear main node URL
    });

    const message = 'Node unregistered successfully. Please reconfigure this node.';

    this.logger.log(`✅ Node reset to unconfigured state`);

    return {
      success: true,
      message,
    };
  }

  /**
   * Generate a secure API key for node authentication
   *
   * Format: bb_[64 hex characters]
   *
   * @returns API key string
   */
  private generateApiKey(): string {
    const random = randomBytes(32).toString('hex');
    return `bb_${random}`;
  }

  /**
   * Generate a secure 6-digit pairing token
   *
   * SECURITY FIX: Uses crypto.randomBytes instead of Math.random()
   * - Cryptographically secure random number generation
   * - Prevents predictable token generation
   * - Uses rejection sampling to ensure uniform distribution
   *
   * Format: 000000-999999 (6 digits)
   *
   * @returns 6-digit pairing code
   */
  private generatePairingToken(): string {
    // SECURITY: Use crypto.randomBytes for cryptographically secure random numbers
    // Generate random number in range [100000, 999999] using rejection sampling
    let token: number;
    do {
      // Generate 4 random bytes (32 bits)
      const buffer = randomBytes(4);
      // Convert to unsigned 32-bit integer
      token = buffer.readUInt32BE(0);
      // Use modulo to get number in range [0, 999999], then add 100000 to get [100000, 999999]
      // Rejection sampling ensures uniform distribution
    } while (token > 4294967295 - (4294967295 % 900000)); // Reject values that would cause bias

    token = (token % 900000) + 100000;
    return token.toString();
  }
}
