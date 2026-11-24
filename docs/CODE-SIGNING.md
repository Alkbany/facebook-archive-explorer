# Windows code signing

## Personal-use test builds

A trusted code-signing certificate is not required just to build and use this application personally. The `main` workflow publishes an unsigned test installer for the project owner's own device. Smart App Control does not support a per-app allow-list; the supported personal-use workaround is to turn Smart App Control off in Windows Security while using this app. Keep Microsoft Defender Antivirus enabled. Recent Windows updates allow Smart App Control to be re-enabled in Windows Security; when enforcement is on again, an unsigned app can be blocked on its next launch.

See [Microsoft's Smart App Control FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) for the current user controls.

A version tag (`v*`) is treated as a release. The Windows workflow configures electron-builder to sign `.dll`, `.node`, `.sys`, and `.ocx` files in addition to its default executable signing. Before it uploads a version release, a PowerShell verification step checks every packaged `.exe`, `.dll`, `.node`, `.sys`, and `.ocx` binary for a valid Authenticode signature with the Code Signing EKU. The GitHub Release job only runs after this verification succeeds.

## Configure a trusted certificate for redistribution

This section is only needed before distributing signed builds to other people or publishing a version-tag release. It is not a prerequisite for the owner's personal-use test builds.

The repository owner must obtain a code-signing certificate from a provider trusted by the Microsoft Trusted Root Program. Then configure these repository Actions secrets:

- `WIN_CSC_LINK`: the PFX/P12 certificate file as a one-line Base64 value, or an HTTPS link accessible to the runner.
- `WIN_CSC_KEY_PASSWORD`: the certificate's private-key password.

Do not commit certificate files, private keys, passwords, or Base64 certificate material to Git. Do not paste them into issues, pull requests, chat, or build logs. The workflow injects these secrets only into the Windows packaging step. electron-builder uses them to sign the installer and application binaries.

The workflow verifies every packaged `.exe`, `.dll`, `.node`, `.sys`, and `.ocx` file before any installer artifact is uploaded. If the main-branch build has no certificate, CI reports a warning and deliberately skips uploading the unsigned installer. A version-tag build fails without the certificate or if verification fails. A successful signature check is a prerequisite, not a guarantee that Microsoft's cloud intelligence will classify an app as safe.

## Options for this project

- A traditional OV Authenticode certificate is a broadly available paid option. Microsoft documents typical pricing around USD $150–300 per year, depending on the provider and certificate.
- Microsoft Artifact Signing has regional eligibility limits. Microsoft's current documentation lists individual developers only in the United States and Canada, and organizations in the United States, Canada, European Union, and United Kingdom. An individual developer in Egypt is not currently listed as eligible.
- SignPath Foundation offers free signing to qualifying open-source projects, but acceptance is not automatic. Its conditions include an OSI-approved open-source license for all project components, an actively maintained and already released project, published code-signing policy, team roles and MFA, and release approval/origin-verification controls. This repository currently has no `LICENSE` file, so it is not currently an OSI-licensed open-source project and cannot claim eligibility. Choosing an open-source license is a legal/product decision and must not be done automatically.

Do not use a self-signed certificate for public releases; it is not trusted by Windows by default and does not solve Smart App Control blocking for ordinary users.


## Smart App Control: practical release rule

Do not ask users to disable Windows security and do not distribute self-signed builds as a workaround. Smart App Control does not provide a button to allow one specific unsigned app. For the app to run when Microsoft's intelligence service cannot make a confident safety prediction, sign the installer and every packaged executable with a valid certificate chained to a CA in Microsoft's Trusted Root Program.

Smart App Control and SmartScreen are related but different checks. A valid signature satisfies Smart App Control's signature fallback; SmartScreen may still show an "unrecognized app" warning until the publisher/file reputation grows. A new signature is not an instant SmartScreen reputation bypass.

The CI workflow now fails closed for version releases and skips publishing unsigned main-branch installers. Until a trusted signing identity is configured, a successful build is only a build-validation result, not a downloadable installer for a device enforcing Smart App Control.
