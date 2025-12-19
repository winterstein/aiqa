import { Span } from './Span';

export interface Example {
    id: string;
    input: any;
    /**
     * For LLM based metrics
     */
    metricPrompts: string[];
    targetOutputs: any[];
    dataset: string;
}