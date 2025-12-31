import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * SSH Key Management Service
 *
 * Handles SSH key generation, storage, and authorized_keys management
 * for seamless passwordless SSH between nodes.
 */
@Injectable()
export class SshKeyService implements OnModuleInit {
  private readonly logger = new Logger(SshKeyService.name);
  private readonly sshDir = join(homedir(), '.ssh');
  private readonly privateKeyPath = join(this.sshDir, 'id_rsa');
  private readonly publicKeyPath = join(this.sshDir, 'id_rsa.pub');
  private readonly authorizedKeysPath = join(this.sshDir, 'authorized_keys');
  private initialized = false;

  async onModuleInit() {
    this.ensureSshDirectory();
    await this.ensureKeysExist();
    this.initialized = true;
  }

  /**
   * Ensure .ssh directory exists with correct permissions
   */
  private ensureSshDirectory(): void {
    if (!existsSync(this.sshDir)) {
      this.logger.log('Creating .ssh directory...');
      mkdirSync(this.sshDir, { recursive: true });
      chmodSync(this.sshDir, 0o700); // rwx------
    }
  }

  /**
   * Ensure SSH keypair exists, generate if missing
   */
  private async ensureKeysExist(): Promise<void> {
    if (!existsSync(this.publicKeyPath)) {
      this.logger.log('SSH keys not found, generating new keypair...');
      await this.generateKeyPair();
    } else {
      this.logger.log('SSH keys found');
    }
  }

