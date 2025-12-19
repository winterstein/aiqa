
export interface Metric {
  name: string;
  description?: string;
  unit?: string;
  type: 'javascript' | 'llm'
  parameters?: Record<string, any>;
}

export default interface Dataset {
  id: string;
  organisation: string;
  name: string;
  description?: string;
  tags?: string[];
  input_schema?: any;
  output_schema?: any;
  metrics?: Metric[];
  created: Date;
  updated: Date;
}

