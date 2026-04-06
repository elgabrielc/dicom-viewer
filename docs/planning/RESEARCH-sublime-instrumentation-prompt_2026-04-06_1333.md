# Research: Sublime Text Analytics & Instrumentation Benchmarking

## Summary

Sublime Text operates with near-zero telemetry and has been commercially successful doing so (~$2.6M revenue, 25M+ users, 3-5 person team, bootstrapped). Telemetry existed briefly in 2013 dev builds, was removed after community pushback, and never returned. The only phone-home is license revocation checks. Package Control install data serves as an indirect proxy for usage analytics. Notably, Sublime HQ has no published privacy policy -- behavior is excellent but undocumented. For a medical imaging app, Panic (Nova) provides the better documentation template.

---

## 1. What Usage Data Does Sublime Text Collect?

### License Revocation Check (Active)

Contacts `license.sublimehq.com` ~10 seconds after every launch:

```
GET http://license.sublimehq.com/check/[license_hash]?n=[param]&b=[param]&m=[param]
User-Agent: sublime-license-check/3.0
```

The license key is hashed before transmission. Will Bond (wbond, Sublime HQ staff) confirmed the purpose: "Sublime Text does a check to see if the currently-installed license has been revoked. This allows things like refunds, and preventing the spread of compromised license keys."

Blocking the endpoint via hosts file or firewall causes no functional degradation. Only Jon Skinner and Will Bond have access to the server data.

### Telemetry (Removed)

Timeline in Sublime Text 3:
- **Build 3023** (April 2013): Added telemetry, disabled by default. Collected: computer specs, startup time, installed packages, edited file types. "File names and file contents are never included."
- **Build 3029** (April 2013): Enabled by default in dev builds.
- **Build 3064**: Permanently disabled and later removed entirely.

The `enable_telemetry` setting still appears in documentation but the feature is dead. The community pushback was immediate and decisive.

### Crash Reporter (Inactive)

A crash reporter exists in the binary but wbond stated "the server used for reporting is not currently accepting requests." Effectively dead.

### Update Checks (Active)

Checks for updates on startup. Disablable with `"update_check": false` for paid users. Unregistered users cannot disable it (enforced to show upgrade nag). No documentation on what data is transmitted beyond version/platform.

### Network Connection Summary

| Endpoint | Purpose | Disablable? | Data Sent |
|----------|---------|-------------|-----------|
| `license.sublimehq.com` | License revocation | Hosts file/firewall only | Hashed license, build, params |
| Update server | Version check | Settings (paid only) | Version, platform (presumed) |
| Crash reporter | Crash dumps | N/A (server inactive) | N/A |
| Telemetry | Usage stats | N/A (removed in 2013) | N/A |

---

## 2. What Does Sublime Text Know About Its Users?

### Purchase Data
- Email address, name (on license), payment via Stripe or PayPal
- Business accounts: company name, seat count, invoice address, VAT ID
- Sublime HQ does not store card numbers (Stripe handles PCI)

### Derivable Metrics (Without Telemetry)
- License sales volume (Stripe/PayPal)
- Approximate active user count (license check server logs)
- Platform/version distribution (User-Agent from license checks)
- Package Control stats (see below)
- Download counts (web analytics)
- Forum/GitHub engagement (qualitative)

### What They Cannot Measure
- Feature usage (which features, how often)
- Session duration or engagement depth
- File types, languages, or workflow patterns
- Where users get stuck or abandon tasks
- Churn signals or abandonment reasons
- Whether new features are adopted after release

### Package Control as Proxy Analytics

Package Control (the package manager, now maintained by wbond at Sublime HQ) is the richest data source:

- **25.31 million total users** (Windows: 16.02M, macOS: 5.55M, Linux: 3.75M)
- **~7,000 package installs per day**
- **5,619 packages** from 4,008 authors
- Records installs, upgrades, removals with OS, ST version, PC version, package versions

wbond: "I am the only person who has access to the server and database. It is never sent or made available to anyone other than myself." Users can disable reporting via Package Control settings.

This data tells Sublime HQ what workflows matter (popular packages = popular use cases) without instrumenting the editor itself.

