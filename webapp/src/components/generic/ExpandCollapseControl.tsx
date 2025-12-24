import React from 'react';

/**
 * A simple expand/collapse control that shows ▼ when expanded and ▶ when collapsed.
 * If hasChildren is false, shows a spacer instead of a button.
 */
export default function ExpandCollapseControl({
	hasChildren,
	isExpanded,
	onToggle,
}: {
	hasChildren: boolean;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	if (hasChildren) {
		return (
			<button 
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onToggle();
				}}
				style={{ 
					background: 'none', 
					border: 'none', 
					cursor: 'pointer',
					fontSize: '14px',
					padding: '2px 5px',
					flexShrink: 0
				}}
			>
				{isExpanded ? '▼' : '▶'}
			</button>
		);
	}
	return <span style={{ width: '20px', flexShrink: 0 }}></span>;
}

