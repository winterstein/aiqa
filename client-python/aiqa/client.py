# aiqa/client.py
import os
from functools import lru_cache
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased

from .aiqa_exporter import AIQASpanExporter

AIQA_TRACER_NAME = "aiqa-tracer"

client = {
    "provider": None,
    "exporter": None,
}

# Component tag to add to all spans (can be set via AIQA_COMPONENT_TAG env var or programmatically)
_component_tag: str = ""


def get_component_tag() -> str:
    """Get the current component tag."""
    return _component_tag


def set_component_tag(tag: str | None) -> None:
    """Set the component tag programmatically (overrides environment variable)."""
    global _component_tag
    _component_tag = tag or ""


@lru_cache(maxsize=1)
def get_aiqa_client():
    """
    Initialize and return the AIQA client.
    
    This function must be called before using any AIQA tracing functionality to ensure
    that environment variables (such as AIQA_SERVER_URL, AIQA_API_KEY, AIQA_COMPONENT_TAG)
    are properly loaded and the tracing system is initialized.
    
    The function is idempotent - calling it multiple times is safe and will only
    initialize once.
    
    Example:
        from aiqa import get_aiqa_client, WithTracing
        
        # Initialize client (loads env vars)
        get_aiqa_client()
        
        @WithTracing
        def my_function():
            pass
    """
    global client
    _init_tracing()
    # optionally return a richer client object; for now you just need init    
    return client

def _init_tracing():
    """Initialize tracing system and load configuration from environment variables."""
    
    # Initialize component tag from environment variable
    set_component_tag(os.getenv("AIQA_COMPONENT_TAG", None))
    
    provider = trace.get_tracer_provider()

    # If it's still the default proxy, install a real SDK provider
    if not isinstance(provider, TracerProvider):
        # Get sampling rate from environment (default: 1.0 = sample all)
        sampling_rate = 1.0
        if env_rate := os.getenv("AIQA_SAMPLING_RATE"):
            try:
                rate = float(env_rate)
                sampling_rate = max(0.0, min(1.0, rate))  # Clamp to [0, 1]
            except ValueError:
                pass
        
        # Create sampler based on trace-id for deterministic sampling
        sampler = TraceIdRatioBased(sampling_rate)
        provider = TracerProvider(sampler=sampler)
        trace.set_tracer_provider(provider)

    # Idempotently add your processor
    _attach_aiqa_processor(provider)
    global client
    client["provider"] = provider

def _attach_aiqa_processor(provider: TracerProvider):
    # Avoid double-adding if get_aiqa_client() is called multiple times
    for p in provider._active_span_processor._span_processors:
        if isinstance(getattr(p, "exporter", None), AIQASpanExporter):
            return

    exporter = AIQASpanExporter(
        server_url=os.getenv("AIQA_SERVER_URL"),
        api_key=os.getenv("AIQA_API_KEY"),
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    global client
    client["exporter"] = exporter