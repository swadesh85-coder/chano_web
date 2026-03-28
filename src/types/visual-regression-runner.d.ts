declare module '*.mjs' {
  export interface VisualRegressionCapture {
    readonly id: string;
  }

  export interface VisualRegressionResult {
    readonly passed: boolean;
    readonly failureCount: number;
    readonly captures: readonly VisualRegressionCapture[];
  }

  export function runVisualRegression(options?: {
    readonly updateBaseline?: boolean;
  }): Promise<VisualRegressionResult>;
}