---

## 3. Privacy Policy and Public Statements

### No Published Privacy Policy

`sublimehq.com/privacy` returns 404. The EULA (`sublimetext.com/eula`) contains zero clauses about data collection, telemetry, analytics, network connections, or privacy. It covers only licensing, warranties, and liability.

This is a notable gap. Even for a privacy-friendly product, no formal policy means no enforceable commitment. For a medical imaging app, this would be unacceptable.

### Staff Statements (In Lieu of Policy)

The closest thing to official privacy stances comes from wbond forum posts:
- License check justification: revocation for refunds and compromised keys
- Telemetry "permanently disabled" and "later removed"
- Package Control data: "I am the only person who has access"
- Crash reporter: server "is not currently accepting requests"

Jon Skinner has made no public statements about telemetry philosophy. In his 2018 HN AMA (Sublime Merge launch), he discussed product strategy and technical decisions but said nothing about privacy.

### Community Perception

On Hacker News, Sublime is frequently recommended as a privacy-focused VS Code alternative. The reputation is earned through absence of collection rather than explicit privacy marketing. The community trust is high but rests on informal commitments.

---

## 4. Product Decisions Without Analytics

### Feedback Channels
1. **GitHub Issues** (`github.com/sublimehq/sublime_text`): Primary structured feedback. Reaction-based voting. "+1 comments with no further content will be deleted."
2. **Forum** (`forum.sublimetext.com`): Discourse-based, long-form, searchable.
3. **Discord**: Real-time community chat (community-run). Staff noted Discord discussions are "consumed immediately and not searchable on Google."
4. **Dev/Beta builds**: Frequent dev releases, power users provide early feedback.

### Decision Model

Jon Skinner operates as a product-focused founder-developer:
- **Opinionated design**: Sublime Merge ships as a separate product rather than integrated Git -- a design principle choice over user requests.
- **Taste-driven**: Architectural choices based on principles, not user polls.
- **Slow, deliberate releases**: ST4 took years. Community sometimes cries "abandonware" but releases are consistently high-quality.
- **Plugin ecosystem as escape valve**: 5,619 packages handle "nice to have" features, keeping the core lean.

### The Gap

Without telemetry, Sublime HQ cannot answer: which features are used, where users struggle, what languages/workflows dominate, whether new features are adopted, or why users leave. They compensate with Package Control proxy data, GitHub issue volume, qualitative forum feedback, and strong product vision.

---

## 5. Update Mechanism

### Core Editor
- Checks on startup, endpoint URL not publicly documented
- `"update_check": false` disables for paid users
- No auto-install -- dialog presented, user chooses
- The ST4 team acknowledged the dialog initially "lacked transparency"

### Package Control
- Independently checks `packagecontrol.io` for package updates
- Sends: OS, ST version, PC version, package versions
- Serves ~8.1GB of JSON metadata per day
- Disablable via Package Control settings

### Package Telemetry Policy (Post-Kite Incident)
In 2017, the popular SideBarEnhancements package was caught secretly sending user data to Kite (an AI startup). Package Control responded with strict rules:
- Any telemetry in packages must be opt-in
- Packages collecting user info without consent are immediately removed
- All submitted packages are reviewed before inclusion

---

## 6. Comparison to VS Code and Nova

### VS Code (Microsoft) -- Extensive Telemetry

Collects by default:
- Crash reports, unexpected errors with scrubbed stack traces
- Feature utilization, performance metrics, startup time
- Extension activation, file types opened
- Workspace identification (hashed Git remotes)
- User identification via hashed MAC address

Disabling telemetry (`telemetry.telemetryLevel: "off"`) blocks access to A/B experiments and early features. Third-party extensions can send their own telemetry independently. VSCodium exists as a community rebuild specifically to strip Microsoft's telemetry.

### Nova (Panic) -- Moderate, Transparent

Panic's stance: "your data is none of our business." Collects by default (opt-out):
- Feature usage, performance metrics, error logs
- Limited identifiers, pseudonymized where feasible
- Third-party analytics: Memfault, Telemetry Deck, App Center
- **30-day retention** only

