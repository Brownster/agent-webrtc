/**
 * Module loader utility for tests
 * Properly loads shared modules with Jest coverage tracking
 */

const fs = require('fs');
const path = require('path');

/**
 * Load a shared module and return its exports
 * This approach allows Jest to track coverage properly
 */
function loadSharedModule(moduleName) {
  const modulePath = path.join(__dirname, '../../shared', `${moduleName}.js`);
  
  if (!fs.existsSync(modulePath)) {
    throw new Error(`Module not found: ${modulePath}`);
  }

  // Clear any existing global exports (except when loading config for storage tests)
  if (moduleName !== 'config') {
    if (global.WebRTCExporterDomains) delete global.WebRTCExporterDomains;
    if (global.WebRTCExporterStorage) delete global.WebRTCExporterStorage;
  }
  if (moduleName === 'config') {
    if (global.WebRTCExporterConfig) delete global.WebRTCExporterConfig;
  }

  // Create a module context that simulates the extension environment
  const moduleContext = {
    global: global,
    globalThis: global,
    self: global,
    window: global,
    console: console
  };

  // Read and execute the module code in the proper context
  const moduleCode = fs.readFileSync(modulePath, 'utf8');
  
  // Create a function that executes the module code
  const moduleFunction = new Function(
    'global', 'globalThis', 'self', 'window', 'console',
    moduleCode
  );

  // Execute the module
  moduleFunction(global, global, global, global, console);

  // Return the appropriate export
  switch (moduleName) {
    case 'config':
      return global.WebRTCExporterConfig;
    case 'domains':
      return global.WebRTCExporterDomains;
    case 'storage':
      return global.WebRTCExporterStorage;
    default:
      throw new Error(`Unknown module: ${moduleName}`);
  }
}

module.exports = {
  loadSharedModule
};