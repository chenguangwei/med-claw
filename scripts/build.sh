#!/bin/bash

# uniins-claw Build Script
# Usage: ./scripts/build.sh [platform] [--with-claude]
# Platforms: linux, windows, mac-intel, mac-arm, all
# Options:
#   --with-claude  Bundle Claude Code CLI as a sidecar (for users without Node.js environment)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global variables
BUNDLE_CLI=false  # Bundle CLI tools (Claude Code + Codex) with shared Node.js
BUILD_PLATFORM="current"
SKIP_SIGNING=true  # Default: skip signing for faster builds
WINDOWS_SIGN_CERT_DIR="$PROJECT_ROOT/certs"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    log_info "Checking requirements..."

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed. Please install it first."
        exit 1
    fi

    if ! command -v cargo &> /dev/null; then
        log_error "Rust/Cargo is not installed. Please install it first."
        exit 1
    fi

    if ! command -v rustup &> /dev/null; then
        log_error "rustup is not installed. Please install it first."
        exit 1
    fi

    log_info "All requirements satisfied."
}

# Install dependencies
install_deps() {
    log_info "Installing dependencies..."
    pnpm install
}

# Build API sidecar for a specific target (using Node.js + esbuild + pkg)
build_api_sidecar() {
    local target="$1"
    log_info "Building API sidecar for $target (Node.js)..."

    cd "$PROJECT_ROOT/src-api"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        pnpm install
    fi

    case "$target" in
        x86_64-unknown-linux-gnu)
            pnpm run build:binary:linux
            ;;
        x86_64-pc-windows-msvc)
            pnpm run build:binary:windows
            ;;
        x86_64-pc-windows-gnu)
            # Cross-compile Windows binary using pkg (same as MSVC, just different output name)
            pnpm bundle && pnpm exec pkg dist/bundle.cjs --targets node20-win-x64 --output dist/uniins-claw-api-x86_64-pc-windows-gnu.exe --options expose-gc
            ;;
        x86_64-apple-darwin)
            pnpm run build:binary:mac-intel
            ;;
        aarch64-apple-darwin)
            pnpm run build:binary:mac-arm
            ;;
        current)
            pnpm run build:binary
            ;;
        *)
            log_error "Unknown target for API sidecar: $target"
            exit 1
            ;;
    esac

    cd "$PROJECT_ROOT"
    log_info "API sidecar build completed for $target"
}

