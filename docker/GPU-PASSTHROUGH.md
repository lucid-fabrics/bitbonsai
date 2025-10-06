# GPU Passthrough Configuration for BitBonsai

This guide covers hardware acceleration setup for NVIDIA, Intel, and AMD GPUs on Unraid and standard Docker environments.

## Table of Contents
- [Unraid Configuration](#unraid-configuration)
- [Docker Compose Configuration](#docker-compose-configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## Unraid Configuration

### NVIDIA GPU (NVENC)

**Prerequisites:**
- NVIDIA GPU with NVENC support (GTX 10xx series or newer)
- Unraid NVIDIA Plugin installed (`Settings > Plugins > Install Plugin`)
- NVIDIA drivers loaded (check `Tools > System Devices`)

**Unraid Template Configuration:**

1. Install BitBonsai from Community Applications or use the template XML
2. Configure the following settings:

```
Basic Settings:
├── WebUI Port: 4200
├── API Port: 3000
├── Media Library Path: /mnt/user/media
└── App Data: /mnt/user/appdata/bitbonsai

Hardware Acceleration (NVIDIA):
├── NVIDIA GPU: all                    # Or specific GPU UUID
└── Extra Parameters: --runtime=nvidia
```

**Manual Docker Command (Unraid Terminal):**
```bash
docker run -d \
  --name=bitbonsai \
  --runtime=nvidia \
  --gpus all \
  -p 4200:4200 \
  -p 3000:3000 \
  -v /mnt/user/media:/library \
  -v /mnt/user/appdata/bitbonsai:/config \
  -e PUID=99 \
  -e PGID=100 \
  -e TZ=America/New_York \
  bitbonsai/bitbonsai:latest
```

**Verify NVIDIA GPU:**
```bash
docker exec bitbonsai nvidia-smi
# Should show your GPU(s)
```

---

### Intel QuickSync (QSV)

**Prerequisites:**
- Intel CPU with integrated graphics (6th gen or newer recommended)
- `/dev/dri` device available on host
- Intel graphics drivers loaded

**Unraid Template Configuration:**

```
Basic Settings:
├── WebUI Port: 4200
├── API Port: 3000
├── Media Library Path: /mnt/user/media
└── App Data: /mnt/user/appdata/bitbonsai

Hardware Acceleration (Intel QSV):
└── Intel QuickSync (QSV): /dev/dri
```

**Manual Docker Command (Unraid Terminal):**
```bash
docker run -d \
  --name=bitbonsai \
  --device=/dev/dri:/dev/dri \
  -p 4200:4200 \
  -p 3000:3000 \
  -v /mnt/user/media:/library \
  -v /mnt/user/appdata/bitbonsai:/config \
  -e PUID=99 \
  -e PGID=100 \
  -e TZ=America/New_York \
  bitbonsai/bitbonsai:latest
```

**Verify Intel QSV:**
```bash
docker exec bitbonsai ls -la /dev/dri
# Should show renderD128, card0, etc.

docker exec bitbonsai vainfo
# Should show Intel VA-API driver info
```

---

### AMD GPU (AMF)

**Prerequisites:**
- AMD GPU with AMF support (RX 400 series or newer)
- `/dev/dri` devices available
- AMDGPU drivers loaded

**Unraid Template Configuration:**

```
Basic Settings:
├── WebUI Port: 4200
├── API Port: 3000
├── Media Library Path: /mnt/user/media
└── App Data: /mnt/user/appdata/bitbonsai

Hardware Acceleration (AMD):
├── AMD GPU (Render): /dev/dri/renderD128
└── AMD GPU (Card): /dev/dri/card0
```

**Manual Docker Command (Unraid Terminal):**
```bash
docker run -d \
  --name=bitbonsai \
  --device=/dev/dri/renderD128:/dev/dri/renderD128 \
  --device=/dev/dri/card0:/dev/dri/card0 \
  -p 4200:4200 \
  -p 3000:3000 \
  -v /mnt/user/media:/library \
  -v /mnt/user/appdata/bitbonsai:/config \
  -e PUID=99 \
  -e PGID=100 \
  -e TZ=America/New_York \
  bitbonsai/bitbonsai:latest
```

**Verify AMD GPU:**
```bash
docker exec bitbonsai ls -la /dev/dri
# Should show renderD128, card0

docker exec bitbonsai vainfo --display drm --device /dev/dri/renderD128
# Should show AMD VA-API driver info
```

---

## Docker Compose Configuration

### docker-compose.yml with GPU Support

```yaml
version: '3.8'

services:
  # NVIDIA GPU Configuration
  bitbonsai-nvidia:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    ports:
      - "4200:4200"
      - "3000:3000"
    volumes:
      - /mnt/user/media:/library
      - /mnt/user/appdata/bitbonsai:/config
      - /mnt/cache/bitbonsai-temp:/tmp/bitbonsai
    environment:
      - PUID=99
      - PGID=100
      - TZ=America/New_York
      - NODE_ENV=production
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu, video, compute, utility]

  # Intel QuickSync Configuration
  bitbonsai-intel:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    ports:
      - "4200:4200"
      - "3000:3000"
    volumes:
      - /mnt/user/media:/library
      - /mnt/user/appdata/bitbonsai:/config
    environment:
      - PUID=99
      - PGID=100
      - TZ=America/New_York
    devices:
      - /dev/dri:/dev/dri

  # AMD GPU Configuration
  bitbonsai-amd:
    image: lucidfabrics/bitbonsai:latest
    container_name: bitbonsai
    restart: unless-stopped
    ports:
      - "4200:4200"
      - "3000:3000"
    volumes:
      - /mnt/user/media:/library
      - /mnt/user/appdata/bitbonsai:/config
    environment:
      - PUID=99
      - PGID=100
      - TZ=America/New_York
    devices:
      - /dev/dri/renderD128:/dev/dri/renderD128
      - /dev/dri/card0:/dev/dri/card0
```

---

## Verification

### Check Hardware Detection in BitBonsai

1. Open BitBonsai Web UI: `http://your-server-ip:4200`
2. Navigate to **Settings > Environment**
3. Check **Hardware Acceleration** section:
   - ✅ Green checkmark = Detected and available
   - ❌ Red X = Not detected

### Test Encoding

1. Go to **Policies** page
2. Create or edit a policy
3. In **Advanced Settings**, select your GPU:
   - NVIDIA GPU (fastest)
   - Intel QuickSync (very fast)
   - AMD GPU (fast)
   - CPU Only (slower, fallback)
4. Save and run an encoding job

### Monitor GPU Usage

**NVIDIA:**
```bash
watch -n 1 nvidia-smi
```

**Intel/AMD:**
```bash
# Install intel-gpu-tools or radeontop
intel_gpu_top
# or
radeontop
```

---

## Troubleshooting

### NVIDIA GPU Not Detected

**Issue:** BitBonsai shows NVIDIA as unavailable

**Solutions:**
1. Verify NVIDIA plugin installed on Unraid:
   ```bash
   ls /usr/bin/nvidia-smi
   ```

2. Check NVIDIA runtime:
   ```bash
   docker info | grep -i runtime
   # Should show "nvidia"
   ```

3. Verify GPU visible to Docker:
   ```bash
   docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
   ```

4. Add `--runtime=nvidia` to Extra Parameters in Unraid template

---

### Intel QSV Not Detected

**Issue:** BitBonsai shows Intel QSV as unavailable

**Solutions:**
1. Check `/dev/dri` devices exist:
   ```bash
   ls -la /dev/dri
   ```

2. Verify Intel GPU vendor ID:
   ```bash
   cat /sys/class/drm/card0/device/vendor
   # Should show: 0x8086
   ```

3. Check permissions:
   ```bash
   # Add user to video/render group
   usermod -aG video,render nobody
   ```

4. Ensure device mapping in template: `/dev/dri:/dev/dri`

---

### AMD GPU Not Detected

**Issue:** BitBonsai shows AMD GPU as unavailable

**Solutions:**
1. Check render device exists:
   ```bash
   ls -la /dev/dri/renderD128
   ```

2. Verify AMD GPU vendor ID:
   ```bash
   cat /sys/class/drm/card0/device/vendor
   # Should show: 0x1002
   ```

3. Install AMDGPU drivers if needed:
   ```bash
   # On Unraid, check kernel modules
   lsmod | grep amdgpu
   ```

4. Map both devices in template:
   - `/dev/dri/renderD128:/dev/dri/renderD128`
   - `/dev/dri/card0:/dev/dri/card0`

---

### Multiple GPUs

**NVIDIA - Specific GPU:**
```bash
# Find GPU UUID
nvidia-smi -L

# Use specific GPU
--gpus '"device=GPU-xxxxx-xxxx-xxxx-xxxx"'
```

**Intel/AMD - Specific Device:**
```bash
# List all DRI devices
ls -la /dev/dri

# Use specific render device
--device=/dev/dri/renderD129:/dev/dri/renderD128
```

---

### Performance Issues

1. **Check GPU utilization is actually being used:**
   - NVIDIA: `nvidia-smi dmon`
   - Intel: `intel_gpu_top`
   - AMD: `radeontop`

2. **Verify FFmpeg is using hardware encoder:**
   ```bash
   docker exec bitbonsai ffmpeg -hide_banner -encoders | grep -E "(nvenc|qsv|amf)"
   ```

3. **Check transcoding cache on fast storage:**
   - Map `/tmp/bitbonsai` to `/mnt/cache/bitbonsai-temp` (SSD/NVMe)

4. **Increase worker threads** in BitBonsai settings

---

## Additional Resources

- [Unraid GPU Passthrough Guide](https://wiki.unraid.net/Using_GPU_for_Plex)
- [NVIDIA Docker Documentation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- [FFmpeg Hardware Acceleration](https://trac.ffmpeg.org/wiki/HWAccelIntro)
- [BitBonsai Documentation](https://docs.bitbonsai.com)

---

## Quick Reference

| GPU Type | Device Mapping | Extra Params | Encoder |
|----------|---------------|--------------|---------|
| NVIDIA   | N/A           | `--runtime=nvidia --gpus all` | `h264_nvenc`, `hevc_nvenc` |
| Intel QSV | `--device=/dev/dri:/dev/dri` | None | `h264_qsv`, `hevc_qsv` |
| AMD AMF   | `--device=/dev/dri/renderD128` `--device=/dev/dri/card0` | None | `h264_amf`, `hevc_amf` |
| CPU Only  | None | None | `libx264`, `libx265` |
