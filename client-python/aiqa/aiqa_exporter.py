"""
OpenTelemetry span exporter that sends spans to the AIQA server API.
Buffers spans and flushes them periodically or on shutdown. Thread-safe.
"""

import os
import json
import logging
import threading
import time
import io
from typing import List, Dict, Any, Optional
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

logger = logging.getLogger("AIQA")


class AIQASpanExporter(SpanExporter):
    """
    Exports spans to AIQA server. Buffers spans and auto-flushes every flush_interval_seconds.
    Call shutdown() before process exit to flush remaining spans.
    """

    def __init__(
        self,
        server_url: Optional[str] = None,
        api_key: Optional[str] = None,
        flush_interval_seconds: float = 5.0,
        max_batch_size_bytes: int = 5 * 1024 * 1024,  # 5MB default
    ):
        """
        Initialize the AIQA span exporter.

        Args:
            server_url: URL of the AIQA server (defaults to AIQA_SERVER_URL env var)
            api_key: API key for authentication (defaults to AIQA_API_KEY env var)
            flush_interval_seconds: How often to flush spans to the server
            max_batch_size_bytes: Maximum size of a single batch in bytes (default: 5mb)
        """
        self._server_url = server_url
        self._api_key = api_key
        self.flush_interval_ms = flush_interval_seconds * 1000
        self.max_batch_size_bytes = max_batch_size_bytes
        self.buffer: List[Dict[str, Any]] = []
        self.buffer_span_keys: set = set()  # Track (traceId, spanId) tuples to prevent duplicates (Python 3.8 compatible)
        self.buffer_lock = threading.Lock()
        self.flush_lock = threading.Lock()
        self.shutdown_requested = False
        self.flush_timer: Optional[threading.Thread] = None
        
        logger.info(
            f"Initializing AIQASpanExporter: server_url={self.server_url or 'not set'}, "
            f"flush_interval={flush_interval_seconds}s"
        )
        self._start_auto_flush()

    @property
    def server_url(self) -> str:         
        return self._server_url or os.getenv("AIQA_SERVER_URL", "").rstrip("/")

    @property
    def api_key(self) -> str:
        return self._api_key or os.getenv("AIQA_API_KEY", "")

    def export(self, spans: List[ReadableSpan]) -> SpanExportResult:
        """
        Export spans to the AIQA server. Adds spans to buffer for async flushing.
        Deduplicates spans based on (traceId, spanId) to prevent repeated exports.
        """
        if not spans:
            logger.debug("export() called with empty spans list")
            return SpanExportResult.SUCCESS
        logger.debug(f"AIQA export() called with {len(spans)} spans")
        # Serialize and add to buffer, deduplicating by (traceId, spanId)
        with self.buffer_lock:
            serialized_spans = []
            duplicates_count = 0
            for span in spans:
                serialized = self._serialize_span(span)
                span_key = (serialized["traceId"], serialized["spanId"])
                if span_key not in self.buffer_span_keys:
                    serialized_spans.append(serialized)
                    self.buffer_span_keys.add(span_key)
                else:
                    duplicates_count += 1
                    logger.debug(f"export() skipping duplicate span: traceId={serialized['traceId']}, spanId={serialized['spanId']}")
            
            self.buffer.extend(serialized_spans)
            buffer_size = len(self.buffer)
        
        if duplicates_count > 0:
            logger.debug(
                f"export() added {len(serialized_spans)} span(s) to buffer, skipped {duplicates_count} duplicate(s). "
                f"Total buffered: {buffer_size}"
            )
        else:
            logger.debug(
                f"export() added {len(spans)} span(s) to buffer. "
                f"Total buffered: {buffer_size}"
            )

        return SpanExportResult.SUCCESS

    def _serialize_span(self, span: ReadableSpan) -> Dict[str, Any]:
        """Convert ReadableSpan to a serializable format."""
        span_context = span.get_span_context()
        
        # Get parent span ID
        parent_span_id = None
        if hasattr(span, "parent") and span.parent:
            parent_span_id = format(span.parent.span_id, "016x")
        elif hasattr(span, "parent_span_id") and span.parent_span_id:
            parent_span_id = format(span.parent_span_id, "016x")
        
        # Get span kind (handle both enum and int)
        span_kind = span.kind
        if hasattr(span_kind, "value"):
            span_kind = span_kind.value
        
        # Get status code (handle both enum and int)
        status_code = span.status.status_code
        if hasattr(status_code, "value"):
            status_code = status_code.value
        
        return {
            "name": span.name,
            "kind": span_kind,
            "parentSpanId": parent_span_id,
            "startTime": self._time_to_tuple(span.start_time),
            "endTime": self._time_to_tuple(span.end_time) if span.end_time else None,
            "status": {
                "code": status_code,
                "message": getattr(span.status, "description", None),
            },
            "attributes": dict(span.attributes) if span.attributes else {},
            "links": [
                {
                    "context": {
                        "traceId": format(link.context.trace_id, "032x"),
                        "spanId": format(link.context.span_id, "016x"),
                    },
                    "attributes": dict(link.attributes) if link.attributes else {},
                }
                for link in (span.links or [])
            ],
            "events": [
                {
                    "name": event.name,
                    "time": self._time_to_tuple(event.timestamp),
                    "attributes": dict(event.attributes) if event.attributes else {},
                }
                for event in (span.events or [])
            ],
            "resource": {
                "attributes": dict(span.resource.attributes) if span.resource.attributes else {},
            },
            "traceId": format(span_context.trace_id, "032x"),
            "spanId": format(span_context.span_id, "016x"),
            "traceFlags": span_context.trace_flags,
            "duration": self._time_to_tuple(span.end_time - span.start_time) if span.end_time else None,
            "ended": span.end_time is not None,
            "instrumentationLibrary": {
                "name": self._get_instrumentation_name(),
                "version": self._get_instrumentation_version(),
            },
        }

    def _time_to_tuple(self, nanoseconds: int) -> tuple:
        """Convert nanoseconds to (seconds, nanoseconds) tuple."""
        seconds = int(nanoseconds // 1_000_000_000)
        nanos = int(nanoseconds % 1_000_000_000)
        return (seconds, nanos)
    
    def _get_instrumentation_name(self) -> str:
        """Get instrumentation library name - always 'aiqa-tracer'."""
        from .client import AIQA_TRACER_NAME
        return AIQA_TRACER_NAME
    
    def _get_instrumentation_version(self) -> Optional[str]:
        """Get instrumentation library version from __version__."""
        try:
            from . import __version__
            return __version__
        except (ImportError, AttributeError):
            return None

    def _build_request_headers(self) -> Dict[str, str]:
        """Build HTTP headers for span requests."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"ApiKey {self.api_key}"
        return headers

    def _get_span_url(self) -> str:
        """Get the URL for sending spans."""
        if not self.server_url:
            raise ValueError("AIQA_SERVER_URL is not set. Cannot send spans to server.")
        return f"{self.server_url}/span"

    def _is_interpreter_shutdown_error(self, error: Exception) -> bool:
        """Check if error is due to interpreter shutdown."""
        error_str = str(error)
        return "cannot schedule new futures after" in error_str or "interpreter shutdown" in error_str

    def _extract_spans_from_buffer(self) -> List[Dict[str, Any]]:
        """Extract spans from buffer (thread-safe). Returns copy of buffer."""
        with self.buffer_lock:
            return self.buffer[:]

    def _extract_and_remove_spans_from_buffer(self) -> List[Dict[str, Any]]:
        """
        Atomically extract and remove all spans from buffer (thread-safe).
        Returns the extracted spans. This prevents race conditions where spans
        are added between extraction and clearing.
        Note: Does NOT clear buffer_span_keys - that should be done after successful send
        to avoid unnecessary clearing/rebuilding on failures.
        """
        with self.buffer_lock:
            spans = self.buffer[:]
            self.buffer.clear()
            return spans
    
    def _remove_span_keys_from_tracking(self, spans: List[Dict[str, Any]]) -> None:
        """
        Remove span keys from tracking set (thread-safe). Called after successful send.
        """
        with self.buffer_lock:
            for span in spans:
                span_key = (span["traceId"], span["spanId"])
                self.buffer_span_keys.discard(span_key)

    def _prepend_spans_to_buffer(self, spans: List[Dict[str, Any]]) -> None:
        """
        Prepend spans back to buffer (thread-safe). Used to restore spans
        if sending fails. Rebuilds the span keys tracking set.
        """
        with self.buffer_lock:
            self.buffer[:0] = spans
            # Rebuild span keys set from current buffer contents
            self.buffer_span_keys = {(span["traceId"], span["spanId"]) for span in self.buffer}

    def _clear_buffer(self) -> None:
        """Clear the buffer (thread-safe)."""
        with self.buffer_lock:
            self.buffer.clear()
            self.buffer_span_keys.clear()

    def _split_into_batches(self, spans: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        """
        Split spans into batches based on max_batch_size_bytes.
        Each batch will be as large as possible without exceeding the limit.
        If a single span exceeds the limit, it will be sent in its own batch with a warning.
        """
        if not spans:
            return []
        
        batches = []
        current_batch = []
        current_batch_size = 0
        
        for span in spans:
            # Estimate size of this span when serialized
            span_json = json.dumps(span)
            span_size = len(span_json.encode('utf-8'))
            
            # Check if this single span exceeds the limit
            if span_size > self.max_batch_size_bytes:
                # If we have a current batch, save it first
                if current_batch:
                    batches.append(current_batch)
                    current_batch = []
                    current_batch_size = 0
                
                # Log warning about oversized span
                span_name = span.get('name', 'unknown')
                span_trace_id = span.get('traceId', 'unknown')
                logger.warning(
                    f"Span '{span_name}' (traceId={span_trace_id}) exceeds max_batch_size_bytes "
                    f"({span_size} bytes > {self.max_batch_size_bytes} bytes). "
                    f"Will attempt to send it anyway - may fail if server/nginx limit is exceeded."
                )
                # Still create a batch with just this span - we'll try to send it
                batches.append([span])
                continue
            
            # If adding this span would exceed the limit, start a new batch
            if current_batch and current_batch_size + span_size > self.max_batch_size_bytes:
                batches.append(current_batch)
                current_batch = []
                current_batch_size = 0
            
            current_batch.append(span)
            current_batch_size += span_size
        
        # Add the last batch if it has any spans
        if current_batch:
            batches.append(current_batch)
        
        return batches

    async def flush(self) -> None:
        """
        Flush buffered spans to the server. Thread-safe: ensures only one flush operation runs at a time.
        Atomically extracts spans to prevent race conditions with concurrent export() calls.
        """
        logger.debug("flush() called - attempting to acquire flush lock")
        with self.flush_lock:
            logger.debug("flush() acquired flush lock")
            # Atomically extract and remove spans to prevent race conditions
            # where export() adds spans between extraction and clearing
            spans_to_flush = self._extract_and_remove_spans_from_buffer()
            logger.debug(f"flush() extracted {len(spans_to_flush)} span(s) from buffer")

            if not spans_to_flush:
                logger.debug("flush() completed: no spans to flush")
                return

            # Skip sending if server URL is not configured
            if not self.server_url:
                logger.warning(
                    f"Skipping flush: AIQA_SERVER_URL is not set. {len(spans_to_flush)} span(s) will not be sent."
                )
                # Spans already removed from buffer, clear their keys to free memory
                self._remove_span_keys_from_tracking(spans_to_flush)
                return

            logger.info(f"flush() sending {len(spans_to_flush)} span(s) to server")
            try:
                await self._send_spans(spans_to_flush)
                logger.info(f"flush() successfully sent {len(spans_to_flush)} span(s) to server")
                # Spans already removed from buffer during extraction
                # Now clear their keys from tracking set to free memory
                self._remove_span_keys_from_tracking(spans_to_flush)
            except RuntimeError as error:
                if self._is_interpreter_shutdown_error(error):
                    if self.shutdown_requested:
                        logger.debug(f"flush() skipped due to interpreter shutdown: {error}")
                        # Put spans back for retry with sync send during shutdown
                        self._prepend_spans_to_buffer(spans_to_flush)
                    else:
                        logger.warning(f"flush() interrupted by interpreter shutdown: {error}")
                        # Put spans back for retry
                        self._prepend_spans_to_buffer(spans_to_flush)
                    raise
                logger.error(f"Error flushing spans to server: {error}")
                # Put spans back for retry
                self._prepend_spans_to_buffer(spans_to_flush)
                raise
            except Exception as error:
                logger.error(f"Error flushing spans to server: {error}")
                # Put spans back for retry
                self._prepend_spans_to_buffer(spans_to_flush)
                if self.shutdown_requested:
                    raise

    def _start_auto_flush(self) -> None:
        """Start the auto-flush timer."""
        if self.shutdown_requested:
            logger.warning("_start_auto_flush() called but shutdown already requested")
            return

        logger.info(f"Starting auto-flush thread with interval {self.flush_interval_ms / 1000.0}s")

        def flush_worker():
            import asyncio
            logger.debug("Auto-flush worker thread started")
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            cycle_count = 0
            while not self.shutdown_requested:
                cycle_count += 1
                logger.debug(f"Auto-flush cycle #{cycle_count} starting")
                try:
                    loop.run_until_complete(self.flush())
                    logger.debug(f"Auto-flush cycle #{cycle_count} completed, sleeping {self.flush_interval_ms / 1000.0}s")
                    time.sleep(self.flush_interval_ms / 1000.0)
                except Exception as e:
                    logger.error(f"Error in auto-flush cycle #{cycle_count}: {e}")
                    logger.debug(f"Auto-flush cycle #{cycle_count} error handled, sleeping {self.flush_interval_ms / 1000.0}s")
                    time.sleep(self.flush_interval_ms / 1000.0)
            
            logger.info(f"Auto-flush worker thread stopping (shutdown requested). Completed {cycle_count} cycles.")
            
            # Don't do final flush here - shutdown() will handle it with synchronous send
            # This avoids event loop shutdown issues
            logger.debug("Auto-flush thread skipping final flush (will be handled by shutdown() with sync send)")
            
            # Close the event loop
            try:
                if not loop.is_closed():
                    loop.close()
                logger.debug("Auto-flush worker thread event loop closed")
            except Exception:
                pass  # Ignore errors during cleanup

        flush_thread = threading.Thread(target=flush_worker, daemon=True, name="AIQA-AutoFlush")
        flush_thread.start()
        self.flush_timer = flush_thread
        logger.info(f"Auto-flush thread started: {flush_thread.name} (daemon={flush_thread.daemon})")

    async def _send_spans(self, spans: List[Dict[str, Any]]) -> None:
        """Send spans to the server API (async). Batches large payloads automatically."""
        import aiohttp

        # Split into batches if needed
        batches = self._split_into_batches(spans)
        if len(batches) > 1:
            logger.info(f"_send_spans() splitting {len(spans)} spans into {len(batches)} batches")
        
        url = self._get_span_url()
        headers = self._build_request_headers()
        
        if self.api_key:
            logger.debug("_send_spans() using API key authentication")
        else:
            logger.debug("_send_spans() no API key provided")

        errors = []
        async with aiohttp.ClientSession() as session:
            for batch_idx, batch in enumerate(batches):
                try:
                    logger.debug(f"_send_spans() sending batch {batch_idx + 1}/{len(batches)} with {len(batch)} spans to {url}")
                    # Pre-serialize JSON to bytes and wrap in BytesIO to avoid blocking event loop
                    json_bytes = json.dumps(batch).encode('utf-8')
                    data = io.BytesIO(json_bytes)
                    
                    async with session.post(url, data=data, headers=headers) as response:
                        logger.debug(f"_send_spans() batch {batch_idx + 1} received response: status={response.status}")
                        if not response.ok:
                            error_text = await response.text()
                            error_msg = f"Failed to send batch {batch_idx + 1}/{len(batches)}: {response.status} {response.reason} - {error_text[:200]}"
                            logger.error(f"_send_spans() {error_msg}")
                            errors.append((batch_idx + 1, error_msg))
                            # Continue with other batches even if one fails
                            continue
                        logger.debug(f"_send_spans() batch {batch_idx + 1} successfully sent {len(batch)} spans")
                except RuntimeError as e:
                    if self._is_interpreter_shutdown_error(e):
                        if self.shutdown_requested:
                            logger.debug(f"_send_spans() skipped due to interpreter shutdown: {e}")
                        else:
                            logger.warning(f"_send_spans() interrupted by interpreter shutdown: {e}")
                        raise
                    error_msg = f"RuntimeError in batch {batch_idx + 1}: {type(e).__name__}: {e}"
                    logger.error(f"_send_spans() {error_msg}")
                    errors.append((batch_idx + 1, error_msg))
                    # Continue with other batches
                except Exception as e:
                    error_msg = f"Exception in batch {batch_idx + 1}: {type(e).__name__}: {e}"
                    logger.error(f"_send_spans() {error_msg}")
                    errors.append((batch_idx + 1, error_msg))
                    # Continue with other batches
        
        # If any batches failed, raise an exception with details
        if errors:
            error_summary = "; ".join([f"batch {idx}: {msg}" for idx, msg in errors])
            raise Exception(f"Failed to send some spans: {error_summary}")
        
        logger.debug(f"_send_spans() successfully sent all {len(spans)} spans in {len(batches)} batch(es)")

    def _send_spans_sync(self, spans: List[Dict[str, Any]]) -> None:
        """Send spans to the server API (synchronous, for shutdown scenarios). Batches large payloads automatically."""
        import requests

        # Split into batches if needed
        batches = self._split_into_batches(spans)
        if len(batches) > 1:
            logger.info(f"_send_spans_sync() splitting {len(spans)} spans into {len(batches)} batches")
        
        url = self._get_span_url()
        headers = self._build_request_headers()
        
        if self.api_key:
            logger.debug("_send_spans_sync() using API key authentication")
        else:
            logger.debug("_send_spans_sync() no API key provided")

        errors = []
        for batch_idx, batch in enumerate(batches):
            try:
                logger.debug(f"_send_spans_sync() sending batch {batch_idx + 1}/{len(batches)} with {len(batch)} spans to {url}")
                response = requests.post(url, json=batch, headers=headers, timeout=10.0)
                logger.debug(f"_send_spans_sync() batch {batch_idx + 1} received response: status={response.status_code}")
                if not response.ok:
                    error_text = response.text[:200] if response.text else ""
                    error_msg = f"Failed to send batch {batch_idx + 1}/{len(batches)}: {response.status_code} {response.reason} - {error_text}"
                    logger.error(f"_send_spans_sync() {error_msg}")
                    errors.append((batch_idx + 1, error_msg))
                    # Continue with other batches even if one fails
                    continue
                logger.debug(f"_send_spans_sync() batch {batch_idx + 1} successfully sent {len(batch)} spans")
            except Exception as e:
                error_msg = f"Exception in batch {batch_idx + 1}: {type(e).__name__}: {e}"
                logger.error(f"_send_spans_sync() {error_msg}")
                errors.append((batch_idx + 1, error_msg))
                # Continue with other batches
        
        # If any batches failed, raise an exception with details
        if errors:
            error_summary = "; ".join([f"batch {idx}: {msg}" for idx, msg in errors])
            raise Exception(f"Failed to send some spans: {error_summary}")
        
        logger.debug(f"_send_spans_sync() successfully sent all {len(spans)} spans in {len(batches)} batch(es)")

    def shutdown(self) -> None:
        """Shutdown the exporter, flushing any remaining spans. Call before process exit."""
        logger.info("shutdown() called - initiating exporter shutdown")
        self.shutdown_requested = True

        # Check buffer state before shutdown
        with self.buffer_lock:
            buffer_size = len(self.buffer)
            logger.info(f"shutdown() buffer contains {buffer_size} span(s) before shutdown")

        # Wait for flush thread to finish (it will do final flush)
        if self.flush_timer and self.flush_timer.is_alive():
            logger.info("shutdown() waiting for auto-flush thread to complete (timeout=10s)")
            self.flush_timer.join(timeout=10.0)
            if self.flush_timer.is_alive():
                logger.warning("shutdown() auto-flush thread did not complete within timeout")
            else:
                logger.info("shutdown() auto-flush thread completed")
        else:
            logger.debug("shutdown() no active auto-flush thread to wait for")

        # Final flush attempt (use synchronous send to avoid event loop issues)
        with self.flush_lock:
            logger.debug("shutdown() performing final flush with synchronous send")
            # Atomically extract and remove spans to prevent race conditions
            spans_to_flush = self._extract_and_remove_spans_from_buffer()
            logger.debug(f"shutdown() extracted {len(spans_to_flush)} span(s) from buffer for final flush")

            if spans_to_flush:
                if not self.server_url:
                    logger.warning(
                        f"shutdown() skipping final flush: AIQA_SERVER_URL is not set. "
                        f"{len(spans_to_flush)} span(s) will not be sent."
                    )
                    # Spans already removed from buffer, clear their keys to free memory
                    self._remove_span_keys_from_tracking(spans_to_flush)
                else:
                    logger.info(f"shutdown() sending {len(spans_to_flush)} span(s) to server (synchronous)")
                    try:
                        self._send_spans_sync(spans_to_flush)
                        logger.info(f"shutdown() successfully sent {len(spans_to_flush)} span(s) to server")
                        # Spans already removed from buffer during extraction
                        # Clear their keys from tracking set to free memory
                        self._remove_span_keys_from_tracking(spans_to_flush)
                    except Exception as e:
                        logger.error(f"shutdown() failed to send spans: {e}")
                        # Spans already removed, but process is exiting anyway
                        logger.warning(f"shutdown() {len(spans_to_flush)} span(s) were not sent due to error")
                        # Keys will remain in tracking set, but process is exiting so memory will be freed
            else:
                logger.debug("shutdown() no spans to flush")
        
        # Check buffer state after shutdown
        with self.buffer_lock:
            buffer_size = len(self.buffer)
            if buffer_size > 0:
                logger.warning(f"shutdown() buffer still contains {buffer_size} span(s) after shutdown")
            else:
                logger.info("shutdown() buffer is empty after shutdown")
        
        logger.info("shutdown() completed")

