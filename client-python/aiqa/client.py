# aiqa/client.py
import os
import logging
from functools import lru_cache
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger("AIQA")

# Compatibility import for TraceIdRatioBased sampler
# In older OpenTelemetry versions it was TraceIdRatioBasedSampler
# In newer versions (>=1.24.0) it's TraceIdRatioBased
TraceIdRatioBased = None
try:
    from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
except ImportError:
    try:
        from opentelemetry.sdk.trace.sampling import TraceIdRatioBasedSampler as TraceIdRatioBased
    except ImportError:
        logger.warning(
            "Could not import TraceIdRatioBased or TraceIdRatioBasedSampler from "
            "opentelemetry.sdk.trace.sampling. AIQA tracing may not work correctly. "
            "Please ensure opentelemetry-sdk>=1.24.0 is installed. "
            "Try: pip install --upgrade opentelemetry-sdk"
        )
        # Set to None so we can check later
        TraceIdRatioBased = None

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
    try:
        _init_tracing()
    except Exception as e:
        logger.error(f"Failed to initialize AIQA tracing: {e}")
        logger.warning("AIQA tracing is disabled. Your application will continue to run without tracing.")
    # optionally return a richer client object; for now you just need init    
    return client

def _init_tracing():
    """Initialize tracing system and load configuration from environment variables."""
    try:
        # Initialize component tag from environment variable
        set_component_tag(os.getenv("AIQA_COMPONENT_TAG", None))
        
        provider = trace.get_tracer_provider()

        # Get sampling rate from environment (default: 1.0 = sample all)
        sampling_rate = 1.0
        if env_rate := os.getenv("AIQA_SAMPLING_RATE"):
            try:
                rate = float(env_rate)
                sampling_rate = max(0.0, min(1.0, rate))  # Clamp to [0, 1]
            except ValueError:
                logger.warning(f"Invalid AIQA_SAMPLING_RATE value '{env_rate}', using default 1.0")

        # If it's still the default proxy, install a real SDK provider
        if not isinstance(provider, TracerProvider):
            if TraceIdRatioBased is None:
                raise ImportError(
                    "TraceIdRatioBased sampler is not available. "
                    "Please install opentelemetry-sdk>=1.24.0"
                )
            
            # Create sampler based on trace-id for deterministic sampling
            sampler = TraceIdRatioBased(sampling_rate)
            provider = TracerProvider(sampler=sampler)
            trace.set_tracer_provider(provider)

        # Idempotently add your processor
        _attach_aiqa_processor(provider)
        global client
        client["provider"] = provider
        
        # Log successful initialization
        server_url = os.getenv("AIQA_SERVER_URL", "not configured")
        logger.info(f"AIQA initialized and tracing (sampling rate: {sampling_rate:.2f}, server: {server_url})")
        
    except Exception as e:
        logger.error(f"Error initializing AIQA tracing: {e}")
        raise

def _attach_aiqa_processor(provider: TracerProvider):
    """Attach AIQA span processor to the provider. Idempotent - safe to call multiple times."""
    try:
        # Avoid double-adding if get_aiqa_client() is called multiple times
        for p in provider._active_span_processor._span_processors:
            if isinstance(getattr(p, "exporter", None), AIQASpanExporter):
                logger.debug("AIQA span processor already attached, skipping")
                return

        exporter = AIQASpanExporter(
            server_url=os.getenv("AIQA_SERVER_URL"),
            api_key=os.getenv("AIQA_API_KEY"),
        )
        provider.add_span_processor(BatchSpanProcessor(exporter))
        global client
        client["exporter"] = exporter
        logger.debug("AIQA span processor attached successfully")
    except Exception as e:
        logger.error(f"Error attaching AIQA span processor: {e}")
        # Re-raise to let _init_tracing handle it - it will log and continue
        raise


def get_aiqa_tracer():
    """
    Get the AIQA tracer with version from __init__.py __version__.
    This should be used instead of trace.get_tracer() to ensure version is set.
    """
    try:
        # Import here to avoid circular import
        from . import __version__
        
        # Compatibility: version parameter may not be supported in older OpenTelemetry versions
        try:
            # Try with version parameter (newer OpenTelemetry versions)
            return trace.get_tracer(AIQA_TRACER_NAME, version=__version__)
        except TypeError:
            # Fall back to without version parameter (older versions)
            return trace.get_tracer(AIQA_TRACER_NAME)
    except Exception as e:
        logger.error(f"Error getting AIQA tracer: {e}")
        # Return a basic tracer as fallback to prevent crashes
        return trace.get_tracer(AIQA_TRACER_NAME)