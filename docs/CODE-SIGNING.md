# Windows code signing

## Why signing is required

The NSIS artifacts produced by pushes to `main` are development/test builds. They may be unsigned when no signing certificate is configured. Smart App Control can block an unknown unsigned app, so these artifacts must not be presented as consumer-ready installers.

A version tag (`v*`) is treated as a release. The Windows workflow requires valid Authenticode signatures on every packaged `.exe`, `.dll`, and `.node` binary before it uploads the release artifact. The GitHub Release job only runs after this verification succeeds.

## Configure a trusted certificate

The repository owner must obtain a code-signing certificate from a provider trusted by the Microsoft Trusted Root Program. Then configure these repository Actions secrets:

- `WIN_CSC_LINK`: the PFX/P12 certificate file as a one-line Base64 value, or an HTTPS link accessible to the runner.
- `WIN_CSC_KEY_PASSWORD`: the certificate's private-key password.

Do not commit certificate files, private keys, passwords, or Base64 certificate material to Git. Do not paste them into issues, pull requests, chat, or build logs. The workflow injects these secrets only into the Windows packaging step. electron-builder uses them to sign the installer and application binaries.

The version-tag workflow fails before artifact upload if a valid Code Signing signature cannot be verified. A successful build alone does not establish Smart App Control acceptance; Microsoft may still use its app intelligence service to block files it identifies as unsafe.

## Options for this project

- A traditional OV Authenticode certificate is a broadly available paid option. Microsoft documents typical pricing around USD $150–300 per year, depending on the provider and certificate.
- Microsoft Artifact Signing has regional eligibility limits. Microsoft's current documentation lists individual developers only in the United States and Canada, and organizations in the United States, Canada, European Union, and United Kingdom. An individual developer in Egypt is not currently listed as eligible.
- SignPath Foundation offers free signing to qualifying open-source projects, but acceptance is not automatic. Its conditions include an OSI-approved open-source license for all project components, an actively maintained and already released project, published code-signing policy, team roles and MFA, and release approval/origin-verification controls. This repository currently has no `LICENSE` file and is marked `private` in `package.json`, so it is not currently ready to claim eligibility. Choosing an open-source license is a legal/product decision and must not be done automatically.

Do not use a self-signed certificate for public releases; it is not trusted by Windows by default and does not solve Smart App Control blocking for ordinary users.
