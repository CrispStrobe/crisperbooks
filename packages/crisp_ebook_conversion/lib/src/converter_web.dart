import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'models.dart';

EbookConversionBackend createBackend({
  String? executablePath,
  String? libraryPath,
  Uri? webWorkerUri,
  required Duration timeout,
  required EbookConversionLimits limits,
}) => _WebBackend(webWorkerUri, timeout, limits);

@JS()
extension type _Request._(JSObject _) implements JSObject {
  external factory _Request({
    required String kind,
    String? request,
    JSArrayBuffer? bytes,
  });
}

@JS()
extension type _Reply._(JSObject _) implements JSObject {
  external String get kind;
  external String get json;
  external JSArrayBuffer? get bytes;
}

class _WorkerResult {
  _WorkerResult(this.kind, this.json, this.bytes);
  final String kind;
  final Map<String, dynamic> json;
  final Uint8List? bytes;
}

class _WebBackend implements EbookConversionBackend {
  _WebBackend(this.workerUri, this.timeout, this.limits);
  final Uri? workerUri;
  final Duration timeout;
  final EbookConversionLimits limits;
  bool _busy = false;

  @override
  Future<EbookConversionCapabilities> capabilities() async {
    try {
      final result = await _call(
        _Request(kind: 'probe'),
        deadline: timeout < const Duration(seconds: 8)
            ? timeout
            : const Duration(seconds: 8),
      );
      if (result.kind != 'ready' ||
          result.json['abi'] != 2 ||
          result.json['version'] != '0.46.2') {
        throw const EbookConversionException(
          'unavailable',
          'The bundled browser conversion engine could not be loaded.',
        );
      }
      return const EbookConversionCapabilities(
        available: true,
        runtime: EbookConversionRuntime.webAssembly,
        cancellationMode: EbookCancellationMode.workerTermination,
        engineVersion: '0.46.2',
        canExportAzw3: true,
        canExportLegacyMobi: true,
        canRewriteKindleMetadata: true,
        canReplaceKindleCover: false,
      );
    } catch (error) {
      return EbookConversionCapabilities(
        available: false,
        runtime: EbookConversionRuntime.unavailable,
        cancellationMode: EbookCancellationMode.unavailable,
        reason: error is EbookConversionException
            ? error.message
            : 'The bundled browser conversion engine is unavailable.',
      );
    }
  }

  @override
  Future<EbookConversionResult> convert(
    Uint8List input, {
    required bool metadataOnly,
    required KindleExportFormat format,
    KindleMetadataPatch? patch,
    Uint8List? cover,
    EbookCancellationToken? cancellation,
  }) {
    if (cover != null) {
      return Future.error(
        const EbookConversionException(
          'unsupportedOperation',
          'Kindle cover replacement requires the native converter.',
        ),
      );
    }
    if (limits.maxInputBytes <= 0 ||
        limits.maxInputBytes > 64 * 1024 * 1024 ||
        limits.maxOutputBytes <= 0 ||
        limits.maxOutputBytes > 128 * 1024 * 1024 ||
        limits.maxExpandedBytes <= 0 ||
        limits.maxExpandedBytes > 192 * 1024 * 1024 ||
        limits.maxEntryBytes <= 0 ||
        limits.maxEntryBytes > 32 * 1024 * 1024 ||
        limits.maxArchiveEntries <= 0 ||
        limits.maxArchiveEntries > 10000 ||
        limits.maxImagePixels <= 0 ||
        limits.maxImagePixels > 50000000 ||
        input.isEmpty ||
        input.length > limits.maxInputBytes) {
      return Future.error(
        const EbookConversionException(
          'limitExceeded',
          'Ebook size exceeds the browser conversion limit.',
        ),
      );
    }
    if (_busy) {
      return Future.error(
        const EbookConversionException(
          'busy',
          'A conversion operation is still running.',
        ),
      );
    }
    if (cancellation?.isCancelled ?? false) {
      return Future.error(
        const EbookConversionException(
          'cancelled',
          'Kindle conversion was cancelled.',
        ),
      );
    }
    final request = jsonEncode({
      'operation': metadataOnly ? 'metadata' : 'export',
      'format': format.extension,
      'metadata': patch?.toJson() ?? <String, Object?>{},
      'limits': limits.toJson(),
    });
    if (utf8.encode(request).length > 131072) {
      return Future.error(
        const EbookConversionException(
          'limitExceeded',
          'Metadata is too large.',
        ),
      );
    }
    _busy = true;
    // Snapshot before the first await; only this private buffer is transferred.
    final snapshot = Uint8List.fromList(input);
    return _convert(snapshot, request, format, cancellation);
  }

