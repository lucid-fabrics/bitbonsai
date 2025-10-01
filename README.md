# 🎬 MediaInsight by Lucid Fabrics

<div align="center">

### *Your Media Library's Personal Analytics Dashboard*

**Ever wondered what's really inside your video collection?**
MediaInsight is here to tell you everything.

---

</div>

## 💡 What is MediaInsight?

Imagine having a crystal-clear view of your entire media library at your fingertips. MediaInsight is a beautiful, modern web application that scans your video collection and reveals fascinating insights you never knew existed.

**Think of it as your media library's health checkup:**
- 🔍 **Know Your Codecs** - How many H.265 videos do you have? Still running old H.264 files? MediaInsight shows you the breakdown.
- 💾 **Track Your Space** - See exactly how much storage each folder is consuming and identify space-saving opportunities.
- 📊 **Beautiful Analytics** - Gorgeous charts and statistics that make understanding your library actually enjoyable.
- ⚡ **Lightning Fast** - Built with Angular 19 and modern web technologies for snappy, responsive performance.

### Why MediaInsight?

If you're running a media server (Plex, Jellyfin, Emby) or managing large video collections, you've probably asked yourself:
- *"How much of my library is encoded efficiently?"*
- *"Which folders are eating up all my storage?"*
- *"Should I re-encode my collection to save space?"*

MediaInsight answers all these questions with style. No more guessing, no more manual checking—just beautiful, actionable insights.

---

## ✨ Key Features

| Feature | What You Get |
|---------|-------------|
| 📊 **Codec Analytics** | Real-time breakdown of H.265/HEVC, H.264, AV1, and other video codecs |
| 💾 **Storage Insights** | Track library size across multiple folders with precise measurements |
| 📈 **Bitrate Intelligence** | Understand your average bitrates and encoding quality |
| 💰 **Savings Calculator** | See how much space you could save by re-encoding |
| 🔄 **Smart Scanning** | Automated library scans with configurable intervals |
| 🎨 **Beautiful UI** | Responsive, modern interface with Lucid Fabrics branding |
| ⚡ **Blazing Fast** | Built with Angular 19 + NgRx for optimal performance |
| 🔌 **NestJS API** | Powerful backend ready for media scanning integration |

## 🏗️ Project Status

### ✅ Completed
- [x] Git repository initialized at `~/git/media-insight`
- [x] Defender guidelines copied to `.claude/` and adapted with NgRx
- [x] Package.json created with Angular 19 + NgRx + NestJS dependencies
- [x] Complete Angular project structure with NgRx +state folders
- [x] Dashboard feature with Effects, Actions, Reducers, Selectors
- [x] Core architecture: Models, BOs, Clients, Services
- [x] NestJS backend API structure (ready for implementation)
- [x] Build successful (354.5 kB bundle size)
- [x] Lucid Fabrics branding applied

### 🚧 Next Steps
- [ ] Implement NestJS media scanning service (ffprobe integration)
- [ ] Add chart visualization library (Chart.js or ApexCharts)
- [ ] Implement settings feature for scan configuration
- [ ] Add real-time WebSocket updates for scan progress
- [ ] Deploy to Docker container on Unraid server

## 📁 Project Architecture

```
apps/
├── frontend/                  # Angular application
│   └── src/
│       ├── app/
│       │   ├── core/
│       │   │   ├── services/          # Core services (MediaStatsService)
│       │   │   ├── models/            # API models (.model.ts)
│       │   │   ├── business-objects/  # Business objects (.bo.ts)
│       │   │   ├── clients/           # HTTP clients (MediaStatsClient)
│       │   │   └── enums/             # TypeScript enums
│       │   ├── features/
│       │   │   └── dashboard/
│       │   │       ├── +state/        # NgRx state management
│       │   │       └── components/    # Dashboard components
│       │   └── shared/
│       │       ├── components/        # Reusable components
│       │       └── pipes/             # Shared pipes
│       ├── assets/
│       │   └── i18n/
│       │       └── en.json            # Translations
│       └── styles/                    # Global SCSS
└── backend/                   # NestJS API
    └── src/
        ├── main.ts                    # NestJS bootstrap
        ├── app.module.ts              # Root module
        └── media-stats/               # Media statistics module
            ├── media-stats.controller.ts
            ├── media-stats.service.ts
            ├── media-stats.module.ts
            └── dto/
                └── media-stats.dto.ts
```

## 🎨 Design Guidelines

### Key Differences from Defender
1. **NgRx for State Management** - Uses NgRx with +state folders (same as Defender)
2. **No Nx Monorepo** - Single standalone Angular application (not a monorepo)
3. **Effect → Service → Client → BO Architecture** - Same pattern as Defender
4. **Focus on Data Viz** - Heavy emphasis on charts and real-time updates

### Angular Best Practices (From Defender Guidelines)
- ✅ Standalone components only (no NgModules)
- ✅ Modern template syntax: `@if`, `@for`, `@switch`
- ✅ OnPush change detection everywhere
- ✅ Strict TypeScript (no `any`)
- ✅ BEM SCSS methodology
- ✅ Business Objects for data transformation
- ✅ Separate API clients from services

