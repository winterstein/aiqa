"""
Object serialization utilities for converting Python objects to JSON-safe formats.
Handles objects, dataclasses, circular references, and size limits.
"""

import json
import os
import dataclasses
from typing import Any, Callable, Set

# Configurable limit for object string representation (in characters)
_MAX_OBJECT_STR_CHARS = int(os.getenv("AIQA_MAX_OBJECT_STR_CHARS", "2000"))


def serialize_for_span(value: Any) -> Any:
    """
    Serialize a value for span attributes.
    OpenTelemetry only accepts primitives (bool, str, bytes, int, float) or sequences of those.
    Complex types (dicts, lists, objects) are converted to JSON strings.
    
    Handles objects by attempting to convert them to dicts, with safeguards against:
    - Circular references
    - Unconvertible parts
    - Large objects (size limits)
    """
    # Keep primitives as is (including None)
    if value is None or isinstance(value, (str, int, float, bool, bytes)):
        return value
    
    # For sequences, check if all elements are primitives
    if isinstance(value, (list, tuple)):
        # If all elements are primitives, return as list
        if all(isinstance(item, (str, int, float, bool, bytes, type(None))) for item in value):
            return list(value)
        # Otherwise serialize to JSON string
        try:
            return safe_json_dumps(value)
        except Exception:
            return str(value)
    
    # For dicts and other complex types, serialize to JSON string
    try:
        return safe_json_dumps(value)
    except Exception:
        # If JSON serialization fails, convert to string
        return safe_str_repr(value)


def safe_str_repr(value: Any) -> str:
    """
    Safely convert a value to string representation.
    Handles objects with __repr__ that might raise exceptions.
    Uses AIQA_MAX_OBJECT_STR_CHARS environment variable (default: 2000) to limit length.
    """
    try:
        # Try __repr__ first (usually more informative)
        repr_str = repr(value)
        # Limit length to avoid huge strings
        if len(repr_str) > _MAX_OBJECT_STR_CHARS:
            return repr_str[:_MAX_OBJECT_STR_CHARS] + "... (truncated)"
        return repr_str
    except Exception:
        # Fallback to type name
        try:
            return f"<{type(value).__name__} object>"
        except Exception:
            return "<unknown object>"


