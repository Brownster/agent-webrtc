# Branch Protection Configuration

To prevent regressions and ensure code quality, configure the following branch protection rules for the `master` branch:

## Required Settings

Navigate to: Repository Settings → Branches → Add branch protection rule

### Branch name pattern
```
master
```

### Protection Rules

#### Require a pull request before merging
- [x] Require a pull request before merging
- [x] Require approvals: **1**
- [x] Dismiss stale reviews when new commits are pushed
- [x] Require review from code owners (if CODEOWNERS file exists)

#### Require status checks to pass before merging
- [x] Require status checks to pass before merging
- [x] Require branches to be up to date before merging

**Required status checks:**
- `Test Suite (18.x)`
- `Test Suite (20.x)` 
- `Validate Extension`
- `Security Scan`
- `Build Validation`
- `Regression Test`
- `Browser Compatibility`

#### Require conversation resolution before merging
- [x] Require conversation resolution before merging

#### Other restrictions
- [x] Restrict pushes that create files larger than 100MB
- [x] Require linear history (optional - prevents merge commits)

#### Rules applied to administrators
- [x] Include administrators (recommended for consistency)

## CLI Configuration (Alternative)

If you prefer to configure via GitHub CLI:

```bash
gh api repos/Brownster/agent-webrtc/branches/master/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Test Suite (18.x)","Test Suite (20.x)","Validate Extension","Security Scan","Build Validation","Regression Test","Browser Compatibility"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --field required_conversation_resolution=true
```

## Additional Recommendations

1. **Create CODEOWNERS file** to automatically request reviews from specific team members:
   ```
   # Global owners
   * @Brownster

   # Critical files require extra review
   override.js @Brownster @webrtc-expert
   background.js @Brownster @webrtc-expert
   manifest.json @Brownster @webrtc-expert
   ```

2. **Set up automatic dependency updates** with Dependabot:
   ```yaml
   # .github/dependabot.yml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule:
         interval: "weekly"
       reviewers:
         - "Brownster"
   ```

3. **Enable security alerts** in repository settings for vulnerability scanning

4. **Configure notification settings** to alert on failed CI runs

These settings ensure that:
- All code goes through peer review
- Tests must pass before merging
- Critical functionality is protected from breaking changes
- Security vulnerabilities are caught early
- Extension quality remains high