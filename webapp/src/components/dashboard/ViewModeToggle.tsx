import React from 'react';
import { ButtonGroup, Button } from 'reactstrap';

type ViewMode = 'histogram' | 'timeseries';

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const ViewModeToggle: React.FC<ViewModeToggleProps> = ({ viewMode, onViewModeChange }) => {
  return (
    <ButtonGroup>
      <Button
        color={viewMode === 'histogram' ? 'primary' : 'secondary'}
        onClick={() => onViewModeChange('histogram')}
        size="sm"
      >
        Histogram
      </Button>
      <Button
        color={viewMode === 'timeseries' ? 'primary' : 'secondary'}
        onClick={() => onViewModeChange('timeseries')}
        size="sm"
      >
        Time Series
      </Button>
    </ButtonGroup>
  );
};

export default ViewModeToggle;
export type { ViewMode };

