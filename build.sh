#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# OpencodeX — WSL Build Script
#
# Cross-compiles the Windows x64 baseline binary from Linux (WSL).
# Works around virtiofs symlink limitations by building in /tmp.
#
# Usage:
#   bash build.sh                    # default: Windows x64 baseline
#   bash build.sh --target win32-x64 # specific target (avx2-capable)
#   bash build.sh --minify           # enable minification
#   bash build.sh --clean            # wipe /tmp build dir first
#   bash build.sh --help             # show help
#
# The built artifact lands in ./artifacts/
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/OpencodeX"
ARTIFACTS="$REPO_ROOT/artifacts"
TARGET="${OPENCODEX_TARGET:-win32-x64-baseline}"
MINIFY=false
CLEAN=false
START_TIME=$(date +%s)

# Determine git channel before switching to build dir (which excludes .git)
if [[ -z "${OPENCODE_CHANNEL:-}" ]]; then
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    export OPENCODE_CHANNEL="$(git branch --show-current)"
  else
    export OPENCODE_CHANNEL="main"
  fi
fi


# ---------------------------------------------------------------------------
# Colors and logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[0;2m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${BLUE}[opencodex]${NC} $*"; }
ok()    { echo -e "${GREEN}[opencodex]${NC} ✓ $*"; }
warn()  { echo -e "${YELLOW}[opencodex]${NC} ⚠ $*"; }
err()   { echo -e "${RED}[opencodex]${NC} ✗ $*" >&2; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}── $* ──${NC}"; STEP_START=$(date +%s); }

step_done() {
  local elapsed=$(( $(date +%s) - STEP_START ))
  echo -e "${DIM}   (${elapsed}s)${NC}"
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
show_help() {
  cat <<'EOF'
OpencodeX Build Script — Cross-compile from WSL to Windows

Usage: bash build.sh [OPTIONS]

Options:
  --target <target>   Build target (default: win32-x64-baseline)
                      Valid targets:
                        win32-x64           Windows x64 (AVX2)
                        win32-x64-baseline  Windows x64 (no AVX2, broadest compat)
                        win32-arm64         Windows ARM64
                        linux-x64           Linux x64
                        linux-x64-baseline  Linux x64 (no AVX2)
                        darwin-arm64        macOS Apple Silicon
                        darwin-x64          macOS Intel
  --minify            Enable minification (default: off, avoids Bun compile bugs)
  --clean             Wipe /tmp/OpencodeX build dir before starting
  --help              Show this help message

Environment:
  OPENCODEX_TARGET    Override default target (same as --target)

Examples:
  bash build.sh                                 # default Windows x64 baseline
  bash build.sh --target win32-x64 --minify     # Windows x64 with minification
  bash build.sh --clean                         # fresh build from scratch
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ -n "${2:-}" ]] || err "--target requires a value"
      TARGET="$2"; shift 2 ;;
    --minify)
      MINIFY=true; shift ;;
    --clean)
      CLEAN=true; shift ;;
    --help|-h)
      show_help ;;
    *)
      warn "Unknown option: $1"; shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Step 1: Check prerequisites
# ---------------------------------------------------------------------------
step "Checking prerequisites"

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "Required command '$1' not found. Install it with: $2"
  fi
}

check_cmd bun    "curl -fsSL https://bun.sh/install | bash"
check_cmd rsync  "sudo apt-get install -y rsync"

# Validate bun version against root package.json
EXPECTED_BUN=$(grep -oP '"bun@\K[^"]+' "$REPO_ROOT/package.json" || true)
ACTUAL_BUN=$(bun --version 2>/dev/null || echo "unknown")
if [[ -n "$EXPECTED_BUN" && "$ACTUAL_BUN" != "$EXPECTED_BUN" ]]; then
  warn "Bun version mismatch: have $ACTUAL_BUN, project expects $EXPECTED_BUN"
  warn "Run: bun upgrade --version $EXPECTED_BUN"
fi

ok "bun $ACTUAL_BUN, rsync $(rsync --version | head -1 | grep -oP '[\d.]+' | head -1)"
step_done

# ---------------------------------------------------------------------------
# Step 2: Prepare build directory in /tmp
# ---------------------------------------------------------------------------
step "Preparing build directory"

if [[ "$CLEAN" == "true" && -d "$BUILD_DIR" ]]; then
  log "Cleaning previous build dir …"
  rm -rf "$BUILD_DIR"
fi

mkdir -p "$ARTIFACTS"

RSYNC_EXCLUDES=(
  --exclude='node_modules'
  --exclude='.git'
  --exclude='dist'
  --exclude='artifacts'
  --exclude='.sbx'
  --exclude='*.zip'
  --exclude='*.tar.gz'
  --exclude='.turbo'
)

if [[ -d "$BUILD_DIR" ]]; then
  log "Syncing source → $BUILD_DIR"
  rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/" "$BUILD_DIR/"
