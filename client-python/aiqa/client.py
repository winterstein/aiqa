# aiqa/client.py
import os
import logging
from functools import lru_cache
from typing import Optional
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


class AIQAClient:
    """
    Singleton client for AIQA tracing.
    
    This class manages the tracing provider, exporter, and enabled state.
    Access via get_aiqa_client() which returns the singleton instance.
    """
    _instance: Optional['AIQAClient'] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._provider: Optional[TracerProvider] = None
            cls._instance._exporter: Optional[AIQASpanExporter] = None
            cls._instance._enabled: bool = True
            cls._instance._initialized: bool = False
        return cls._instance
    
    @property
    def provider(self) -> Optional[TracerProvider]:
        """Get the tracer provider."""
        return self._provider
    
    @provider.setter
    def provider(self, value: Optional[TracerProvider]) -> None:
        """Set the tracer provider."""
        self._provider = value
    
    @property
    def exporter(self) -> Optional[AIQASpanExporter]:
        """Get the span exporter."""
        return self._exporter
    
    @exporter.setter
    def exporter(self, value: Optional[AIQASpanExporter]) -> None:
        """Set the span exporter."""
        self._exporter = value
    
    @property
    def enabled(self) -> bool:
        """Check if tracing is enabled."""
        return self._enabled
    
    @enabled.setter
    def enabled(self, value: bool) -> None:
        """Set the enabled state."""
        self._enabled = value
    
    def set_enabled(self, enabled: bool) -> None:
        """
        Enable or disable AIQA tracing.
        
        When disabled:
        - Tracing does not create spans
        - Export does not send spans
        
        Args:
            enabled: True to enable tracing, False to disable
        """
        self._enabled = enabled
        if enabled:
            logger.info("AIQA tracing enabled")
        else:
            logger.info("AIQA tracing disabled")
    
    def is_enabled(self) -> bool:
        """Check if tracing is enabled."""
        return self._enabled


# Global singleton instance (for backward compatibility with direct access)
client: AIQAClient = AIQAClient()

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
def get_aiqa_client() -> AIQAClient:
    """
    Initialize and return the AIQA client singleton.
    
    This function must be called before using any AIQA tracing functionality to ensure
    that environment variables (such as AIQA_SERVER_URL, AIQA_API_KEY, AIQA_COMPONENT_TAG)
    are properly loaded and the tracing system is initialized.
    
    The client object manages the tracing system state. Tracing is done by the WithTracing 
    decorator. Experiments are run by the ExperimentRunner class.
    
    The function is idempotent - calling it multiple times is safe and will only
    initialize once.
    
    Example:
        from aiqa import get_aiqa_client, WithTracing
        
        # Initialize client (loads env vars)
        client = get_aiqa_client()
        
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
    return client

def _init_tracing():
    """Initialize tracing system and load configuration from environment variables."""
    global client
    if client._initialized:
        return
    
    try:
        # Check for required environment variables
        server_url = os.getenv("AIQA_SERVER_URL")
        api_key = os.getenv("AIQA_API_KEY")
        
        if not server_url or not api_key:
            client.enabled = False
            missing_vars = []
            if not server_url:
                missing_vars.append("AIQA_SERVER_URL")
            if not api_key:
                missing_vars.append("AIQA_API_KEY")
            logger.warning(
                f"AIQA tracing is disabled: missing required environment variables: {', '.join(missing_vars)}"
            )
            client._initialized = True
            return
        
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
        client.provider = provider
        
        # Log successful initialization
        logger.info(f"AIQA initialized and tracing (sampling rate: {sampling_rate:.2f}, server: {server_url})")
        client._initialized = True
        
    except Exception as e:
        logger.error(f"Error initializing AIQA tracing: {e}")
        client._initialized = True  # Mark as initialized even on error to prevent retry loops
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
        client.exporter = exporter
        logger.debug("AIQA span processor attached successfully")
    except Exception as e:
        logger.error(f"Error attaching AIQA span processor: {e}")
        # Re-raise to let _init_tracing handle it - it will log and continue
        raise


def set_enabled(enabled: bool) -> None:
    """
    Enable or disable AIQA tracing.
    
    When disabled:
    - Tracing does not create spans
    - Export does not send spans
    
    Args:
        enabled: True to enable tracing, False to disable
    
    Example:
        from aiqa import get_aiqa_client
        
        client = get_aiqa_client()
        client.set_enabled(False)  # Disable tracing
    """
    client = get_aiqa_client()
    client.set_enabled(enabled)


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