# Bundle CLI tools (Claude Code + Codex) with shared Node.js runtime
# This creates a single cli-bundle with one Node.js and both CLI packages
bundle_cli_tools() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        log_info "Skipping CLI bundling (use --with-cli to enable)"
        return 0
    fi

    log_info "Bundling CLI tools with shared Node.js for $target..."

    local output_dir="$PROJECT_ROOT/src-api/dist"
    local bundle_dir="$output_dir/cli-bundle"

    # Clean up old bundles
    rm -rf "$bundle_dir"
    rm -rf "$output_dir/claude-bundle"
    rm -rf "$output_dir/codex-bundle"
    mkdir -p "$bundle_dir"

    # Determine platform-specific settings
    local node_platform=""
    local node_arch=""
    local node_ext=""
    local npm_os=""
    local npm_cpu=""
    local npm_libc=""
    local claude_native_package=""
    local claude_native_bin=""
    local codex_native_package=""

    case "$target" in
        x86_64-unknown-linux-gnu)
            node_platform="linux"
            node_arch="x64"
            npm_os="linux"
            npm_cpu="x64"
            npm_libc="glibc"
            claude_native_package="@anthropic-ai/claude-code-linux-x64"
            claude_native_bin="claude"
            codex_native_package="@openai/codex-linux-x64"
            ;;
        x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
            node_platform="win"
            node_arch="x64"
            node_ext=".exe"
            npm_os="win32"
            npm_cpu="x64"
            claude_native_package="@anthropic-ai/claude-code-win32-x64"
            claude_native_bin="claude.exe"
            codex_native_package="@openai/codex-win32-x64"
            ;;
        x86_64-apple-darwin)
            node_platform="darwin"
            node_arch="x64"
            npm_os="darwin"
            npm_cpu="x64"
            claude_native_package="@anthropic-ai/claude-code-darwin-x64"
            claude_native_bin="claude"
            codex_native_package="@openai/codex-darwin-x64"
            ;;
        aarch64-apple-darwin)
            node_platform="darwin"
            node_arch="arm64"
            npm_os="darwin"
            npm_cpu="arm64"
            claude_native_package="@anthropic-ai/claude-code-darwin-arm64"
            claude_native_bin="claude"
            codex_native_package="@openai/codex-darwin-arm64"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    node_platform="darwin"
                    node_arch=$([ "$arch" = "arm64" ] && echo "arm64" || echo "x64")
                    npm_os="darwin"
                    npm_cpu="$node_arch"
                    claude_native_package="@anthropic-ai/claude-code-darwin-$node_arch"
                    claude_native_bin="claude"
                    codex_native_package="@openai/codex-darwin-$node_arch"
                    ;;
                Linux)
                    node_platform="linux"
                    node_arch="x64"
                    npm_os="linux"
                    npm_cpu="x64"
                    npm_libc="glibc"
                    claude_native_package="@anthropic-ai/claude-code-linux-x64"
                    claude_native_bin="claude"
                    codex_native_package="@openai/codex-linux-x64"
                    ;;
                *)
                    node_platform="linux"
                    node_arch="x64"
                    npm_os="linux"
                    npm_cpu="x64"
                    npm_libc="glibc"
                    claude_native_package="@anthropic-ai/claude-code-linux-x64"
                    claude_native_bin="claude"
                    codex_native_package="@openai/codex-linux-x64"
                    ;;
            esac
            ;;
        *)
            node_platform="linux"
            node_arch="x64"
            npm_os="linux"
            npm_cpu="x64"
            npm_libc="glibc"
            claude_native_package="@anthropic-ai/claude-code-linux-x64"
            claude_native_bin="claude"
            codex_native_package="@openai/codex-linux-x64"
            ;;
    esac

    # Node.js version - fixed for stability
    local node_version="22.2.0"
    local node_filename="node-v${node_version}-${node_platform}-${node_arch}"
    local node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.tar.gz"

    # For Windows, use .zip format
    if [ "$node_platform" = "win" ]; then
        node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.zip"
    fi

    # Cache directory for Node.js downloads
    local cache_dir="$HOME/.uniins-claw/cache"
    local cached_node="$cache_dir/${node_filename}/node${node_ext}"
    mkdir -p "$cache_dir"

    # Check if we have a cached Node.js binary
    if [ -f "$cached_node" ]; then
        log_info "Using cached Node.js v${node_version} for ${node_platform}-${node_arch}"
        cp "$cached_node" "$bundle_dir/node${node_ext}"
        chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
    else
        log_info "Downloading Node.js v${node_version} for ${node_platform}-${node_arch}..."

        local temp_dir=$(mktemp -d)
        cd "$temp_dir"

        local download_success=false

        # Try to download
        if [ "$node_platform" = "win" ]; then
            if curl -fsSL "$node_url" -o node.zip 2>/dev/null; then
                unzip -q node.zip
                cp "${node_filename}/node.exe" "$bundle_dir/node.exe"
                # Cache for future builds
                mkdir -p "$cache_dir/${node_filename}"
                cp "${node_filename}/node.exe" "$cache_dir/${node_filename}/node.exe"
                download_success=true
            fi
        else
            if curl -fsSL "$node_url" | tar xz 2>/dev/null; then
                cp "${node_filename}/bin/node" "$bundle_dir/node"
                chmod +x "$bundle_dir/node"
                # Cache for future builds
                mkdir -p "$cache_dir/${node_filename}"
                cp "${node_filename}/bin/node" "$cache_dir/${node_filename}/node"
                download_success=true
            fi
        fi

        # Fallback to local node if download fails
        if [ "$download_success" != "true" ]; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            log_info "Node.js cached at $cache_dir/${node_filename}/"
        fi

        cd "$PROJECT_ROOT"
        rm -rf "$temp_dir"
    fi

    # Note: npm is NOT bundled - Live Preview requires system Node.js/npm
    # This keeps the bundle size smaller and avoids V8 compatibility issues
    # Users without Node.js will only have Static Preview available

    # Verify Node.js binary
    if [ ! -f "$bundle_dir/node${node_ext}" ]; then
        log_error "Node.js binary not found"
        return 1
    fi

    log_info "Node.js binary ready"

    # Install both CLI packages
    cd "$bundle_dir"
    echo '{"name":"cli-bundle","private":true,"type":"module"}' > package.json

    local npm_target_args=(--os="$npm_os" --cpu="$npm_cpu")
    if [ -n "$npm_libc" ]; then
        npm_target_args+=(--libc="$npm_libc")
    fi

    log_info "Installing @anthropic-ai/claude-code and @openai/codex for ${npm_os}-${npm_cpu}${npm_libc:+-$npm_libc}..."
    npm install @anthropic-ai/claude-code @openai/codex \
        "${npm_target_args[@]}" \
        --include=optional \
        --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" 2>&1 | tail -15

    # Verify installations
    if [ ! -f "node_modules/@anthropic-ai/claude-code/package.json" ]; then
        log_error "Claude Code installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    if [ ! -f "node_modules/${claude_native_package}/${claude_native_bin}" ]; then
        log_error "Claude Code native binary missing for target: ${claude_native_package}/${claude_native_bin}"
        cd "$PROJECT_ROOT"
        return 1
    fi

    if [ ! -f "node_modules/@openai/codex/bin/codex.js" ]; then
        log_error "Codex installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    if [ ! -d "node_modules/${codex_native_package}" ]; then
        log_error "Codex native package missing for target: ${codex_native_package}"
        cd "$PROJECT_ROOT"
        return 1
    fi

    log_info "Both CLI packages installed successfully"

    # Clean up unused platform-specific vendor binaries
    # This reduces bundle size significantly (keeping only the target platform)
    log_info "Cleaning up unused platform binaries..."

    # Determine which platform dirs to keep for each package
    local codex_keep=""      # @openai/codex uses: aarch64-apple-darwin, x86_64-apple-darwin, etc.
    local claude_keep=""     # @anthropic-ai/claude-code uses: arm64-darwin, x64-darwin, etc.

    case "$target" in
        x86_64-unknown-linux-gnu)
            codex_keep="x86_64-unknown-linux-musl"
            claude_keep="x64-linux"
            ;;
        x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
            codex_keep="x86_64-pc-windows-msvc"
            claude_keep="x64-win32"
            ;;
        x86_64-apple-darwin)
            codex_keep="x86_64-apple-darwin"
            claude_keep="x64-darwin"
            ;;
        aarch64-apple-darwin)
            codex_keep="aarch64-apple-darwin"
            claude_keep="arm64-darwin"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    if [ "$arch" = "arm64" ]; then
                        codex_keep="aarch64-apple-darwin"
                        claude_keep="arm64-darwin"
                    else
                        codex_keep="x86_64-apple-darwin"
                        claude_keep="x64-darwin"
                    fi
                    ;;
                Linux)
                    codex_keep="x86_64-unknown-linux-musl"
                    claude_keep="x64-linux"
                    ;;
                *)
                    codex_keep="x86_64-unknown-linux-musl"
                    claude_keep="x64-linux"
                    ;;
            esac
            ;;
    esac

    # Clean @openai/codex vendor directory
    local codex_vendor="node_modules/@openai/codex/vendor"
    if [ -d "$codex_vendor" ] && [ -n "$codex_keep" ]; then
        log_info "Cleaning @openai/codex vendor (keeping $codex_keep)..."
        for dir in "$codex_vendor"/*; do
            local dirname=$(basename "$dir")
            if [ "$dirname" != "$codex_keep" ] && [ -d "$dir" ]; then
                rm -rf "$dir"
                log_info "  Removed codex/vendor/$dirname"
            fi
        done
    fi

    for dir in node_modules/@openai/codex-*; do
        if [ -d "$dir" ] && [ "node_modules/${codex_native_package}" != "$dir" ]; then
            rm -rf "$dir"
            log_info "  Removed $(basename "$(dirname "$dir")")/$(basename "$dir")"
        fi
    done

    for dir in node_modules/@anthropic-ai/claude-code-*; do
        if [ -d "$dir" ] && [ "node_modules/${claude_native_package}" != "$dir" ]; then
            rm -rf "$dir"
            log_info "  Removed $(basename "$(dirname "$dir")")/$(basename "$dir")"
        fi
    done

    # Clean @anthropic-ai/claude-code vendor/ripgrep directory
    local claude_rg_vendor="node_modules/@anthropic-ai/claude-code/vendor/ripgrep"
    if [ -d "$claude_rg_vendor" ] && [ -n "$claude_keep" ]; then
        log_info "Cleaning @anthropic-ai/claude-code vendor/ripgrep (keeping $claude_keep)..."
        for item in "$claude_rg_vendor"/*; do
            local itemname=$(basename "$item")
            # Keep the target platform dir and any non-directory files (like COPYING)
            if [ -d "$item" ] && [ "$itemname" != "$claude_keep" ]; then
                rm -rf "$item"
                log_info "  Removed claude-code/vendor/ripgrep/$itemname"
            fi
        done
    fi

    log_info "Platform cleanup completed"

    # Copy .wasm files to bundle root (some may be needed at runtime)
    cp node_modules/@anthropic-ai/claude-code/*.wasm . 2>/dev/null || true

    # Remove quarantine attribute from all files in cli-bundle
    # This prevents SIGTRAP errors when running binaries on macOS
    # Must be done BEFORE signing, as quarantine can cause issues even with signed binaries
    if [ "$node_platform" = "darwin" ]; then
        log_info "Removing quarantine attributes from cli-bundle..."
        xattr -r -d com.apple.quarantine . 2>/dev/null || true
        # Also remove other extended attributes that might cause issues
        xattr -r -c . 2>/dev/null || true
        log_info "Quarantine attributes removed"
    fi

    # Sign all native modules and binaries for macOS notarization
    # Apple notarization requires:
    # 1. All binaries signed with Developer ID certificate
    # 2. Secure timestamp included
    # 3. Hardened runtime enabled
    # Node.js binary needs special entitlements for JIT compilation
    if [ "$node_platform" = "darwin" ] && [ "$SKIP_SIGNING" != "true" ]; then
        log_info "Signing all Mach-O binaries for macOS notarization..."

        # Get signing identity from environment or use default
        local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"
        local entitlements_file="$PROJECT_ROOT/src-tauri/entitlements.plist"

        # Find and sign ALL Mach-O binary files (not just by extension)
        find . -type f | while read -r file; do
            if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                local filename=$(basename "$file")
                log_info "  Signing: $file"
                # Node binary needs special entitlements for JIT
                if [ "$filename" = "node" ] || [ "$filename" = "node.exe" ]; then
                    codesign --force --timestamp --options runtime \
                        --entitlements "$entitlements_file" \
                        --sign "$signing_identity" "$file" 2>&1 || {
                        log_warn "  Failed to sign $file, trying with specific identity..."
                        local identity=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
                        if [ -n "$identity" ]; then
                            codesign --force --timestamp --options runtime \
                                --entitlements "$entitlements_file" \
                                --sign "$identity" "$file"
                        fi
                    }
                else
                    codesign --force --timestamp --options runtime --sign "$signing_identity" "$file" 2>&1 || {
                        log_warn "  Failed to sign $file, trying with specific identity..."
                        local identity=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
                        if [ -n "$identity" ]; then
                            codesign --force --timestamp --options runtime --sign "$identity" "$file"
                        fi
                    }
                fi
            fi
        done

        log_info "Native module signing completed"
    fi

    cd "$PROJECT_ROOT"

    # Create launcher scripts for both CLIs
    create_cli_launcher "$output_dir" "$node_platform" "claude" "${claude_native_package}/${claude_native_bin}" "$target" "native"
    create_cli_launcher "$output_dir" "$node_platform" "codex" "@openai/codex/bin/codex.js" "$target" "node"

    # Verify
    local bundle_size=$(du -sh "$bundle_dir" 2>/dev/null | cut -f1)
    log_info "CLI bundling completed for $target"
    log_info "Bundle size: $bundle_size (shared Node.js + both CLIs)"
}

# Helper function to create launcher scripts
create_cli_launcher() {
    local output_dir="$1"
    local node_platform="$2"
    local cli_name="$3"
    local cli_path="$4"
    local target="$5"
    local launcher_kind="${6:-node}"

    local output_name="$cli_name"
    if [ "$node_platform" = "win" ]; then
        output_name="${cli_name}.exe"

        # Windows batch launcher for local/manual runs.
        cat > "$output_dir/${cli_name}.cmd" << BATCH_EOF
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "BUNDLE_DIR=%SCRIPT_DIR%cli-bundle"
if not exist "%BUNDLE_DIR%\\node.exe" set "BUNDLE_DIR=%SCRIPT_DIR%..\\Resources\\cli-bundle"
if "${launcher_kind}"=="native" (
"%BUNDLE_DIR%\\node_modules\\${cli_path}" %*
) else (
"%BUNDLE_DIR%\\node.exe" "%BUNDLE_DIR%\\node_modules\\${cli_path}" %*
)
BATCH_EOF

        if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
            log_error "x86_64-w64-mingw32-gcc is required to build Windows CLI launcher executables"
            return 1
        fi

        local c_cli_path="${cli_path//\//\\\\}"
        local launcher_source
        launcher_source="$(mktemp "${TMPDIR:-/tmp}/uniins-claw-launcher.XXXXXX.c")"
        cat > "$launcher_source" << C_EOF
#include <process.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <windows.h>

#define CLI_REL_PATH L"$c_cli_path"
#define LAUNCHER_KIND L"$launcher_kind"

static int file_exists(const wchar_t *path) {
    DWORD attrs = GetFileAttributesW(path);
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static void dirname_in_place(wchar_t *path) {
    wchar_t *slash = wcsrchr(path, L'\\\\');
    if (slash) {
        *slash = L'\\0';
    }
}

int wmain(int argc, wchar_t **argv) {
    wchar_t exe_path[32768];
    wchar_t script_dir[32768];
    wchar_t bundle_dir[32768];
    wchar_t node_path[32768];
    wchar_t cli_path[32768];
    wchar_t **child_argv;
    int arg_offset;
    int result;

    if (!GetModuleFileNameW(NULL, exe_path, 32768)) {
        fwprintf(stderr, L"Error: unable to locate launcher executable\\n");
        return 1;
    }

    wcscpy(script_dir, exe_path);
    dirname_in_place(script_dir);

    swprintf(bundle_dir, 32768, L"%ls\\\\cli-bundle", script_dir);
    swprintf(node_path, 32768, L"%ls\\\\node.exe", bundle_dir);
    if (!file_exists(node_path)) {
        swprintf(bundle_dir, 32768, L"%ls\\\\..\\\\Resources\\\\cli-bundle", script_dir);
        swprintf(node_path, 32768, L"%ls\\\\node.exe", bundle_dir);
    }

    if (!file_exists(node_path)) {
        fwprintf(stderr, L"Error: cli-bundle node.exe not found\\n");
        return 1;
    }

    swprintf(cli_path, 32768, L"%ls\\\\node_modules\\\\%ls", bundle_dir, CLI_REL_PATH);
    if (!file_exists(cli_path)) {
        fwprintf(stderr, L"Error: CLI target not found: %ls\\n", cli_path);
        return 1;
    }

    if (wcscmp(LAUNCHER_KIND, L"native") == 0) {
        child_argv = calloc((size_t)argc + 1, sizeof(wchar_t *));
        if (!child_argv) return 1;
        child_argv[0] = cli_path;
        for (int i = 1; i < argc; i++) {
            child_argv[i] = argv[i];
        }
        child_argv[argc] = NULL;
        result = _wspawnv(_P_WAIT, cli_path, (const wchar_t * const *)child_argv);
    } else {
        child_argv = calloc((size_t)argc + 2, sizeof(wchar_t *));
        if (!child_argv) return 1;
        child_argv[0] = node_path;
        child_argv[1] = cli_path;
        arg_offset = 2;
        for (int i = 1; i < argc; i++) {
            child_argv[arg_offset++] = argv[i];
        }
        child_argv[arg_offset] = NULL;
        result = _wspawnv(_P_WAIT, node_path, (const wchar_t * const *)child_argv);
    }

    free(child_argv);
    if (result == -1) {
        fwprintf(stderr, L"Error: failed to launch CLI\\n");
        return 1;
    }
    return result;
}
C_EOF
        x86_64-w64-mingw32-gcc -municode "$launcher_source" -o "$output_dir/$output_name"
        rm -f "$launcher_source"
    else
        # Unix shell launcher - searches multiple locations for bundle
        cat > "$output_dir/$output_name" << SHELL_EOF
#!/bin/bash
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

# Search for cli-bundle in multiple locations
# 1. Same directory as launcher (development / Linux)
# 2. ../Resources/_up_/src-api/dist/cli-bundle (macOS app bundle - Tauri resources)
# 3. ../Resources/cli-bundle (legacy location)
for DIR in "\$SCRIPT_DIR/cli-bundle" "\$SCRIPT_DIR/../Resources/_up_/src-api/dist/cli-bundle" "\$SCRIPT_DIR/../Resources/cli-bundle"; do
    if [ -f "\$DIR/node" ] && [ -d "\$DIR/node_modules" ]; then
        BUNDLE_DIR="\$DIR"
        break
    fi
done

if [ -z "\$BUNDLE_DIR" ]; then
    echo "Error: cli-bundle not found" >&2
    echo "Searched in:" >&2
    echo "  - \$SCRIPT_DIR/cli-bundle" >&2
    echo "  - \$SCRIPT_DIR/../Resources/_up_/src-api/dist/cli-bundle" >&2
    exit 1
fi

if [ "${launcher_kind}" = "native" ]; then
    exec "\$BUNDLE_DIR/node_modules/${cli_path}" "\$@"
else
    exec "\$BUNDLE_DIR/node" "\$BUNDLE_DIR/node_modules/${cli_path}" "\$@"
fi
SHELL_EOF
        chmod +x "$output_dir/$output_name"
    fi

    # Create target-specific launcher (Tauri adds target triple suffix to externalBin)
    local target_suffix=""
    case "$target" in
        x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc|x86_64-pc-windows-gnu|x86_64-apple-darwin|aarch64-apple-darwin)
            target_suffix="-$target"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    target_suffix=$([ "$arch" = "arm64" ] && echo "-aarch64-apple-darwin" || echo "-x86_64-apple-darwin")
                    ;;
                Linux)
                    target_suffix="-x86_64-unknown-linux-gnu"
                    ;;
            esac
            ;;
    esac

    if [ -n "$target_suffix" ]; then
        local target_launcher="$output_dir/${cli_name}${target_suffix}"
        if [ "$node_platform" = "win" ]; then
            target_launcher="$output_dir/${cli_name}${target_suffix}.exe"
        fi
        cp "$output_dir/$output_name" "$target_launcher"
        chmod +x "$target_launcher" 2>/dev/null || true
        log_info "Created launcher: $target_launcher"
    fi
}

# Update tauri.conf.json to include or remove CLI bundle sidecar
update_tauri_config() {
    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Updating tauri.conf.json to include CLI bundle sidecar..."

        # Use node to properly update JSON config
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Ensure arrays exist
if (!config.bundle.externalBin) {
    config.bundle.externalBin = [];
}
if (!config.bundle.resources) {
    config.bundle.resources = [];
}

// Add unified CLI bundle (both Claude and Codex share one Node.js)
// Add launcher scripts for both CLIs
if (!config.bundle.externalBin.includes('../src-api/dist/claude')) {
    config.bundle.externalBin.unshift('../src-api/dist/claude');
}
if (!config.bundle.externalBin.includes('../src-api/dist/codex')) {
    config.bundle.externalBin.unshift('../src-api/dist/codex');
}

// Add cli-bundle as resource (contains shared Node.js + both CLI packages)
const cliResource = '../src-api/dist/cli-bundle/**/*';
if (!config.bundle.resources.includes(cliResource)) {
    // Remove old separate bundle resources
    config.bundle.resources = config.bundle.resources.filter(r =>
        !r.includes('claude-bundle') && !r.includes('codex-bundle')
    );
    config.bundle.resources.push(cliResource);
}
console.log('Added unified CLI bundle config');

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2) + '\n');
console.log('Config updated successfully');
"
        log_info "Updated tauri.conf.json with unified CLI bundle configuration"
    else
        log_info "Removing CLI bundle config from tauri.conf.json (not using --with-cli)..."

        # Remove CLI-related config when not bundling
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Remove claude and codex from externalBin
if (config.bundle.externalBin) {
    config.bundle.externalBin = config.bundle.externalBin.filter(bin =>
        !bin.includes('claude') && !bin.includes('codex')
    );
}

