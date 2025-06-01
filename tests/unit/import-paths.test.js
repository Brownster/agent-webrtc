/**
 * Import Path Validation Tests
 * Ensures all importScripts paths in background scripts are valid
 */

const fs = require('fs')
const path = require('path')

describe('Import Path Validation', () => {
  const projectRoot = path.join(__dirname, '../..')
  
  describe('background/index.js', () => {
    let backgroundIndexContent
    let importPaths
    
    beforeAll(() => {
      const backgroundIndexPath = path.join(projectRoot, 'background/index.js')
      backgroundIndexContent = fs.readFileSync(backgroundIndexPath, 'utf8')
      
      // Extract all importScripts calls
      const importMatches = backgroundIndexContent.match(/importScripts\(['"`]([^'"`]+)['"`]\)/g)
      importPaths = importMatches ? importMatches.map(match => {
        const pathMatch = match.match(/importScripts\(['"`]([^'"`]+)['"`]\)/)
        return pathMatch ? pathMatch[1] : null
      }).filter(Boolean) : []
    })
    
    test('should contain importScripts calls', () => {
      expect(importPaths.length).toBeGreaterThan(0)
      expect(importPaths).toContain('../assets/pako.min.js')
      expect(importPaths).toContain('../shared/config.js')
      expect(importPaths).toContain('stats-formatter.js')
    })
    
    test('all importScripts paths should exist', () => {
      const backgroundDir = path.join(projectRoot, 'background')
      const missingFiles = []
      
      importPaths.forEach(importPath => {
        // Resolve path relative to background directory (where index.js is located)
        const resolvedPath = path.resolve(backgroundDir, importPath)
        
        if (!fs.existsSync(resolvedPath)) {
          missingFiles.push({
            importPath,
            resolvedPath,
            exists: false
          })
        }
      })
      
      if (missingFiles.length > 0) {
        const errorMessage = 'Missing import files:\n' + 
          missingFiles.map(f => `  ${f.importPath} -> ${f.resolvedPath}`).join('\n')
        throw new Error(errorMessage)
      }
      
      expect(missingFiles).toHaveLength(0)
    })
    
    test('should import all required modules', () => {
      const requiredModules = [
        '../assets/pako.min.js',
        '../shared/config.js',
        '../shared/domains.js', 
        '../shared/storage.js',
        'stats-formatter.js',
        'pushgateway-client.js',
        'options-manager.js',
        'connection-tracker.js',
        'lifecycle-manager.js',
        'tab-monitor.js',
        'message-handler.js'
      ]
      
      const missingModules = requiredModules.filter(module => !importPaths.includes(module))
      
      expect(missingModules).toHaveLength(0)
      expect(importPaths).toEqual(expect.arrayContaining(requiredModules))
    })
    
    test('should not have duplicate imports', () => {
      const duplicates = importPaths.filter((path, index) => importPaths.indexOf(path) !== index)
      expect(duplicates).toHaveLength(0)
    })
  })
  
  describe('original background.js', () => {
    test('should still exist for comparison', () => {
      const backgroundJsPath = path.join(projectRoot, 'background.js')
      expect(fs.existsSync(backgroundJsPath)).toBe(true)
    })
    
    test('should have different imports than background/index.js', () => {
      const backgroundJsPath = path.join(projectRoot, 'background.js')
      const backgroundJsContent = fs.readFileSync(backgroundJsPath, 'utf8')
      
      // Extract imports from original background.js
      const originalImportMatches = backgroundJsContent.match(/importScripts\(['"`]([^'"`]+)['"`]\)/g)
      const originalImportPaths = originalImportMatches ? originalImportMatches.map(match => {
        const pathMatch = match.match(/importScripts\(['"`]([^'"`]+)['"`]\)/)
        return pathMatch ? pathMatch[1] : null
      }).filter(Boolean) : []
      
      // Original should use absolute paths from extension root
      expect(originalImportPaths).toContain('assets/pako.min.js')
      expect(originalImportPaths).toContain('shared/config.js')
      expect(originalImportPaths).toContain('background/stats-formatter.js')
    })
  })
  
  describe('web_accessible_resources validation', () => {
    test('manifest should include all background modules as web accessible', () => {
      const manifestPath = path.join(projectRoot, 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      
      const webAccessibleResources = manifest.web_accessible_resources?.[0]?.resources || []
      
      const requiredResources = [
        'shared/config.js',
        'shared/domains.js', 
        'shared/storage.js',
        'background/stats-formatter.js',
        'background/pushgateway-client.js',
        'background/options-manager.js',
        'background/connection-tracker.js',
        'background/lifecycle-manager.js',
        'background/tab-monitor.js',
        'background/message-handler.js'
      ]
      
      const missingResources = requiredResources.filter(resource => 
        !webAccessibleResources.includes(resource)
      )
      
      expect(missingResources).toHaveLength(0)
    })
    
    test('manifest should use background/index.js as service worker', () => {
      const manifestPath = path.join(projectRoot, 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      
      expect(manifest.background.service_worker).toBe('background/index.js')
    })
  })
  
  describe('file structure validation', () => {
    test('all expected directories should exist', () => {
      const requiredDirs = ['background', 'shared', 'assets']
      
      requiredDirs.forEach(dir => {
        const dirPath = path.join(projectRoot, dir)
        expect(fs.existsSync(dirPath)).toBe(true)
        expect(fs.statSync(dirPath).isDirectory()).toBe(true)
      })
    })
    
    test('all background modules should exist', () => {
      const backgroundModules = [
        'stats-formatter.js',
        'pushgateway-client.js', 
        'options-manager.js',
        'connection-tracker.js',
        'lifecycle-manager.js',
        'tab-monitor.js',
        'message-handler.js',
        'index.js'
      ]
      
      const backgroundDir = path.join(projectRoot, 'background')
      
      backgroundModules.forEach(module => {
        const modulePath = path.join(backgroundDir, module)
        expect(fs.existsSync(modulePath)).toBe(true)
        expect(fs.statSync(modulePath).isFile()).toBe(true)
      })
    })
    
    test('all shared modules should exist', () => {
      const sharedModules = ['config.js', 'domains.js', 'storage.js']
      const sharedDir = path.join(projectRoot, 'shared')
      
      sharedModules.forEach(module => {
        const modulePath = path.join(sharedDir, module)
        expect(fs.existsSync(modulePath)).toBe(true)
        expect(fs.statSync(modulePath).isFile()).toBe(true)
      })
    })
  })
})