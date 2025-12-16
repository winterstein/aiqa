import { useState } from 'react';
import JsonObjectViewer from './JsonObjectViewer';

/**
 * For viewing LLM input and output (which could be big).
 * TODO show (with expand/collapse bits) text that may have
 * xml tags or json blobs in it.
 */
export default function TextWithStructureViewer({text}) {
	// parse text into an array of plain-text / xml / json blocks
	let blocks = [];
	// Blocks must start on a new line.
	// Look for xml blocks which start a line with <tag and end with </tag> 
	// or json blocks	
	let index = 0;
	const blockStart = /^<[a-zA-Z][a-zA-Z0-9_]*|{|\[/;
	const matches = text.matchAll(blockStart);
	matches.forEach((match) => {
		console.log(match)
	});
	// fallback:
	blocks = [{type: 'text', text}];
	// render
	return <div>
		{blocks.map((block) => {
			return <div key={block.id}>
				{block.type === 'text' && <TextViewer text={block.text} />}
				{/* {block.type === 'xml' && <XmlObjectViewer xml={block.xml} />} */}
				{block.type === 'json' && <JsonObjectViewer json={block.json} />}
			</div>
		})}
	</div>
}

/**
 * Show potentially big text
 */
function TextViewer({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	if (text.length > 1000 && !expanded) {
		return <div>{text.slice(0, 1000) + '...'} <button onClick={() => setExpanded(true)}>Expand</button></div>
	}
	return <div>{text}</div>
}