  Future<EbookConversionResult> _convert(
    Uint8List snapshot,
    String request,
    KindleExportFormat format,
    EbookCancellationToken? cancellation,
  ) async {
    try {
      final buffer = snapshot.buffer.toJS;
      final result = await _call(
        _Request(kind: 'convert', request: request, bytes: buffer),
        transfer: <JSObject>[buffer].toJS,
        deadline: timeout,
        cancellation: cancellation,
      );
      final response = result.json;
      if (response['ok'] != true) {
        throw EbookConversionException(
          response['code'] as String? ?? 'conversionFailed',
          response['message'] as String? ?? 'Kindle conversion failed.',
        );
      }
      final bytes = result.bytes;
      if (result.kind != 'result' ||
          response['version'] != '0.46.2' ||
          response['format'] != format.extension ||
          bytes == null ||
          bytes.length < 78 ||
          bytes.length > limits.maxOutputBytes ||
          ascii.decode(bytes.sublist(60, 68), allowInvalid: true) !=
              'BOOKMOBI') {
        throw const EbookConversionException(
          'validationFailed',
          'Unexpected browser conversion response.',
        );
      }
      return EbookConversionResult(
        bytes: bytes,
        format: format,
        engineVersion: '0.46.2',
        noOp: response['noOp'] == true,
        warnings: (response['warnings'] as List? ?? const []).cast<String>(),
        changes: (response['changes'] as List? ?? const []).map(
          (change) => EbookMetadataChange(
            change['record'] as int,
            change['action'] as String,
          ),
        ),
      );
    } finally {
      _busy = false;
    }
  }

  Future<_WorkerResult> _call(
    _Request request, {
    required Duration deadline,
    JSArray<JSObject>? transfer,
    EbookCancellationToken? cancellation,
  }) async {
    if (deadline <= Duration.zero) {
      throw const EbookConversionException(
        'timeout',
        'Kindle conversion timed out.',
      );
    }
    web.Worker? worker;
    Timer? timer;
    final completion = Completer<_WorkerResult>();
    void fail(String code, String message) {
      if (!completion.isCompleted) {
        completion.completeError(EbookConversionException(code, message));
      }
    }

    try {
      final base = Uri.parse(web.document.baseURI);
      final uri = base.resolveUri(
        workerUri ??
            Uri.parse(
              'assets/packages/crisp_ebook_conversion/assets/conversion_worker.js',
            ),
      );
      if (!{'http', 'https'}.contains(uri.scheme) ||
          uri.origin != base.origin ||
          uri.userInfo.isNotEmpty) {
        throw const EbookConversionException(
          'unavailable',
          'Conversion worker must be a bundled same-origin asset.',
        );
      }
      worker = web.Worker(
        uri.toString().toJS,
        web.WorkerOptions(type: 'module'),
      );
      worker.onmessage = ((web.MessageEvent event) {
        if (completion.isCompleted) return;
        try {
          final reply = _Reply._(event.data as JSObject);
          final json = jsonDecode(reply.json) as Map<String, dynamic>;
          final bytes = reply.bytes?.toDart.asUint8List();
          completion.complete(_WorkerResult(reply.kind, json, bytes));
        } catch (_) {
          fail('validationFailed', 'Invalid browser conversion response.');
        }
      }).toJS;
      worker.onerror = ((web.Event event) {
        event.preventDefault();
        fail(
          'unavailable',
          'The bundled conversion worker could not be started.',
        );
      }).toJS;
      worker.onmessageerror = ((web.Event event) {
        fail(
          'validationFailed',
          'The conversion worker response could not be read.',
        );
      }).toJS;
      timer = Timer(
        deadline,
        () => fail('timeout', 'Kindle conversion timed out.'),
      );
      if (cancellation != null) {
        if (cancellation.isCancelled) {
          throw const EbookConversionException(
            'cancelled',
            'Kindle conversion was cancelled.',
          );
        }
        unawaited(
          cancellation.whenCancelled.then((_) {
            fail('cancelled', 'Kindle conversion was cancelled.');
          }),
        );
      }
      if (transfer == null) {
        worker.postMessage(request);
      } else {
        worker.postMessage(request, transfer);
      }
      return await completion.future;
    } on EbookConversionException {
      rethrow;
    } catch (_) {
      throw const EbookConversionException(
        'unavailable',
        'The bundled conversion worker is unavailable.',
      );
    } finally {
      timer?.cancel();
      if (worker != null) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
    }
  }
}
