# Crisperbooks

Offline ebook reading and editing for Flutter and Dart, extracted from
[CrispCloud](https://github.com/CrispStrobe/CrispCloud). The packages accept book
bytes and return data; your application controls files, accounts and persistence.

## Packages

| Package | Use it for |
| --- | --- |
| [`crisperbooks`](lib/crisperbooks.dart) | Flutter edit sessions, undo/redo, structured prose UI, portable EPUB reading, appearance and reading data |
| [`crisp_ebook`](packages/crisp_ebook) | Pure Dart EPUB metadata, content, structure and resource editing; EPUB/FB2/FBZ output |
| [`crisp_ebook_reader`](packages/crisp_ebook_reader) | Enhanced EPUB, MOBI/AZW/AZW3, FictionBook and CBZ reader with sandboxed platform hosts |
| [`crisp_ebook_conversion`](packages/crisp_ebook_conversion) | Optional Kindling converter for Kindle output and metadata updates |

Package names are retained so existing consumers and native plugin registrations
remain compatible. The facade does not require the native Kindle build hook.

## Editing without owning the host's files

```dart
import 'package:crisperbooks/crisperbooks.dart';

final session = EbookEditSession(EpubDocument.open(inputBytes));
session.mutate((book) => book.updateMetadata(title: 'Revised title'));
session.mutate((book) => book.addChapter(title: 'Afterword', text: 'New text.'));
session.undo();
session.redo();

await session.save((immutableBytes) async {
  await hostStore.saveWithConflictCheck(immutableBytes);
  return EbookSaveOutcome.savedOriginal;
});

final fictionBook = session.document.exportFictionBook();
await hostStore.deliverCopy(fictionBook.bytes, 'book.fb2');
session.dispose();
```

The save callback is your application's implementation. Report `savedCopy` or
`downloadedCopy` when the source was not overwritten; the session retains its
dirty state. Failed saves and newer edits survive asynchronous completion.
Set `copyOnly: true` for a normalized Kindle/FictionBook import.

Use `CrispEbookReader` with `CrispEbookController` for enhanced reading, or
`EbookChapterReader` with `EbookChapterReaderController` for portable EPUB reading.
`probeEbookLinuxHost()` lets the host select portable reading when sandboxed
WebKit is unavailable. Portable and enhanced locators have different identities.

`EbookProseEditorDialog` edits supported text nodes while retaining surrounding
markup. `EbookAppearanceDialog` supplies common reading controls.
`EbookReadingData` and `EbookReadingDataImportPlan` provide validated immutable
sidecars and explicit merge choices. These APIs never read cloud credentials.

## Formats and qualification

EPUB edits preserve untouched package resources. Kindle/FictionBook content
editing normalizes input to an EPUB copy; conversion may change layout and
reports limitations. Unsupported/protected input fails without replacing the
source. CBZ is a reading format. KFX and licensed DRM are not implemented.

The enhanced host targets web, Windows, macOS, Linux, Android and iOS. Workflows
exercise rendering and conversion; inspect actual results before claiming device
support. Portable recovery, compilation and enhanced rendering are separate
checks. This development branch does not establish every FBReader feature.

## Development

The qualification toolchain is Flutter 3.47.8 / Dart 3.13 and Node 24.22.1.

```sh
flutter pub get
flutter analyze
flutter test test
cd packages/crisp_ebook
dart test
```

Native conversion tests require Rust and the target toolchain; the converter
README documents configuration and asset verification. Keep test results tied to
their source revision.

Read [package boundaries](docs/architecture.md) and
[release preparation](docs/publishing.md). Nothing is published to pub.dev.
Existing licenses and third-party notices are preserved: the facade and EPUB core
retain AGPL-3.0; the reader/converter keep their package licenses.

The native acceptance harness uses a generated original cover fixture, the workspace package configuration, an explicit Bash pipeline on Android, and a scoped compatibility definition for the Windows WebView plugin on current MSVC. These fixes preserve the production reader and converter validation requirements.

Apple acceptance uses the explicit Intel macOS 15 runner and Xcode 26.3, avoiding the observed arm64 runner allocation failures. Android harness projects use the host-supported AGP 8.11.1, Kotlin 2.2.20 and Gradle 8.14.1 line. Workspace-aware FictionBook and Kindle import verification runs the actual converters and independent schema/EPUBCheck gates.

The unchanged `32b00f4` production packages passed the actual macOS 26.2
integration harness, including all eight publication-format cases, edited
Kindle/FictionBook exports and offline isolation. The compact
[execution log and source receipt](docs/evidence/native-macos-20261113/receipt.json)
retain the exact harness hashes; its only local changes add five progress logs.
The earlier hosted Mac job exhausted its combined build/test budget. Its budget
is now 90 minutes to cover both Rust builds and the real WebView host; publication
deadlines and assertions are unchanged. Hosted completion remains a separate gate.
