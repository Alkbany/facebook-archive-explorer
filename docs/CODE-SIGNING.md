# Windows code signing and Smart App Control

## What the current build does

The application is built with Electron and packaged by electron-builder as a per-user NSIS installer. The Windows build includes the main application executable, Electron runtime DLLs, helper binaries, an installer, and an uninstaller.

The repository does not currently have a trusted Windows signing certificate configured. The latest successful Windows build log explicitly reported that signing was skipped for the main application executable, bundled DLLs, NSIS installer, and uninstaller. That is why the build can pass CI and still be blocked by Smart App Control.

This is not an Electron runtime or TypeScript compilation error. Electron apps are not automatically trusted because they use Electron. Another Electron application may run because Microsoft already recognizes its files, because its publisher signed all relevant binaries with a trusted certificate, or because Smart App Control is not enforcing on that device. We cannot identify which explanation applies to a different application without inspecting its actual file signatures and Windows security state.

## Personal-use builds

A paid certificate is not required to build this application or test it on a device where Smart App Control is not enforcing. Main-branch CI uploads an unsigned Windows test installer. The beta release pipeline also supports unsigned installers so early builds can be tested without purchasing a certificate.

Smart App Control does not offer a per-application allow-list for an unknown unsigned program. For personal testing, the Windows-supported local option is to turn Smart App Control off in Windows Security while testing this application. Keep Microsoft Defender Antivirus enabled. Turning Smart App Control off is a local device choice, not a workaround to recommend to other users or a substitute for signing.

Microsoft references:
- [Smart App Control overview](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)
- [Smart App Control for Windows](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/smart-app-control)

## Release version policy

- v0.1.0-beta.1, v0.1.0-beta.2, and later v0.x.y-beta.n tags are early-access pre-releases. They can be published unsigned and are clearly marked as pre-releases on GitHub.
- v1.0.0 is the first stable product release. It will be published only after the release-readiness checklist in the roadmap has been completed. The release pipeline will sign and verify binaries when a trusted certificate is configured; without one, it can still publish an explicitly labelled unsigned build for the owner's personal use.
- Later releases follow Semantic Versioning: patch releases for compatible fixes, minor releases for backward-compatible features, and major releases for breaking changes.

When a certificate is configured, electron-builder signs the main executable, installer, uninstaller, and additional binary extensions listed in package.json under build.win.signExts. The PowerShell verification step checks every packaged .exe, .dll, .node, .sys, and .ocx binary for a valid Authenticode signature with the Code Signing EKU before the installer is attached to the release.

## Configure a trusted certificate

For signed redistribution, obtain a code-signing certificate from a provider trusted by the Microsoft Trusted Root Program, then configure these repository Actions secrets:

- WIN_CSC_LINK: the PFX/P12 certificate file as a one-line Base64 value, or an HTTPS link accessible to the runner.
- WIN_CSC_KEY_PASSWORD: the certificate's private-key password.

Never commit certificate files, private keys, passwords, or Base64 certificate material to Git. Do not paste them into issues, pull requests, chat, or build logs.

A valid signature is the trusted-certificate path used by Smart App Control when Microsoft cannot otherwise recognize an application. It does not guarantee immediate SmartScreen reputation or remove all first-run warnings. Do not use a self-signed certificate as a public-distribution workaround.
