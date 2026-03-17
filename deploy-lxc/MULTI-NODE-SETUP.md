# BitBonsai Multi-Node Setup Guide

This guide explains how to deploy BitBonsai in a multi-node configuration for distributed video encoding.

## Architecture

- **MAIN Node**: Central database and job queue (typically on Unraid or standalone server)
- **LINKED Nodes**: Worker nodes that process encoding jobs (LXC containers or Docker)

## Automatic Storage Sharing

BitBonsai automatically handles storage sharing between nodes:

1. **MAIN node** auto-detects Docker volume mounts and exports them as NFS shares
2. **LINKED nodes** auto-discover and auto-mount NFS shares from the MAIN node on startup
3. **No manual configuration** required - just deploy and pair!

## Deployment Options

### Option 1: LXC Containers (Proxmox)

#### New Deployment

The deployment script automatically configures NFS support:

```bash
cd deploy-lxc
./deploy-to-proxmox.sh <proxmox_host> <proxmox_ip> <container_id> <environment>

# Example:
./deploy-to-proxmox.sh pve-ai 192.168.1.5 200 prod
```

#### Existing LXC Container

If you have an existing BitBonsai LXC container that was deployed before NFS support was added:

```bash
# On your Proxmox host (e.g., ssh root@192.168.1.5)
cd /tmp
scp user@your-machine:/path/to/bitbonsai/deploy-lxc/scripts/enable-nfs-on-lxc.sh .
chmod +x enable-nfs-on-lxc.sh
./enable-nfs-on-lxc.sh <container_id>

# Example:
./enable-nfs-on-lxc.sh 200

# Then reboot the container:
pct reboot 200
```

### Option 2: Docker Containers

Docker containers inherit the host's mount capabilities, so no special configuration is needed for NFS.

#### Docker Compose for LINKED Node

```yaml
version: '3.8'

services:
  bitbonsai-linked:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai-linked
    restart: unless-stopped
    ports:
      - "3100:3100"  # Backend API
      - "4210:4210"  # Frontend UI
    environment:
      - NODE_ENV=production
      - PORT=3100
    # For Docker, you can either:
    # A) Mount NFS on host and bind-mount into container
    # B) Use Docker volume with NFS driver
    volumes:
      - ./data:/app/data  # Persistent database
    # Optional: If using Docker NFS volume
    # volumes:
    #   - type: volume
    #     source: media
    #     target: /media
    #     volume:
    #       driver: local
    #       driver_opts:
    #         type: nfs
    #         o: addr=192.168.1.100,rw,nolock,soft
    #         device: ":/mnt/user/media"

# Optional: NFS volume definition
# volumes:
#   media:
#     driver: local
#     driver_opts:
#       type: nfs
#       o: addr=192.168.1.100,rw,nolock,soft
#       device: ":/mnt/user/media"
```

## How It Works

### MAIN Node (Automatic)

On startup, the MAIN node:
1. Detects Docker volume mounts (e.g., `/mnt/user/media`)
2. Configures NFS exports for the local network
3. Creates StorageShare records in the database
4. Starts NFS server

### LINKED Node (Automatic)

On startup or after pairing, LINKED nodes:
1. Query the MAIN node's API for available NFS shares
2. Create local StorageShare records
3. Execute NFS mount commands to `/media`, `/cache`, etc.
4. Start encoding workers that can access the mounted media

## Pairing Nodes

1. Deploy MAIN node first
2. Deploy LINKED node(s)
3. In the MAIN node's web UI:
   - Navigate to **Nodes** page
   - The LINKED node will appear with a pairing token
   - Enter the 6-digit token to complete pairing
4. Storage shares are automatically mounted on the LINKED node

## Troubleshooting

### NFS Mount Fails on LXC

**Symptom**: Logs show `mount.nfs: Operation not permitted`

**Solution**: Enable NFS support on the LXC container (see "Existing LXC Container" section above)

### Storage Not Auto-Mounting

**Symptom**: LINKED node shows `No NFS shares detected`

**Solution**:
1. Check MAIN node has NFS exports: `ssh root@main-ip "cat /etc/exports"`
2. Verify NFS server is running: `ssh root@main-ip "systemctl status nfs-server"`
3. Check network connectivity: `showmount -e <main-node-ip>` from LINKED node

### Permissions Issues

**Symptom**: Can read files but not write, or "Permission denied" errors

**Solution**: Check NFS export options in `/etc/exports` on MAIN node:
- For read-write: `rw,no_root_squash`
- For read-only: `ro,all_squash`

## Security Considerations

- NFS exports are configured for the local subnet (e.g., `192.168.1.0/24`)
- For production deployments, consider:
  - Restricting exports to specific IP addresses
  - Using NFSv4 with Kerberos authentication
  - Implementing firewall rules

## Performance Tips

- Use read-only (`ro`) mounts when workers only need to read source files
- Mount temporary/cache directories as read-write (`rw`)
- For high-concurrency workloads, consider 10GbE network for NFS traffic

## Support

For issues or questions:
- GitHub Issues: https://github.com/wassimmehanna/bitbonsai/issues
- Documentation: https://github.com/wassimmehanna/bitbonsai/wiki