  /**
   * Generate SSH keypair using ssh-keygen
   */
  private generateKeyPair(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const keygen = spawn('ssh-keygen', [
        '-t',
        'rsa',
        '-b',
        '4096',
        '-f',
        this.privateKeyPath,
        '-N',
        '', // No passphrase for automation
        '-C',
        'bitbonsai-cluster-node',
      ]);

      let stderr = '';

      keygen.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        keygen.kill('SIGKILL');
        reject(new Error('ssh-keygen timed out after 10 seconds'));
      }, 10000);

      keygen.on('close', (code) => {
        clearTimeout(timeoutId);
        keygen.stdout?.destroy();
        keygen.stderr?.destroy();

        if (code === 0) {
          // Set correct permissions
          chmodSync(this.privateKeyPath, 0o600); // rw-------
          chmodSync(this.publicKeyPath, 0o644); // rw-r--r--
          this.logger.log('✅ SSH keypair generated successfully');
          resolve();
        } else {
          this.logger.error(`Failed to generate SSH keys: ${stderr}`);
          reject(new Error(`ssh-keygen failed with code ${code}`));
        }
      });

      keygen.on('error', (error) => {
        clearTimeout(timeoutId);
        keygen.stdout?.destroy();
        keygen.stderr?.destroy();
        this.logger.error('Failed to spawn ssh-keygen:', error);
        reject(error);
      });
    });
  }

  /**
   * Get this node's public key
   */
  getPublicKey(): string {
    if (!existsSync(this.publicKeyPath)) {
      throw new Error('SSH public key not found');
    }

    return readFileSync(this.publicKeyPath, 'utf-8').trim();
  }

  /**
   * Add a public key to authorized_keys
   *
   * @param publicKey - SSH public key to authorize
   * @param comment - Optional comment for the key entry
   */
  addAuthorizedKey(publicKey: string, comment?: string): void {
    const keyEntry = comment ? `${publicKey} # ${comment}\n` : `${publicKey}\n`;

    // Create authorized_keys if it doesn't exist
    if (!existsSync(this.authorizedKeysPath)) {
      writeFileSync(this.authorizedKeysPath, keyEntry, { mode: 0o600 });
      this.logger.log(`Created authorized_keys and added key${comment ? ` (${comment})` : ''}`);
      return;
    }

    // Read existing keys
    const existingKeys = readFileSync(this.authorizedKeysPath, 'utf-8');

    // Check if key already exists (compare key part only, ignore comment)
    const keyPart = publicKey.split(' ').slice(0, 2).join(' ');
    if (existingKeys.includes(keyPart)) {
      this.logger.log(`Key already exists in authorized_keys${comment ? ` (${comment})` : ''}`);
      return;
    }

    // Append new key
    writeFileSync(this.authorizedKeysPath, existingKeys + keyEntry, { mode: 0o600 });
    this.logger.log(`✅ Added key to authorized_keys${comment ? ` (${comment})` : ''}`);
  }

  /**
   * Remove a public key from authorized_keys
   *
   * @param publicKey - SSH public key to remove
   */
  removeAuthorizedKey(publicKey: string): void {
    if (!existsSync(this.authorizedKeysPath)) {
      this.logger.warn('authorized_keys file does not exist');
      return;
    }

    const existingKeys = readFileSync(this.authorizedKeysPath, 'utf-8');
    const keyPart = publicKey.split(' ').slice(0, 2).join(' ');

    // Filter out the key to remove
    const updatedKeys = existingKeys
      .split('\n')
      .filter((line) => !line.includes(keyPart))
      .join('\n');

    writeFileSync(this.authorizedKeysPath, updatedKeys, { mode: 0o600 });
    this.logger.log('✅ Removed key from authorized_keys');
  }

  /**
   * Test SSH connection to a remote host
   *
   * @param host - Remote host IP/hostname
   * @param port - SSH port (default: 22)
   * @returns Promise that resolves if connection successful
   */
  async testConnection(host: string, port = 22): Promise<boolean> {
    return new Promise((resolve) => {
      const ssh = spawn('ssh', [
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'ConnectTimeout=5',
        '-o',
        'BatchMode=yes', // Disable password prompt
        '-p',
        port.toString(),
        `root@${host}`,
        'echo "SSH_OK"',
      ]);

      let stdout = '';

      ssh.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ssh.kill('SIGKILL');
        this.logger.warn(`SSH connection to ${host} timed out after 10 seconds`);
        resolve(false);
      }, 10000);

      ssh.on('close', (code) => {
        clearTimeout(timeoutId);
        ssh.stdout?.destroy();
        ssh.stderr?.destroy();

        const success = code === 0 && stdout.includes('SSH_OK');
        if (success) {
          this.logger.log(`✅ SSH connection to ${host} successful`);
        } else {
          this.logger.warn(`❌ SSH connection to ${host} failed (code: ${code})`);
        }
        resolve(success);
      });

      ssh.on('error', (error) => {
        clearTimeout(timeoutId);
        ssh.stdout?.destroy();
        ssh.stderr?.destroy();
        this.logger.error(`SSH connection error to ${host}:`, error);
        resolve(false);
      });
    });
  }

  /**
   * Copy SSH public key to remote host
   *
   * @param host - Remote host IP/hostname
   * @param publicKey - Public key to copy
   * @param port - SSH port (default: 22)
   */
  async copyKeyToRemote(host: string, publicKey: string, port = 22): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use ssh to append the key to remote authorized_keys
      const command = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;

      const ssh = spawn('ssh', [
        '-o',
        'StrictHostKeyChecking=no',
        '-p',
        port.toString(),
        `root@${host}`,
        command,
      ]);

      let stderr = '';

      ssh.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ssh.kill('SIGKILL');
        reject(new Error(`SSH key copy to ${host} timed out after 15 seconds`));
      }, 15000);

      ssh.on('close', (code) => {
        clearTimeout(timeoutId);
        ssh.stdout?.destroy();
        ssh.stderr?.destroy();

        if (code === 0) {
          this.logger.log(`✅ Copied public key to ${host}`);
          resolve();
        } else {
          this.logger.error(`Failed to copy key to ${host}: ${stderr}`);
          reject(new Error(`ssh failed with code ${code}`));
        }
      });

      ssh.on('error', (error) => {
        clearTimeout(timeoutId);
        ssh.stdout?.destroy();
        ssh.stderr?.destroy();
        this.logger.error(`Failed to connect to ${host}:`, error);
        reject(error);
      });
    });
  }
}
