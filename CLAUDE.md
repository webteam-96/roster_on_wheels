## Start here

**The project is `row/`.** `reference/` (RIZones) is only a source to copy from: never run it, connect to its servers/databases, or treat its settings as ROW's. ROW has no production database yet.

**Resuming work? Read `row/HANDOFF.md` first:** what was done last, the next task, and how to run things locally.

Then read `kb/README.md`: it maps the codebases (ROW api / workers / admin / club-website / mobile, all under
`row/`, plus the RIZones reference API + Flutter app), the generated ROW-vs-RIZones diffs, the document index and the
testing record. **Stack (finalized 2026-10-15): Next.js frontend + ASP.NET Core (.NET) backend.** The earlier NestJS
port has been deleted. Progress and decisions live in `row/STATUS.md` and `row/ROW-CHANGES.md`; pending work and why it
is pending is in `row/PENDING-WORK.md`.
Do not re-read whole codebases to orient: use the diffs in `kb/` and the graphify queries below.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.
graphify is at `~/.local/bin/graphify.exe` (not on PATH). `graphify-out/graph.json` merges the per-codebase graphs; each
node's `repo` says which codebase it is from. To stay inside one codebase pass
`--graph graphify-out/parts/<tag>/graphify-out/graph.json` (tags: api, workers, admin, club-website, mobile, ref-api,
ref-mobile). Run `bash kb/rebuild.sh` once to regenerate the graphs after the folder restructure.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `bash kb/rebuild.sh` (graphs + diffs; `--no-graphs` for diffs only). Code-only, no API cost.

## Agent skills

### Issue tracker

GitHub Issues on webteam-96/roster_on_wheels, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- BACKEND-CHECKLIST:START -->
## Backend Engineering Checklist

Keep these in mind on every backend task in this project. Apply what fits the project's actual scale — don't add Kubernetes, sharding or sagas to a small app just to tick a box. When writing or reviewing backend code, flag any item that is being violated or ignored where it matters.

**Rules of thumb**
- Every external call has a timeout; retries use exponential backoff + jitter and only on idempotent operations.
- Every write endpoint that can be retried (payments, orders, webhooks) needs an idempotency key.
- No N+1 queries; check indexes for every new query on a large table.
- Never log secrets, tokens or PII. Secrets come from env/secret manager, never the repo.
- Every schema change ships as a reversible migration.
- Validate and parameterize all input — no string-built SQL, escape output, lock down CORS.
- New services/endpoints get health checks, structured logs, and basic metrics from day one.

### Traffic & Edge
1. Rate Limiting · 2. Caching · 3. Load Balancing · 4. Reverse Proxies · 5. API Gateways · 48. CDN · 49. Edge Caching · 50. Cache Invalidation

### Build, Ship & Deploy
6. CI/CD · 7. Docker · 8. Kubernetes · 51. Feature Flags · 52. Blue-Green Deployment · 53. Canary Releases · 54. Rolling Deployments · 55. Rollbacks · 104. Infrastructure as Code · 105. Terraform · 106. Helm Charts · 107. Build Caching · 108. Dependency Hell

### Resilience
9. Service Discovery · 10. Circuit Breakers · 11. Timeouts · 12. Retries · 13. Exponential Backoff · 14. Idempotency · 44. Backpressure · 56. Health Checks · 57. Liveness & Readiness Probes · 87. Chaos Engineering

### Async & Messaging
15. Message Queues · 16. Pub/Sub · 17. Event-Driven Architecture · 18. Distributed Transactions · 19. Saga Pattern · 20. Dead Letter Queues · 21. Cron Jobs · 101. Webhooks

### Real-time
22. WebSockets · 23. Long Polling · 24. Server-Sent Events

### Database
25. Database Indexing · 26. Query Optimization · 27. N+1 Queries · 28. Connection Pooling · 29. Read Replicas · 30. Sharding · 31. Partitioning · 32. Replication · 81. Database Migrations · 82. Schema Versioning

### Distributed Systems & Consistency
33. Leader Election · 34. CAP Theorem · 35. Eventual Consistency · 36. Optimistic Locking · 37. Pessimistic Locking · 38. Distributed Locks · 95. Network Partitions · 96. Clock Skew

### Concurrency & Runtime
39. Race Conditions · 40. Deadlocks · 41. Memory Leaks · 42. Garbage Collection · 43. Thread Safety

### Scaling & Cost
45. Autoscaling · 46. Horizontal Scaling · 47. Vertical Scaling · 88. Cost Optimization · 89. Cold Starts · 90. Serverless Limits

### Performance
91. Latency · 92. Throughput · 93. P99 Latency · 94. Tail Latency

### Observability & Reliability
58. Monitoring · 59. Logging · 60. Distributed Tracing · 61. Metrics · 62. Alerts · 63. SLOs · 64. SLIs · 65. Error Budgets · 66. Observability

### Security
67. Secrets Management · 68. IAM · 69. OAuth · 70. JWT Rotation · 71. TLS · 72. Encryption at Rest · 73. Encryption in Transit · 74. WAF · 75. DDoS Protection · 76. CORS · 77. CSRF · 78. SQL Injection · 79. XSS · 80. SSRF