else
  log "Copying source → $BUILD_DIR"
  rsync -a "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/" "$BUILD_DIR/"
fi

ok "Source synced to $BUILD_DIR"
step_done

# ---------------------------------------------------------------------------
# Step 3: Install dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies"

cd "$BUILD_DIR"
log "Running bun install …"
if ! bun install 2>&1; then
  warn "bun install exited non-zero — continuing anyway (some optional packages may 403)"
fi

ok "Dependencies installed"
step_done

# ---------------------------------------------------------------------------
# Step 4: Build
# ---------------------------------------------------------------------------
step "Building target: $TARGET"

cd "$BUILD_DIR/packages/opencode"

BUILD_ARGS=(
  "script/build.ts"
  "--"
  "--target" "$TARGET"
  "--skip-embed-web-ui"
)

if [[ "$MINIFY" != "true" ]]; then
  BUILD_ARGS+=("--no-minify")
fi

log "Running: bun run ${BUILD_ARGS[*]}"
if ! bun run "${BUILD_ARGS[@]}" 2>&1; then
  warn "Build script exited non-zero — checking for output anyway …"
fi

step_done

# ---------------------------------------------------------------------------
# Step 5: Locate and validate artifacts
# ---------------------------------------------------------------------------
step "Collecting artifacts"

# Map target to the directory name used by build.ts
# build.ts uses: pkg.name (opencode) + os-mapped + arch + baseline? + abi?
get_artifact_dir() {
  local t="$1"
  # Replace win32 → windows in directory name (build.ts does this)
  echo "opencode-${t/win32/windows}"
}

ARTIFACT_DIR_NAME=$(get_artifact_dir "$TARGET")
WIN_BIN="$BUILD_DIR/packages/opencode/dist/$ARTIFACT_DIR_NAME/bin/opencode"
WIN_ZIP="$BUILD_DIR/packages/opencode/dist/$ARTIFACT_DIR_NAME.zip"

# For Windows targets the binary has .exe extension
if [[ "$TARGET" == win32-* ]]; then
  WIN_BIN="${WIN_BIN}.exe"
fi

FOUND=false

if [[ -f "$WIN_BIN" ]]; then
  ok "Binary found: $WIN_BIN ($(du -sh "$WIN_BIN" | cut -f1))"

  # Validate PE header for Windows binaries
  if [[ "$TARGET" == win32-* ]]; then
    MAGIC=$(xxd -l 2 -p "$WIN_BIN" 2>/dev/null || true)
    if [[ "$MAGIC" == "4d5a" ]]; then
      ok "PE header validated (MZ magic)"
    else
      warn "Binary does not have PE header — may be corrupt (got: $MAGIC)"
    fi
  fi

  # Copy binary to artifacts
  local_name="opencodex-${TARGET/win32/windows}"
  if [[ "$TARGET" == win32-* ]]; then
    cp "$WIN_BIN" "$ARTIFACTS/${local_name}.exe"
    ok "Copied → artifacts/${local_name}.exe"
  else
    cp "$WIN_BIN" "$ARTIFACTS/${local_name}"
    ok "Copied → artifacts/${local_name}"
  fi
  FOUND=true
fi

# Also create a zip if we have the binary
if [[ "$FOUND" == "true" && "$TARGET" == win32-* ]]; then
  ZIP_NAME="opencodex-${TARGET/win32/windows}.zip"
  (cd "$BUILD_DIR/packages/opencode/dist/$ARTIFACT_DIR_NAME/bin" && zip -q "$ARTIFACTS/$ZIP_NAME" *)
  ok "Zipped → artifacts/$ZIP_NAME ($(du -sh "$ARTIFACTS/$ZIP_NAME" | cut -f1))"
elif [[ -f "$WIN_ZIP" ]]; then
  ZIP_NAME="opencodex-${TARGET/win32/windows}.zip"
  cp "$WIN_ZIP" "$ARTIFACTS/$ZIP_NAME"
  ok "Copied zip → artifacts/$ZIP_NAME"
  FOUND=true
fi

if [[ "$FOUND" != "true" ]]; then
  err "No artifact produced for target '$TARGET'. Expected binary at:\n  $WIN_BIN\n\nContents of dist/:\n$(ls -la "$BUILD_DIR/packages/opencode/dist/" 2>/dev/null || echo '  (empty or missing)')"
fi

step_done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
ELAPSED=$(( $(date +%s) - START_TIME ))
echo ""
echo -e "${GREEN}${BOLD}Build complete!${NC} (${ELAPSED}s total)"
echo -e "${DIM}Target:    ${NC}$TARGET"
echo -e "${DIM}Artifacts: ${NC}$ARTIFACTS/"
ls -lh "$ARTIFACTS/" | tail -n +2 | sed 's/^/  /'
echo ""