// Remove cli-bundle from resources
if (config.bundle.resources) {
    config.bundle.resources = config.bundle.resources.filter(r =>
        !r.includes('cli-bundle') && !r.includes('claude-bundle') && !r.includes('codex-bundle')
    );
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2) + '\n');
console.log('Removed CLI bundle config');
"
        log_info "Removed CLI bundle config from tauri.conf.json"
    fi
}

clean_stale_cli_artifacts() {
    local target="$1"
    local release_dir="$PROJECT_ROOT/src-tauri/target/$target/release"

    if [ "$BUNDLE_CLI" = "true" ] || [ ! -d "$release_dir" ]; then
        return 0
    fi

    log_info "Cleaning stale CLI bundle artifacts from $release_dir..."
    rm -rf \
        "$release_dir/uniins-claw-windows-x64" \
        "$release_dir/_up_/src-api/dist/cli-bundle" \
        "$release_dir/cli-bundle" \
        "$release_dir/claude" \
        "$release_dir/claude.exe" \
        "$release_dir/claude.cmd" \
        "$release_dir/codex" \
        "$release_dir/codex.exe" \
        "$release_dir/codex.cmd"
}

ensure_windows_signing_tool() {
    if command -v osslsigncode &> /dev/null; then
        return 0
    fi

    log_error "osslsigncode is required for Windows Authenticode signing from macOS/Linux."
    log_info "Install it with: brew install osslsigncode"
    log_info "Then rerun: pnpm build:app:windows -- --sign"
    exit 1
}

