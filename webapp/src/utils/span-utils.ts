import { Span } from "../common/types";

export function getDurationUnits(durationMs: number | null | undefined): 'ms' | 's' | 'm' | 'h' | 'd' | null {
	if (durationMs === null || durationMs === undefined) return null;
	if (durationMs < 1000) return 'ms';
	if (durationMs < 1000000) return 's';
	if (durationMs < 60000) return 'm';
	if (durationMs < 3600000) return 'h';
	return 'd';
}

export function durationString(durationMs: number | null | undefined, units: 'ms' | 's' | 'm' | 'h' | 'd' | null = null): string {
	if (durationMs === null || durationMs === undefined) return '';
	// if units is unset, pick the most appropriate unit
	if (units === null) {
		units = getDurationUnits(durationMs);
	}
	// switch by unit
	if (units === 'ms') return `${durationMs}ms`;
	if (units === 's') return `${Math.round(durationMs / 1000)}s`;
	if (units === 'm') return `${Math.round(durationMs / 60000)}m`;
	if (units === 'h') return `${Math.round(durationMs / 3600000)}h`;
	if (units === 'd') return `${Math.round(durationMs / 86400000)}d`;
	return '';
}


export const getSpanId = (span: Span) => {
    // Check all possible locations for span ID, in order of preference:
    // 1. clientSpanId (client-set, takes precedence)
    // 2. spanId (direct OpenTelemetry property)
    // 3. span.id (nested property)
    // 4. client_span_id (alternative naming)
    return (span as any).clientSpanId 
        || (span as any).spanId 
        || (span as any).span?.id 
        || (span as any).client_span_id 
        || 'N/A';
  };

  const asTime = (time: number|[number, number]|Date) => {
	if ( ! time) return null;
	if (typeof time === 'number') {
		return new Date(time);
	}
	if (Array.isArray(time)) {
		return new Date(time[0] * 1000 + time[1] / 1000000);
	}
	if (time instanceof Date) {
		return time;
	}	
	return new Date(time);
  };

export const getStartTime = (span: Span) => {
	return asTime(span.startTime);
  };

export const getEndTime = (span: Span) => {
	return asTime(span.endTime);
  };

export const getDurationMs = (span: Span): number | null => {
    const start = getStartTime(span);
    const end = getEndTime(span);
    if ( ! start || ! end) return null;
    return end.getTime() - start.getTime();
  };
