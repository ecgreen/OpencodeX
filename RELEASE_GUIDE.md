# OpencodeX Release Guide

This guide covers the public preview release path for the TUI/CLI and desktop GUI. Releases are manually triggered from GitHub Actions and published to GitHub Releases.

## Version Sources

- TUI/CLI preview version: `packages/opencode/package.json`
- GUI preview version: `packages/gui/package.json`
- Current public preview version: `0.0.1`

The workflows use the package version by default. A manually entered workflow version can override the package version.

## Recommended Path: Manual GitHub Action

Use this path for public preview releases. It builds assets in GitHub-hosted runners for each target platform and uploads them to a GitHub Release. Pushing a tag does not start a release.

### 1. Prepare the release branch

1. Confirm the version in both package files.
2. Run focused validation locally:

   ```bash
   bun --cwd packages/gui run typecheck
   bun --cwd packages/gui run test
   bun --cwd packages/gui run build
   ```

   ```bash
   bun --cwd packages/opencode run test
   bun --cwd packages/opencode run test:httpapi
   ```

3. Commit the release prep changes using a conventional commit, for example:

   ```bash
   git add packages/opencode/package.json packages/gui/package.json bun.lock RELEASE_GUIDE.md
   git commit -m "chore: prepare public preview 0.0.1"
   ```

4. Push the branch and merge it into `main`.

### 2. Confirm GUI signing secrets

Public GUI release assets should be signed. The `release-gui` workflow fails by default if required signing secrets are missing.

Required macOS secrets:

- `MACOS_CSC_LINK`: base64-encoded Developer ID Application certificate, or another Electron Builder-supported certificate source.
- `MACOS_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: Apple developer account email used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

Required Windows secrets:

- `WIN_CSC_LINK`: base64-encoded Authenticode code-signing certificate, or another Electron Builder-supported certificate source.
- `WIN_CSC_KEY_PASSWORD`: certificate password.

Linux assets are not code signed in this workflow. They are distributed with checksums.

Use the `allow_unsigned_gui` workflow input only for internal preview testing. Do not use it for a public announcement unless the release notes clearly call out unsigned installers and expected OS trust prompts.

### Getting macOS signing credentials

You need an active Apple Developer Program membership and Account Holder access.

1. On a Mac, create a certificate signing request in Keychain Access:
   - Open **Keychain Access**.
   - Choose **Certificate Assistant** > **Request a Certificate From a Certificate Authority**.
   - Save the `.certSigningRequest` file to disk.
2. In Apple Developer, open **Certificates, Identifiers & Profiles**.
3. Add a new certificate.
4. Under **Software**, choose **Developer ID Application**.
5. Upload the CSR and download the generated `.cer`.
6. Double-click the `.cer` to install it in Keychain Access.
7. In Keychain Access, open **My Certificates**, find the `Developer ID Application` certificate, and export it with its private key as a password-protected `.p12`.
8. Base64-encode the `.p12`:

   ```bash
   base64 -i DeveloperIDApplication.p12 -o macos-csc-link.txt
   ```

   On Windows PowerShell:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("DeveloperIDApplication.p12")) | Set-Content -NoNewline macos-csc-link.txt
   ```

9. Create an Apple app-specific password from your Apple Account security settings.
10. Find your Apple Team ID in the Apple Developer account membership details.
11. Add these GitHub Actions repository secrets:

   ```text
   MACOS_CSC_LINK                contents of macos-csc-link.txt
   MACOS_CSC_KEY_PASSWORD        password used when exporting the .p12
   APPLE_ID                      Apple developer account email
   APPLE_APP_SPECIFIC_PASSWORD   app-specific password
   APPLE_TEAM_ID                 Apple Developer Team ID
   ```

`Developer ID Installer` is only needed if we later ship a signed `.pkg`. The current GUI workflow ships `.dmg` and `.zip`, so `Developer ID Application` is the certificate we need.

### Getting Windows signing credentials

For Windows, decide which signing path to use before buying anything.

Path A, fastest with the current workflow: buy an OV Microsoft Authenticode code-signing certificate from a public CA that supports CI signing in a way Electron Builder can consume. Confirm before purchase that you can use it with GitHub Actions as either a base64 `.pfx`/`.p12` or another Electron Builder-supported certificate source.

