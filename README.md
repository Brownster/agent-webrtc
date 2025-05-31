# WebRTC Stats Exporter Pro

[![CI](https://github.com/your-org/webrtc-stats-exporter-pro/workflows/WebRTC%20Stats%20Exporter%20CI/badge.svg)](https://github.com/your-org/webrtc-stats-exporter-pro/actions)
[![Tests](https://img.shields.io/badge/tests-37%20passing-brightgreen)](https://github.com/your-org/webrtc-stats-exporter-pro/actions)
[![Coverage](https://img.shields.io/badge/coverage-91%25-brightgreen)](https://github.com/your-org/webrtc-stats-exporter-pro/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Chrome extension that automatically captures WebRTC statistics from supported communication platforms and exports them to a Prometheus Pushgateway for monitoring and analysis.

## Features

- **Automatic WebRTC Detection**: Automatically captures WebRTC stats on supported platforms
- **Multi-Platform Support**: Works with Microsoft Teams, Google Meet, Amazon Connect, Genesys Cloud, and more
- **Prometheus Integration**: Exports metrics in Prometheus format to a configurable Pushgateway
- **Agent Identification**: Configurable agent ID for filtering metrics in Grafana/monitoring systems
- **Comprehensive Stats**: Collects inbound/outbound RTP stats, connection metrics, and quality indicators
- **Robust Architecture**: Modular design with comprehensive error handling and testing

## Supported Platforms

- Microsoft Teams
- Google Meet
- Amazon Connect (CCP)
- Genesys Cloud (PureCloud)
- And other WebRTC-based communication platforms

## Installation

### From Chrome Web Store
*Coming soon*

### Manual Installation (Development)
1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. Configure the extension via the options page

## Configuration

Access the extension options by:
1. Clicking the extension icon in Chrome
2. Selecting "Open Options"
3. Configure:
   - **Pushgateway URL**: Your Prometheus Pushgateway endpoint (default: `http://localhost:9091`)
   - **Agent ID**: Unique identifier for this agent/user
   - **Update Interval**: How often to collect stats (default: 2 seconds)
   - **Authentication**: Username/password if required
   - **Enabled Domains**: Toggle automatic capture for specific platforms

## Architecture

### Core Components

- **Background Script**: Manages extension lifecycle, tab monitoring, and metric export
- **Content Script**: Injected into target pages to detect WebRTC usage
- **Override Script**: Hooks into RTCPeerConnection to capture statistics
- **Shared Modules**: Centralized configuration, domain management, and storage

### Data Flow

1. Extension detects navigation to supported platforms
2. Content script injects WebRTC monitoring code
3. Statistics are collected from active peer connections
4. Metrics are formatted in Prometheus format
5. Data is exported to configured Pushgateway

## Development

### Prerequisites
- Node.js 18+ and npm
- Chrome browser for testing

### Setup
```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Lint code
npm run lint

# Validate everything
npm run validate
```

### Testing
The project includes comprehensive test coverage with **91%+ code coverage**:
- **Unit Tests**: Individual module testing with Jest
- **Direct Import Tests**: Coverage-tracked testing of shared modules
- **Integration Tests**: Component interaction testing  

**Current Test Results:**
- ✅ **37 tests passing**
- ✅ **91.66% statement coverage**
- ✅ **89.28% branch coverage** 
- ✅ **100% function coverage**

Run tests with:
```bash
npm test                # All tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
npm run test:ci         # CI mode with full reporting
```

### Project Structure
```
├── manifest.json           # Extension manifest
├── background.js           # Service worker (background script)
├── content-script.js       # Content script for target pages
├── override.js            # WebRTC hook injection script
├── popup.html/js          # Extension popup UI
├── options.html/js        # Options page UI
├── shared/                # Shared modules
│   ├── config.js          # Centralized configuration
│   ├── domains.js         # Domain management utilities
│   └── storage.js         # Storage abstraction layer
├── tests/                 # Test suite (91%+ coverage)
│   ├── modules/           # Jest-compatible module wrappers  
│   ├── unit/              # Unit tests (37 tests passing)
│   ├── utils/             # Test utilities and helpers
│   ├── setup.js           # Jest test setup
│   └── setupAfterEnv.js   # Jest environment configuration
├── assets/                # Static assets
├── grafana/               # Grafana dashboard examples
└── .github/workflows/     # CI/CD pipelines
```

## Metrics

The extension exports various WebRTC metrics including:

- **Connection Metrics**: Bytes sent/received, packet loss, jitter
- **Quality Metrics**: Round-trip time, quality limitation reasons
- **Media Metrics**: Audio/video codec information, frame rates
- **Agent Metrics**: Connection counts, session duration

All metrics include labels for:
- `agent_id`: Configured agent identifier
- `connection_id`: Unique peer connection ID
- `origin`: Source domain (e.g., meet.google.com)
- `platform`: Detected platform type

## CI/CD

The project includes GitHub Actions workflows for:
- **Automated Testing**: Unit, integration, and E2E tests
- **Code Quality**: Linting and security scanning
- **Extension Validation**: Manifest and API compatibility checks
- **Performance Testing**: Load time and execution benchmarks
- **Build Validation**: Extension packaging and artifact creation

## Roadmap

### Phase 1: Foundation ✅
- [x] Eliminate DRY violations
- [x] Create shared modules
- [x] Implement comprehensive testing (91%+ coverage)
- [x] Setup CI/CD pipeline with automated testing

### Phase 2: Architecture (In Progress)
- [ ] Decompose monolithic background script
- [ ] Enhanced error handling with retry logic
- [ ] Comprehensive input validation

### Phase 3: Robustness
- [ ] Circuit breaker patterns
- [ ] Health monitoring and auto-recovery  
- [ ] Memory optimization and cleanup

### Phase 4: DevEx & Quality
- [ ] Advanced build tooling
- [ ] Performance monitoring
- [ ] Enhanced debugging tools

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass: `npm run validate`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For issues, feature requests, or questions:
- Open an issue on GitHub
- Check the [troubleshooting guide](tests/README.md)
- Review the [development documentation](CLAUDE.md)

## Acknowledgments

- Built for enterprise call center monitoring and analysis
- Designed for integration with Prometheus and Grafana
- Supports modern Chrome extension Manifest V3