## 🔧 Backend API

### NestJS Backend
MediaInsight uses a NestJS backend that will:
- Scan media directories for video files
- Analyze codec distribution using ffprobe
- Provide REST API at `http://localhost:3000/api/v1`
- Support future Docker deployment on Unraid server

### API Endpoints
```
GET  /api/v1/media-stats          # Get all media statistics
POST /api/v1/media-stats/scan     # Trigger new scan
```

### Backend Structure
```
apps/backend/
├── src/
│   ├── main.ts                    # NestJS bootstrap
│   ├── app.module.ts              # Root module
│   └── media-stats/
│       ├── media-stats.controller.ts
│       ├── media-stats.service.ts
│       ├── media-stats.module.ts
│       └── dto/
│           └── media-stats.dto.ts
├── tsconfig.json
└── nest-cli.json
```

## 📝 Development Roadmap

### ✅ Phase 1: Angular Setup (COMPLETED)
1. ✅ Installed Angular CLI and dependencies with NgRx
2. ✅ Created project structure following guidelines
3. ✅ Set up routing with lazy loading
4. ✅ Configured SCSS with Lucid Fabrics theme

### ✅ Phase 2: Core Services (COMPLETED)
1. ✅ Created MediaStatsClient for API communication
2. ✅ Implemented MediaStatsBo for data transformation
3. ✅ Built MediaStatsService with business logic
4. ✅ Added NgRx state management (+state folders)
5. ✅ Implemented Effects, Actions, Reducers, Selectors

### ✅ Phase 3: Dashboard Components (COMPLETED)
1. ✅ DashboardComponent (main view with NgRx)
2. ✅ Stats overview cards (total size, files, bitrate)
3. ✅ Folder statistics display
4. ✅ Codec distribution cards
5. ✅ Scan trigger button

### 🚧 Phase 4: Backend Implementation (IN PROGRESS)
1. ✅ NestJS project structure created
2. ✅ MediaStats controller and service scaffolded
3. ⏳ Implement actual media directory scanning
4. ⏳ Integrate ffprobe for codec analysis
5. ⏳ Add file system traversal and statistics calculation

### 🔜 Phase 5: Enhancements (PLANNED)
1. Add Chart.js/ApexCharts for visualizations
2. Implement auto-refresh with configurable interval
3. Add settings page for scan configuration
4. WebSocket for real-time scan progress
5. Docker deployment to Unraid server

## 🚀 Development

### Prerequisites
- Node.js 20+ LTS
- Angular CLI 19+
- NestJS CLI 10+
- Docker (optional, for containerized development)

### Installation
```bash
cd ~/git/media-insight
npm install
```

### Development Options

MediaInsight supports two development workflows:

#### Option 1: Local Development (Mac/Linux/Windows)

**Run both frontend and backend simultaneously:**
```bash
npx nx dev
# Frontend: http://localhost:4200 (with HMR)
# Backend: http://localhost:3000/api/v1 (with auto-reload)
```

**Or run individually:**

**Frontend only:**
```bash
npx nx serve frontend
# Navigate to http://localhost:4200
# API requests proxied to http://localhost:3000
```

**Backend only:**
```bash
npx nx serve backend
# API running at http://localhost:3000/api/v1
```

#### Option 2: Docker Development (Recommended for Testing)

Run the entire stack in Docker with **Hot Module Replacement (HMR)** and live reload:

```bash
npx nx docker:dev
# Frontend: http://localhost:4200 (with HMR)
# Backend: http://localhost:3000/api/v1 (with auto-reload)
# Media path: ./test-media mounted to /media
```

**Stop Docker development:**
```bash
npx nx docker:dev:down
```

**Benefits of Docker Development:**
- ✅ Identical to production environment
- ✅ Includes ffmpeg/ffprobe for media analysis
- ✅ Test media directories pre-configured
- ✅ Full HMR support via volume mounts
- ✅ No need to install system dependencies

### Test Media

Sample videos are provided in `test-media/` directory:
- **Movies**: 2 sample files (H.264 + H.265)
- **TV**: 2 sample episodes (H.264 + H.265)
- **Anime**: 3 sample episodes (H.264 + H.265)

These are automatically mounted in Docker development mode.

### Build

**Frontend:**
```bash
npm run build
# Output: dist/apps/frontend/
```

**Backend:**
```bash
npm run build:api
# Output: dist/apps/backend/
```

## 📚 Documentation

### Code Conventions (Public)
**Located in:** `code-conventions/`

- 📖 **[Angular Guidelines](./code-conventions/angular-guidelines.md)** - Angular 19 with NgRx patterns
- 🔧 **[NestJS Guidelines](./code-conventions/nestjs-guidelines.md)** - Backend API standards
- ✅ **[Testing Guidelines](./code-conventions/testing-guidelines.md)** - Testing requirements
- 🌐 **[i18n Guidelines](./code-conventions/i18n-guidelines.md)** - Internationalization patterns
- 📝 **[Git Workflow](./code-conventions/git-commit-instructions.md)** - Commit conventions

