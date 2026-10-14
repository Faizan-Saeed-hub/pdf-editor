# Security Policy

PDF Faiz is a browser-first PDF toolkit. The core privacy promise is that user PDF files are processed locally in the browser and are not uploaded to a PDF Faiz server for normal tool workflows.

## Reporting a vulnerability

If you find a security issue, please report it privately instead of opening a public issue.

Security contact: please use the project owner's support contact.

Please include:

- a short summary
- affected area or route
- reproduction steps
- expected impact
- screenshots or proof of concept if useful

## Scope

Security reports that matter most:

- unexpected upload or leakage of user PDF files
- unsafe handling of PDF content
- cross-site scripting
- dependency vulnerabilities with a realistic exploit path
- deployment or caching behavior that exposes private user data

## Out of scope

- issues that require a compromised browser or device
- reports without a practical security impact
- automated dependency reports without a working exploit path

## Supported version

Only the current production version at your deployed PDF Faiz site is supported.
