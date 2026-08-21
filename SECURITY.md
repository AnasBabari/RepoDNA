# Security policy

## Analysis trust boundary

Treat every analysed repository as hostile input. RepoDNA reads supported files as text and must never execute repository code, package-manager lifecycle scripts, shell scripts, Makefiles, Dockerfiles, hooks, or application entry points during ordinary analysis.

GitHub ingestion accepts only public `github.com/<owner>/<repository>` URLs. Archives are downloaded with explicit limits, checked for unsafe paths and expanded-size abuse, extracted to a temporary directory, analysed, and removed.

The visualizer accepts a local JSON artifact. It does not upload repository source.

## Reporting a vulnerability

Please avoid opening a public issue for an exploitable vulnerability. Use GitHub's private vulnerability reporting feature on this repository and include the affected version, reproduction steps, impact, and any suggested mitigation.

## Supported version

Until the first stable release, security fixes are made on `main` and included in the next tagged version.

