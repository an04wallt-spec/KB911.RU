# Project views
Bind a separate Cloudflare D1 database as MODEL_VIEWS to Pages production and apply migrations/0001_project_views.sql once before deployment.
Successful HTML GET requests increment an atomic per-project counter. HEAD, 404, upload, listing and deletion do not. Repeated requests and bots count; these are file openings, not unique visitors or proof that WebGL rendered. No IP addresses or visitor data are stored. Counting starts at deployment; earlier openings cannot be recovered.
Counts survive model replacement and deletion. Empty projects remain absent from the R2 project list; reusing a project name restores its historical total. Database failures preserve model access and show an unavailable counter instead of a false zero.
D1 writes do not consume R2 Class A operations, but D1 has its own usage limits. No new API token is needed.
Android keeps the existing signing identity; CI produces an unsigned APK for compilation checks, not installation. Final distribution requires the existing local signing key.