ensure_windows_signing_cert() {
    WINDOWS_SIGN_CERT_PFX="${WINDOWS_SIGN_CERT_PFX:-$WINDOWS_SIGN_CERT_DIR/windows-selfsigned.pfx}"
    WINDOWS_SIGN_CERT_PASSWORD_FILE="${WINDOWS_SIGN_CERT_PASSWORD_FILE:-$WINDOWS_SIGN_CERT_DIR/windows-selfsigned.password}"
    WINDOWS_SIGN_CERT_CRT="${WINDOWS_SIGN_CERT_CRT:-$WINDOWS_SIGN_CERT_DIR/windows-selfsigned.crt}"

    if [ -n "${WINDOWS_SIGN_CERT_PASSWORD:-}" ] && [ -f "$WINDOWS_SIGN_CERT_PFX" ]; then
        return 0
    fi

    mkdir -p "$WINDOWS_SIGN_CERT_DIR"

    if [ -z "${WINDOWS_SIGN_CERT_PASSWORD:-}" ]; then
        if [ -f "$WINDOWS_SIGN_CERT_PASSWORD_FILE" ]; then
            WINDOWS_SIGN_CERT_PASSWORD="$(cat "$WINDOWS_SIGN_CERT_PASSWORD_FILE")"
        else
            WINDOWS_SIGN_CERT_PASSWORD="$(openssl rand -hex 24)"
            printf '%s' "$WINDOWS_SIGN_CERT_PASSWORD" > "$WINDOWS_SIGN_CERT_PASSWORD_FILE"
            chmod 600 "$WINDOWS_SIGN_CERT_PASSWORD_FILE"
        fi
    fi

    if [ -f "$WINDOWS_SIGN_CERT_PFX" ]; then
        return 0
    fi

    log_warn "No Windows signing certificate found. Creating a local self-signed certificate."
    log_warn "Self-signed certificates are useful for internal builds, but Windows will not trust them unless the certificate is installed on the target machine."

    local key_file="$WINDOWS_SIGN_CERT_DIR/windows-selfsigned.key"
    local subject="${WINDOWS_SIGN_SUBJECT:-/CN=uniins-claw Self-Signed Code Signing/O=uniins-claw}"

    openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
        -subj "$subject" \
        -addext "extendedKeyUsage=codeSigning" \
        -keyout "$key_file" \
        -out "$WINDOWS_SIGN_CERT_CRT"

    openssl pkcs12 -export \
        -inkey "$key_file" \
        -in "$WINDOWS_SIGN_CERT_CRT" \
        -out "$WINDOWS_SIGN_CERT_PFX" \
        -name "uniins-claw Self-Signed Code Signing" \
        -passout "pass:$WINDOWS_SIGN_CERT_PASSWORD"

    rm -f "$key_file"
    chmod 600 "$WINDOWS_SIGN_CERT_PFX" "$WINDOWS_SIGN_CERT_CRT"
    log_info "Created self-signed Windows certificate: $WINDOWS_SIGN_CERT_PFX"
}

sign_windows_file() {
    local file="$1"
    local signed_file="$file.signed"
    local app_name="${WINDOWS_SIGN_APP_NAME:-uniins-claw}"
    local app_url="${WINDOWS_SIGN_APP_URL:-https://uniins-claw.ai}"
    local timestamp_url="${WINDOWS_SIGN_TIMESTAMP_URL:-}"

    if [ ! -f "$file" ]; then
        return 0
    fi

    if ! file "$file" 2>/dev/null | grep -q "PE32"; then
        log_warn "Skipping non-PE .exe file: $file"
        return 0
    fi

    log_info "Signing Windows binary: $file"

    local args=(
        sign
        -pkcs12 "$WINDOWS_SIGN_CERT_PFX"
        -pass "$WINDOWS_SIGN_CERT_PASSWORD"
        -n "$app_name"
        -i "$app_url"
        -h sha256
    )

    if [ -n "$timestamp_url" ]; then
        args+=(-t "$timestamp_url")
    fi

    args+=(-in "$file" -out "$signed_file")

    osslsigncode "${args[@]}"
    mv "$signed_file" "$file"
}

