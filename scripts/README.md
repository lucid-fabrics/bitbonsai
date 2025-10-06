# Test Media Population Script

This script helps you quickly populate test media libraries for development and testing of BitBonsai's encoding workflows.

## Quick Start

### 1. Get a Sample Video

Download any video file (MP4, MKV, AVI, etc.) to use as your test sample. For example:

```bash
# Download a sample video (public domain)
curl -o ~/Downloads/sample.mp4 "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
```

Or use any existing video file you have.

### 2. Run the Script

```bash
./scripts/populate-test-media.sh ~/Downloads/sample.mp4 ~/test-media
```

**Parameters:**
- **First argument:** Path to your sample video file
- **Second argument:** (Optional) Root directory for test media (default: `/Users/wassimmehanna/test-media`)

### 3. What It Creates

The script will create:

```
~/test-media/
├── Anime/
│   ├── Attack on Titan - S01E05.mp4
│   ├── Demon Slayer - S02E12.mp4
│   └── ... (10 files total)
│
├── Anime Movies/
│   ├── Spirited Away (2001).mp4
│   ├── Your Name (2016).mp4
│   └── ... (8 files total)
│
├── Movies/
│   ├── The Matrix (1999).mp4
│   ├── Inception (2010).mp4
│   └── ... (15 files total)
│
└── TV/
    ├── Breaking Bad/
    │   └── Season 1/
    │       ├── Breaking Bad - S01E01.mp4
    │       └── ... (5 episodes)
    └── ... (8 shows total)
```

**Total:** ~73 test files

## How to Use with BitBonsai

### 1. Add Libraries in UI

1. Open BitBonsai UI → **Libraries** page
2. Click **Add Library**
3. Add each folder:
   - **Anime** → `~/test-media/Anime`
   - **Anime Movies** → `~/test-media/Anime Movies`
   - **Movies** → `~/test-media/Movies`
   - **TV** → `~/test-media/TV`

### 2. Create a Policy

1. Go to **Policies** page
2. Click **Add Policy**
3. Configure:
   - **Name:** Test Encoding
   - **Preset:** Balanced HEVC
   - **Target Codec:** H.265
   - **Quality:** 23 (default)
4. Save

### 3. Trigger Encoding

1. Go to **Queue** page
2. Select your libraries
3. Click **Start Encoding**
4. Watch the process in real-time! 🎬

## Resetting Test Media

To completely reset and repopulate with fresh files:

```bash
./scripts/populate-test-media.sh ~/Downloads/sample.mp4 ~/test-media
```

The script will:
1. ✓ Clean existing test media
2. ✓ Create new files with random names
3. ✓ Show summary of what was created

## Customization

Edit the script to change:

```bash
NUM_ANIME=10                # Number of anime series files
NUM_ANIME_MOVIES=8          # Number of anime movie files
NUM_MOVIES=15               # Number of movie files
NUM_TV_SHOWS=8              # Number of TV shows
NUM_TV_EPISODES_PER_SHOW=5  # Episodes per show
```

Or add your own names to the arrays:
- `ANIME_NAMES`
- `MOVIE_NAMES`
- `TV_SHOW_NAMES`

## Tips for Testing

### Quick 5-Minute Encoding Test

Use a small video file (10-50MB) to complete encoding in ~5 minutes:

```bash
# Use a small sample
./scripts/populate-test-media.sh ~/Downloads/small-sample.mp4
```

### Longer Stress Test

Use a larger video file (500MB-1GB) for realistic encoding times:

```bash
# Use a large sample
./scripts/populate-test-media.sh ~/Downloads/large-movie.mp4
```

### Test Different Codecs

Populate with videos in different source codecs:

```bash
# H.264 source → H.265 target (most common)
./scripts/populate-test-media.sh ~/Downloads/h264-video.mp4

# Test codec detection
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 ~/Downloads/your-video.mp4
```

## Troubleshooting

### "Sample video not found"
- Ensure the video file path is correct
- Use absolute paths (e.g., `/Users/you/Downloads/video.mp4`)

### "Permission denied"
- Make sure the script is executable: `chmod +x scripts/populate-test-media.sh`
- Check write permissions for the target directory

### Files not showing in BitBonsai
- Verify library paths in BitBonsai UI match the created folders
- Check that video files are supported formats (MP4, MKV, AVI, etc.)
- Trigger a library scan if needed

## Example Workflow

```bash
# 1. Download sample video
curl -o ~/sample.mp4 "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"

# 2. Populate test media
./scripts/populate-test-media.sh ~/sample.mp4 ~/test-media

# 3. Add libraries in BitBonsai UI

# 4. Create encoding policy

# 5. Start encoding and watch!

# 6. To reset and try again:
./scripts/populate-test-media.sh ~/sample.mp4 ~/test-media
```

Enjoy testing! 🚀
