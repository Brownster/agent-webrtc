# WebRTC Stats Exporter - Testing Guide

This directory contains comprehensive tests for the WebRTC Stats Exporter Chrome extension.

## Test Structure

```
tests/
├── setup.js              # Jest configuration and Chrome extension mocks
├── unit/                  # Unit tests for individual modules
│   ├── config.test.js     # Tests for shared/config.js
│   ├── domains.test.js    # Tests for shared/domains.js
│   └── storage.test.js    # Tests for shared/storage.js
├── integration/           # Integration tests for component interactions
│   └── background.test.js # Tests for background script functionality
├── e2e/                   # End-to-end tests for complete workflows
│   └── extension.test.js  # Tests for full extension functionality
└── mocks/                 # Mock utilities and test helpers
```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode (Development)
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

### CI Mode (with JUnit output)
```bash
npm run test:ci
```

## Test Categories

### Unit Tests
- **Purpose**: Test individual functions and modules in isolation
- **Scope**: Shared modules (config, domains, storage)
- **Coverage**: Function behavior, edge cases, error handling

### Integration Tests  
- **Purpose**: Test component interactions and Chrome API integration
- **Scope**: Background script, content script communication
- **Coverage**: Message passing, storage operations, tab management

### End-to-End Tests
- **Purpose**: Test complete user workflows and extension behavior
- **Scope**: Full extension functionality from user action to metrics export
- **Coverage**: WebRTC stats flow, configuration changes, error recovery

### Proxy Tests
- **Purpose**: Validate optional mTLS proxy configuration
- **Scope**: Pushgateway client, options manager, and options page UI
- **Running**: Included in `npm test` (no special setup). Mock certificates are generated automatically in unit tests.

## Chrome Extension Testing

### Mocked APIs
The test setup mocks all Chrome extension APIs:
- `chrome.storage` (sync and local)
- `chrome.runtime` (messaging, lifecycle)
- `chrome.tabs` (query, events)
- `chrome.action` (badge, title)
- `chrome.alarms` (scheduling)
- `chrome.scripting` (code injection)

### Test Utilities

#### `createMockTab(overrides)`
Creates a mock Chrome tab object for testing.

```javascript
const tab = createMockTab({
  url: 'https://meet.google.com/test-meeting',
  id: 123
});
```

#### `createMockWebRTCStats(type, overrides)`
Creates mock WebRTC statistics objects.

```javascript
const stats = createMockWebRTCStats('inbound-rtp', {
  bytesReceived: 1000,
  packetsReceived: 10
});
```

#### `mockStorage(syncData, localData)`
Configures Chrome storage mocks with test data.

```javascript
mockStorage({
  url: 'http://localhost:9091',
  agentId: 'test-agent'
});
```

#### `loadSharedModules()`
Loads and executes shared modules in the test environment.

```javascript
loadSharedModules();
const config = global.WebRTCExporterConfig;
```

## Writing Tests

### Unit Test Example

```javascript
import { describe, test, expect, beforeEach } from '@jest/globals';

describe('MyModule', () => {
  beforeEach(() => {
    loadSharedModules();
  });

  test('should do something', () => {
    const result = global.WebRTCExporterConfig.someFunction();
    expect(result).toBe(expectedValue);
  });
});
```

### Integration Test Example

```javascript
import { describe, test, expect, beforeEach } from '@jest/globals';

describe('Background Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage({ url: 'http://localhost:9091' });
  });

  test('should handle tab events', async () => {
    // Load background script
    loadSharedModules();
    eval(fs.readFileSync('background.js', 'utf8'));
    
    // Test tab event handling
    const listener = chrome.tabs.onActivated.addListener.mock.calls[0][0];
    await listener({ tabId: 123 });
    
    expect(chrome.action.setBadgeText).toHaveBeenCalled();
  });
});
```

## Coverage Requirements

The test suite maintains high coverage standards:
- **Functions**: 80% minimum
- **Lines**: 80% minimum  
- **Branches**: 70% minimum
- **Statements**: 80% minimum

## Continuous Integration

Tests run automatically on:
- Pull requests to `main` branch
- Pushes to `main` and `develop` branches
- Multiple Node.js versions (18.x, 20.x)

### CI Pipeline Includes:
1. **Linting**: Code style and quality checks
2. **Unit Tests**: Individual module testing
3. **Integration Tests**: Component interaction testing
4. **Security Scan**: Vulnerability and secret detection
5. **Extension Validation**: Manifest and file structure checks
6. **Performance Tests**: Load time and execution speed
7. **Build Validation**: Extension packaging and artifact creation

## Debugging Tests

### Console Output
Tests suppress console output by default. To see logs:

```javascript
beforeEach(() => {
  // Restore console for debugging
  global.console = require('console');
});
```

### Test Isolation
Each test runs in isolation with fresh mocks:

```javascript
beforeEach(() => {
  jest.clearAllMocks();
  delete global.WebRTCExporterConfig;
  loadSharedModules();
});
```

### Mock Inspection
Examine mock calls during debugging:

```javascript
test('should call storage', async () => {
  await someFunction();
  
  console.log('Storage calls:', chrome.storage.sync.get.mock.calls);
  expect(chrome.storage.sync.get).toHaveBeenCalledWith(['url']);
});
```

## Performance Testing

Performance tests verify:
- Shared module loading time
- Domain validation speed
- Memory usage patterns
- Extension startup time

Run performance tests:

```bash
npm run test -- --testNamePattern="Performance"
```

## Test Data Management

### Test Configuration
```javascript
const TEST_CONFIG = {
  url: 'http://localhost:9091',
  agentId: 'test-agent',
  updateInterval: 2,
  enabledStats: ['inbound-rtp', 'outbound-rtp']
};
```

### Mock WebRTC Stats
```javascript
const MOCK_STATS = {
  'inbound-rtp': {
    bytesReceived: 1000,
    packetsReceived: 10,
    packetsLost: 0,
    jitter: 0.001
  },
  'outbound-rtp': {
    bytesSent: 2000,
    packetsSent: 20,
    retransmittedPackets: 1
  }
};
```

## Common Issues

### Module Loading
If shared modules aren't loading correctly:
```javascript
// Ensure modules are loaded before tests
beforeEach(() => {
  loadSharedModules();
  expect(global.WebRTCExporterConfig).toBeDefined();
});
```

### Async Testing
For Promise-based code:
```javascript
test('should handle async operations', async () => {
  await expect(asyncFunction()).resolves.toBe(expectedValue);
});
```

### Chrome API Mocking
If Chrome APIs aren't mocked properly:
```javascript
beforeEach(() => {
  // Ensure Chrome object exists
  expect(global.chrome).toBeDefined();
  expect(global.chrome.storage.sync.get).toBeInstanceOf(Function);
});
```

## Contributing

When adding new features:
1. Write tests first (TDD approach)
2. Ensure tests cover edge cases
3. Update mocks for new Chrome APIs
4. Add integration tests for new workflows
5. Verify CI pipeline passes

For questions or issues with testing, refer to the main project documentation or create an issue in the repository.