sign_windows_release() {
    local target="$1"
    local release_dir="$PROJECT_ROOT/src-tauri/target/$target/release"

    if [ "$SKIP_SIGNING" = "true" ]; then
        return 0
    fi

    if [[ "$target" != *windows* ]]; then
        return 0
    fi

    ensure_windows_signing_tool
    ensure_windows_signing_cert

    log_info "Signing Windows release artifacts..."
    sign_windows_file "$release_dir/uniins-claw.exe"
    sign_windows_file "$release_dir/uniins-claw-api.exe"

    if [ "$BUNDLE_CLI" = "true" ]; then
        sign_windows_file "$release_dir/claude.exe"
        sign_windows_file "$release_dir/codex.exe"
        if [ -d "$release_dir/_up_/src-api/dist/cli-bundle" ]; then
            while IFS= read -r -d '' exe_file; do
                sign_windows_file "$exe_file"
            done < <(find "$release_dir/_up_/src-api/dist/cli-bundle" -type f -name '*.exe' -print0)
        fi
    fi

    log_info "Windows signing completed."
}

prepare_windows_portable_dir() {
    local target="$1"
    local release_dir="$PROJECT_ROOT/src-tauri/target/$target/release"
    local portable_dir="$release_dir/uniins-claw-windows-x64"
    local app_exe="$release_dir/uniins-claw.exe"

    if [[ "$target" != *windows* ]]; then
        return 0
    fi

    if [ ! -f "$app_exe" ]; then
        log_warn "Windows app executable not found at $app_exe; skipping portable directory"
        return 0
    fi

    log_info "Preparing Windows portable directory..."
    rm -rf "$portable_dir"
    mkdir -p "$portable_dir"

    cp "$app_exe" "$portable_dir/"
    cp "$release_dir/uniins-claw-api.exe" "$portable_dir/" 2>/dev/null || true
    cp "$release_dir/WebView2Loader.dll" "$portable_dir/" 2>/dev/null || {
        log_warn "WebView2Loader.dll not found in $release_dir"
    }

    if [ "$BUNDLE_CLI" = "true" ]; then
        cp "$release_dir/claude.exe" "$portable_dir/" 2>/dev/null || true
        cp "$release_dir/codex.exe" "$portable_dir/" 2>/dev/null || true
        if [ -d "$release_dir/_up_" ]; then
            cp -R "$release_dir/_up_" "$portable_dir/"
        fi
    fi

    log_info "Windows portable output: $portable_dir"
}

ensure_windows_installer_tool() {
    if command -v makensis &> /dev/null; then
        return 0
    fi

    log_error "makensis is required to build a Windows installer from macOS/Linux."
    log_info "Install it with: brew install nsis"
    exit 1
}

build_windows_installer() {
    local target="$1"
    local release_dir="$PROJECT_ROOT/src-tauri/target/$target/release"
    local portable_dir="$release_dir/uniins-claw-windows-x64"
    local version
    version="$(get_app_version)"
    local installer_path="$release_dir/uniins-claw_${version}_x64-setup.exe"
    local nsis_script="$release_dir/uniins-claw-installer.nsi"
    local installer_icon="$PROJECT_ROOT/src-tauri/icons/icon.ico"
    local license_file="$PROJECT_ROOT/LICENSE"

    if [[ "$target" != *windows* ]]; then
        return 0
    fi

    if [ ! -d "$portable_dir" ]; then
        log_warn "Portable directory not found at $portable_dir; skipping installer"
        return 0
    fi

    ensure_windows_installer_tool

    log_info "Building Windows installer..."
    cat > "$nsis_script" << NSIS_EOF
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
!include MUI2.nsh

Name "uniins-claw"
OutFile "$installer_path"
Icon "$installer_icon"
UninstallIcon "$installer_icon"
InstallDir "\$LOCALAPPDATA\\Programs\\uniins-claw"
InstallDirRegKey HKCU "Software\\uniins-claw" "InstallDir"
BrandingText "uniins-claw Work Assistant"
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING
!define MUI_ICON "$installer_icon"
!define MUI_UNICON "$installer_icon"
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 uniins-claw"
!define MUI_WELCOMEPAGE_TEXT "uniins-claw 是面向本地工作的智能助手桌面应用。安装向导将复制应用文件、创建快捷方式，并注册卸载信息。\$\r\$\n\$\r\$\n建议在安装前关闭正在运行的 uniins-claw。"
!define MUI_COMPONENTSPAGE_TEXT_TOP "选择要安装的组件。应用核心文件为必选，快捷方式可按需创建。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择 uniins-claw 的安装目录。默认安装到当前用户目录，无需管理员权限。"
!define MUI_FINISHPAGE_RUN "\$INSTDIR\\uniins-claw.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 uniins-claw"
!define MUI_FINISHPAGE_TITLE "uniins-claw 安装完成"
!define MUI_FINISHPAGE_TEXT "uniins-claw 已安装到你的电脑。你可以从开始菜单、桌面快捷方式或安装目录启动应用。"
!define MUI_FINISHPAGE_NOAUTOCLOSE

VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "uniins-claw"
VIAddVersionKey "CompanyName" "uniins-claw"
VIAddVersionKey "FileDescription" "uniins-claw Installer"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "ProductVersion" "${version}"
VIAddVersionKey "LegalCopyright" "Copyright © uniins-claw contributors"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "$license_file"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "!uniins-claw 应用程序" SEC_APP
  SectionIn RO
  SetOutPath "\$INSTDIR"
  File /r "$portable_dir/*"

  WriteUninstaller "\$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\uniins-claw" "InstallDir" "\$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "DisplayName" "uniins-claw"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "Publisher" "uniins-claw"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "InstallLocation" "\$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "UninstallString" '"\$INSTDIR\\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw" "NoRepair" 1
SectionEnd

Section "开始菜单快捷方式" SEC_STARTMENU
  CreateDirectory "\$SMPROGRAMS\\uniins-claw"
  CreateShortCut "\$SMPROGRAMS\\uniins-claw\\uniins-claw.lnk" "\$INSTDIR\\uniins-claw.exe"
  CreateShortCut "\$SMPROGRAMS\\uniins-claw\\Uninstall uniins-claw.lnk" "\$INSTDIR\\Uninstall.exe"
SectionEnd

Section "桌面快捷方式" SEC_DESKTOP
  CreateShortCut "\$DESKTOP\\uniins-claw.lnk" "\$INSTDIR\\uniins-claw.exe"
SectionEnd

LangString DESC_SEC_APP \${LANG_SIMPCHINESE} "安装 uniins-claw 主程序、本地 API 和运行所需资源。"
LangString DESC_SEC_STARTMENU \${LANG_SIMPCHINESE} "在开始菜单中创建 uniins-claw 和卸载入口。"
LangString DESC_SEC_DESKTOP \${LANG_SIMPCHINESE} "在桌面创建 uniins-claw 快捷方式。"
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT \${SEC_APP} \$(DESC_SEC_APP)
  !insertmacro MUI_DESCRIPTION_TEXT \${SEC_STARTMENU} \$(DESC_SEC_STARTMENU)
  !insertmacro MUI_DESCRIPTION_TEXT \${SEC_DESKTOP} \$(DESC_SEC_DESKTOP)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  Delete "\$DESKTOP\\uniins-claw.lnk"
  Delete "\$SMPROGRAMS\\uniins-claw\\uniins-claw.lnk"
  Delete "\$SMPROGRAMS\\uniins-claw\\Uninstall uniins-claw.lnk"
  RMDir "\$SMPROGRAMS\\uniins-claw"

  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\uniins-claw"
  DeleteRegKey HKCU "Software\\uniins-claw"

  RMDir /r "\$INSTDIR"
SectionEnd
NSIS_EOF

    makensis "$nsis_script"

    if [ "$SKIP_SIGNING" != "true" ]; then
        sign_windows_file "$installer_path"
    fi

    log_info "Windows installer output: $installer_path"
}

