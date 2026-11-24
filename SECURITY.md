# Security

## Supported application runtime

The application should use a currently supported Electron stable release. Electron's upstream policy supports only the latest three stable major releases. The project roadmap tracks runtime updates and requires TypeScript checks, unit tests, an Electron build, and a Windows installer build after an Electron upgrade.

## Local archive data

Facebook exports can contain private conversations, personal identifiers, and sensitive activity. The application is designed to process archives locally. Do not attach an unredacted Facebook export, application database, media file, or backup to a public issue or pull request.

For bug reports, provide synthetic examples, sanitized logs, and the smallest reproducible description possible. Keep archive paths and identifiers redacted.

## Reporting a security issue

Use GitHub's private vulnerability reporting feature from the repository Security tab when it is enabled. Do not publish exploit details or private archive data in a public issue.

## Windows signing

Windows installers are unsigned unless trusted Authenticode signing credentials are configured. An unsigned build can be blocked by Smart App Control. The release page must state signing status accurately; a successful build is not evidence that Windows will trust the installer.
