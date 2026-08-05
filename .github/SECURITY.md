# Security Policy

## Supported Versions

We release updates to skills on a quarterly basis. Security issues are addressed as soon as possible.

| Version | Supported          |
| ------- | ------------------ |
| Latest (main branch) | ✅ |
| Older commits | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in any skill, please report it by:

1. **DO NOT** open a public issue
2. Email the maintainers (or use GitHub Security Advisories)
3. Include:
   - Affected skill(s)
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

## What to Expect

- **Response Time**: Within 48 hours
- **Updates**: Every 5-7 days during investigation
- **Resolution**: Security patches released ASAP
- **Credit**: Public acknowledgment in release notes (if desired)

## Security Best Practices

### For Skill Users

- ✅ Use skills from official marketplace only
- ✅ Keep skills updated (check quarterly)
- ✅ Review skill code before using in production
- ✅ Report suspicious patterns or vulnerabilities

### For Skill Contributors

- ✅ Never include credentials, tokens, or API keys
- ✅ Validate all user inputs in examples
- ✅ Follow SAP security best practices
- ✅ Use latest stable package versions
- ✅ Document known security considerations

## Automated Security Scanning

This repository is covered by two free GitHub features for public repos (no paid Advanced Security license required):

### CodeQL (Static Analysis)
- Workflow: [`.github/workflows/codeql.yml`](../workflows/codeql.yml) · Config: [`.github/codeql/codeql-config.yml`](../codeql/codeql-config.yml)
- Languages analyzed: **JavaScript/TypeScript**, **Python**, and **Java**.
- Runs on every push/PR to `main` that touches source code (content-only changes are ignored), plus a **weekly scheduled** scan to catch newly-released queries.
- Results appear in the repository's **Security → Code scanning alerts** tab.
- Note: Java analysis runs without a build (`build-mode: none`) because the repo has no Maven/Gradle build, so results are best-effort for the Eclipse plugin source.

### Dependabot (Dependency + Action Updates)
- Config: [`.github/dependabot.yml`](../dependabot.yml)
- Surfaces vulnerability advisories and opens PRs for outdated dependencies (npm) and pinned GitHub Actions, grouped weekly to reduce review load.

Findings from either tool are triaged like any other reported vulnerability (see *Reporting a Vulnerability* above).

## Known Security Considerations

### API Keys & Credentials
Skills provide guidance on SAP APIs and services. Always:
- Use environment variables for secrets
- Never hardcode credentials
- Follow SAP's security recommendations
- Implement proper authentication/authorization

### Package Dependencies
Skills reference npm packages and SDKs. Always:
- Verify package authenticity
- Check for known vulnerabilities
- Use lock files for reproducible builds
- Keep dependencies updated

## Scope

This security policy covers:
- ✅ Skills content and recommendations
- ✅ Documentation and examples
- ✅ Repository infrastructure

This policy does NOT cover:
- ❌ SAP products themselves (report to SAP)
- ❌ Third-party packages (report to package maintainers)
- ❌ Claude Code/Desktop platforms (report to Anthropic/Factory)

## Additional Resources

- [SAP Trust Center](https://www.sap.com/about/trust-center/security.html)
- [SAP Security Patch Day](https://support.sap.com/en/my-support/knowledge-base/security-notes-news.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Thank you for helping keep SAP Skills secure!** 🔒