See [Code Conventions README](./code-conventions/README.md) for detailed standards.

## 📦 Project Structure

```
media-insight/
├── code-conventions/           # Public development guidelines & standards
├── .claude/                    # Private/internal documentation
├── apps/
│   ├── frontend/               # Angular application
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── core/
│   │   │   │   │   ├── services/       # MediaStatsService
│   │   │   │   │   ├── models/         # API response models
│   │   │   │   │   ├── business-objects/  # BOs with mapping logic
│   │   │   │   │   ├── clients/        # HTTP clients
│   │   │   │   │   └── enums/          # TypeScript enums
│   │   │   │   ├── features/
│   │   │   │   │   └── dashboard/
│   │   │   │   │       ├── +state/     # NgRx (actions, effects, reducers, selectors)
│   │   │   │   │       ├── components/
│   │   │   │   │       ├── dashboard.component.ts
│   │   │   │   │       ├── dashboard.component.html
│   │   │   │   │       └── dashboard.component.scss
│   │   │   │   └── shared/
│   │   │   ├── assets/
│   │   │   │   └── i18n/              # Translation files
│   │   │   ├── styles/                # Global SCSS (Lucid Fabrics theme)
│   │   │   └── main.ts                # Angular bootstrap with NgRx providers
│   │   ├── tsconfig.app.json
│   │   └── public/
│   └── backend/                # NestJS API
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   └── media-stats/
│       │       ├── media-stats.controller.ts
│       │       ├── media-stats.service.ts
│       │       ├── media-stats.module.ts
│       │       └── dto/
│       │           └── media-stats.dto.ts
│       ├── tsconfig.json
│       └── nest-cli.json
├── dist/                       # Build output
│   └── apps/
│       ├── frontend/
│       └── backend/
├── angular.json
├── tsconfig.json
├── package.json
└── README.md
```

## 🎨 Lucid Fabrics Branding

### Color Palette
- Primary: `#667eea` → `#764ba2` (gradient)
- Success: `#10b981`
- Warning: `#f59e0b`
- Danger: `#ef4444`

### Typography
- Font Family: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`
- Headings: Bold, gradient text
- Body: Clean, readable

## 🐳 Docker Deployment

MediaInsight is fully containerized and ready for deployment to any Docker environment.

### Quick Start with Docker

```bash
# Pull from Docker Hub
docker pull lucidfabrics/media-insight:latest

# Run container
docker run -d \
  --name=media-insight \
  --restart=unless-stopped \
  -p 3000:3000 \
  -e TZ=America/New_York \
  -v /mnt/user/media:/media:ro \
  -v /mnt/user/appdata/media-insight:/app/data \
  lucidfabrics/media-insight:latest
```

Access at: `http://localhost:3000`

### Docker Compose

```bash
# Start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Unraid Installation

MediaInsight includes a ready-to-use Unraid Community Applications template:

1. Open Unraid WebUI → **Docker** tab
2. Click **Add Container**
3. Search for **MediaInsight**
4. Configure media paths
5. Click **Apply**

See [Unraid Installation Guide](./unraid/README.md) for detailed setup instructions.

### Available Docker Tags

- `latest` - Latest stable release
- `0.1.0` - Specific version
- `0.1` - Minor version (auto-updates patches)
- `0` - Major version (auto-updates minors/patches)

**Docker Hub:** https://hub.docker.com/r/lucidfabrics/media-insight

### Building Locally

```bash
# Build Docker image
npm run docker:build

# Build and push to Docker Hub
npm run docker:build-push
```

### Release Management

MediaInsight uses semantic versioning with automated release workflow:

```bash
# Patch release (0.1.0 → 0.1.1)
npm run version:patch

# Minor release (0.1.0 → 0.2.0)
npm run version:minor

# Major release (0.1.0 → 1.0.0)
npm run version:major

# Full automated release (build, tag, push Docker, commit, push Git)
./scripts/release.sh patch  # or minor/major
```

## 🤝 Contributing

Before contributing, please review our [Code Conventions](./code-conventions/README.md).

**Key Guidelines:**
- Follow [Angular Guidelines](./code-conventions/angular-guidelines.md) for frontend code
- Follow [NestJS Guidelines](./code-conventions/nestjs-guidelines.md) for backend code
- Write tests per [Testing Guidelines](./code-conventions/testing-guidelines.md)
- Use proper [Git Workflow](./code-conventions/git-commit-instructions.md)

## ☕ Support the Project

If MediaInsight helps you organize your media library, consider buying me a coffee!

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/YOUR_USERNAME)

Your support helps maintain and improve MediaInsight with new features like:
- Real-time scan progress tracking
- Advanced codec analytics
- Storage optimization recommendations
- Multi-language support

## 📄 License

Copyright © 2025 Lucid Fabrics. All rights reserved.