# Update tauri.conf.json to disable signing
disable_signing_config() {
    if [ "$SKIP_SIGNING" != "true" ]; then
        return 0
    fi

    log_info "Disabling code signing in tauri.conf.json..."

    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    # Use node to remove signing config
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Remove macOS signing identity to disable signing
if (config.bundle && config.bundle.macOS) {
    delete config.bundle.macOS.signingIdentity;
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2) + '\n');
console.log('Signing disabled in config');
"
}

# Get version from tauri.conf.json
get_app_version() {
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$PROJECT_ROOT/src-tauri/tauri.conf.json', 'utf8'));
console.log(config.version || '0.0.0');
"
}

# Build for Linux (x86_64)
build_linux() {
    log_info "Building for Linux x86_64..."

    local target="x86_64-unknown-linux-gnu"
    local current_os=$(uname -s)

    # Check if we're on macOS trying to cross-compile for Linux
    if [ "$current_os" = "Darwin" ]; then
        log_error "Cross-compiling Linux Tauri apps from macOS is not supported."
        log_error "Tauri requires GTK libraries (pango, cairo, atk, etc.) which need a Linux sysroot."
        log_info ""
        log_info "Recommended solutions:"
        log_info "  1. Use GitHub Actions (already configured in .github/workflows/build.yml)"
        log_info "     - Push a tag: git tag v0.x.x && git push --tags"
        log_info "     - Or manually trigger the workflow from GitHub Actions page"
        log_info ""
        log_info "  2. Use Docker with a Linux image:"
        log_info "     docker run --rm -v \"\$(pwd)\":/app -w /app rust:latest bash -c \\"
        log_info "       'apt-get update && apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf nodejs npm && npm i -g pnpm && ./scripts/build.sh linux'"
        log_info ""
        log_info "  3. Build on a real Linux machine or VM"
        exit 1
    fi

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config
    clean_stale_cli_artifacts "$target"

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Config restore removed - no longer needed

    log_info "Linux build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for Windows (x86_64)
build_windows() {
    log_info "Building for Windows x86_64..."

    local current_os=$(uname -s)
    local target=""

    # Determine target based on current platform
    if [ "$current_os" = "Darwin" ] || [ "$current_os" = "Linux" ]; then
        # Cross-compiling from macOS/Linux - use GNU toolchain
        target="x86_64-pc-windows-gnu"
        log_info "Cross-compiling from $current_os using GNU toolchain"

        # Check for MinGW
        if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
            log_error "MinGW is required for cross-compilation to Windows"
            log_info "Install with: brew install mingw-w64 (macOS) or apt install mingw-w64 (Linux)"
            exit 1
        fi
    else
        # Building on Windows - use MSVC
        target="x86_64-pc-windows-msvc"
    fi

    # Build API sidecar first (pkg can cross-compile)
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config
    clean_stale_cli_artifacts "$target"

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    # Set up linker for cross-compilation
    if [ "$target" = "x86_64-pc-windows-gnu" ]; then
        export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="x86_64-w64-mingw32-gcc"
        # Skip NSIS/MSI bundling when cross-compiling (requires network/Windows tools)
        log_info "Cross-compiling: skipping installer bundling (NSIS/MSI), generating exe only..."
        pnpm tauri build --target "$target" --no-bundle
    else
        pnpm tauri build --target "$target"
    fi

    sign_windows_release "$target"
    prepare_windows_portable_dir "$target"
    build_windows_installer "$target"

    log_info "Windows build completed!"
    if [ "$target" = "x86_64-pc-windows-gnu" ]; then
        log_info "Output: src-tauri/target/$target/release/uniins-claw.exe"
        log_info "Portable output: src-tauri/target/$target/release/uniins-claw-windows-x64/"
        log_info "Installer output: src-tauri/target/$target/release/uniins-claw_$(get_app_version)_x64-setup.exe"
        log_info "Note: NSIS installer is generated locally; MSI still requires a native Windows build environment"
    else
        log_info "Output: src-tauri/target/$target/release/bundle/"
    fi
}

# Build for macOS Intel (x86_64)
build_mac_intel() {
    log_info "Building for macOS Intel (x86_64)..."

    local target="x86_64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    # IMPORTANT: When signing is enabled, we must disable Tauri's built-in notarization
    # because Resources/cli-bundle binaries need to be signed AFTER Tauri copies them.
    if [ "$SKIP_SIGNING" != "true" ] && [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Disabling Tauri notarization (will notarize manually after signing cli-bundle)..."
        TAURI_SKIP_NOTARIZATION=true pnpm tauri build --target "$target"
    else
        pnpm tauri build --target "$target"
    fi

    # Sign cli-bundle in app bundle Resources (after Tauri build)
    sign_cli_bundle_in_app "$target"

    # Notarize the app (after all binaries are signed)
    notarize_app "$target"

    # Recreate DMG with bundle included
    recreate_dmg "$target"

    log_info "macOS Intel build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Sign cli-bundle in Resources and re-sign app bundle (unified bundle with both Claude and Codex)
# Note: Tauri copies cli-bundle to Contents/Resources/_up_/src-api/dist/cli-bundle via resources config
# We do NOT copy to Contents/MacOS as that causes signing failures due to symlinks in node_modules/.bin
sign_cli_bundle_in_app() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        return 0
    fi

    if [ "$SKIP_SIGNING" = "true" ]; then
        log_info "Skipping cli-bundle signing (signing disabled)"
        return 0
    fi

    log_info "Signing cli-bundle in app bundle Resources..."

    local app_bundle=""
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin)
            app_bundle="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/uniins-claw.app"
            ;;
        current)
            local arch=$(uname -m)
            if [ "$arch" = "arm64" ]; then
                app_bundle="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/uniins-claw.app"
            else
                app_bundle="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/uniins-claw.app"
            fi
            ;;
        *)
            log_warn "Platform $target may not need signing"
            return 0
            ;;
    esac

    if [ ! -d "$app_bundle" ]; then
        log_warn "App bundle not found at $app_bundle"
        return 0
    fi

    local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"
    local entitlements="$PROJECT_ROOT/src-tauri/entitlements.plist"

    # Find cli-bundle in Resources (Tauri copies to _up_/src-api/dist/cli-bundle)
    local cli_bundle_path="$app_bundle/Contents/Resources/_up_/src-api/dist/cli-bundle"

    if [ -d "$cli_bundle_path" ]; then
        log_info "  Found cli-bundle at: $cli_bundle_path"

        # Remove quarantine and extended attributes first
        # This prevents SIGTRAP errors even after signing
        log_info "  Removing quarantine attributes..."
        xattr -r -d com.apple.quarantine "$cli_bundle_path" 2>/dev/null || true
        xattr -r -c "$cli_bundle_path" 2>/dev/null || true

        # Remove symlinks in .bin directory that cause signing failures
        local bin_dir="$cli_bundle_path/node_modules/.bin"
        if [ -d "$bin_dir" ]; then
            log_info "  Removing .bin symlinks that cause signing issues..."
            rm -rf "$bin_dir"
        fi

        # Sign all Mach-O binaries in cli-bundle with entitlements
        # Node.js requires JIT and unsigned memory entitlements to run properly
        log_info "  Signing cli-bundle Mach-O binaries with entitlements..."
        find "$cli_bundle_path" -type f | while read -r file; do
            if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                local filename=$(basename "$file")
                log_info "    Signing: $filename"
                # Node binary needs special entitlements for JIT
                if [ "$filename" = "node" ] || [ "$filename" = "node.exe" ]; then
                    codesign --force --timestamp --options runtime \
                        --entitlements "$entitlements" \
                        --sign "$signing_identity" "$file" 2>&1 || true
                else
                    codesign --force --timestamp --options runtime \
                        --sign "$signing_identity" "$file" 2>&1 || true
                fi
            fi
        done
    else
        log_warn "  cli-bundle not found at expected location: $cli_bundle_path"
    fi

    # Re-sign the entire app bundle with entitlements
    log_info "  Re-signing entire app bundle..."
    codesign --force --deep --timestamp --options runtime \
        --entitlements "$entitlements" \
        --sign "$signing_identity" "$app_bundle"

    # Verify signature
    if codesign --verify --deep --strict "$app_bundle" 2>&1; then
        log_info "App bundle signature verified successfully"
    else
        log_warn "App bundle signature verification had warnings (may still work)"
    fi
}