def object_to_dict(obj: Any, visited: Set[int], max_depth: int = 10, current_depth: int = 0) -> Any:
    """
    Convert an object to a dictionary representation.
    
    Args:
        obj: The object to convert
        visited: Set of object IDs to detect circular references
        max_depth: Maximum recursion depth
        current_depth: Current recursion depth
    
    Returns:
        Dictionary representation of the object, or a string if conversion fails
    """
    if current_depth > max_depth:
        return "<max depth exceeded>"
    
    obj_id = id(obj)
    if obj_id in visited:
        return "<circular reference>"
    
    # Handle None
    if obj is None:
        return None
    
    # Handle primitives
    if isinstance(obj, (str, int, float, bool, bytes)):
        return obj
    
    # Handle dict
    if isinstance(obj, dict):
        visited.add(obj_id)
        try:
            result = {}
            for k, v in obj.items():
                key_str = str(k) if not isinstance(k, (str, int, float, bool)) else k
                result[key_str] = object_to_dict(v, visited, max_depth, current_depth + 1)
            visited.remove(obj_id)
            return result
        except Exception:
            visited.discard(obj_id)
            return safe_str_repr(obj)
    
    # Handle list/tuple
    if isinstance(obj, (list, tuple)):
        visited.add(obj_id)
        try:
            result = [object_to_dict(item, visited, max_depth, current_depth + 1) for item in obj]
            visited.remove(obj_id)
            return result
        except Exception:
            visited.discard(obj_id)
            return safe_str_repr(obj)
    
    # Handle dataclasses
    if dataclasses.is_dataclass(obj):
        visited.add(obj_id)
        try:
            result = {}
            for field in dataclasses.fields(obj):
                value = getattr(obj, field.name, None)
                result[field.name] = object_to_dict(value, visited, max_depth, current_depth + 1)
            visited.remove(obj_id)
            return result
        except Exception:
            visited.discard(obj_id)
            return safe_str_repr(obj)
    
    # Handle objects with __dict__
    if hasattr(obj, "__dict__"):
        visited.add(obj_id)
        try:
            result = {}
            for key, value in obj.__dict__.items():
                # Skip private attributes that start with __
                if not (isinstance(key, str) and key.startswith("__")):
                    result[key] = object_to_dict(value, visited, max_depth, current_depth + 1)
            visited.remove(obj_id)
            return result
        except Exception:
            visited.discard(obj_id)
            return safe_str_repr(obj)
    
    # Handle objects with __slots__
    if hasattr(obj, "__slots__"):
        visited.add(obj_id)
        try:
            result = {}
            for slot in obj.__slots__:
                if hasattr(obj, slot):
                    value = getattr(obj, slot, None)
                    result[slot] = object_to_dict(value, visited, max_depth, current_depth + 1)
            visited.remove(obj_id)
            return result
        except Exception:
            visited.discard(obj_id)
            return safe_str_repr(obj)
    
    # Fallback: try to get a few common attributes
    try:
        result = {}
        for attr in ["name", "id", "value", "type", "status"]:
            if hasattr(obj, attr):
                value = getattr(obj, attr, None)
                result[attr] = object_to_dict(value, visited, max_depth, current_depth + 1)
        if result:
            return result
    except Exception:
        pass
    
    # Final fallback: string representation
    return safe_str_repr(obj)


def safe_json_dumps(value: Any, max_size_mb: float = 1.0) -> str:
    """
    Safely serialize a value to JSON string with safeguards against:
    - Circular references
    - Large objects (size limits)
    - Unconvertible parts
    
    Args:
        value: The value to serialize
        max_size_mb: Maximum size in MB for the JSON string (default: 1MB)
    
    Returns:
        JSON string representation
    """
    max_size_bytes = int(max_size_mb * 1024 * 1024)
    visited: Set[int] = set()
    
    # Convert the entire structure to ensure circular references are detected
    # across the whole object graph
    try:
        converted = object_to_dict(value, visited)
    except Exception:
        # If conversion fails, try with a fresh visited set and json default handler
        try:
            json_str = json.dumps(value, default=json_default_handler_factory(set()))
            if len(json_str.encode('utf-8')) > max_size_bytes:
                return f"<object too large: {len(json_str)} bytes (limit: {max_size_bytes} bytes)>"
            return json_str
        except Exception:
            return safe_str_repr(value)
    
    # Try JSON serialization of the converted structure
    try:
        json_str = json.dumps(converted, default=json_default_handler_factory(set()))
        # Check size
        if len(json_str.encode('utf-8')) > max_size_bytes:
            return f"<object too large: {len(json_str)} bytes (limit: {max_size_bytes} bytes)>"
        return json_str
    except Exception:
        # Final fallback
        return safe_str_repr(value)


def json_default_handler_factory(visited: Set[int]) -> Callable[[Any], Any]:
    """
    Create a JSON default handler with a shared visited set for circular reference detection.
    """
    def handler(obj: Any) -> Any:
        # Handle bytes
        if isinstance(obj, bytes):
            try:
                return obj.decode('utf-8')
            except UnicodeDecodeError:
                return f"<bytes: {len(obj)} bytes>"
        
        # Try object conversion with the shared visited set
        try:
            return object_to_dict(obj, visited)
        except Exception:
            return safe_str_repr(obj)
    
    return handler


def json_default_handler(obj: Any) -> Any:
    """
    Default handler for JSON serialization of non-serializable objects.
    This is a fallback that creates its own visited set.
    """
    return json_default_handler_factory(set())(obj)

