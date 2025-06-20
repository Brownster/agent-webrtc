#!/usr/bin/env node

/**
 * Chrome Extension Packaging Script
 * Creates a production-ready zip file for Chrome Web Store or manual installation
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Configuration
const BUILD_DIR = 'build'
const ROOT_DIR = process.cwd()
const PACKAGE_JSON = require(path.join(ROOT_DIR, 'package.json'))

// Files to include in the extension package
const INCLUDE_FILES = [
  'manifest.json',
  'background.js',
  'content-script.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'override.js',
  'LICENSE',
  'README.md'
]

// Directories to include
const INCLUDE_DIRS = [
  'assets',
  'shared',
  'background',
  'grafana'
]

// Note: Explicit include strategy used instead of exclude patterns

function log (message) {
  console.log(`[package-extension] ${message}`)
}

function copyFileSync (src, dest) {
  const destDir = path.dirname(dest)
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }
  fs.copyFileSync(src, dest)
}

function copyDirSync (src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function cleanBuildDir () {
  if (fs.existsSync(BUILD_DIR)) {
    log('Cleaning existing build directory...')
    fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true })
}

function copyExtensionFiles () {
  log('Copying extension files...')

  // Copy individual files
  for (const file of INCLUDE_FILES) {
    const srcPath = path.join(ROOT_DIR, file)
    const destPath = path.join(BUILD_DIR, file)

    if (fs.existsSync(srcPath)) {
      copyFileSync(srcPath, destPath)
      log(`  ✓ ${file}`)
    } else {
      log(`  ⚠ Skipping missing file: ${file}`)
    }
  }

  // Copy directories
  for (const dir of INCLUDE_DIRS) {
    const srcPath = path.join(ROOT_DIR, dir)
    const destPath = path.join(BUILD_DIR, dir)

    if (fs.existsSync(srcPath)) {
      copyDirSync(srcPath, destPath)
      log(`  ✓ ${dir}/`)
    } else {
      log(`  ⚠ Skipping missing directory: ${dir}`)
    }
  }
}

function updateManifestVersion () {
  const manifestPath = path.join(BUILD_DIR, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  // Use package.json version if different
  if (manifest.version !== PACKAGE_JSON.version) {
    log(`Updating manifest version: ${manifest.version} → ${PACKAGE_JSON.version}`)
    manifest.version = PACKAGE_JSON.version
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  }
}

function createZipPackage () {
  // Use a consistent name expected by CI and release workflows
  const zipName = 'webrtc-stats-exporter-pro.zip'
  const zipPath = path.join(ROOT_DIR, zipName)

  log(`Creating zip package: ${zipName}`)

  try {
    // Remove existing zip if it exists
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath)
    }

    // Create zip file
    execSync(`cd ${BUILD_DIR} && zip -r "../${zipName}" .`, { stdio: 'inherit' })

    // Verify zip was created
    if (fs.existsSync(zipPath)) {
      const stats = fs.statSync(zipPath)
      log(`✓ Package created successfully: ${zipName} (${Math.round(stats.size / 1024)}KB)`)
      return zipPath
    } else {
      throw new Error('Zip file was not created')
    }
  } catch (error) {
    log(`✗ Error creating zip package: ${error.message}`)
    process.exit(1)
  }
}

function validatePackage () {
  log('Validating package contents...')

  const requiredFiles = ['manifest.json', 'background.js']
  for (const file of requiredFiles) {
    const filePath = path.join(BUILD_DIR, file)
    if (!fs.existsSync(filePath)) {
      log(`✗ Missing required file: ${file}`)
      process.exit(1)
    }
  }

  // Validate manifest
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'manifest.json'), 'utf8'))
    if (!manifest.version || !manifest.name) {
      throw new Error('Manifest missing required fields')
    }
    log(`✓ Manifest valid (version: ${manifest.version})`)
  } catch (error) {
    log(`✗ Invalid manifest.json: ${error.message}`)
    process.exit(1)
  }

  log('✓ Package validation passed')
}

function printSummary (zipPath) {
  const stats = fs.statSync(zipPath)
  const fileCount = execSync(`cd ${BUILD_DIR} && find . -type f | wc -l`).toString().trim()

  console.log('\n' + '='.repeat(50))
  console.log('📦 PACKAGE SUMMARY')
  console.log('='.repeat(50))
  console.log(`Name: ${PACKAGE_JSON.name}`)
  console.log(`Version: ${PACKAGE_JSON.version}`)
  console.log(`Package: ${path.basename(zipPath)}`)
  console.log(`Size: ${Math.round(stats.size / 1024)}KB`)
  console.log(`Files: ${fileCount}`)
  console.log(`Location: ${zipPath}`)
  console.log('='.repeat(50))
  console.log('\n📋 INSTALLATION INSTRUCTIONS:')
  console.log('1. Extract the zip file to a folder')
  console.log('2. Open Chrome and go to chrome://extensions/')
  console.log('3. Enable "Developer mode"')
  console.log('4. Click "Load unpacked" and select the extracted folder')
  console.log('5. Configure the extension via the options page')
  console.log('='.repeat(50))
}

// Main execution
function main () {
  console.log('🔧 WebRTC Stats Exporter - Extension Packager\n')

  try {
    cleanBuildDir()
    copyExtensionFiles()
    updateManifestVersion()
    validatePackage()
    const zipPath = createZipPackage()
    printSummary(zipPath)

    log('✅ Extension packaging completed successfully!')
  } catch (error) {
    log(`❌ Packaging failed: ${error.message}`)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  main,
  copyExtensionFiles,
  createZipPackage,
  validatePackage
}
