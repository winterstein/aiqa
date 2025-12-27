import React from 'react';
import { TimeseriesDataPoint } from './useTraceMetrics';
import { FEEDBACK_ICONS } from './chart-constants';

interface TimeseriesTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: TimeseriesDataPoint }> | null;
}

export const TimeseriesTooltip: React.FC<TimeseriesTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0]?.payload;
  if (!data) {
    return null;
  }

  return (
    <div className="bg-white p-2 border rounded shadow">
      <p className="mb-1"><strong>Time:</strong> {new Date(data.time).toLocaleString()}</p>
      <p className="mb-1"><strong>Duration:</strong> {data.duration.toFixed(2)}ms</p>
      {data.tokens > 0 && <p className="mb-1"><strong>Tokens:</strong> {data.tokens.toLocaleString()}</p>}
      {data.cost > 0 && <p className="mb-1"><strong>Cost:</strong> ${data.cost.toFixed(4)}</p>}
      {data.feedback !== 0 && (
        <p className="mb-0">
          <strong>Feedback:</strong> {data.feedback === 1 ? FEEDBACK_ICONS.positive : FEEDBACK_ICONS.negative}
        </p>
      )}
    </div>
  );
};