Does NOT collect: keyboard input, screen contents, network traffic, hostnames, passwords, SSH keys, file contents. Opt-out via macOS Preferences.

### Comparison Matrix

| Dimension | Sublime Text | VS Code | Nova (Panic) |
|-----------|-------------|---------|--------------|
| Usage telemetry | Removed (2013) | Extensive, on by default | Moderate, on by default |
| Crash reporting | Exists but inactive | Active, default on | Active, default on |
| User identification | None (hashed license) | Hashed MAC address | Limited, pseudonymized |
| Feature usage tracked | No | Yes | Yes (aggregated) |
| File types tracked | No | Yes | No |
| Update check | Yes, disablable (paid) | Yes, disablable | Yes, disablable |
| Privacy policy | None published | Detailed | Very detailed |
| Data retention stated | No | No explicit limit | 30 days |
| Third-party analytics | None | Microsoft internal | Named vendors |
| Opt-out mechanism | N/A | Settings toggle | Preferences checkbox |
| Price | $99 (3yr updates) | Free | $99 (1yr updates) |

---

## 7. Company Context

- **Founded**: 2007 by Jon Skinner (ex-Google)
- **Location**: Woollahra, Sydney, Australia
- **Team**: 3-5 employees
- **Revenue**: ~$2.6M estimated (bootstrapped, no VC)
- **Products**: Sublime Text ($99), Sublime Merge ($99), Bundle ($168), Business subs ($50-65/seat/year)
- **User base**: 25.31M via Package Control

---

## 8. Applicability to Our App

### Key Takeaways

1. **Near-zero telemetry can sustain a profitable desktop business.** Sublime proves it. But it works because the product is opinionated, the team is tiny, and the plugin ecosystem provides proxy metrics.

2. **The lack of a privacy policy is a gap, not a feature.** Sublime's behavior is excellent but undocumented. For medical imaging, we need both the behavior AND the enforceable policy. Panic's privacy policy is the gold standard template.

3. **Package Control is the clever proxy.** Install data reveals what workflows matter without instrumenting the editor. For us, the equivalent might be: which sample scans get loaded, which modalities appear, which tools get used -- but these are better measured directly with local counters.

4. **We need more signal than Sublime has.** A text editor is a simple tool -- you type, it edits. A medical imaging app has more feature surface (viewer tools, library management, notes, measurements, modality-specific behavior). Understanding which features matter is more critical for our product decisions.

5. **The SideBarEnhancements/Kite incident is a cautionary tale.** Third-party code sending user data without consent destroyed community trust instantly. Any instrumentation we add must be transparent and user-visible.

### Where We Land

Between Todoist (full server-side analytics) and Sublime (near-zero telemetry), our ADR 008 approach sits in the middle: local counters, user-visible, no network. This gives us the product signal Sublime lacks while preserving the privacy posture that medical imaging demands. When we go web-first, we move toward Todoist's model with server-side computation and aggregate analytics.

---

## Sources

- [Sublime Text Forum: license.sublimehq.com discussion](https://forum.sublimetext.com/t/sublime-text-calling-home-to-license-sublimehq-com-on-every-start/33474)
- [Sublime Text Forum: telemetry discussion](https://forum.sublimetext.com/t/is-st-calling-home-telemetry/25137)
- [Sublime Text Forum: network audit](https://forum.sublimetext.com/t/network-or-security-audits-of-sublime-text/12161)
- [ST3 Changelog](https://gist.github.com/zchee/587094fd1f1c8e51ff7f)
- [Package Control Stats](https://packagecontrol.io/stats)
- [Package Control Telemetry RFC](https://forum.sublimetext.com/t/rfc-default-package-control-channel-and-package-telemetry/30157)
- [Jon Skinner HN AMA (2018)](https://news.ycombinator.com/item?id=18030450)
- [VS Code Telemetry Docs](https://code.visualstudio.com/docs/configure/telemetry)
- [Panic Privacy Policy](https://panic.com/privacy/)
- [Sublime Text EULA](https://www.sublimetext.com/eula)
- [Sublime HQ Store](https://www.sublimehq.com/store/text)
