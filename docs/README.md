# BitBonsai Documentation

> **Comprehensive documentation for BitBonsai - Professional media automation platform**

Welcome to the BitBonsai documentation! This guide will help you install, configure, and optimize your media encoding workflow.

---

## Quick Navigation

### Getting Started
Start here if you're new to BitBonsai:

- **[Getting Started Guide](./user/getting-started.md)** - Quick start for new users
- **[Installation Guide](./user/installation.md)** - Complete installation instructions
- **[Docker Setup](./user/docker-setup.md)** - Docker deployment guide
- **[Encoding Policies](./user/encoding-policies.md)** - Policy system explained

### Development
For developers contributing to BitBonsai:

- **[Architecture Overview](./development/architecture.md)** - System design and architecture
- **[Deployment Guide](./development/deployment.md)** - Build and deployment processes
- **[Features](./development/features/)** - Feature implementation documentation

### Releases
Platform-specific release documentation:

- **[Unraid Release Guide](./releases/unraid.md)** - Unraid Community Apps release process

---

## Documentation Structure

```
docs/
├── README.md (this file)
├── user/
│   ├── getting-started.md      # Quick start guide
│   ├── installation.md         # Installation instructions
│   ├── docker-setup.md         # Docker deployment
│   └── encoding-policies.md    # Policy configuration
├── development/
│   ├── architecture.md         # System architecture
│   ├── deployment.md           # Build and deployment
│   └── features/               # Feature documentation
│       ├── node-setup-wizard.md
│       ├── capability-flow-diagram.md
│       ├── av1-throttling.md
│       ├── encoding-preview.md
│       └── keep-original.md
└── releases/
    └── unraid.md               # Unraid release process
```

---

## Common Tasks

### First-Time Setup

1. **[Install BitBonsai](./user/installation.md)** - Choose your deployment method
2. **[Configure Libraries](./user/getting-started.md#adding-your-first-library)** - Point to your media
3. **[Create Policies](./user/encoding-policies.md)** - Define encoding rules
4. **[Start Encoding](./user/getting-started.md#starting-your-first-job)** - Begin optimization

### Adding Encoding Nodes

**Commercial tier only** - Scale your encoding capacity:

1. **[Multi-Node Setup](./user/getting-started.md#adding-child-nodes)** - Deploy worker nodes
2. **[Auto-Discovery](./user/getting-started.md#auto-discovery-setup)** - Use mDNS for easy pairing
3. **[Manual Pairing](./user/getting-started.md#manual-pairing)** - For complex networks

### Troubleshooting

- **[Docker Issues](./user/docker-setup.md#troubleshooting)** - Common Docker problems
- **[Unraid Cache Pool](./releases/unraid.md#cache-pool-configuration)** - SSD performance optimization
- **[Node Discovery](./user/getting-started.md#troubleshooting-node-discovery)** - mDNS troubleshooting

---

## Key Features

### TRUE RESUME & Auto-Heal
Never lose encoding progress again. BitBonsai's revolutionary crash recovery:

- **TRUE RESUME** - Resume from exact timestamp after crashes
- **Auto-Heal** - 4-layer defense against Docker volume mount race conditions
- **Zero manual intervention** - Jobs auto-resume after restarts

Learn more: [Architecture - Auto-Heal System](./development/architecture.md#auto-heal-system)

### Priority Queue
Dynamic job prioritization with visual indicators:

- Pin urgent jobs to the top
- Library filtering for multi-library setups
- Real-time FPS and ETA tracking

Learn more: [Getting Started - Queue Management](./user/getting-started.md#queue-management)

### Multi-Node Architecture
Scale from single node to 100+ encoding nodes:

- **Auto-discovery** via mDNS/Bonjour
- **Manual pairing** for complex networks
- **Per-node statistics** and monitoring

Learn more: [Architecture - Distributed Encoding](./development/architecture.md#distributed-encoding)

---

## Support

### Community Support (Free Tier)
- [GitHub Discussions](https://github.com/lucidfabrics/bitbonsai/discussions)
- [GitHub Issues](https://github.com/lucidfabrics/bitbonsai/issues)
- [Discord Community](https://discord.gg/lucidfabrics)

### Commercial Support
- **Starter**: Email (48h response)
- **Professional**: Email (24h response)
- **Enterprise**: Slack/Phone (4h response) + SLA

Contact: [support@lucidfabrics.com](mailto:support@lucidfabrics.com)

---

## Contributing

We welcome documentation improvements! See our [contribution guidelines](../CONTRIBUTING.md) for:

- Documentation style guide
- Pull request process
- Code conventions

---

## License

BitBonsai uses a dual-license model:

- **Free Tier**: MIT License for personal use
- **Commercial Tier**: Commercial license for businesses

[View License Details](../README.md#license)

---

<div align="center">

**Made with ❤️ by [Lucid Fabrics](https://lucidfabrics.com)**

[Main README](../README.md) • [Quick Start](./user/getting-started.md) • [Installation](./user/installation.md)

</div>
