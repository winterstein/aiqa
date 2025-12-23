"""
Python client for AIQA server - OpenTelemetry tracing decorators.
"""

from .tracing import (
    WithTracing,
    flush_tracing,
    shutdown_tracing,
    set_span_attribute,
    set_span_name,
    get_active_span,
    get_provider,
    get_exporter,
    get_trace_id,
    get_span_id,
    create_span_from_trace_id,
    inject_trace_context,
    extract_trace_context,
    set_conversation_id,
)
from .client import get_client
from .ExperimentRunner import ExperimentRunner

__version__ = "0.2.2"

__all__ = [
    "WithTracing",
    "flush_tracing",
    "shutdown_tracing",
    "set_span_attribute",
    "set_span_name",
    "get_active_span",
    "get_provider",
    "get_exporter",
    "get_client",
    "ExperimentRunner",
    "get_trace_id",
    "get_span_id",
    "create_span_from_trace_id",
    "inject_trace_context",
    "extract_trace_context",
    "set_conversation_id",
    "__version__",
]

