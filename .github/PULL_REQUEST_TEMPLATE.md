# Pull Request

## Description
Brief description of changes made.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Performance improvement
- [ ] Test improvements

## Testing
- [ ] All existing tests pass (`npm test`)
- [ ] Linting passes (`npm run lint:check`)
- [ ] New tests added for new functionality
- [ ] Manual testing completed on target platforms

## Critical Changes Checklist
If you've modified any of these files, please verify:

### RTCPeerConnection Interception (`override.js`)
- [ ] `Object.defineProperty(window, 'RTCPeerConnection')` still present
- [ ] Proxy constructor calls `webrtcInternalsExporter.add(pc)`
- [ ] Stats collection still works via `collectStats()`
- [ ] Connection state change handlers intact

### Content Script (`content-script.js`)
- [ ] Script injection still works
- [ ] Message passing to background script functional
- [ ] Options loading and domain checking intact

### Background Script (`background.js` or `background/`)
- [ ] Message handler responds to `peer-connection-stats` events
- [ ] Circuit breaker functionality preserved
- [ ] Pushgateway client integration working

### Manifest (`manifest.json`)
- [ ] Version updated if needed
- [ ] All required permissions present
- [ ] Content script matches include target domains
- [ ] Manifest V3 compliance maintained

## Regression Testing
- [ ] Tested on Microsoft Teams
- [ ] Tested on Google Meet
- [ ] Tested circuit breaker failure scenarios
- [ ] Verified metrics export to Pushgateway
- [ ] Confirmed no memory leaks in long-running sessions

## Documentation
- [ ] README updated if needed
- [ ] Code comments added for complex logic
- [ ] API documentation updated if applicable

## Security
- [ ] No hardcoded secrets or credentials
- [ ] No new security vulnerabilities introduced
- [ ] Input validation added where needed

## Performance
- [ ] No significant performance degradation
- [ ] Memory usage remains stable
- [ ] Extension package size acceptable

## Breaking Changes
If this is a breaking change, describe:
1. What breaks
2. How to migrate
3. Why the change is necessary

## Additional Notes
Any additional information, context, or considerations for reviewers.