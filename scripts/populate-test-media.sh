#!/bin/bash

# BitBonsai Test Media Population Script
# This script creates test media files by copying a sample video with random names
# to simulate a real media library for testing encoding workflows

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SAMPLES_DIR="$PROJECT_ROOT/test-media/samples"
MEDIA_ROOT="$PROJECT_ROOT/test-media"

# Use first available sample video in samples directory, or allow override
if [ -n "$1" ]; then
  SAMPLE_VIDEO="$1"
else
  # Find first video file in samples directory
  SAMPLE_VIDEO=$(find "$SAMPLES_DIR" -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.avi" \) 2>/dev/null | head -1)
fi
NUM_ANIME=10
NUM_ANIME_MOVIES=8
NUM_MOVIES=15
NUM_TV_SHOWS=8
NUM_TV_EPISODES_PER_SHOW=5

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Sample names
ANIME_NAMES=(
  "Attack on Titan"
  "Demon Slayer"
  "My Hero Academia"
  "One Piece"
  "Naruto Shippuden"
  "Fullmetal Alchemist"
  "Death Note"
  "Sword Art Online"
  "Tokyo Ghoul"
  "Hunter x Hunter"
  "Steins Gate"
  "Code Geass"
  "Cowboy Bebop"
  "Dragon Ball Super"
  "Jujutsu Kaisen"
)

ANIME_MOVIE_NAMES=(
  "Spirited Away"
  "Your Name"
  "Princess Mononoke"
  "Howl's Moving Castle"
  "Akira"
  "Ghost in the Shell"
  "My Neighbor Totoro"
  "Weathering with You"
  "Ponyo"
  "Castle in the Sky"
)

MOVIE_NAMES=(
  "The Matrix"
  "Inception"
  "Interstellar"
  "The Dark Knight"
  "Pulp Fiction"
  "Fight Club"
  "Forrest Gump"
  "The Shawshank Redemption"
  "Goodfellas"
  "The Godfather"
  "Gladiator"
  "Avatar"
  "Titanic"
  "The Avengers"
  "Star Wars"
  "Jurassic Park"
  "Back to the Future"
  "The Lion King"
  "Toy Story"
  "Finding Nemo"
)

TV_SHOW_NAMES=(
  "Breaking Bad"
  "Game of Thrones"
  "The Mandalorian"
  "Stranger Things"
  "The Office"
  "Friends"
  "The Crown"
  "Westworld"
  "Black Mirror"
  "Better Call Saul"
  "The Witcher"
  "House of Cards"
  "Peaky Blinders"
  "The Boys"
  "Vikings"
)

# Function to print colored output
print_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Function to clean existing test media
clean_test_media() {
  print_info "Cleaning existing test media..."

  # Remove entire directories to ensure clean reset
  rm -rf "$MEDIA_ROOT/Anime"
  rm -rf "$MEDIA_ROOT/Anime Movies"
  rm -rf "$MEDIA_ROOT/Movies"
  rm -rf "$MEDIA_ROOT/TV"

  # Remove old directories if they exist
  rm -rf "$MEDIA_ROOT/Anime Library"
  rm -rf "$MEDIA_ROOT/TV Shows"
  rm -rf "$MEDIA_ROOT/TV Shows Test"

  # Recreate directories
  mkdir -p "$MEDIA_ROOT/Anime"
  mkdir -p "$MEDIA_ROOT/Anime Movies"
  mkdir -p "$MEDIA_ROOT/Movies"
  mkdir -p "$MEDIA_ROOT/TV"

  print_success "Existing test media removed"
}

# Function to populate anime series
populate_anime() {
  print_info "Populating Anime with $NUM_ANIME items..."

  for i in $(seq 1 $NUM_ANIME); do
    anime_name="${ANIME_NAMES[$((RANDOM % ${#ANIME_NAMES[@]}))]}"
    season=$((RANDOM % 3 + 1))
    episode=$((RANDOM % 24 + 1))

    # Format: Anime Name - S01E05.mp4
    filename="$anime_name - S$(printf "%02d" $season)E$(printf "%02d" $episode).mp4"

    cp "$SAMPLE_VIDEO" "$MEDIA_ROOT/Anime/$filename"
    echo "  ✓ Created: $filename"
  done

  print_success "Anime populated"
}

# Function to populate anime movies
populate_anime_movies() {
  print_info "Populating Anime Movies with $NUM_ANIME_MOVIES items..."

  for i in $(seq 1 $NUM_ANIME_MOVIES); do
    movie_name="${ANIME_MOVIE_NAMES[$((RANDOM % ${#ANIME_MOVIE_NAMES[@]}))]}"
    year=$((RANDOM % 30 + 1990))

    # Format: Movie Name (2020).mp4
    filename="$movie_name ($year).mp4"

    cp "$SAMPLE_VIDEO" "$MEDIA_ROOT/Anime Movies/$filename"
    echo "  ✓ Created: $filename"
  done

  print_success "Anime Movies populated"
}

# Function to populate movies
populate_movies() {
  print_info "Populating Movies with $NUM_MOVIES items..."

  for i in $(seq 1 $NUM_MOVIES); do
    movie_name="${MOVIE_NAMES[$((RANDOM % ${#MOVIE_NAMES[@]}))]}"
    year=$((RANDOM % 30 + 1990))

    # Format: Movie Name (2020).mp4
    filename="$movie_name ($year).mp4"

    cp "$SAMPLE_VIDEO" "$MEDIA_ROOT/Movies/$filename"
    echo "  ✓ Created: $filename"
  done

  print_success "Movies populated"
}

# Function to populate TV shows
populate_tv_shows() {
  print_info "Populating TV with $NUM_TV_SHOWS shows..."

  for i in $(seq 1 $NUM_TV_SHOWS); do
    show_name="${TV_SHOW_NAMES[$((RANDOM % ${#TV_SHOW_NAMES[@]}))]}"
    season=$((RANDOM % 5 + 1))

    # Create show directory
    show_dir="$MEDIA_ROOT/TV/$show_name/Season $season"
    mkdir -p "$show_dir"

    # Create episodes
    for ep in $(seq 1 $NUM_TV_EPISODES_PER_SHOW); do
      # Format: Show Name - S01E05.mp4
      filename="$show_name - S$(printf "%02d" $season)E$(printf "%02d" $ep).mp4"

      cp "$SAMPLE_VIDEO" "$show_dir/$filename"
    done

    echo "  ✓ Created: $show_name (Season $season) - $NUM_TV_EPISODES_PER_SHOW episodes"
  done

  print_success "TV populated"
}

# Function to show summary
show_summary() {
  total_files=$((NUM_ANIME + NUM_ANIME_MOVIES + NUM_MOVIES + (NUM_TV_SHOWS * NUM_TV_EPISODES_PER_SHOW)))

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${GREEN}Test Media Population Complete!${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Summary:"
  echo "  📁 Media Root:    $MEDIA_ROOT"
  echo "  🎌 Anime:         $NUM_ANIME files"
  echo "  🎥 Anime Movies:  $NUM_ANIME_MOVIES files"
  echo "  🎬 Movies:        $NUM_MOVIES files"
  echo "  📺 TV:            $NUM_TV_SHOWS shows × $NUM_TV_EPISODES_PER_SHOW episodes = $((NUM_TV_SHOWS * NUM_TV_EPISODES_PER_SHOW)) files"
  echo "  📊 Total:         $total_files files"
  echo ""
  echo "Next steps:"
  echo "  1. Add these libraries in BitBonsai UI:"
  echo "     • Anime        → $MEDIA_ROOT/Anime"
  echo "     • Anime Movies → $MEDIA_ROOT/Anime Movies"
  echo "     • Movies       → $MEDIA_ROOT/Movies"
  echo "     • TV           → $MEDIA_ROOT/TV"
  echo ""
  echo "  2. Create a policy with H.265 target codec"
  echo "  3. Trigger encoding and watch the process!"
  echo ""
  echo "To reset and repopulate:"
  echo "  ./scripts/populate-test-media.sh"
  echo ""
}

# Main execution
main() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  BitBonsai Test Media Population Script"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Validate sample video exists
  if [ ! -f "$SAMPLE_VIDEO" ]; then
    echo -e "${YELLOW}Error: Sample video not found at: $SAMPLE_VIDEO${NC}"
    echo ""
    echo "Usage: $0 <sample-video-path> [media-root-path]"
    echo ""
    echo "Example:"
    echo "  $0 ~/Downloads/sample-video.mp4 ~/test-media"
    echo ""
    exit 1
  fi

  # Get sample video size
  video_size=$(du -h "$SAMPLE_VIDEO" | cut -f1)
  total_size=$(echo "$video_size * $((NUM_ANIME + NUM_MOVIES + (NUM_TV_SHOWS * NUM_TV_EPISODES_PER_SHOW)))" | bc 2>/dev/null || echo "~unknown")

  print_info "Sample Video: $SAMPLE_VIDEO ($video_size)"
  print_info "Target Path: $MEDIA_ROOT"
  print_warning "Estimated total size: ~$total_size (approx)"
  echo ""

  clean_test_media

  echo ""
  populate_anime
  echo ""
  populate_anime_movies
  echo ""
  populate_movies
  echo ""
  populate_tv_shows

  show_summary
}

# Run main
main
