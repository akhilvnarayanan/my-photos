---
name: Restored web artifact registration
description: A restored web artifact can have a valid manifest and workflow but still be absent from the platform artifact registry.
---

When a project is restored from an archive, validate and replace the existing artifact manifest through the artifact lifecycle before relying on preview or presentation tooling; this registers the artifact without recreating its source directory.

**Why:** The web app and workflow can run locally while platform preview tools still report the artifact as missing.

**How to apply:** If listArtifacts omits an on-disk artifact with a valid `.replit-artifact/artifact.toml`, use a temporary copy with the manifest verification/replacement callback, then re-list artifacts before presenting.