# Notarize the app bundle (after all signing is complete)
notarize_app() {
    local target="$1"

    if [ "$SKIP_SIGNING" = "true" ]; then
        return 0
    fi

    if [ "$BUNDLE_CLI" != "true" ]; then
        # If no cli-bundle, Tauri already handled notarization
        return 0
    fi

    log_info "Notarizing app bundle..."

    local app_path=""
    case "$target" in
        aarch64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/uniins-claw.app"
            ;;
        x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/uniins-claw.app"
            ;;
        current)
            local arch=$(uname -m)
            if [ "$arch" = "arm64" ]; then
                app_path="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/uniins-claw.app"
            else
                app_path="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/uniins-claw.app"
            fi
            ;;
        *)
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Create a zip for notarization
    local temp_zip=$(mktemp).zip
    log_info "Creating zip for notarization..."
    ditto -c -k --keepParent "$app_path" "$temp_zip"

    # Submit for notarization
    local notarize_output
    if [ -n "$APPLE_ID" ] && [ -n "$APPLE_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
        log_info "Submitting to Apple notary service (this may take a few minutes)..."
        notarize_output=$(xcrun notarytool submit "$temp_zip" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_PASSWORD" \
            --team-id "$APPLE_TEAM_ID" \
            --wait 2>&1) || true
    else
        # Try keychain profile as fallback
        log_info "Submitting to Apple notary service using keychain profile..."
        notarize_output=$(xcrun notarytool submit "$temp_zip" \
            --keychain-profile "notarytool-profile" \
            --wait 2>&1) || {
            log_warn "Notarization failed. Set APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID or configure keychain profile."
            rm -f "$temp_zip"
            return 0
        }
    fi

    rm -f "$temp_zip"

    if echo "$notarize_output" | grep -q "status: Accepted"; then
        log_info "App notarization successful!"

        # Staple the notarization ticket to the app
        log_info "Stapling notarization ticket to app..."
        xcrun stapler staple "$app_path" || {
            log_warn "Failed to staple app, but notarization was successful"
        }
    else
        log_error "App notarization failed:"
        echo "$notarize_output"
        return 1
    fi
}

# Recreate DMG after modifying app bundle
recreate_dmg() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        return 0
    fi

    log_info "Recreating DMG with cli-bundle included..."

    local app_path=""
    local dmg_dir=""
    local dmg_name=""
    local version=$(get_app_version)

    case "$target" in
        aarch64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/uniins-claw.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="uniins-claw_${version}_aarch64.dmg"
            ;;
        x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/uniins-claw.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="uniins-claw_${version}_x64.dmg"
            ;;
        *)
            log_warn "DMG recreation not needed for $target"
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_warn "App bundle not found at $app_path"
        return 0
    fi

    # Remove old DMG and create new one
    rm -f "$dmg_dir"/*.dmg
    mkdir -p "$dmg_dir"

    # Create temp directory with app and Applications shortcut
    local temp_dir=$(mktemp -d)
    cp -R "$app_path" "$temp_dir/"
    ln -s /Applications "$temp_dir/Applications"
    cp "$PROJECT_ROOT/src-tauri/icons/icon.icns" "$temp_dir/.VolumeIcon.icns" 2>/dev/null || true
    cat > "$temp_dir/安装说明.txt" << DMG_README_EOF
uniins-claw 安装说明

1. 将 uniins-claw 拖入 Applications 文件夹。
2. 从 Applications 启动 uniins-claw。
3. 首次启动如遇 macOS 安全提示，请在“系统设置 > 隐私与安全性”中允许打开。
4. 应用会在本机启动必要的本地服务，用于任务、文件、技能和模型能力调用。

如需卸载，请从 Applications 删除 uniins-claw，并按需清理用户目录中的应用数据。
DMG_README_EOF

    # Hide .app extension in Finder
    SetFile -a E "$temp_dir/uniins-claw.app" 2>/dev/null || true
    SetFile -a C "$temp_dir" 2>/dev/null || true

    log_info "Creating DMG with Applications shortcut and install guide..."
    hdiutil create -volname uniins-claw -srcfolder "$temp_dir" -ov -format UDZO "$dmg_dir/$dmg_name"

    # Clean up temp directory
    rm -rf "$temp_dir"

    if [ -f "$dmg_dir/$dmg_name" ]; then
        local dmg_size=$(du -h "$dmg_dir/$dmg_name" | cut -f1)
        log_info "DMG created: $dmg_dir/$dmg_name ($dmg_size)"

        # Sign, notarize and staple the DMG if signing is enabled
        if [ "$SKIP_SIGNING" != "true" ]; then
            local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"

            # Sign the DMG
            log_info "Signing DMG..."
            codesign --force --timestamp --sign "$signing_identity" "$dmg_dir/$dmg_name"

            # Notarize the DMG
            log_info "Notarizing DMG (this may take a few minutes)..."
            local notarize_output
            if [ -n "$APPLE_ID" ] && [ -n "$APPLE_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
                notarize_output=$(xcrun notarytool submit "$dmg_dir/$dmg_name" \
                    --apple-id "$APPLE_ID" \
                    --password "$APPLE_PASSWORD" \
                    --team-id "$APPLE_TEAM_ID" \
                    --wait 2>&1) || true
            else
                # Try keychain profile as fallback
                notarize_output=$(xcrun notarytool submit "$dmg_dir/$dmg_name" \
                    --keychain-profile "notarytool-profile" \
                    --wait 2>&1) || {
                    log_warn "DMG notarization failed. Set APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID environment variables."
                    return 0
                }
            fi

            if echo "$notarize_output" | grep -q "status: Accepted"; then
                log_info "DMG notarization successful"

                # Staple the notarization ticket
                log_info "Stapling notarization ticket to DMG..."
                xcrun stapler staple "$dmg_dir/$dmg_name" || {
                    log_warn "Failed to staple DMG, but notarization was successful"
                }
            else
                log_warn "DMG notarization may have failed:"
                echo "$notarize_output"
            fi
        fi

        log_info "DMG ready: $dmg_dir/$dmg_name"
    else
        log_error "Failed to recreate DMG"
        return 1
    fi
}

# Build for macOS Apple Silicon (aarch64)
build_mac_arm() {
    log_info "Building for macOS Apple Silicon (aarch64)..."

    local target="aarch64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    # IMPORTANT: When signing is enabled, we must disable Tauri's built-in notarization
    # because Resources/cli-bundle binaries need to be signed AFTER Tauri copies them.
    # Flow: Tauri build -> sign cli-bundle in Resources -> re-sign app -> manual notarize
    if [ "$SKIP_SIGNING" != "true" ] && [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Disabling Tauri notarization (will notarize manually after signing cli-bundle)..."
        TAURI_SKIP_NOTARIZATION=true pnpm tauri build --target "$target"
    else
        pnpm tauri build --target "$target"
    fi

    # Sign cli-bundle in app bundle Resources (after Tauri build)
    sign_cli_bundle_in_app "$target"

    # Notarize the app (after all binaries are signed)
    notarize_app "$target"

    # Recreate DMG with bundle included
    recreate_dmg "$target"

    log_info "macOS Apple Silicon build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for current platform
build_current() {
    log_info "Building for current platform..."

    # Build API sidecar first
    build_api_sidecar "current"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "current"
    update_tauri_config

    # IMPORTANT: When signing is enabled, we must disable Tauri's built-in notarization
    if [ "$SKIP_SIGNING" != "true" ] && [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Disabling Tauri notarization (will notarize manually after signing cli-bundle)..."
        TAURI_SKIP_NOTARIZATION=true pnpm tauri build
    else
        pnpm tauri build
    fi

    # Sign cli-bundle in app bundle Resources
    sign_cli_bundle_in_app "current"

    # Notarize the app (after all binaries are signed)
    notarize_app "current"

    # Recreate DMG with bundle included
    recreate_dmg "current"

    log_info "Build completed!"
    log_info "Output: src-tauri/target/release/bundle/"
}


# Show help
show_help() {
    echo "uniins-claw Build Script"
    echo ""
    echo "Usage: ./scripts/build.sh [platform] [options]"
    echo ""
    echo "Platforms:"
    echo "  linux       - Build for Linux x86_64"
    echo "  windows     - Build for Windows x86_64 (cross-compile from macOS/Linux supported)"
    echo "  mac-intel   - Build for macOS Intel (x86_64) ~30MB"
    echo "  mac-arm     - Build for macOS Apple Silicon (aarch64) ~27MB"
    echo "  current     - Build for current platform (default)"
    echo "  all         - Build for all platforms (requires cross-compilation setup)"
    echo ""
    echo "Options:"
    echo "  --with-cli      Bundle CLI tools (Claude Code + Codex) with shared Node.js"
    echo "                  This creates a unified bundle (~100MB) containing:"
    echo "                  - One Node.js binary (shared)"
    echo "                  - @anthropic-ai/claude-code"
    echo "                  - @openai/codex"
    echo "                  Allows out-of-box Claude Code and Codex sandbox support"
    echo "  --sign          Enable code signing. macOS uses Developer ID/notarization;"
    echo "                  Windows uses Authenticode. If WINDOWS_SIGN_CERT_PFX is not set,"
    echo "                  a local self-signed certificate is generated under ./certs/"
    echo "                  Default: signing is DISABLED for faster builds"
    echo "  --no-sign       Explicitly disable signing (default behavior)"
    echo ""
    echo "Requirements:"
    echo "  - pnpm"
    echo "  - Node.js (for API sidecar)"
    echo "  - Rust (cargo, rustup)"
    echo "  - MinGW (for Windows cross-compilation from macOS/Linux)"
    echo "    macOS: brew install mingw-w64"
    echo "    Linux: apt install mingw-w64"
    echo ""
    echo "Examples:"
    echo "  ./scripts/build.sh                     # Build for current platform (no signing)"
    echo "  ./scripts/build.sh mac-arm             # Build for Apple Silicon (fast, no signing)"
    echo "  ./scripts/build.sh mac-arm --with-cli  # Build with bundled CLI tools"
    echo "  ./scripts/build.sh mac-arm --sign      # Build with signing and notarization"
    echo "  ./scripts/build.sh mac-arm --with-cli --sign  # Full release build"
    echo "  ./scripts/build.sh windows             # Cross-compile for Windows from macOS"
    echo "  ./scripts/build.sh windows --with-cli  # Windows with bundled CLI tools"
    echo "  ./scripts/build.sh windows --sign      # Windows with self-signed Authenticode signature"
    echo ""
    echo "Note: Cross-compilation requires proper toolchain setup."
    echo "      For CI/CD builds, use GitHub Actions workflow instead."
    echo ""
    echo "CLI bundling (--with-cli):"
    echo "  Creates a unified cli-bundle with one shared Node.js binary and both CLIs:"
    echo "  - Claude Code CLI: for AI-assisted coding"
    echo "  - Codex CLI: for sandbox execution (macOS/Linux)"
    echo "  This saves ~80MB compared to bundling each CLI separately."
}

# Parse arguments and set global variables
# Sets: BUNDLE_CLI, BUILD_PLATFORM, SKIP_SIGNING
parse_args() {
    BUILD_PLATFORM="current"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --)
                shift
                ;;
            --with-cli)
                BUNDLE_CLI=true
                shift
                ;;
            # Keep legacy flags for backwards compatibility
            --with-claude|--with-codex)
                BUNDLE_CLI=true
                log_warn "Note: --with-claude and --with-codex are deprecated. Use --with-cli instead (bundles both)."
                shift
                ;;
            --sign)
                SKIP_SIGNING=false
                shift
                ;;
            --no-sign)
                SKIP_SIGNING=true
                shift
                ;;
            -h|--help|help)
                show_help
                exit 0
                ;;
            linux|windows|mac-intel|mac-arm|current|all)
                BUILD_PLATFORM="$1"
                shift
                ;;
            *)
                log_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Main
main() {
    # Parse arguments first (sets BUILD_PLATFORM, BUNDLE_CLI, SKIP_SIGNING)
    parse_args "$@"

    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "CLI bundling enabled (Claude Code + Codex with shared Node.js)"
    fi

    if [ "$SKIP_SIGNING" = "true" ]; then
        log_info "Code signing disabled (use --sign to enable)"
        # Use ad-hoc signing (no certificate required, faster)
        export APPLE_SIGNING_IDENTITY="-"
        # Disable notarization
        export TAURI_SKIP_NOTARIZATION=true
        # Also set these to ensure no signing attempt
        unset APPLE_CERTIFICATE
        unset APPLE_CERTIFICATE_PASSWORD
        unset APPLE_ID
        unset APPLE_PASSWORD
        unset APPLE_TEAM_ID
        # Also modify config file to remove signing identity
        disable_signing_config
    else
        log_info "Code signing enabled"
    fi

    local platform="$BUILD_PLATFORM"

    check_requirements
    install_deps

    case "$platform" in
        linux)
            build_linux
            ;;
        windows)
            build_windows
            ;;
        mac-intel)
            build_mac_intel
            ;;
        mac-arm)
            build_mac_arm
            ;;
        current)
            build_current
            ;;
        all)
            log_warn "Building for all platforms requires cross-compilation setup."
            log_warn "Consider using GitHub Actions for cross-platform builds."
            build_linux
            build_windows
            build_mac_intel
            build_mac_arm
            ;;
    esac

    # Summary
    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Build completed with bundled CLI tools (Claude Code + Codex)"
    else
        log_info "Build completed (no CLI tools bundled)"
    fi
}

main "$@"