### Disaster Recovery
83. Disaster Recovery · 84. Backups · 85. Failover · 86. Multi-Region Deployment

### Networking & Protocols
97. DNS · 98. TCP vs UDP · 99. HTTP/2 & HTTP/3 · 100. gRPC

### API Contracts
102. API Versioning · 103. Semantic Versioning

### Operations
109. Production Incidents · 110. On-Call · 111. Postmortems
<!-- BACKEND-CHECKLIST:END -->

<!-- FRONTEND-RULES:START -->
## Frontend Design Rules (Anti-Slop)

These patterns make a UI look generic and AI-generated. Do not use them on any UI task in this project unless the user explicitly asks for one. When reviewing or writing UI, flag any violation.

### Color
1. No harsh gradients. Use solid colors or very subtle tonal shifts.
2. No rainbow coloring. Use one brand color plus neutrals and at most one accent.
3. No pure white (#FFFFFF) backgrounds. Use an off-white or tinted neutral.
4. No purple-and-black palettes.
5. No neon colors.
6. No basic, default pastel palettes. If pastels are used, tune them to the brand.

### Typography & Copy
7. No Inter, Geist, or Space Grotesk. Pick a typeface with character that fits the brand.
8. No em dashes in UI copy. Use periods, commas, or colons.
9. No emoji in UI or copy.
10. No "It's not X, it's Y" phrasing.
11. No fake testimonials. Use real quotes with real names, or leave the section out.

### Icons & Decoration
12. No Lucide icons by default. Use a different set, custom icons, or no icons.
13. No sparkle icons.
14. No animated arrows.
15. No radial glow orbs in backgrounds.
16. No dot-grid backgrounds.
17. No liquid glass / glassmorphism.
18. No drop shadows as the default way to separate elements. Use spacing, borders, or tonal contrast.

### Layout & Components
19. No row of 3 feature cards.
20. No 3-tier pricing table by default. Match pricing to the actual business model.
21. No colored left strip on cards or callouts.
22. No checkmark bullet lists.
23. No soft, uniform rounded corners on everything. Choose a deliberate radius (including sharp) and keep it consistent.

### Motion
24. No hover animations on everything. Animate only where it gives feedback or meaning.

### Must Include
25. Skeleton loaders for every async content area. No blank screens or lone spinners.
26. A real product demo: actual screenshots, video, or an interactive preview. No placeholder mockups.
27. A Terms of Service page, linked in the footer.
28. A Privacy Policy page, linked in the footer.
<!-- FRONTEND-RULES:END -->

<!-- SECURITY-CHECKLIST:START -->
## Security Checklist

Check every change in this project against these items. When writing or reviewing code, flag any item being violated. Never trade one of these away for speed without telling the user.

**Rules of thumb**
- Every endpoint checks authentication AND that this user may access this specific record (no IDOR).
- Never trust the client: validation, prices, roles, and permissions are enforced on the server.
- Secrets live only in env vars or a secret manager. Never in code, the repo, frontend bundles, or logs.
- Parameterize every query and never pass user input to a shell, file path, or outbound URL unchecked.
- Production shows generic errors; details go to logs (with secrets and PII stripped).
- Least privilege everywhere: DB users, cloud roles, API keys, AI tools.

### Secrets & Config
1. Exposed DB credentials · 2. Public `.env` files · 3. Hardcoded secrets · 12. Secrets in JavaScript · 15. Secrets in Git · 26. JWT secrets · 30. Default credentials

### Authentication & Sessions
4. Weak authentication · 24. Broken password reset · 25. Weak session management · 47. Insecure cookie settings · 54. Misconfigured OAuth

### Authorization & Access Control
5. Missing authorization checks · 6. Cross-user access · 9. Unprotected admin routes · 16. Client-only security · 33. IDOR / BOLA · 49. Poor tenant isolation · 51. Mass assignment

### Injection & Input Handling
13. Input validation · 14. SQL injection · 19. Cross-Site Scripting (XSS) · 22. Path traversal · 23. Server-Side Request Forgery (SSRF) · 34. APIs + user input · 52. Command injection · 53. Insecure deserialization

### APIs & Web
18. Insecure API endpoints · 20. Cross-Site Request Forgery (CSRF) · 27. Permissive CORS · 28. Rate limits · 31. Unsigned webhooks · 32. Frontend payment checks · 46. Missing security headers

### Files
21. Insecure file uploads

### Exposure & Information Leaks
10. Exposed production debug tools · 11. Verbose production errors · 17. Logs leaking secrets · 29. Exposed environments · 35. Exposed logs · 36. Exposed source maps · 45. Exposed internal dashboards

### Data & Infrastructure
7. Open database permissions · 8. Cloud service misconfigurations · 41. Excessive DB permissions · 44. No backups / restore · 48. Unencrypted data

### Supply Chain
37. Vulnerable dependencies · 38. Malicious packages

### AI Features
39. Prompt injection · 40. Unpermissioned AI access

### Monitoring & Process
42. Missing audit logs · 43. No security monitoring · 50. Unreviewed code
<!-- SECURITY-CHECKLIST:END -->
