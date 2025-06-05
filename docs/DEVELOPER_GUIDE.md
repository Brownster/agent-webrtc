# Developer Guide

This document provides guidelines for contributing to **WebRTC Stats Exporter Pro** and explains how to set up a local development environment.

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```
2. **Open Extension in Chrome**
   - Navigate to `chrome://extensions`
   - Enable *Developer mode*
   - Click **Load unpacked** and select the repository root

3. **Run Tests**
   ```bash
   npm test
   ```

4. **Lint Source Code**
   ```bash
   npm run lint
   ```

Use `npm run validate` to run linting and the full test suite.

## Recommended Workflow

1. **Create a feature branch** for your changes.
2. **Write tests first** whenever possible.
3. Make your code changes.
4. Run `npm run validate` to ensure the project passes linting and tests.
5. Submit a pull request.

## Packaging the Extension

To create a production-ready zip archive:
```bash
npm run package:zip
```
The output is placed in the repository root and can be uploaded to the Chrome Web Store or loaded manually.

## Debugging Tips

- Use `npm run test:watch` to run tests in watch mode while developing.
- Add `console.log` statements for temporary debugging—tests suppress output by default.
- Use the `tests/mocks/` utilities when writing new tests for Chrome APIs.

## Directory Overview

- **background/** – Core background modules and reliability logic.
- **shared/** – Reusable utilities and configuration.
- **tests/** – Jest test suite with high coverage.
- **scripts/package-extension.js** – Packaging script used by `npm run package:zip`.

Refer to the [main README](../README.md) for a detailed project overview and the [tests README](../tests/README.md) for testing guidance.