1. Purchase an OV code-signing certificate for the publisher identity you want users to see.
2. Complete the CA identity validation.
3. Export or obtain the signing certificate as a password-protected `.pfx` or `.p12`, if your provider supports that.
4. Base64-encode it:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("windows-codesign.pfx")) | Set-Content -NoNewline win-csc-link.txt
   ```

5. Add these GitHub Actions repository secrets:

   ```text
   WIN_CSC_LINK           contents of win-csc-link.txt
   WIN_CSC_KEY_PASSWORD   password for the .pfx/.p12
   ```

This removes the unsigned or unknown-publisher problem, but a new OV certificate can still need SmartScreen reputation to build over time.

Path B, stronger but needs workflow work: use an EV certificate or Microsoft Artifact Signing / Trusted Signing. EV certificates have stronger initial SmartScreen reputation, but are commonly bound to hardware or cloud key storage and are not usually exportable as a simple CI `.pfx`. Microsoft Artifact Signing is a managed signing service backed by HSMs. If we choose this path, update `release-gui.yml` to use Electron Builder `win.azureSignOptions` or a custom Windows signing step instead of `WIN_CSC_LINK`.

For public preview, use Path A only if the provider confirms CI-compatible signing. Otherwise choose Path B and update the workflow before release.

### Adding secrets to GitHub

Do not paste certificates, passwords, or app-specific passwords into issues, chat, docs, or commits.

Add repository secrets in GitHub:

1. Open the repository on GitHub.
2. Go to **Settings**.
3. Open **Secrets and variables** > **Actions**.
4. Click **New repository secret**.
5. Add each secret name and value exactly as listed above.

You can also use `gh secret set`:

```bash
gh secret set MACOS_CSC_LINK < macos-csc-link.txt
gh secret set MACOS_CSC_KEY_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
gh secret set WIN_CSC_LINK < win-csc-link.txt
gh secret set WIN_CSC_KEY_PASSWORD
```

### 3. Trigger the CLI release workflow

In GitHub:

1. Open **Actions**.
2. Select `release-cli`.
3. Choose **Run workflow**.
4. Select the `main` branch, or the exact branch/commit ref that should ship.
5. Enter `0.0.1` for `version`, or leave it blank to use `packages/opencode/package.json`.
6. Leave `prerelease` enabled for public preview.
7. Run the workflow.

The workflow creates or updates:

- GitHub Release tag `v0.0.1`
- TUI/CLI release assets
- `SHA256SUMS`

### 4. Trigger the GUI release workflow

After `release-cli` succeeds, run the GUI workflow with the same version:

1. Open **Actions**.
2. Select `release-gui`.
3. Choose **Run workflow**.
4. Select the same branch or commit ref used for `release-cli`.
5. Enter `0.0.1` for `version`, or leave it blank to use `packages/gui/package.json`.
6. Leave `prerelease` enabled for public preview.
7. Leave `allow_unsigned_gui` disabled for a public release.
8. Run the workflow.

The workflow uploads GUI assets and `SHA256SUMS-GUI` to the same `v0.0.1` GitHub Release.

### 5. Watch the workflows

In GitHub, open **Actions** and watch:

- `release-cli`: builds TUI/CLI archives and `SHA256SUMS`
- `release-gui`: builds signed/notarized GUI installers/archives and `SHA256SUMS-GUI`

The release is created as a prerelease/public preview by default.

### 6. Find the release files

Release files are uploaded to:

```text
https://github.com/opencodex/opencodex/releases/tag/v0.0.1
```

CLI files are produced under `packages/opencode/dist` during CI and uploaded as release assets. Expected assets include platform-specific `opencode-*` archives plus `SHA256SUMS`.

GUI files are produced under `packages/gui/release` during CI and uploaded as release assets. Expected assets include:

- Windows: NSIS installer and zip
- macOS: dmg and zip
- Linux: AppImage and deb
- `SHA256SUMS-GUI`

### 7. Validate the release assets

Download assets from the GitHub Release and verify checksums:

```bash
sha256sum -c SHA256SUMS
sha256sum -c SHA256SUMS-GUI
```

Then smoke test at least one platform before announcing:

```bash
opencodex --version
opencodex
```

For the GUI, install or unpack the desktop asset, launch it, confirm the dashboard loads, and submit a harmless prompt in a test session.

On macOS, confirm the app is notarized:

```bash
spctl --assess --type execute --verbose /Applications/OpencodeX.app
```

On Windows, confirm the executable or installer has a valid Authenticode signature:

```powershell
Get-AuthenticodeSignature .\OpencodeX-Setup-0.0.1.exe
```

## Retry Or Draft Release

Manual dispatch is also the retry path:

- Rerun `release-cli` to replace CLI assets for the same version.
- Rerun `release-gui` to replace GUI assets for the same version.
- Enable `draft` if you want the GitHub Release created as a draft before public announcement.
- Enable `allow_unsigned_gui` only for internal builds when signing certificates are unavailable.

Both workflows upload with `--clobber`, so rerunning a workflow replaces assets for the same release tag.

## Local Build Fallback

Local builds are useful for preview testing but should not be the primary public distribution path.

### Build TUI/CLI locally

From `packages/opencode`:

```bash
bun run script/build.ts --target linux-x64 --skip-embed-web-ui --no-minify
```

Replace `linux-x64` with the target platform. Local output goes to:

```text
packages/opencode/dist
```

### Build GUI locally

From `packages/gui`:

```bash
bun run build
bun run prepare:sidecar
bun run package
bun run smoke:packaged
```

Local GUI output goes to:

```text
packages/gui/release
```

## Release Notes Checklist

Include these points in the public preview release notes:

- This is a public preview, not GA.
- The TUI/CLI is the primary supported release surface.
- The GUI is preview quality and may lag TUI workflows.
- GUI installers are expected to be signed on Windows and signed/notarized on macOS.
- If `allow_unsigned_gui` was used, say so prominently and warn about OS trust prompts.
- Checksums are available as `SHA256SUMS` and `SHA256SUMS-GUI`.
- Bugs should be filed with the new issue templates.

## Troubleshooting

- If `release-gui` fails during smoke, inspect the sidecar build/copy step and the packaged app logs.
- If `release-gui` fails before packaging, confirm the signing secrets are configured or rerun with `allow_unsigned_gui` for internal testing.
- If a release already exists, rerun the appropriate manual workflow to replace assets for the same tag.
- If only one workflow succeeds, keep the release marked prerelease and rerun the failed workflow before announcing.
- If version numbers are wrong, delete the bad draft/prerelease assets, fix the package versions or workflow input, and rerun before public announcement.
